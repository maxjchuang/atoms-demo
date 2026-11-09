import { ArtifactManifest } from '@atoms/contracts';
import {
  ProjectMemoryUpdate, RouterResult, type StartCoordinationRequestDto, type RouterResultDto,
  type CoordinationExecutionSnapshotDto,
} from '@atoms/contracts/conversation';
import { sha256 } from './files.js';

export class CoordinationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export class CoordinatorStructureError extends CoordinationError {
 readonly feedback; readonly issues;
 constructor(path:(string|number)[],code='invalid_structure',aliases:Record<string,string[]>={}) {super(400,'INVALID_REQUEST','协调结果结构校验未通过，字段：'+path.map((p,i)=>typeof p==='number'?`[${p}]`:(i?'.':'')+p).join('')+'；请修正字段或澄清要求，未执行操作。');this.feedback={kind:'coordinator_structure' as const,issues:[{code,path,refs:[]}],rule:'Regenerate the complete result with valid objects and typed lists. Do not drop invalid items, fabricate source quotes or permissions, or change ledger authority. Known reference aliases: '+JSON.stringify(aliases)};this.issues=this.feedback.issues;}
}
export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, data) =>
  data && typeof data === 'object' && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) : data);
export function contextDigest(context: StartCoordinationRequestDto['context']) {
  const { hash: _hash, ...body } = context;
  return sha256(canonicalJson(body));
}
export const usedContext = (request: StartCoordinationRequestDto): CoordinationExecutionSnapshotDto['contextUsed'] => ({
  contextId: request.context.id, contextRevision: request.context.contextRevision,
  memoryRevision: request.context.projectMemory.revision, conversationRevision: request.context.conversationRevision,
  contextVersionId: request.context.contextVersionId, asOf: request.context.asOf, hash: request.context.hash,
});
export function validateContext(request: StartCoordinationRequestDto) {
  const context = request.context;
  if (context.hash !== contextDigest(context)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Context hash does not match its immutable facts');
  if (context.facts.project.id !== request.projectId || context.projectMemory.projectId !== request.projectId
    || context.projectMemory.decisions.some((decision) => decision.projectId !== request.projectId)
    || context.recentMessages.some((message) => message.projectId !== request.projectId)
    || context.pendingClarifications.some((item) => item.projectId !== request.projectId)
    || context.relevantProposals.some((item) => item.projectId !== request.projectId)) {
    throw new CoordinationError(400, 'INVALID_REQUEST', 'Context contains a foreign project resource');
  }
  if (context.recentMessages.length > request.budget.maxRecentMessages
    || Buffer.byteLength(JSON.stringify(context.recentMessages)) > request.budget.maxRecentMessageBytes
    || Buffer.byteLength(JSON.stringify(context.projectMemory)) > request.budget.maxMemoryBytes) {
    throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Project context exceeds its bounded history or memory budget');
  }
  if (context.sourceArtifact && (context.sourceArtifact.versionId !== context.contextVersionId
    || !context.facts.versions.some((version) => version.id === context.sourceArtifact!.versionId))) {
    throw new CoordinationError(400, 'INVALID_REQUEST', 'Published source does not match the authorized context version');
  }
  const operation = request.operation;
  if (operation.kind === 'proposal_refresh'
    && !context.relevantProposals.some((proposal) => proposal.id === operation.proposalId
      && proposal.revision === operation.expectedRevision)) {
    throw new CoordinationError(409, 'STALE_REVISION', 'Refresh requires the exact trusted proposal snapshot');
  }
}

export type SourceRead = { path: string; sha256: string; text: string };
export async function readPublishedSources(request: StartCoordinationRequestDto, paths: string[],
  apiUrl: string | undefined, serviceToken: string, signal: AbortSignal,
): Promise<SourceRead[]> {
  const source = request.context.sourceArtifact;
  if (!source || !apiUrl) throw new CoordinationError(400, 'INVALID_REQUEST', 'No published source snapshot is authorized');
  if (paths.length === 0 || paths.length > request.budget.maxSourceFiles || new Set(paths).size !== paths.length) {
    throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Source file count exceeds the authorized budget');
  }
  if (paths.some((name) => !name.startsWith('source/') || !source.allowedPaths.includes(name)
    || name.split('/').some((part) => ['..', '.', '', '.env', '.git', '.dsh', 'node_modules'].includes(part)))) {
    throw new CoordinationError(403, 'FORBIDDEN', 'Source path is not in the published read allowlist');
  }
  const base = `${apiUrl}/internal/v1/input-artifacts/${source.artifactId}`;
  const headers = { authorization: `Bearer ${serviceToken}`, 'x-atoms-protocol-version': '0.1.0' };
  const response = await fetch(`${base}/manifest`, { headers, signal });
  if (!response.ok) throw new CoordinationError(503, 'RUNTIME_UNAVAILABLE', 'Published source is temporarily unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.manifestSha256) throw new CoordinationError(400, 'INVALID_REQUEST', 'Published manifest integrity mismatch');
  const manifest = ArtifactManifest.parse(JSON.parse(bytes.toString()));
  const selected = paths.map((name) => {
    const entry = manifest.files.find((item) => item.path === name);
    if (!entry) throw new CoordinationError(403, 'FORBIDDEN', 'Source file is not in the manifest');
    return entry;
  });
  if (selected.reduce((sum, item) => sum + item.bytes, 0) > request.budget.maxSourceBytes) {
    throw new CoordinationError(400, 'BUDGET_EXCEEDED', 'Published source exceeds the byte budget');
  }
  const result: SourceRead[] = [];
  for (const entry of selected) {
    const file = await fetch(`${base}/file?path=${encodeURIComponent(entry.path)}`, { headers, signal });
    if (!file.ok) throw new CoordinationError(503, 'RUNTIME_UNAVAILABLE', 'Published source file is unavailable');
    const content = Buffer.from(await file.arrayBuffer());
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) throw new CoordinationError(400, 'INVALID_REQUEST', 'Published source file integrity mismatch');
    result.push({ path: entry.path, sha256: entry.sha256, text: content.toString('utf8') });
  }
  return result;
}

export function buildAliases(request: StartCoordinationRequestDto, excludedTurns: ReadonlySet<string> = new Set()) {
  const users = [{ alias: 'u0', id: request.inputMessageId, text: request.content },
    ...request.context.recentMessages.filter((message) => message.role === 'user' && message.id !== request.inputMessageId
      && (!message.coordinationTurnId || !excludedTurns.has(message.coordinationTurnId)))
      .map((message, index) => ({ alias: `u${index + 1}`, id: message.id, text: message.content }))];
  return {
    users,
    runs: request.context.facts.runs.map((value, index) => ({ alias: `r${index}`, value })),
    versions: request.context.facts.versions.map((value, index) => ({ alias: `v${index}`, value })),
    actions: request.context.facts.availableActions.map((value, index) => ({ alias: `a${index}`, value })),
    decisions: request.context.projectMemory.decisions.map((value, index) => ({ alias: `d${index}`, value })),
    proposals: request.context.relevantProposals.map((value, index) => ({ alias: `p${index}`, value })),
  };
}
export type SemanticDecision = Record<string, unknown> & { kind: string };
const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 12000) throw new CoordinatorStructureError([label.replace(/ /g,'_')],'invalid_string');
  return value;
};
const records = (value: unknown): Record<string, unknown>[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new CoordinationError(400, 'INVALID_REQUEST', 'Invalid coordinator list');
  }
  return value as Record<string, unknown>[];
};
export function settleDecision(request: StartCoordinationRequestDto, raw: SemanticDecision, sources: SourceRead[], excludedTurns: ReadonlySet<string> = new Set()): RouterResultDto {
  const aliases = buildAliases(request, excludedTurns);
  const known={run:aliases.runs.map(x=>x.alias),version:aliases.versions.map(x=>x.alias),available_action:aliases.actions.map(x=>x.alias),decision:aliases.decisions.map(x=>x.alias)};
  for(const field of ['references','evidence','memoryUpdates','acceptance','options']as const){const list=raw[field];if(list===undefined)continue;if(!Array.isArray(list)||list.length>20)throw new CoordinatorStructureError([field],'invalid_list',known);const bad=list.findIndex(v=>!v||typeof v!=='object'||Array.isArray(v));if(bad>=0)throw new CoordinatorStructureError([field,bad],'invalid_object',known);for(const [i,v]of list.entries()){if(!v||typeof v!=='object'||Array.isArray(v))throw new CoordinatorStructureError([field,i],'invalid_object',known);const item=v as Record<string,unknown>;for(const key of field==='memoryUpdates'?['kind','message','quote']:field==='evidence'?['message','quote']:field==='acceptance'?['description']:field==='options'?['label']:['kind'])if(typeof item[key]!=='string'||!String(item[key]).trim())throw new CoordinatorStructureError([field,i,key],'invalid_string',known);if(field==='memoryUpdates'&&!ProjectMemoryUpdate.shape.kind.options.includes(item.kind as any))throw new CoordinatorStructureError([field,i,'kind'],'invalid_memory_kind',known);if(field==='references'){const kind=String(item.kind);if(kind==='file'){if(typeof item.path!=='string'||!item.path.trim())throw new CoordinatorStructureError([field,i,'path'],'invalid_string',known);}else{if(!Object.hasOwn(known,kind))throw new CoordinatorStructureError([field,i,'kind'],'invalid_reference_kind',known);if(!(known[kind as keyof typeof known] as string[]).includes(String(item.ref)))throw new CoordinatorStructureError([field,i,'ref'],'unknown_reference_alias',known);}}}}
  const find = <T extends { alias: string }>(list: T[], alias: unknown, label: string) => {
    const item = list.find((entry) => entry.alias === alias);
    if (!item) throw new CoordinationError(400, 'INVALID_REQUEST', `Unknown ${label} reference`);
    return item;
  };
  const references: RouterResultDto['references'] = records(raw.references).map((reference) => {
    if (reference.kind === 'run') return { kind: 'run', runId: find(aliases.runs, reference.ref, 'run').value.id };
    if (reference.kind === 'version') return { kind: 'version', versionId: find(aliases.versions, reference.ref, 'version').value.id };
    if (reference.kind === 'available_action') return { kind: 'available_action', actionId: find(aliases.actions, reference.ref, 'action').value.id };
    if (reference.kind === 'decision') return { kind: 'decision', decisionId: find(aliases.decisions, reference.ref, 'decision').value.id };
    if (reference.kind === 'file' && request.context.sourceArtifact && sources.some((source) => source.path === reference.path)) {
      return { kind: 'file', versionId: request.context.sourceArtifact.versionId, path: String(reference.path) };
    }
    throw new CoordinationError(400, 'INVALID_REQUEST', 'Unverified coordinator reference');
  });
  const evidence = records(raw.evidence).map((item) => {
    const user = find(aliases.users, item.message, 'source message');
    const quote = string(item.quote, 'evidence');
    if (quote.length > 2000 || !user.text.includes(quote)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Evidence must quote a trusted user message');
    return { messageId: user.id, quote };
  });
  const memoryUpdates = records(raw.memoryUpdates).map((item) => {
    const user = find(aliases.users, item.message, 'memory source');
    if (user.id !== request.inputMessageId) throw new CoordinationError(400, 'INVALID_REQUEST', 'New memory may only derive from this authorized input, not an old or cancelled turn');
    const quote = string(item.quote, 'memory evidence');
    if (!user.text.includes(quote)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Memory update lacks user source evidence');
    const superseded = item.supersedes == null ? null : find(aliases.decisions, item.supersedes, 'decision').value;
    if (superseded && superseded.status !== 'active') throw new CoordinationError(409, 'CONFLICT', 'Memory correction must supersede an active decision');
    return { kind: item.kind, text: quote, sourceMessageIds: [user.id], supersedesDecisionId: superseded?.id ?? null };
  });
  const base = { contextUsed: usedContext(request), references, memoryUpdates };
  const answer = () => {
    const text = string(raw.answer, 'answer');
    if (/https?:\/\/|file:\/\/|127\.0\.0\.1:\d|localhost:\d/i.test(text)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Answers must use trusted action references, not invented or credentialized URLs');
    return text;
  };
  if (request.operation.kind === 'proposal_refresh' && raw.kind !== 'change_proposal') throw new CoordinationError(400, 'INVALID_REQUEST', 'Proposal refresh must return a read-only replacement proposal');
  if (raw.kind === 'consult') return RouterResult.parse({ kind: raw.kind, answer: answer(), ...base });
  if (raw.kind === 'status') {
    const selected = Array.isArray(raw.targetRuns)
      ? raw.targetRuns.map((ref) => find(aliases.runs, ref, 'run').value)
      : aliases.runs.map((item) => item.value);
    return RouterResult.parse({ kind: raw.kind, answer: answer(), ...base, observations: selected });
  }
  if (raw.kind === 'change_proposal') {
    if (!evidence.some((item) => item.messageId === request.inputMessageId)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Change requires evidence from the current authorized user input');
    const exact = request.operation.kind === 'proposal_refresh' || raw.basePolicy === 'exact_version';
    const selected = request.operation.kind === 'proposal_refresh' || raw.baseVersion == null
      ? request.context.facts.currentVersionId : find(aliases.versions, raw.baseVersion, 'version').value.id;
    return RouterResult.parse({ kind: raw.kind, summary: string(raw.summary, 'summary'), goal: string(raw.goal, 'goal'),
      acceptance: records(raw.acceptance).map((item, index) => ({ id: `acceptance_${index + 1}`, description: string(item.description, 'acceptance') })),
      origin: request.operation.kind === 'clarification_answer' ? 'confirmed_clarification'
        : raw.origin === 'explicit_request' ? 'explicit_request' : 'inferred_suggestion',
      basePolicy: exact ? { kind: 'exact_version', expectedBaseVersionId: selected } : { kind: 'latest_on_dispatch' },
      evidence, ...base });
  }
  if (raw.kind === 'clarify') {
    const related = raw.relatedProposal == null ? null : find(aliases.proposals, raw.relatedProposal, 'proposal').value.id;
    return RouterResult.parse({ kind: raw.kind, question: string(raw.question, 'question'),
      options: records(raw.options).map((item, index) => ({ id: `option_${sha256(request.turnId).slice(0, 16)}_${index + 1}`, label: string(item.label, 'option') })),
      allowText: raw.allowText === true, relatedProposalId: related, ...base });
  }
  if (raw.kind === 'control') {
    const run = find(aliases.runs, raw.targetRun, 'run').value;
    if (!evidence.some((item) => item.messageId === request.inputMessageId)) throw new CoordinationError(400, 'INVALID_REQUEST', 'Control requires evidence from this user input');
    if (request.mode === 'ask') return RouterResult.parse({ kind: 'consult', answer: '当前为只读问答模式，未取消任务。请使用对应任务的停止操作。', ...base });
    return RouterResult.parse({ kind: raw.kind, action: 'cancel_run', targetRunId: run.id, expectedRevision: run.revision,
      evidence, sourceMessageIds: [...new Set(evidence.map((item) => item.messageId))], ...base });
  }
  throw new CoordinationError(400, 'INVALID_REQUEST', 'Unknown coordinator result kind');
}
