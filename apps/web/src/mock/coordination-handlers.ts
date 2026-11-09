import { http, HttpResponse, type JsonBodyType } from 'msw';
import { SubmitMessageRequest, CoordinationWorkspace, CoordinationTurn, type ConversationMessageDto,
  type ConversationEventDto, type CoordinationTurnDto, type ChangeProposalDto, type ClarificationDto,
  type ProjectMemoryViewDto, type SubmitMessageRequestDto, type CoordinationOutcomeDto,
  type ContextUsed, type TurnActionDescriptorDto } from '@atoms/contracts/conversation';
import { contextUsed as fixtureContext } from '@atoms/contracts/conversation-fixtures';
import { mockExecutionStore as execution } from './handlers';

// Deterministic protocol simulation only. These rules are not a production NLP
// Router and their routing results are never evidence of real model accuracy.
type ContextValue = typeof ContextUsed['_type'];
type ProjectState = {
  messages: ConversationMessageDto[]; turns: CoordinationTurnDto[]; proposals: ChangeProposalDto[];
  questions: ClarificationDto[]; events: ConversationEventDto[]; memory: ProjectMemoryViewDto;
  requests: { [turnId: string]: SubmitMessageRequestDto }; ticks: { [turnId: string]: number };
  refreshOf: { [turnId: string]: string }; actorsSeen: { [messageId: string]: string };
  actions: { [turnId: string]: TurnActionDescriptorDto[] }; questionTargets: { [questionId: string]: { [optionId: string]: string } };
};
type Store = { projects: { [projectId: string]: ProjectState }; used: number; reserved: number };
const storageKey = 'atoms_web_mock_coordination_v2';
let store: Store;
try { store = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? { projects: {}, used: 0, reserved: 0 }; }
catch { store = { projects: {}, used: 0, reserved: 0 }; }
const now = execution.now, id = execution.id, error = execution.error;
const save = () => { localStorage.setItem(storageKey, JSON.stringify(store)); execution.save(); };
const asJson = (value: unknown, status = 200) => HttpResponse.json(value as JsonBodyType, { status, headers: { 'X-Atoms-Coordination-Version': '0.2.0' } });
const projectRecord = (value: unknown) => typeof value === 'string' ? execution.find(value) : undefined;
function state(projectId: string): ProjectState {
  store.projects[projectId] ??= { messages: [], turns: [], proposals: [], questions: [], events: [],
    memory: { projectId, revision: 0, decisions: [], summary: '', summaryThroughConversationRevision: 0, updatedAt: now() },
    requests: {}, ticks: {}, refreshOf: {}, actorsSeen: {}, actions: {}, questionTargets: {} };
  store.projects[projectId].questionTargets ??= {};
  return store.projects[projectId];
}
function emit(projectId: string, turnId: string | null, event: ConversationEventDto['event']) {
  const data = state(projectId);
  data.events.push({ protocolVersion: '0.2.0', projectId, turnId, seq: data.events.length + 1, occurredAt: now(), event: structuredClone(event) }); save();
}
function addMessage(projectId: string, options: Partial<ConversationMessageDto> & Pick<ConversationMessageDto, 'role' | 'actor' | 'content'>) {
  const data = state(projectId);
  const value: ConversationMessageDto = { id: id('message'), projectId, historySeq: (data.messages.at(-1)?.historySeq ?? 0) + 1, revision: 1,
    coordinationTurnId: null, runId: null, replyToMessageId: null, status: 'complete', createdAt: now(), updatedAt: now(), ...options };
  data.messages.push(value); emit(projectId, value.coordinationTurnId, { type: 'message.upserted', payload: value }); return value;
}
function mirror(projectId: string) {
  const record = execution.find(projectId); if (!record) return;
  const data = state(projectId);
  for (const value of record.messages) {
    const fingerprint = JSON.stringify([value.content, value.status, value.runId]);
    if (data.actorsSeen[value.id] === fingerprint) continue;
    data.actorsSeen[value.id] = fingerprint;
    const existing = data.messages.find(message => message.id === value.id);
    if (existing) {
      Object.assign(existing, { runId: value.runId, content: value.content, status: value.status, revision: existing.revision + 1, updatedAt: now() });
      emit(projectId, existing.coordinationTurnId, { type: 'message.upserted', payload: existing });
    } else addMessage(projectId, { ...value, actor: value.role === 'user' ? 'user' : execution.state.actors[value.id] ?? 'legacy_assistant' });
  }
}
function context(projectId: string): ContextValue {
  const record = execution.find(projectId)!; const data = state(projectId);
  return { ...fixtureContext, contextId: `context_${projectId}`, contextRevision: record.project.revision,
    memoryRevision: data.memory.revision, conversationRevision: data.messages.length,
    contextVersionId: record.project.currentVersionId, asOf: now() };
}
function updateTurn(turn: CoordinationTurnDto, patch: Partial<CoordinationTurnDto>) {
  Object.assign(turn, patch, { revision: turn.revision + 1, updatedAt: now() });
  emit(turn.projectId, turn.id, { type: 'turn.updated', payload: turn });
}
function begin(projectId: string, request: SubmitMessageRequestDto, refreshProposalId?: string, reusedUser?: ConversationMessageDto) {
  const data = state(projectId), turnId = id('turn');
  const question = request.replyTo && data.questions.find(item => item.id === request.replyTo!.clarificationId);
  const content = request.input.kind === 'text' ? request.input.content : request.input.kind === 'selection'
    ? question?.options.find(item => request.input.kind === 'selection' && item.id === request.input.optionId)?.label ?? ''
    : request.input.kind === 'status' ? '查看当前项目进度' : '如何预览与分享这个应用？';
  const userMessage = reusedUser ?? addMessage(projectId, { role: 'user', actor: 'user', content, coordinationTurnId: turnId, replyToMessageId: request.replyTo?.replyToMessageId ?? null });
  const used = context(projectId);
  const turn: CoordinationTurnDto = { id: turnId, projectId, revision: 1, userMessageId: userMessage.id, assistantMessageId: null,
    mode: request.mode, runMode: request.runMode, status: 'queued', contextVersionId: used.contextVersionId,
    contextRevisionUsed: used.contextRevision, memoryRevisionUsed: used.memoryRevision, conversationRevisionUsed: used.conversationRevision,
    result: null, error: null, continuationOfTurnId: question?.originatingTurnId ?? null, retryOfTurnId: null,
    createdAt: now(), startedAt: null, completedAt: null, updatedAt: now() };
  data.turns.push(turn); data.requests[turn.id] = request; store.reserved++;
  if (refreshProposalId) data.refreshOf[turn.id] = refreshProposalId;
  if (question) { Object.assign(question, { status: 'answered', revision: question.revision + 1,
    answerMessageId: userMessage.id, continuationTurnId: turn.id, updatedAt: now() }); emit(projectId, turn.id, { type: 'clarification.updated', payload: question }); }
  emit(projectId, turn.id, { type: 'turn.updated', payload: turn }); return { userMessage, turn };
}
function finish(turn: CoordinationTurnDto, content: string, outcome: (reply: ConversationMessageDto) => CoordinationOutcomeDto) {
  const reply = addMessage(turn.projectId, { role: 'assistant', actor: 'coordinator', content,
    coordinationTurnId: turn.id, replyToMessageId: turn.userMessageId });
  updateTurn(turn, { status: 'completed', assistantMessageId: reply.id, result: outcome(reply), completedAt: now() });
}
function proposalFor(turn: CoordinationTurnDto, goal: string, forceOpen = false, exact = false) {
  const data = state(turn.projectId), record = execution.find(turn.projectId)!;
  const old = data.refreshOf[turn.id] ? data.proposals.find(item => item.id === data.refreshOf[turn.id]) : null;
  const proposal: ChangeProposalDto = { id: id('proposal'), projectId: turn.projectId, revision: 1, originatingTurnId: turn.id,
    sourceMessageIds: old ? [...old.sourceMessageIds, turn.userMessageId] : [turn.userMessageId], summary: goal.slice(0, 80), goal,
    acceptance: [{ id: id('acceptance'), description: '变更后完成类型、构建与页面加载检查；行为另行验收。' }],
    origin: turn.continuationOfTurnId ? 'confirmed_clarification' : 'explicit_request',
    basePolicy: exact || old ? { kind: 'exact_version', expectedBaseVersionId: record.project.currentVersionId } : { kind: 'latest_on_dispatch' },
    contextUsed: context(turn.projectId), status: 'open', acceptedRunId: null, supersedesProposalId: old?.id ?? null,
    lastAdmissionError: null, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now(), updatedAt: now() };
  data.proposals.push(proposal);
  let admission: 'proposed' | 'run_queued' | 'blocked' = 'proposed';
  if (turn.mode !== 'ask' && !forceOpen) {
    if (execution.session().quota.runsReserved + execution.session().quota.runsUsed >= execution.session().quota.runLimit) {
      admission = 'blocked'; proposal.lastAdmissionError = { code: 'GENERATION_QUOTA_EXCEEDED', message: '构建额度不足，提案已保留，未创建任务。', retryable: false };
    } else { admit(proposal, turn.runMode); admission = 'run_queued'; }
  }
  emit(turn.projectId, turn.id, { type: 'proposal.updated', payload: proposal });
  finish(turn, admission === 'run_queued' ? '已理解为明确修改，构建任务已独立排队；执行开始时会按提案基线处理。'
    : admission === 'blocked' ? '修改提案已整理，但构建额度不足，没有创建任务。' : '已整理修改提案。当前不会直接改代码，接受提案后才会创建构建。', () => ({
      kind: 'change_proposal', proposalId: proposal.id, admission, runId: proposal.acceptedRunId, admissionError: proposal.lastAdmissionError,
    }));
}
function admit(proposal: ChangeProposalDto, runMode: 'build' | 'plan') {
  const record = execution.find(proposal.projectId)!;
  const sourceTurn = state(proposal.projectId).turns.find(turn => turn.id === proposal.originatingTurnId)!;
  const sourceMessage = state(proposal.projectId).messages.find(message => message.id === sourceTurn.userMessageId)!;
  const run = execution.enqueue(record, proposal.goal, runMode, sourceMessage.id, sourceMessage.content);
  Object.assign(proposal, { status: 'accepted', revision: proposal.revision + 1, acceptedRunId: run.id, updatedAt: now() });
  mirror(proposal.projectId); emit(proposal.projectId, proposal.originatingTurnId, { type: 'proposal.updated', payload: proposal }); return run;
}
function remember(turn: CoordinationTurnDto, text: string) {
  const data = state(turn.projectId), kind = /目标/.test(text) ? 'goal' : 'preference';
  const previous = data.memory.decisions.find(item => item.status === 'active' && item.kind === kind);
  if (previous && /更正|改为|纠正|深色|暖色/.test(text)) { previous.status = 'superseded'; previous.revision++; }
  const memoryText = text.split(/新的约定是[：:]/).at(-1) || text;
  const value = /深色/.test(memoryText) ? '界面保持深色' : /暖色/.test(memoryText) ? '界面保持暖色' : memoryText.replace(/^记住[：:]?/, '').slice(0, 300);
  data.memory.decisions.push({ id: id('decision'), projectId: turn.projectId, revision: 1, kind, text: value, status: 'active',
    sourceTurnId: turn.id, sourceMessageIds: [turn.userMessageId], sourceProposalId: null, sourceClarificationId: null,
    supersedesDecisionId: previous?.status === 'superseded' ? previous.id : null, confirmedAt: now(), createdAt: now(), updatedAt: now() });
  data.memory.revision++; data.memory.summary = data.memory.decisions.filter(item => item.status === 'active').map(item => item.text).join('；');
  data.memory.summaryThroughConversationRevision = data.messages.length; data.memory.updatedAt = now(); save();
  finish(turn, `已保存项目约定：${value}。本次只更新约定，没有创建构建。`, reply => ({ kind: 'consult', replyMessageId: reply.id,
    contextUsed: context(turn.projectId), references: [{ kind: 'decision', decisionId: data.memory.decisions.at(-1)!.id }] }));
}

function clarify(turn: CoordinationTurnDto, text: string, options: ClarificationDto['options'], allowText: boolean) {
  const data = state(turn.projectId), record = execution.find(turn.projectId)!;
  const question: ClarificationDto = { id: id('clarification'), projectId: turn.projectId, revision: 1,
    originatingTurnId: turn.id, questionMessageId: id('message'), question: text, options, allowText,
    contextVersionId: record.project.currentVersionId, contextRevision: record.project.revision, relatedProposalId: null,
    status: 'open', answerMessageId: null, continuationTurnId: null, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now(), updatedAt: now() };
  data.questions.push(question);
  const reply = addMessage(turn.projectId, { id: question.questionMessageId, role: 'assistant', actor: 'coordinator', content: question.question,
    coordinationTurnId: turn.id, replyToMessageId: turn.userMessageId });
  emit(turn.projectId, turn.id, { type: 'clarification.updated', payload: question });
  updateTurn(turn, { status: 'completed', assistantMessageId: reply.id, completedAt: now(), result: { kind: 'clarify', clarificationId: question.id, replyMessageId: reply.id } });
  return question;
}
function cancelTarget(turn: CoordinationTurnDto, targetId: string) {
  const record = execution.find(turn.projectId)!, target = record.runs.find(run => run.id === targetId);
  const ended = target && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(target.status);
  if (target && !ended) execution.update(record, target, { status: 'cancelling', pendingAttention: null, pendingAnswer: null });
  finish(turn, ended ? '所选构建已经结束，不需要再停止。' : target ? '取消请求已接收，等待所选构建真正停止。' : '所选目标不可用，没有取消其他任务。', reply => ({
    kind: 'control', action: 'cancel_run', targetRunId: targetId, replyMessageId: reply.id,
    receipt: !target ? 'not_applied' : ended ? 'already_terminal' : 'cancellation_requested', run: target ? structuredClone(target) : null,
    reason: target ? null : { code: 'NOT_FOUND', message: '目标不可用', retryable: false },
  }));
}

function process(turn: CoordinationTurnDto) {
  const data = state(turn.projectId), record = execution.find(turn.projectId)!;
  const request = data.requests[turn.id], user = data.messages.find(item => item.id === turn.userMessageId)!;
  const text = user.content;
  if (data.refreshOf[turn.id]) { proposalFor(turn, data.proposals.find(item => item.id === data.refreshOf[turn.id])!.goal, true, true); return; }
  if (request.input.kind === 'status' || /进度|完成了吗|怎么样了|^当前状态$/.test(text)) {
    const runs = record.runs.map(item => ({ id: item.id, revision: item.revision, status: item.status, phase: item.phase, baseVersionId: item.baseVersionId, resultVersionId: item.resultVersionId }));
    finish(turn, record.project.activeRunId ? '当前有构建任务进行中，问答与构建独立。可在构建活动中查看真实阶段或单独停止。' : '当前没有进行中的构建。成功版本仍可预览；类型和加载检查不等于全部行为验收。', reply => ({ kind: 'status', replyMessageId: reply.id, contextUsed: context(turn.projectId), observations: runs, references: runs.slice(-1).map(item => ({ kind: 'run', runId: item.id })) })); return;
  }
  if (request.input.kind === 'sharing_help' || /如何分享|怎么分享|能分享|如何部署|怎么部署/.test(text)) {
    const actionId = id('action'); data.actions[turn.id] = [{ id: actionId, turnId: turn.id, kind: 'deployment_help', label: '查看真实分享条件', available: true }];
    if (record.project.currentVersionId) data.actions[turn.id].push(
      { id: id('action'), turnId: turn.id, kind: 'preview', label: '打开当前签名预览', available: true, versionId: record.project.currentVersionId },
      { id: id('action'), turnId: turn.id, kind: 'source_download', label: '下载当前版本源码', available: true, versionId: record.project.currentVersionId });
    finish(turn, '当前是本机开发预览，不提供自动公网部署。你可以打开临时预览或下载源码；给外部访客使用需要先完成隔离与部署验收。没有为这个问题创建构建任务。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: data.actions[turn.id].map(action => ({ kind: 'available_action', actionId: action.id })) })); return;
  }
  if (/记住|仅更新|更正.*偏好|纠正.*约定|项目约定.*是/.test(text)) { remember(turn, text); return; }
  if (/记得|偏好是什么|刚才决定|记忆/.test(text)) {
    finish(turn, data.memory.summary ? `已确认的项目约定是：${data.memory.summary}。来源可在项目约定中核对。` : '尚无已确认约定，我不会把推测当作你的决定。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: data.memory.decisions.filter(item => item.status === 'active').map(item => ({ kind: 'decision', decisionId: item.id })) })); return;
  }
  if (request.replyTo) {
    const question = data.questions.find(item => item.id === request.replyTo!.clarificationId)!;
    const origin = data.turns.find(item => item.id === question.originatingTurnId)!;
    const original = data.messages.find(item => item.id === origin.userMessageId)!.content;
    const controlTarget = request.input.kind === 'selection' && data.questionTargets[question.id]?.[request.input.optionId];
    if (controlTarget) {
      if (turn.mode === 'ask') finish(turn, '已定位目标，但只问项目模式不执行取消。请在构建活动里显式停止。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: [{ kind: 'run', runId: controlTarget }] }));
      else cancelTarget(turn, controlTarget);
      return;
    }
    if (request.input.kind === 'selection' && request.input.optionId.endsWith('consult')) {
      finish(turn, '好的，本次只解释现有能力，没有创建构建。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: [] }));
    } else proposalFor(turn, `${original}；已明确：${text}`);
    return;
  }
  if (/停掉那个|停止所有|取消所有|全部停止/.test(text)) {
    const targets = record.runs.filter(run => !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status));
    if (!targets.length) {
      finish(turn, '没有可停止的活动任务，我不会猜测其他目标。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: [] })); return;
    }
    const options = targets.map((run, index) => ({ id: id('option'), label: `${run.status === 'queued' ? '等待中' : '执行中'}的第 ${index + 1} 个任务` }));
    const question = clarify(turn, '请选择要停止的具体构建任务；不会批量停止。', options, false);
    data.questionTargets[question.id] = Object.fromEntries(options.map((option, index) => [option.id, targets[index].id])); save(); return;
  }
  if (/^(可以|好的|好|就这样)[。！!]?\s*$|更好看|优化一下|分享一下/.test(text)) {
    clarify(turn, '你希望只了解现有能力，还是创建明确的修改需求？', [
      { id: id('option') + '_consult', label: '只了解现有能力，不修改' },
      { id: id('option') + '_change', label: '改为暖色配色，创建修改任务' },
    ], true); return;
  }
  if (/停止.*构建|取消.*构建/.test(text) && turn.mode !== 'ask') {
    const target = record.runs.find(item => item.id === record.project.activeRunId);
    if (target) cancelTarget(turn, target.id);
    else finish(turn, '没有明确的活动构建，没有执行取消。', reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: [] }));
    return;
  }
  if (/构建|创建|做一个|增加|添加|改|修改|调整|搜索|便签墙|任务看板/.test(text) && !/如何使用|怎么使用|为什么|解释|是什么/.test(text)) {
    proposalFor(turn, text, turn.mode === 'ask', /基于当前版本|只针对|exact/i.test(text)); return;
  }
  finish(turn, `我会基于已发布版本解释这个项目。${data.memory.summary ? `已确认约定：${data.memory.summary}。` : ''}当前仅支持受控 React 前端与浏览器本地数据；这是只读答复，没有修改代码。`, reply => ({ kind: 'consult', replyMessageId: reply.id, contextUsed: context(turn.projectId), references: record.project.currentVersionId ? [{ kind: 'version', versionId: record.project.currentVersionId }] : [] }));
}
function advance(projectId: string) {
  const data = state(projectId);
  const turn = data.turns.find(item => ['processing', 'cancelling'].includes(item.status)) ?? data.turns.find(item => item.status === 'queued');
  if (!turn) return;
  if (turn.status === 'cancelling') { updateTurn(turn, { status: 'cancelled', completedAt: now() }); return; }
  if (turn.status === 'queued') { store.reserved--; store.used++; updateTurn(turn, { status: 'processing', startedAt: now() }); return; }
  const text = data.messages.find(item => item.id === turn.userMessageId)?.content ?? '';
  if (text.includes('[slow-answer]')) return;
  process(turn);
}
function workspace(projectId: string) {
  mirror(projectId); const data = state(projectId), record = execution.find(projectId)!;
  return CoordinationWorkspace.parse({ protocolVersion: '0.2.0', execution: execution.snapshot(record),
    context: { contextVersionId: record.project.currentVersionId, contextRevision: record.project.revision, memoryRevision: data.memory.revision },
    conversationRevision: data.messages.length, messages: data.messages.slice(-50),
    olderMessagesCursor: data.messages.length > 50 ? String(data.messages.at(-50)!.historySeq) : null,
    pendingCoordinationTurns: data.turns.filter(item => ['queued', 'processing', 'cancelling'].includes(item.status)), latestCoordinationTurn: data.turns.at(-1) ?? null,
    clarifications: data.questions, proposals: data.proposals, executionEventCursor: record.events.length, conversationEventCursor: data.events.length });
}
const turnItem = (value: unknown) => Object.entries(store.projects).flatMap(([projectId, data]) => data.turns.filter(turn => turn.id === value).map(turn => ({ projectId, data, turn })))[0];
const proposalItem = (value: unknown) => Object.entries(store.projects).flatMap(([projectId, data]) => data.proposals.filter(proposal => proposal.id === value).map(proposal => ({ projectId, data, proposal })))[0];
const questionItem = (value: unknown) => Object.entries(store.projects).flatMap(([projectId, data]) => data.questions.filter(question => question.id === value).map(question => ({ projectId, data, question })))[0];
// Mock-only collaboration seam; never imported by production components.
export const mockCoordinationStore = { state, begin, finish, addMessage, context, emit, admit, save, get store() { return store; } };
export const coordinationHandlers = [
  http.get('/api/v2/session', () => execution.unauthorized() ?? asJson({ session: execution.session(), coordinationQuota: { limit: 50, reserved: store.reserved, used: store.used } })),
  http.get('/api/v2/projects/:id/workspace', ({ params }) => execution.unauthorized() ?? (projectRecord(params.id) ? asJson(workspace(String(params.id))) : error(404, 'NOT_FOUND', '项目不存在'))),
  http.get('/api/v2/projects/:id/memory', ({ params }) => execution.unauthorized() ?? (projectRecord(params.id) ? asJson(state(String(params.id)).memory) : error(404, 'NOT_FOUND', '项目不存在'))),
  http.get('/api/v2/projects/:id/messages', ({ params, request }) => {
    const auth = execution.unauthorized(); if (auth) return auth;
    if (!projectRecord(params.id)) return error(404, 'NOT_FOUND', '项目不存在');
    mirror(String(params.id)); const data = state(String(params.id)); const before = Number(new URL(request.url).searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
    const items = data.messages.filter(message => message.historySeq < before).slice(-50);
    return asJson({ items, nextCursor: items.length && data.messages[0].historySeq < items[0].historySeq ? String(items[0].historySeq) : null });
  }),
  http.get('/api/v2/projects/:id/conversation-events', ({ params, request }) => {
    const auth = execution.unauthorized(); if (auth) return auth;
    if (!projectRecord(params.id)) return error(404, 'NOT_FOUND', '项目不存在');
    const projectId = String(params.id); advance(projectId); mirror(projectId);
    const after = Number(new URL(request.url).searchParams.get('after') ?? 0), data = state(projectId);
    const items = data.events.filter(event => event.seq > after).slice(0, 100), nextCursor = items.at(-1)?.seq ?? after;
    return asJson({ items, nextCursor, hasMore: data.events.length > nextCursor });
  }),
  http.post('/api/v2/projects/:id/messages', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    if (!projectRecord(params.id)) return error(404, 'NOT_FOUND', '项目不存在');
    const validation = SubmitMessageRequest.safeParse(body); if (!validation.success) return error(400, 'INVALID_REQUEST', '消息输入不合法');
    if (store.used + store.reserved >= 50) return error(403, 'COORDINATION_QUOTA_EXCEEDED', '消息额度已用完');
    const parsed = validation.data, projectId = String(params.id), data = state(projectId);
    if (parsed.replyTo) {
      const question = data.questions.find(item => item.id === parsed.replyTo!.clarificationId);
      if (!question || question.revision !== parsed.replyTo.expectedRevision || question.questionMessageId !== parsed.replyTo.replyToMessageId || question.status !== 'open') return error(409, 'STALE_REVISION', '此问题已经更新或回答，请刷新');
      if (parsed.input.kind === 'selection' && !question.options.some(option => parsed.input.kind === 'selection' && option.id === parsed.input.optionId) || parsed.input.kind === 'text' && !question.allowText) return error(400, 'INVALID_REQUEST', '回答与绑定问题不匹配');
    }
    const result = begin(projectId, parsed);
    if (parsed.input.kind === 'status' || parsed.input.kind === 'sharing_help') {
      store.reserved--; store.used++; updateTurn(result.turn, { status: 'processing', startedAt: now() }); process(result.turn);
    }
    return { value: result, status: 202 };
  })),
  http.get('/api/v2/coordination-turns/:id', ({ params }) => execution.unauthorized() ?? (turnItem(params.id) ? asJson(CoordinationTurn.parse(turnItem(params.id)!.turn)) : error(404, 'NOT_FOUND', '消息轮次不存在'))),
  http.post('/api/v2/coordination-turns/:id/cancel', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = turnItem(params.id); if (!item) return error(404, 'NOT_FOUND', '消息轮次不存在'); const { turn } = item;
    if (turn.status === 'completed' && turn.result?.kind === 'change_proposal' && turn.result.runId) return { value: { turn, disposition: 'already_dispatched', run: execution.findRun(turn.result.runId)!.run }, status: 200 };
    if (turn.status === 'completed') return { value: { turn, disposition: 'already_completed', run: null }, status: 200 };
    if (body.expectedRevision !== turn.revision) return error(409, 'STALE_REVISION', '消息轮次已更新');
    if (turn.status === 'queued') { store.reserved--; updateTurn(turn, { status: 'cancelled', completedAt: now() }); return { value: { turn, disposition: 'cancelled', run: null }, status: 200 }; }
    if (turn.status === 'cancelled') return { value: { turn, disposition: 'cancelled', run: null }, status: 200 };
    updateTurn(turn, { status: 'cancelling' }); return { value: { turn, disposition: 'cancellation_requested', run: null }, status: 202 };
  })),
  http.post('/api/v2/coordination-turns/:id/retry', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = turnItem(params.id); if (!item) return error(404, 'NOT_FOUND', '消息轮次不存在');
    if (body.expectedRevision !== item.turn.revision || !['cancelled', 'failed', 'interrupted'].includes(item.turn.status)) return error(409, 'CONFLICT', '不能重试此消息');
    const result = begin(item.projectId, item.data.requests[item.turn.id], undefined, item.data.messages.find(message => message.id === item.turn.userMessageId)); result.turn.retryOfTurnId = item.turn.id; save(); return { value: { turn: result.turn }, status: 202 };
  })),
  http.get('/api/v2/proposals/:id', ({ params }) => execution.unauthorized() ?? (proposalItem(params.id) ? asJson(proposalItem(params.id)!.proposal) : error(404, 'NOT_FOUND', '提案不存在'))),
  http.get('/api/v2/clarifications/:id', ({ params }) => execution.unauthorized() ?? (questionItem(params.id) ? asJson(questionItem(params.id)!.question) : error(404, 'NOT_FOUND', '问题不存在'))),
  http.post('/api/v2/proposals/:id/accept', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = proposalItem(params.id); if (!item) return error(404, 'NOT_FOUND', '提案不存在'); const proposal = item.proposal;
    if (proposal.status === 'accepted') return { value: { proposal, run: execution.findRun(proposal.acceptedRunId!)!.run }, status: 200 };
    if (proposal.revision !== body.expectedRevision || proposal.status !== 'open') return error(409, 'STALE_REVISION', '提案已更新');
    const record = execution.find(item.projectId)!;
    if (proposal.basePolicy.kind === 'exact_version' && proposal.basePolicy.expectedBaseVersionId !== record.project.currentVersionId) {
      Object.assign(proposal, { status: 'stale', revision: proposal.revision + 1, lastAdmissionError: { code: 'CONFLICT', message: '指定基线已改变，需要只读刷新并重新确认。', retryable: false } }); emit(item.projectId, proposal.originatingTurnId, { type: 'proposal.updated', payload: proposal });
      return error(409, 'CONFLICT', '提案基线已改变，未创建构建');
    }
    if (execution.session().quota.runsReserved + execution.session().quota.runsUsed >= 10) return error(403, 'GENERATION_QUOTA_EXCEEDED', '构建额度不足');
    const run = admit(proposal, body.runMode ?? 'build'); return { value: { proposal, run }, status: 202 };
  })),
  http.post('/api/v2/proposals/:id/refresh', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = proposalItem(params.id); if (!item) return error(404, 'NOT_FOUND', '提案不存在');
    if (item.proposal.revision !== body.expectedRevision) return error(409, 'STALE_REVISION', '提案已更新');
    return { value: begin(item.projectId, { input: { kind: 'text', content: '基于最新版本只读刷新这项提案，尚不执行。' }, mode: 'ask', runMode: 'build' }, item.proposal.id), status: 202 };
  })),
  http.post('/api/v2/proposals/:id/dismiss', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = proposalItem(params.id); if (!item) return error(404, 'NOT_FOUND', '提案不存在');
    if (item.proposal.revision !== body.expectedRevision) return error(409, 'STALE_REVISION', '提案已更新');
    Object.assign(item.proposal, { status: 'dismissed', revision: item.proposal.revision + 1 }); emit(item.projectId, item.proposal.originatingTurnId, { type: 'proposal.updated', payload: item.proposal }); return { value: { proposal: item.proposal }, status: 200 };
  })),
  http.post('/api/v2/clarifications/:id/dismiss', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, body => {
    const item = questionItem(params.id); if (!item) return error(404, 'NOT_FOUND', '问题不存在');
    if (item.question.revision !== body.expectedRevision) return error(409, 'STALE_REVISION', '问题已更新');
    Object.assign(item.question, { status: 'dismissed', revision: item.question.revision + 1 }); emit(item.projectId, item.question.originatingTurnId, { type: 'clarification.updated', payload: item.question }); return { value: { clarification: item.question }, status: 200 };
  })),
  http.get('/api/v2/coordination-turns/:turnId/actions/:actionId', ({ params }) => {
    const item = turnItem(params.turnId); const action = item?.data.actions[String(params.turnId)]?.find(value => value.id === params.actionId);
    return execution.unauthorized() ?? (action ? asJson(action) : error(404, 'NOT_FOUND', '宿主操作不可用'));
  }),
  http.post('/api/v2/coordination-turns/:turnId/actions/:actionId/resolve', ({ params, request }) => execution.unauthorized() ?? execution.mutation(request, () => {
    const item = turnItem(params.turnId), action = item?.data.actions[String(params.turnId)]?.find(value => value.id === params.actionId);
    if (!item || !action) return error(404, 'NOT_FOUND', '宿主操作不可用');
    const version = action.versionId && execution.find(item.projectId)!.versions.find(value => value.id === action.versionId);
    const resolution = action.kind === 'deployment_help' ? { kind: 'deployment_help', message: '本机预览不等于公网部署。当前没有自动部署能力，请下载源码并完成后续隔离部署验收。' }
      : action.kind === 'preview' && version ? { kind: 'preview', versionId: version.id, url: version.previewUrl, expiresAt: version.previewExpiresAt }
      : action.kind === 'source_download' && version ? { kind: 'source_download', versionId: version.id, path: `/api/v1/versions/${version.id}/source.zip` }
      : action.kind === 'view_run' && action.runId ? { kind: 'view_run', runId: action.runId }
      : action.kind === 'cancel_run' && action.runId ? { kind: 'cancel_run', runId: action.runId, expectedRevision: execution.findRun(action.runId)!.run.revision, requiresExplicitAction: true } : null;
    if (!resolution) return error(409, 'CONFLICT', '操作目标已失效');
    return { value: { turnId: params.turnId, actionId: params.actionId, resolution }, status: 200 };
  })),
  // Explicit Mock-only setup for migration/history fixtures. Not included in production.
  http.post('/__mock/v2/seed/:projectId', async ({ params, request }) => {
    const projectId = String(params.projectId), data = state(projectId), body = await request.json() as { kind?: string };
    if (!execution.find(projectId)) return error(404, 'NOT_FOUND', '项目不存在');
    if (body.kind === 'history') {
      const record = execution.find(projectId)!;
      for (let index = 0; index < 65; index++) record.messages.push({ id: id('message'), projectId, runId: null,
        role: index % 2 ? 'assistant' : 'user', content: `旧历史消息 ${index + 1}`, status: 'complete',
        createdAt: new Date(Date.now() - 86400000 + index * 1000).toISOString() });
      mirror(projectId);
    }
    save(); return asJson({ ok: true, messages: data.messages.length });
  }),
];
