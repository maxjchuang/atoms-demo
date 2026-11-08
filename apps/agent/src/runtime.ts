import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentEvent, AgentInputRequest, ArtifactManifest, CancelExecutionRequest, ExecutionSnapshot, ErrorCode,
  PROTOCOL_VERSION, StartExecutionRequest,
  type AgentEventDto, type ArtifactManifestDto, type ExecutionSnapshotDto, type StartExecutionDto,
} from '@atoms/contracts';
import type { RuntimeEvent, Check } from '@atoms/contracts';
import { COORDINATION_DEFAULTS } from '@atoms/contracts/conversation';
import { FakeDshAdapter, DshAdapter, type ModelAdapter, type PlanValue, type AdapterContext, type ResolvedRunQuestion } from './adapters.js';
import { listFiles, putFile, safeFile, sha256 } from './files.js';
import { mediaType, verifyApplication } from './verify.js';
import { templateFiles } from './template.js';
import { CoordinatorRuntime } from './coordinator.js';
import { CoordinationError } from './coordination-context.js';
import type { CoordinatorAdapter } from './coordinator-adapters.js';
import { CoordinationProtocolVersion } from '@atoms/contracts/conversation';
import { TOKEN_ACCOUNTING_VERSION } from './native-usage.js';

type RuntimeBody = ReturnType<typeof RuntimeEvent.parse>;
type CheckValue = ReturnType<typeof Check.parse>;
type RecordValue = {
  request: StartExecutionDto; hash: string; snapshot: ExecutionSnapshotDto;
  events: AgentEventDto[]; commands: Record<string, { hash: string; snapshot: ExecutionSnapshotDto }>;
  started: boolean; plan: PlanValue | null; planConfirmed: boolean; queueOrder: number;
  activeMs: number; waitingAt: number | null;
  usage: { modelSteps: number; inputTokens: number; outputTokens: number };
  ordinaryQuestions: number; answers: ResolvedRunQuestion[];
  repairRoundsUsed: number; verificationErrors: string | null; repairClaimed: boolean;
  tokenAccountingVersion?: typeof TOKEN_ACCOUNTING_VERSION;
};
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, data) => data && typeof data === 'object' && !Array.isArray(data)
  ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) : data);
class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export interface AgentOptions {
  dataDir: string; serviceToken: string; apiInternalUrl?: string;
  mode?: 'fake' | 'dsh'; apiKey?: string; model?: string; adapter?: ModelAdapter;
  coordinationMode?: 'fake' | 'dsh'; coordinatorAdapter?: CoordinatorAdapter;
}

export class AgentRuntime {
  readonly records = new Map<string, RecordValue>();
  readonly adapter: ModelAdapter;
  private controllers = new Map<string, AbortController>();
  private pumping: Promise<void> | null = null;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(readonly options: AgentOptions) {
    mkdirSync(options.dataDir, { recursive: true });
    this.adapter = options.adapter || (options.mode === 'fake' ? new FakeDshAdapter() : new DshAdapter({ apiKey: options.apiKey, model: options.model }));
    const ledger = this.ledgerPath();
    if (existsSync(ledger)) {
      for (const item of JSON.parse(readFileSync(ledger, 'utf8')) as RecordValue[]) {
        StartExecutionRequest.parse(item.request); ExecutionSnapshot.parse(item.snapshot);
        this.records.set(item.request.executionId, item);
        if (!terminal.has(item.snapshot.status) && item.snapshot.status !== 'waiting_input' && item.snapshot.status !== 'accepted') {
          // Children are owned by this process; a full restart is fenced by fresh execution directories.
          item.snapshot.status = 'interrupted'; item.snapshot.pendingAttention = null;
          this.emit(item, { type: 'execution.interrupted', payload: { reason: 'Runtime restarted; explicit retry required. External processes are not resumed.' } });
        }
      }
    }
    this.timer = setInterval(() => {
      for (const item of this.records.values()) {
        if (item.snapshot.status === 'waiting_input' && item.waitingAt
          && Date.now() - item.waitingAt > item.request.budget.maxWaitingInputMs) {
          item.snapshot.status = 'failed'; item.snapshot.pendingAttention = null;
          this.emit(item, { type: 'execution.failed', payload: { code: 'BUDGET_EXCEEDED', message: '等待用户输入已超时' } });
        }
      }
    }, 1000);
    this.timer.unref();
    this.schedule();
  }
  private ledgerPath() { return path.join(this.options.dataDir, 'executions.json'); }
  private persist() {
    const filename = this.ledgerPath();
    writeFileSync(filename + '.tmp', JSON.stringify([...this.records.values()]));
    renameSync(filename + '.tmp', filename);
  }
  private emit(item: RecordValue, event: RuntimeBody) {
    const seq = item.events.length + 1;
    item.snapshot.lastSourceSeq = seq; item.snapshot.updatedAt = now();
    const envelope = AgentEvent.parse({ protocolVersion: PROTOCOL_VERSION, executionId: item.request.executionId,
      runId: item.request.runId, sourceSeq: seq, occurredAt: now(), event });
    item.events.push(envelope); this.persist();
  }
  private update(item: RecordValue, changes: Partial<ExecutionSnapshotDto>) {
    item.snapshot = { ...item.snapshot, ...changes, revision: item.snapshot.revision + 1,
      lastSourceSeq: item.events.length + 1, updatedAt: now() };
    ExecutionSnapshot.parse(item.snapshot);
    this.emit(item, { type: 'execution.updated', payload: clone(item.snapshot) });
  }
  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Execution not found');
    return record;
  }
  start(raw: unknown, pathId: string) {
    const request = StartExecutionRequest.parse(raw);
    if (pathId !== request.executionId) throw new HttpError(400, 'INVALID_REQUEST', 'Execution ID mismatch');
    const hash = sha256(canonical(request));
    const existing = this.records.get(pathId);
    if (existing) {
      if (existing.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Execution ID already has a different request');
      return { created: false, snapshot: clone(existing.snapshot) };
    }
    if (!this.adapter.ready()) throw new HttpError(503, 'RUNTIME_UNAVAILABLE', 'DeepSeek credentials are not configured');
    const item: RecordValue = {
      request, hash, snapshot: { protocolVersion: PROTOCOL_VERSION, id: pathId, runId: request.runId,
        status: 'accepted', phase: null, revision: 1, lastSourceSeq: 0, pendingAttention: null, artifactId: null, updatedAt: now() },
      events: [], commands: {}, started: false, plan: null, planConfirmed: request.mode === 'build',
      queueOrder: Date.now(), activeMs: 0, waitingAt: null, usage: { modelSteps: 0, inputTokens: 0, outputTokens: 0 },
      ordinaryQuestions: 0, answers: [], repairRoundsUsed: 0, verificationErrors: null, repairClaimed: false,
      tokenAccountingVersion: TOKEN_ACCOUNTING_VERSION,
    };
    this.records.set(pathId, item);
    this.update(item, {}); const snapshot = clone(item.snapshot); this.schedule();
    return { created: true, snapshot };
  }
  answer(id: string, raw: unknown) {
    const input = AgentInputRequest.parse(raw); const item = this.get(id);
    const previous = item.commands[input.commandId]; const hash = sha256(canonical(input));
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Command ID reused with different input');
      return clone(previous.snapshot);
    }
    const question = item.snapshot.pendingAttention;
    if (item.snapshot.status !== 'waiting_input' || !question || question.id !== input.attentionId
      || question.revision !== input.expectedRevision) throw new HttpError(409, 'STALE_REVISION', 'Question is no longer current');
    const answer = input.answer;
    if ((answer.kind === 'approve_plan' && question.kind !== 'plan_confirmation')
      || (answer.kind === 'select' && !question.options.some((option) => option.id === answer.optionId))
      || (answer.kind === 'text' && !question.allowText)) throw new HttpError(400, 'INVALID_REQUEST', 'Answer does not match question');
    if (question.kind === 'plan_confirmation') item.planConfirmed = true;
    else {
      item.answers ??= [];
      item.answers.push({ question: { title: question.title, description: question.description, options: structuredClone(question.options) }, answer: structuredClone(answer) });
    }
    item.waitingAt = null; item.queueOrder = Date.now();
    this.update(item, { status: 'accepted', pendingAttention: null });
    this.emit(item, { type: 'attention.resolved', payload: { attentionId: question.id } });
    item.commands[input.commandId] = { hash, snapshot: clone(item.snapshot) }; this.persist();
    this.schedule(); return clone(item.snapshot);
  }
  async cancel(id: string, raw: unknown) {
    const input = CancelExecutionRequest.parse(raw); const item = this.get(id); const hash = sha256(canonical(input));
    const previous = item.commands[input.commandId];
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'CONFLICT', 'Command ID reused');
      return clone(previous.snapshot);
    }
    if (!terminal.has(item.snapshot.status)) {
      this.update(item, { status: 'cancelling', pendingAttention: null });
      const controller = this.controllers.get(id);
      if (controller) controller.abort();
      else { item.snapshot.status = 'cancelled'; this.emit(item, { type: 'execution.cancelled', payload: {} }); }
    }
    item.commands[input.commandId] = { hash, snapshot: clone(item.snapshot) }; this.persist();
    return clone(item.snapshot);
  }
  events(id: string, after: number, limit: number) {
    const item = this.get(id);
    const items = item.events.filter((event) => event.sourceSeq > after).slice(0, limit);
    const nextCursor = items.at(-1)?.sourceSeq ?? after;
    return { items: clone(items), nextCursor, hasMore: item.events.some((event) => event.sourceSeq > nextCursor) };
  }
  private schedule() {
    if (this.closed || this.pumping) return;
    this.pumping = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
      while (!this.closed) {
        const next = [...this.records.values()].filter((item) => item.snapshot.status === 'accepted').sort((a, b) => a.queueOrder - b.queueOrder)[0];
        if (!next) break;
        await this.process(next);
      }
    }).finally(() => { this.pumping = null; if (!this.closed && [...this.records.values()].some((item) => item.snapshot.status === 'accepted')) this.schedule(); });
  }
  private async prepareWorkspace(item: RecordValue, workspace: string, signal: AbortSignal) {
    await mkdir(workspace, { recursive: true });
    for (const [name, content] of Object.entries(templateFiles)) await putFile(workspace, name, content);
    if (item.request.input.kind === 'version') {
      if (!this.options.apiInternalUrl) throw new Error('API_INTERNAL_URL is not configured');
      const base = `${this.options.apiInternalUrl}/internal/v1/input-artifacts/${item.request.input.artifactId}`;
      const headers = { authorization: `Bearer ${this.options.serviceToken}`, 'x-atoms-protocol-version': PROTOCOL_VERSION };
      const response = await fetch(`${base}/manifest`, { headers, signal });
      if (!response.ok) throw new Error(`Input manifest HTTP ${response.status}`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (sha256(raw) !== item.request.input.manifestSha256) throw new Error('Input manifest hash mismatch');
      const manifest = ArtifactManifest.parse(JSON.parse(raw.toString()));
      let total = 0;
      for (const file of manifest.files.filter((file) => file.path.startsWith('source/'))) {
        const result = await fetch(`${base}/file?path=${encodeURIComponent(file.path)}`, { headers, signal });
        if (!result.ok) throw new Error(`Input source HTTP ${result.status}`);
        const content = Buffer.from(await result.arrayBuffer()); total += content.length;
        if (content.length !== file.bytes || sha256(content) !== file.sha256 || total > item.request.budget.maxArtifactBytes) throw new Error('Input file integrity or budget mismatch');
        const name = file.path.slice('source/'.length);
        // Inputs cannot replace executable configs or dependency manifests from the trusted template.
        if (name.startsWith('src/') || name === 'index.html') await putFile(workspace, name, content);
      }
    }
  }
  private async process(item: RecordValue) {
    const id = item.request.executionId; const controller = new AbortController(); this.controllers.set(id, controller);
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort('budget'), Math.max(1, item.request.budget.maxWallTimeMs - item.activeMs));
    const root = path.join(this.options.dataDir, 'executions', id);
    const workspace = path.join(root, 'workspace'); const evidence = path.join(root, 'evidence');
    const context: AdapterContext = { request: item.request, workspace,
      home: path.join(this.options.dataDir, 'dsh', item.request.projectId), signal: controller.signal,
      remainingOutputTokens: () => item.request.budget.maxOutputTokens - (item.usage?.outputTokens || 0),
      report: (content) => this.emit(item, { type: 'message.completed', payload: { messageId: `message_${randomUUID().replaceAll('-', '')}`, content } }),
      fileChanged: (change) => this.emit(item, { type: 'file.changed', payload: change }),
      runAnswers: item.answers ?? [],
      meter: (usage) => {
        item.usage ??= { modelSteps: 0, inputTokens: 0, outputTokens: 0 };
        for (const key of ['modelSteps', 'inputTokens', 'outputTokens'] as const) item.usage[key] += usage[key] || 0;
        this.persist();
        if (item.usage.modelSteps > item.request.budget.maxModelSteps
          || item.usage.inputTokens > item.request.budget.maxInputTokens
          || item.usage.outputTokens > item.request.budget.maxOutputTokens) {
          controller.abort('budget'); throw new Error('Model budget exceeded');
        }
      },
    };
    try {
      this.update(item, { status: 'running', pendingAttention: null,
        phase: !item.plan || !item.planConfirmed ? 'planning' : item.verificationErrors ? 'repairing' : 'generating' });
      if (!item.started) { item.started = true; this.emit(item, { type: 'execution.started', payload: {} }); }
      if (!item.plan) {
        context.report(item.request.input.kind === 'template' ? '正在准备受控 React 模板。' : '正在载入并校验上一版本源码快照。');
        await this.prepareWorkspace(item, workspace, controller.signal);
        context.report('源码工作目录已准备完成，开始整理实现计划。');
        item.plan = await this.adapter.plan(context); this.persist();
        context.report(`计划已整理：${item.plan.summary.slice(0, 240)}\n${item.plan.tasks.slice(0, 5).map((task, index) => `${index + 1}. ${task.slice(0, 120)}`).join('\n')}`);
      }
      if (!item.planConfirmed) {
        const attention = { id: `attention_${id}`, runId: item.request.runId, revision: 1,
          kind: 'plan_confirmation' as const, title: '确认实现计划', description: item.plan.summary,
          options: [], allowText: false, plan: item.plan, createdAt: now() };
        item.waitingAt = Date.now();
        this.update(item, { status: 'waiting_input', pendingAttention: attention, phase: 'planning' });
        this.emit(item, { type: 'attention.created', payload: attention }); return;
      }
      let summary = ''; let checks: CheckValue[] = []; let errors: string | null = item.verificationErrors ?? null;
      item.repairRoundsUsed ??= 0; item.repairClaimed ??= false; item.ordinaryQuestions ??= 0;
      while (true) {
        if (controller.signal.aborted) throw new Error('Execution aborted');
        if (errors && !item.repairClaimed) {
          if (item.repairRoundsUsed >= item.request.budget.maxRepairRounds) throw new HttpError(422, 'VERIFICATION_FAILED', '验证失败且修复次数已用完：' + errors.slice(-1000));
          item.repairRoundsUsed++; item.repairClaimed = true; this.persist();
        }
        this.update(item, { phase: errors ? 'repairing' : 'generating' });
        this.emit(item, { type: 'phase.changed', payload: { phase: errors ? 'repairing' : 'generating' } });
        const generated = await this.adapter.generate(context, item.plan, errors || undefined);
        if (typeof generated !== 'string') {
          if (item.ordinaryQuestions >= COORDINATION_DEFAULTS.maxOrdinaryRunQuestions) throw new HttpError(422, 'BUDGET_EXCEEDED', '执行中的问题次数已达到上限，未扩大任务预算。');
          item.ordinaryQuestions++; item.waitingAt = Date.now();
          const attention = { id: `attention_${sha256(id).slice(0, 24)}_${item.ordinaryQuestions}`, runId: item.request.runId,
            revision: item.ordinaryQuestions, kind: 'question' as const, title: generated.title,
            description: generated.description, options: generated.options.map((label, index) => ({ id: `option_${index + 1}`, label })),
            allowText: generated.allowText, createdAt: now() };
          this.update(item, { status: 'waiting_input', pendingAttention: attention });
          this.emit(item, { type: 'attention.created', payload: attention }); return;
        }
        summary = generated;
        this.update(item, { phase: 'verifying' });
        const verified = await verifyApplication(workspace, evidence, controller.signal,
          (check) => this.emit(item, { type: 'check.completed', payload: check }), context.report);
        checks = verified.checks; errors = verified.errors;
        item.verificationErrors = errors; item.repairClaimed = false; this.persist();
        if (!errors) break;
      }
      if (errors) throw new HttpError(422, 'VERIFICATION_FAILED', '验证失败且修复次数已用完：' + errors.slice(-1000));
      const behavior: CheckValue = { id: 'check_behavior', kind: 'behavior', name: '需求行为验收', required: false,
        status: 'not_run', summary: '最小闭环只验证类型、构建和页面加载；功能行为待人工验收。', evidenceIds: [] };
      checks.push(behavior); this.emit(item, { type: 'check.completed', payload: behavior });
      context.report('必要检查已通过，开始打包候选源码、预览产物和验证证据。');
      const artifactId = `artifact_${id}`;
      const artifactRoot = path.join(root, 'artifacts', artifactId); await mkdir(artifactRoot, { recursive: true });
      for (const file of await listFiles(workspace)) {
        const prefix = file.startsWith('dist/') ? '' : 'source/';
        await putFile(artifactRoot, prefix + file, await readFile(await safeFile(workspace, file)));
      }
      for (const file of await listFiles(evidence)) await putFile(artifactRoot, `evidence/${file}`, await readFile(await safeFile(evidence, file)));
      const names = await listFiles(artifactRoot); let total = 0;
      const files = await Promise.all(names.map(async (name) => {
        const bytes = await readFile(await safeFile(artifactRoot, name)); total += bytes.length;
        return { path: name, bytes: bytes.length, sha256: sha256(bytes), mediaType: mediaType(name) };
      }));
      if (total > item.request.budget.maxArtifactBytes) throw new HttpError(422, 'BUDGET_EXCEEDED', '产物大小超过预算');
      const manifest: ArtifactManifestDto = ArtifactManifest.parse({ protocolVersion: PROTOCOL_VERSION, id: artifactId,
        executionId: id, runId: item.request.runId, baseVersionId: item.request.baseVersionId,
        summary, files, checks, evidence: [
          ...['typecheck', 'build', 'smoke'].map((kind) => ({ id: `evidence_${kind}`, path: `evidence/${kind}.log`, kind: 'log' })),
          { id: 'evidence_screenshot', path: 'evidence/screenshot.png', kind: 'screenshot' },
        ], createdAt: now() });
      const raw = JSON.stringify(manifest); await putFile(artifactRoot, 'manifest.json', raw);
      if (controller.signal.aborted) throw new Error('Execution aborted');
      item.snapshot.artifactId = artifactId;
      this.emit(item, { type: 'artifact.ready', payload: { artifactId, manifestSha256: sha256(raw) } });
      context.report('候选产物与验证证据已就绪，等待后端校验并发布版本。');
      item.snapshot.status = 'succeeded'; item.snapshot.revision++;
      this.emit(item, { type: 'execution.completed', payload: { artifactId } });
    } catch (error) {
      await this.adapter.close(id).catch(() => {});
      item.snapshot.pendingAttention = null; item.snapshot.revision++;
      if (item.snapshot.status === 'cancelling' || this.closed) {
        item.snapshot.status = 'cancelled'; this.emit(item, { type: 'execution.cancelled', payload: {} });
      } else {
        item.snapshot.status = 'failed';
        const code = controller.signal.aborted ? 'BUDGET_EXCEEDED'
          : error instanceof HttpError ? ErrorCode.parse(error.code) : 'INTERNAL_ERROR';
        this.emit(item, { type: 'execution.failed', payload: { code,
          message: error instanceof Error ? error.message.slice(0, 1500) : '执行失败' } });
      }
    } finally {
      clearTimeout(timer); item.activeMs += Date.now() - startedAt; this.controllers.delete(id); this.persist();
    }
  }
  async artifact(id: string, artifactId: string, file: string) {
    const item = this.get(id);
    if (item.snapshot.artifactId !== artifactId) throw new HttpError(404, 'NOT_FOUND', 'Artifact not found');
    const root = path.join(this.options.dataDir, 'executions', id, 'artifacts', artifactId);
    if (file !== 'manifest.json') {
      const manifest = ArtifactManifest.parse(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')));
      if (!manifest.files.some((entry) => entry.path === file)) throw new HttpError(404, 'NOT_FOUND', 'Artifact file not found');
    }
    return await readFile(await safeFile(root, file));
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.pumping;
  }
}

async function jsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 100000) throw new HttpError(400, 'INVALID_REQUEST', 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new HttpError(400, 'INVALID_REQUEST', 'Invalid JSON'); }
}
export function createAgentServer(options: AgentOptions) {
  const runtime = new AgentRuntime(options);
  const coordinator = new CoordinatorRuntime({ ...options, mode: options.coordinationMode ?? options.mode });
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url || '/', 'http://runtime');
    const coordinationRequest = url.pathname.startsWith('/internal/v2/');
    res.setHeader(coordinationRequest ? 'x-atoms-coordination-version' : 'x-atoms-protocol-version', coordinationRequest ? CoordinationProtocolVersion : PROTOCOL_VERSION);
    try {
      const expected = Buffer.from(`Bearer ${options.serviceToken}`); const actual = Buffer.from(req.headers.authorization || '');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HttpError(401, 'UNAUTHENTICATED', 'Internal service authentication required');
      if (coordinationRequest) {
        if (req.headers['x-atoms-coordination-version'] !== CoordinationProtocolVersion) throw new CoordinationError(400, 'INVALID_REQUEST', 'Unsupported coordination version');
        const route = url.pathname.match(/^\/internal\/v2\/coordination-turns\/([a-z][a-z0-9_-]{2,127})(?:\/(events|cancel))?$/);
        if (!route) throw new CoordinationError(404, 'NOT_FOUND', 'Coordination route not found');
        const [, turnId, action] = route;
        if (!action && req.method === 'PUT') {
          const result = coordinator.start(await jsonBody(req), turnId); return json(result.created ? 201 : 200, result.snapshot);
        }
        if (!action && req.method === 'GET') return json(200, coordinator.get(turnId).snapshot);
        if (action === 'events' && req.method === 'GET') {
          const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
          if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError(400, 'INVALID_REQUEST', 'Invalid coordination cursor');
          return json(200, coordinator.events(turnId, after, limit));
        }
        if (action === 'cancel' && req.method === 'POST') {
          const ended = ['completed', 'failed', 'cancelled', 'interrupted'].includes(coordinator.get(turnId).snapshot.status);
          return json(ended ? 200 : 202, await coordinator.cancel(turnId, await jsonBody(req)));
        }
        throw new CoordinationError(404, 'NOT_FOUND', 'Coordination route not found');
      }
      if (req.headers['x-atoms-protocol-version'] !== PROTOCOL_VERSION) throw new HttpError(400, 'INVALID_REQUEST', 'Unsupported protocol version');
      if (url.pathname === '/internal/v1/health' && req.method === 'GET') return json(200, {
        protocolVersion: PROTOCOL_VERSION, ready: runtime.adapter.ready(),
        capabilities: { templates: ['react-vite-v1'], cancel: true, attention: true, artifacts: true },
      });
      const match = url.pathname.match(/^\/internal\/v1\/executions\/([a-z][a-z0-9_-]{2,127})(?:\/(.*))?$/);
      if (!match) throw new HttpError(404, 'NOT_FOUND', 'Route not found');
      const [, id, suffix = ''] = match;
      if (!suffix && req.method === 'PUT') { const result = runtime.start(await jsonBody(req), id); return json(result.created ? 201 : 200, result.snapshot); }
      if (!suffix && req.method === 'GET') return json(200, runtime.get(id).snapshot);
      if (suffix === 'events' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0), limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'INVALID_REQUEST', 'Invalid event cursor');
        return json(200, runtime.events(id, after, limit));
      }
      if (suffix === 'inputs' && req.method === 'POST') return json(202, runtime.answer(id, await jsonBody(req)));
      if (suffix === 'cancel' && req.method === 'POST') {
        const wasTerminal = terminal.has(runtime.get(id).snapshot.status);
        return json(wasTerminal ? 200 : 202, await runtime.cancel(id, await jsonBody(req)));
      }
      const artifact = suffix.match(/^artifacts\/([a-z][a-z0-9_-]{2,127})\/(manifest|file)$/);
      if (artifact && req.method === 'GET') {
        const filename = artifact[2] === 'manifest' ? 'manifest.json' : url.searchParams.get('path') || '';
        const bytes = await runtime.artifact(id, artifact[1], filename);
        res.setHeader('content-type', mediaType(filename)); res.setHeader('x-content-type-options', 'nosniff'); res.end(bytes); return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      const invalid = error && typeof error === 'object' && 'issues' in error;
      const known = error instanceof HttpError || error instanceof CoordinationError;
      const code = known ? error.code : invalid ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
      const status = known ? error.status : invalid ? 400 : 500;
      json(status, { error: { code, message: known ? error.message : invalid ? 'Request does not match protocol' : 'Internal runtime error',
        retryable: status === 503, requestId: `request_${randomUUID().replaceAll('-', '')}` } });
    }
  });
  return { server, runtime, coordinator,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No runtime address');
      return `http://${host}:${address.port}`;
    },
    async close() { await Promise.all([runtime.close(), coordinator.close()]); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}
