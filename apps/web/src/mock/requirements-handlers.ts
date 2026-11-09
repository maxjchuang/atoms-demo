import { http, HttpResponse, delay } from 'msw';
import { z } from 'zod';
import { RequirementsProtocolVersion, RequirementsVersionHeader, ProjectRequirementSnapshot, RequirementSummary, RequirementsReadView, ReviewRequirementsRequest, AcceptRequirementSummaryRequest, AcceptRequirementSummaryResponse } from '@atoms/contracts/requirements';
import * as fixture from '@atoms/contracts/requirements-fixtures';
import { version as fixtureVersion } from '@atoms/contracts/fixtures';
import { SubmitMessageRequest, SubmitMessageResponse } from '@atoms/contracts/conversation';
import { requirementHash, snapshotRef, acceptanceFor } from '../requirements-api';
import { mockExecutionStore as execution } from './handlers';
import { mockCoordinationStore as coordination } from './coordination-handlers';
type Settings = { scenario: string; view: z.infer<typeof RequirementsReadView>; reviewPosts: number; acceptPosts: number; reviewBodies: unknown[]; reviewReceipts?: Record<string, { body: string; value: z.infer<typeof SubmitMessageResponse> }>; delayMs?: number; reviewDelayMs?: number; ordinaryChanges?: boolean; nextOutcome?: 'change' | 'consult' };
const key = 'atoms_web_mock_requirements';
let store: Record<string, Settings>; try { store = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { store = {}; }
const save = () => localStorage.setItem(key, JSON.stringify(store)), headers = { [RequirementsVersionHeader]: RequirementsProtocolVersion, 'Cache-Control': 'private, no-store' };
const now = execution.now, id = execution.id;
function error(status: number, code: string, message: string) { return HttpResponse.json({ error: { code, message, requestId: 'request_requirements_mock', retryable: status >= 500 } }, { status, headers }); }
async function seal<T extends Record<string, unknown>>(value: T) { return { ...value, hash: await requirementHash(value) }; }
async function empty(projectId: string) {
  const record = execution.find(projectId)!;
  return ProjectRequirementSnapshot.parse(await seal({ ...fixture.snapshot, id: id('requirements'), projectId, revision: 1, entries: [], base: record.project.currentVersionId ? { kind: 'published_version', versionId: record.project.currentVersionId, sourceSnapshotHash: 'a'.repeat(64), sourceAvailable: true } : { kind: 'empty_project' }, updatedAt: now() }));
}
async function settings(projectId: string) {
  if (!store[projectId]) { store[projectId] = { scenario: 'empty', view: { protocolVersion: RequirementsProtocolVersion, snapshot: await empty(projectId), pendingSummaries: [] }, reviewPosts: 0, acceptPosts: 0, reviewBodies: [] }; save(); }
  const data = store[projectId], record = execution.find(projectId)!;
  if (data.scenario === 'empty' && (data.view.snapshot.base.kind === 'empty_project' ? null : data.view.snapshot.base.versionId) !== record.project.currentVersionId) {
    data.view.snapshot = ProjectRequirementSnapshot.parse(await seal({ ...await empty(projectId), entries: data.view.snapshot.entries, revision: data.view.snapshot.revision + 1 })); save();
  }
  return data;
}
async function summaryFor(projectId: string, userText?: string) {
  const data = await settings(projectId), snapshot = data.view.snapshot, active = snapshot.entries.filter(entry => entry.state === 'active');
  if (!active.length || snapshot.base.kind === 'published_version' && !snapshot.base.sourceAvailable) return null;
  const excluded = data.scenario === 'suggestion' ? active.filter(entry => entry.authorization === 'suggested').map(entry => ({ entryId: entry.id, reason: 'unaccepted_suggestion' as const, source: null }))
    : data.scenario === 'replacement' ? [{ entryId: active[0].id, reason: 'explicit_user_replacement' as const, source: active.at(-1)!.sources[0] }] : [];
  const included = active.filter(entry => !excluded.some(item => item.entryId === entry.id));
  // Deterministic Mock authority recipe only; not a production language merger.
  const goal = included.map(entry => entry.text).join('；');
  const acceptance = included.map((entry, index) => ({ id: `acceptance_mock_${index}`, description: `验收：${entry.text}` }));
  const current = coordination.state(projectId);
  const existingUser = !userText && current.messages.find(message => message.id === active.at(-1)!.sources[0].messageId);
  const { turn } = coordination.begin(projectId, { input: { kind: 'text', content: userText ?? active.at(-1)!.text }, mode: 'ask', runMode: 'plan' }, undefined, existingUser || undefined);
  coordination.store.reserved--; coordination.store.used++;
  const proposal = { ...fixture.summary.proposal, id: id('proposal'), projectId, originatingTurnId: turn.id, sourceMessageIds: active.flatMap(entry => entry.sources.map(source => source.messageId)), summary: '完整累计方案（Synthetic Mock）', goal, acceptance, contextUsed: coordination.context(projectId), status: 'open' as const, acceptedRunId: null, createdAt: now(), updatedAt: now(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  current.proposals.push(proposal);
  const summary = RequirementSummary.parse(await seal({ ...fixture.summary, id: id('summary'), projectId, proposal, snapshot,
    draft: { snapshot: snapshotRef(snapshot), implementation: snapshot.base.kind === 'empty_project' ? 'new_app' : 'modify_app', goal, acceptance, includedEntryIds: included.map(entry => entry.id), exclusions: excluded, coverage: included.map((entry, index) => ({ acceptanceId: acceptance[index].id, entryIds: [entry.id] })) }, createdAt: now() }));
  current.proposals[current.proposals.findIndex(value => value.id === proposal.id)] = summary.proposal;
  data.view.pendingSummaries.push(summary);
  coordination.finish(turn, '已整理完整累计方案供审阅，尚未授权或创建构建。', () => ({ kind: 'change_proposal', proposalId: proposal.id, admission: 'proposed', runId: null, admissionError: null }));
  coordination.save(); save(); return summary;
}
const findSummary = (proposalId: string) => Object.entries(store).flatMap(([projectId, data]) => data.view.pendingSummaries.filter(summary => summary.proposal.id === proposalId).map(summary => ({ projectId, data, summary })))[0];
export const requirementsHandlers = [
  http.post('/__mock/requirements/seed', async ({ request }) => {
    const body = await request.json() as { projectId: string; scenario?: string; delayMs?: number; reviewDelayMs?: number; ordinaryChanges?: boolean; nextOutcome?: 'change' | 'consult' };
    if (!execution.find(body.projectId)) return error(404, 'NOT_FOUND', '项目不存在。');
    const scenario = body.scenario ?? 'three-ask', data = await settings(body.projectId); data.scenario = scenario; data.delayMs = body.delayMs; data.reviewDelayMs = body.reviewDelayMs; data.ordinaryChanges = body.ordinaryChanges; data.nextOutcome = body.nextOutcome;
    if (scenario === 'published') { const record = execution.find(body.projectId)!; const version = { ...fixtureVersion, id: id('version'), projectId: body.projectId, previewUrl: `${location.origin}/mock-preview.html`, previewExpiresAt: new Date(Date.now() + 86400000).toISOString() }; record.versions.unshift(version); record.project.currentVersionId = version.id; execution.save(); }
    let entries = scenario === 'empty' ? [] : fixture.entries.map(entry => ({ ...structuredClone(entry), sources: entry.sources.map(source => ({ ...source, messageId: id('message') })) }));
    if (scenario === 'generic') entries = entries.map((entry, i) => ({ ...entry, text: ['制作作品集', '需要双语切换', '加入可筛选项目列表'][i], sources: entry.sources.map(source => ({ ...source, quote: ['制作作品集', '需要双语切换', '加入可筛选项目列表'][i] })) }));
    if (scenario === 'suggestion') entries.push({ ...structuredClone(entries[0]), id: id('requirement'), text: '尚未确认的模型建议', authorization: 'suggested', sources: [{ ...entries[0].sources[0], messageId: id('message'), quote: '建议增加展示动画' }] });
    if (scenario === 'replacement') entries.push({ ...structuredClone(entries[0]), id: id('requirement'), text: '替换原始界面布局为新的已提出方案', sources: [{ ...entries[0].sources[0], messageId: id('message'), quote: '请用新的界面布局替换原来的布局要求' }] });
    const base = await empty(body.projectId); data.view = { protocolVersion: RequirementsProtocolVersion, snapshot: ProjectRequirementSnapshot.parse(await seal({ ...base, entries, revision: Math.max(1, entries.length) })), pendingSummaries: [] };
    if (scenario === 'missing-source') data.view.snapshot = ProjectRequirementSnapshot.parse(await seal({ ...data.view.snapshot, base: { kind: 'published_version', versionId: 'version_missing_source', sourceSnapshotHash: null, sourceAvailable: false } }));
    for (const entry of entries) coordination.addMessage(body.projectId, { id: entry.sources[0].messageId, role: 'user', actor: 'user', content: entry.sources[0].quote });
    await summaryFor(body.projectId);
    if (scenario === 'stale') data.view.snapshot = ProjectRequirementSnapshot.parse(await seal({ ...data.view.snapshot, revision: data.view.snapshot.revision + 1, updatedAt: now() }));
    save(); return HttpResponse.json({ ok: true });
  }),
  http.get('/__mock/requirements/:projectId/stats', ({ params }) => { const data = store[String(params.projectId)]; return HttpResponse.json(data ? { reviewPosts: data.reviewPosts, acceptPosts: data.acceptPosts, reviewBodies: data.reviewBodies, snapshotRevision: data.view.snapshot.revision, entries: data.view.snapshot.entries, proposals: data.view.pendingSummaries.map(summary => summary.proposal.id) } : {}); }),
  http.post('/__mock/requirements/:projectId/outcome', async ({ params, request }) => { const data = await settings(String(params.projectId)), body = await request.json() as { nextOutcome: 'change' | 'consult' }; data.nextOutcome = body.nextOutcome; save(); return HttpResponse.json({ ok: true }); }),
  http.get('/api/requirements/v1/projects/:projectId', async ({ params }) => {
    if (!execution.state.authenticated) return error(401, 'UNAUTHENTICATED', '请重新登录。');
    const projectId = String(params.projectId); if (!execution.find(projectId)) return error(404, 'NOT_FOUND', '项目不存在。'); const data = await settings(projectId); if (data.delayMs) await delay(data.delayMs); return HttpResponse.json(data.scenario === 'corrupt' ? { ...data.view, snapshot: { ...data.view.snapshot, hash: 'f'.repeat(64) } } : data.view, { headers });
  }),
  http.get('/api/requirements/v1/proposals/:proposalId', ({ params }) => { const value = findSummary(String(params.proposalId)); return value ? HttpResponse.json(value.summary, { headers }) : error(404, 'NOT_FOUND', '此提案没有完整需求summary绑定。'); }),
  http.post('/api/v2/proposals/:proposalId/accept', ({ params }) => findSummary(String(params.proposalId)) ? execution.error(409, 'CONFLICT', '请使用完整需求审阅的精确接受入口。') : undefined),
  http.post('/api/requirements/v1/proposals/:proposalId/accept', async ({ params, request }) => {
    if (!execution.state.authenticated) return error(401, 'UNAUTHENTICATED', '请重新登录。'); const item = findSummary(String(params.proposalId)); if (!item) return error(404, 'NOT_FOUND', '完整方案不存在。');
    const parsed = AcceptRequirementSummaryRequest.safeParse(await request.json()); if (!parsed.success || !request.headers.get('Idempotency-Key')) return error(400, 'INVALID_REQUEST', '缺少精确授权或幂等键。'); item.data.acceptPosts++; save();
    if (item.summary.acceptedRunId) return HttpResponse.json(AcceptRequirementSummaryResponse.parse({ protocolVersion: RequirementsProtocolVersion, disposition: 'already_accepted', summary: item.summary, run: execution.findRun(item.summary.acceptedRunId)!.run, quota: execution.session().quota }), { headers });
    if (JSON.stringify(parsed.data) !== JSON.stringify(acceptanceFor(item.summary)) || item.data.view.snapshot.hash !== item.summary.snapshot.hash) return error(409, 'STALE_REQUIREMENTS', '需求快照或基线已变化，请重新整理并审阅。');
    const run = coordination.admit(item.summary.proposal, 'plan'); item.summary.acceptedRunId = run.id; item.summary.revision++; item.summary.hash = await requirementHash(item.summary);
    const snapshot = item.data.view.snapshot; item.data.view.snapshot = ProjectRequirementSnapshot.parse(await seal({ ...snapshot, id: id('requirements'), revision: snapshot.revision + 1, entries: snapshot.entries.map(entry => item.summary.draft.includedEntryIds.includes(entry.id) ? { ...entry, authorization: 'confirmed' } : item.summary.draft.exclusions.some(excluded => excluded.entryId === entry.id && excluded.reason !== 'unaccepted_suggestion') ? { ...entry, state: 'superseded' } : entry), updatedAt: now() })); save();
    return HttpResponse.json(AcceptRequirementSummaryResponse.parse({ protocolVersion: RequirementsProtocolVersion, disposition: 'created', summary: item.summary, run, quota: execution.session().quota }), { status: 202, headers });
  }),
  http.post('/api/requirements/v1/projects/:projectId/review', async ({ params, request }) => {
    if (!execution.state.authenticated) return error(401, 'UNAUTHENTICATED', '请重新登录。'); const projectId = String(params.projectId), data = await settings(projectId), parsed = ReviewRequirementsRequest.safeParse(await request.json());
    if (!parsed.success || !request.headers.get('Idempotency-Key')) return error(400, 'INVALID_REQUEST', '整理草稿需要明确发送与精确快照。');
    const mutationKey = request.headers.get('Idempotency-Key')!, serialized = JSON.stringify(parsed.data); data.reviewReceipts ??= {};
    const previous = data.reviewReceipts[mutationKey]; if (previous) return previous.body === serialized ? HttpResponse.json(previous.value, { headers }) : error(409, 'CONFLICT', '同一请求键不能更换整理草稿。');
    if (JSON.stringify(parsed.data.expectedSnapshot) !== JSON.stringify(snapshotRef(data.view.snapshot))) return error(409, 'STALE_REQUIREMENTS', '需求快照已变化，请重新整理草稿再发送。');
    data.reviewPosts++; data.reviewBodies.push(parsed.data); const summary = await summaryFor(projectId, parsed.data.input.content);
    if (!summary) return error(409, 'REVIEW_REQUIRED', '还没有可整理的产品要求，请先通过普通消息明确目标。');
    const state = coordination.state(projectId), turn = state.turns.find(value => value.id === summary.proposal.originatingTurnId)!, userMessage = state.messages.find(value => value.id === turn.userMessageId)!;
    const value = { userMessage, turn }; data.reviewReceipts[mutationKey] = { body: serialized, value: structuredClone(value) }; save(); if (data.reviewDelayMs) await delay(data.reviewDelayMs); return HttpResponse.json(value, { status: 202, headers });
  }),
  http.post('/api/v2/projects/:projectId/messages', async ({ params, request }) => {
    const projectId = String(params.projectId), data = store[projectId]; if (!data?.ordinaryChanges) return undefined;
    const parsed = SubmitMessageRequest.safeParse(await request.json()); if (!parsed.success || parsed.data.input.kind !== 'text') return error(400, 'INVALID_REQUEST', 'Mock明确消息样例需要文本。');
    if (data.nextOutcome === 'consult') { const result = coordination.begin(projectId, parsed.data); coordination.store.reserved--; coordination.store.used++; coordination.finish(result.turn, '只读咨询，没有新增产品要求。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: coordination.context(projectId), references: [] })); save(); return HttpResponse.json(result, { status: 202, headers: { 'X-Atoms-Coordination-Version': '0.2.0' } }); }
    const sourceId = id('message'), entry = { id: id('requirement'), text: parsed.data.input.content, kind: 'increment' as const, authorization: 'requested' as const, state: 'active' as const, sources: [{ messageId: sourceId, quote: parsed.data.input.content, proposalId: null, decisionId: null, clarificationId: null, questionMessageId: null, questionText: null }], createdAt: now() };
    coordination.addMessage(projectId, { id: sourceId, role: 'user', actor: 'user', content: entry.text }); data.view.snapshot = ProjectRequirementSnapshot.parse(await seal({ ...data.view.snapshot, id: id('requirements'), revision: data.view.snapshot.revision + 1, entries: [...data.view.snapshot.entries, entry], updatedAt: now() }));
    const summary = await summaryFor(projectId); const state = coordination.state(projectId), turn = state.turns.find(value => value.id === summary!.proposal.originatingTurnId)!, userMessage = state.messages.find(value => value.id === sourceId)!; save();
    return HttpResponse.json({ userMessage, turn }, { status: 202, headers: { 'X-Atoms-Coordination-Version': '0.2.0' } });
  }),
];
