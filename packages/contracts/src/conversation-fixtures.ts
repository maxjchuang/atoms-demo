/** Synthetic v0.2 contract examples, never evidence of real routing/model execution. */
import { run as executionRun, scenarios as executionScenarios, time, version } from './fixtures.js';
import {
  CoordinationProtocolVersion, CoordinationBudget,
  type ConversationMessageDto, type CoordinationTurnDto, type ChangeProposalDto,
  type ClarificationDto, type ProjectMemoryViewDto, type StartCoordinationRequestDto,
  type RouterResultDto, type ConversationEventDto, type CoordinationWorkspaceDto,
} from './conversation.js';

export const contextUsed = {
  contextId: 'context_demo', contextRevision: 1, memoryRevision: 0, conversationRevision: 1,
  contextVersionId: version.id, asOf: time, hash: 'c'.repeat(64),
};
export const memory: ProjectMemoryViewDto = {
  projectId: 'project_demo', revision: 0, decisions: [], summary: '', summaryThroughConversationRevision: 0, updatedAt: time,
};
export const legacyMessage = { id: 'message_legacy', projectId: 'project_demo', runId: 'run_demo',
  role: 'user' as const, status: 'complete' as const, content: '创建便签墙', createdAt: time };
export const legacyConversationMessage: ConversationMessageDto = {
  ...legacyMessage, actor: 'user', coordinationTurnId: null, replyToMessageId: null,
  historySeq: 1, revision: 1, updatedAt: time,
};
export const consultUser: ConversationMessageDto = {
  id: 'message_consult', projectId: 'project_demo', coordinationTurnId: 'turn_consult', runId: null,
  replyToMessageId: null, historySeq: 2, revision: 1, role: 'user', actor: 'user', status: 'complete',
  content: '如何分享这个应用给别人？', createdAt: time, updatedAt: time,
};
export const consultReply: ConversationMessageDto = {
  ...consultUser, id: 'message_consult_reply', historySeq: 3, role: 'assistant', actor: 'coordinator',
  replyToMessageId: consultUser.id,
  content: '当前预览仅限本机。可以下载源码；公网分享需要完成部署。',
};
export const consultRouterResult: RouterResultDto = {
  kind: 'consult', answer: consultReply.content, contextUsed,
  references: [{ kind: 'available_action', actionId: 'action_source' }, { kind: 'version', versionId: version.id }], memoryUpdates: [],
};
export const consultTurn: CoordinationTurnDto = {
  id: 'turn_consult', projectId: 'project_demo', revision: 3, userMessageId: consultUser.id,
  assistantMessageId: consultReply.id, mode: 'auto', runMode: 'build', status: 'completed',
  contextVersionId: version.id, contextRevisionUsed: 1, memoryRevisionUsed: 0, conversationRevisionUsed: 1,
  result: { kind: 'consult', replyMessageId: consultReply.id, contextUsed, references: consultRouterResult.references },
  error: null, continuationOfTurnId: null, retryOfTurnId: null,
  createdAt: time, startedAt: time, completedAt: time, updatedAt: time,
};
export const startCoordination: StartCoordinationRequestDto = {
  protocolVersion: CoordinationProtocolVersion, turnId: consultTurn.id, projectId: 'project_demo',
  inputMessageId: consultUser.id, assistantMessageId: consultReply.id, content: consultUser.content,
  operation: { kind: 'message', input: { kind: 'text', content: consultUser.content } }, mode: 'auto', runMode: 'build',
  context: {
    id: contextUsed.contextId, projectId: 'project_demo', contextRevision: 1, conversationRevision: 1,
    contextVersionId: version.id, asOf: time, hash: contextUsed.hash,
    facts: {
      project: { id: 'project_demo', title: '便签墙' }, currentVersionId: version.id,
      versions: [{ id: version.id, summary: version.summary, createdAt: time,
        checks: version.checks.map(({ kind, status }) => ({ kind, status })) }],
      runs: [], availableActions: [{ id: 'action_source', kind: 'source_download', versionId: version.id, available: true }],
      deployment: { scope: 'local_only', publicDeployment: false },
    },
    projectMemory: memory, recentMessages: [legacyConversationMessage, consultUser],
    pendingClarifications: [], relevantProposals: [],
  }, budget: CoordinationBudget.parse({}),
};

export const proposal: ChangeProposalDto = {
  id: 'proposal_search', projectId: 'project_demo', revision: 1, originatingTurnId: 'turn_change',
  sourceMessageIds: ['message_change'], summary: '增加便签搜索', goal: '增加一个按便签文字筛选的搜索框',
  acceptance: [{ id: 'acceptance_search', description: '搜索文字后仅显示匹配便签' }],
  origin: 'explicit_request', basePolicy: { kind: 'latest_on_dispatch' }, contextUsed,
  status: 'open', acceptedRunId: null, supersedesProposalId: null, lastAdmissionError: null,
  expiresAt: '2026-11-09T08:00:00.000Z', createdAt: time, updatedAt: time,
};
export const changeRouterResult: RouterResultDto = {
  kind: 'change_proposal', summary: proposal.summary, goal: proposal.goal, acceptance: proposal.acceptance,
  origin: proposal.origin, basePolicy: proposal.basePolicy,
  evidence: [{ messageId: 'message_change', quote: '增加一个搜索框' }], contextUsed, references: [], memoryUpdates: [],
};
export const admittedRun = { ...executionRun, id: 'run_from_message' };
export const autoChangeTurn: CoordinationTurnDto = {
  ...consultTurn, id: 'turn_change', userMessageId: 'message_change', assistantMessageId: 'message_change_reply',
  result: { kind: 'change_proposal', proposalId: proposal.id, admission: 'run_queued', runId: admittedRun.id, admissionError: null },
};
export const askProposalTurn: CoordinationTurnDto = {
  ...autoChangeTurn, id: 'turn_ask_change', mode: 'ask',
  result: { kind: 'change_proposal', proposalId: proposal.id, admission: 'proposed', runId: null, admissionError: null },
};
export const acceptedProposal: ChangeProposalDto = { ...proposal, status: 'accepted', acceptedRunId: admittedRun.id };
export const staleExactProposal: ChangeProposalDto = {
  ...proposal, id: 'proposal_exact', revision: 2, status: 'stale', basePolicy: { kind: 'exact_version', expectedBaseVersionId: version.id },
};
export const refreshCoordination: StartCoordinationRequestDto = {
  ...startCoordination, turnId: 'turn_refresh', inputMessageId: 'message_refresh', assistantMessageId: 'message_refresh_reply',
  content: '基于最新版本重新整理这项提案。', mode: 'ask',
  operation: { kind: 'proposal_refresh', proposalId: staleExactProposal.id, expectedRevision: 2, forceProposalOnly: true },
  context: { ...startCoordination.context, relevantProposals: [staleExactProposal] },
};
export const refreshedProposal: ChangeProposalDto = {
  ...proposal, id: 'proposal_refreshed', originatingTurnId: refreshCoordination.turnId,
  sourceMessageIds: ['message_change', 'message_refresh'], supersedesProposalId: staleExactProposal.id,
  basePolicy: { kind: 'exact_version', expectedBaseVersionId: version.id },
};

export const clarification: ClarificationDto = {
  id: 'clarification_color', projectId: 'project_demo', revision: 1, originatingTurnId: 'turn_color',
  questionMessageId: 'message_color_question', question: '希望使用哪一种配色？',
  options: [{ id: 'option_warm', label: '暖色' }, { id: 'option_dark', label: '深色' }], allowText: false,
  contextVersionId: version.id, contextRevision: 1, relatedProposalId: null,
  status: 'open', answerMessageId: null, continuationTurnId: null,
  expiresAt: '2026-11-09T08:00:00.000Z', createdAt: time, updatedAt: time,
};
export const clarificationTurn: CoordinationTurnDto = {
  ...consultTurn, id: 'turn_color', userMessageId: 'message_color', assistantMessageId: clarification.questionMessageId,
  result: { kind: 'clarify', clarificationId: clarification.id, replyMessageId: clarification.questionMessageId },
};
export const selectionMessageRequest = {
  input: { kind: 'selection' as const, optionId: 'option_dark' }, mode: 'auto' as const, runMode: 'build' as const,
  replyTo: { clarificationId: clarification.id, expectedRevision: 1, replyToMessageId: clarification.questionMessageId },
};
export const continuationCoordination: StartCoordinationRequestDto = {
  ...startCoordination, turnId: 'turn_color_answer', inputMessageId: 'message_color_answer', assistantMessageId: 'message_color_answer_reply',
  content: '深色', operation: { kind: 'clarification_answer', questionSnapshot: clarification,
    relatedProposal: null, answerMessageId: 'message_color_answer',
    answer: { kind: 'selection', optionId: 'option_dark', label: '深色' } }, replyTo: selectionMessageRequest.replyTo,
  continuationOfTurnId: clarification.originatingTurnId,
  context: { ...startCoordination.context, pendingClarifications: [] },
};
export const answeredClarification: ClarificationDto = {
  ...clarification, status: 'answered', answerMessageId: 'message_color_answer', continuationTurnId: continuationCoordination.turnId,
};
export const decision = {
  id: 'decision_color', projectId: 'project_demo', revision: 1, kind: 'preference' as const, text: '界面保持暖色',
  status: 'active' as const, sourceTurnId: 'turn_preference', sourceMessageIds: ['message_preference'],
  sourceProposalId: null, sourceClarificationId: null, supersedesDecisionId: null,
  confirmedAt: time, createdAt: time, updatedAt: time,
};
export const controlTargetRun = {
  ...executionRun, id: 'run_control_target', revision: 2, status: 'running' as const,
  phase: 'generating' as const, executionId: 'execution_control_target',
};
export const controlRouterResult: RouterResultDto = {
  kind: 'control', action: 'cancel_run', targetRunId: controlTargetRun.id, expectedRevision: 2,
  sourceMessageIds: ['message_cancel_request'], evidence: [{ messageId: 'message_cancel_request', quote: '停止这个正在生成的任务' }],
  contextUsed, references: [{ kind: 'run', runId: controlTargetRun.id }], memoryUpdates: [],
};
export const controlTurn: CoordinationTurnDto = {
  ...consultTurn, id: 'turn_cancel_request', userMessageId: 'message_cancel_request', assistantMessageId: 'message_cancel_reply',
  result: { kind: 'control', action: 'cancel_run', targetRunId: controlTargetRun.id, replyMessageId: 'message_cancel_reply',
    receipt: 'cancellation_requested', run: { ...controlTargetRun, revision: 3, status: 'cancelling' }, reason: null },
};
export const persistedMemory: ProjectMemoryViewDto = {
  ...memory, revision: 1, decisions: [decision], summary: '已确认界面保持暖色。', summaryThroughConversationRevision: 2,
};

const conversationEvent = (seq: number, event: ConversationEventDto['event']): ConversationEventDto => ({
  protocolVersion: CoordinationProtocolVersion, projectId: 'project_demo', turnId: consultTurn.id, seq, occurredAt: time, event,
});
export const consultEvents: ConversationEventDto[] = [
  conversationEvent(1, { type: 'message.upserted', payload: consultUser }),
  conversationEvent(2, { type: 'turn.updated', payload: { ...consultTurn, revision: 1, status: 'queued', result: null,
    assistantMessageId: null, startedAt: null, completedAt: null } }),
  conversationEvent(3, { type: 'message.upserted', payload: consultReply }),
  conversationEvent(4, { type: 'turn.updated', payload: consultTurn }),
];
export const workspace: CoordinationWorkspaceDto = {
  protocolVersion: CoordinationProtocolVersion,
  execution: { ...executionScenarios[0].final, messages: [legacyMessage] },
  context: { contextVersionId: version.id, contextRevision: 1, memoryRevision: 0 }, conversationRevision: 1,
  messages: [legacyConversationMessage, consultUser, consultReply], olderMessagesCursor: null,
  pendingCoordinationTurns: [], latestCoordinationTurn: consultTurn, clarifications: [], proposals: [],
  executionEventCursor: executionScenarios[0].final.eventCursor, conversationEventCursor: 4,
};
export const scenarios = {
  consult: { request: { input: { kind: 'text' as const, content: consultUser.content } }, turn: consultTurn, routerResult: consultRouterResult },
  status: { request: { input: { kind: 'status' as const } }, routerResult: {
    kind: 'status' as const, answer: '目前没有正在写入的任务。', observations: [], contextUsed, references: [], memoryUpdates: [],
  } },
  autoChange: { turn: autoChangeTurn, routerResult: changeRouterResult, proposal: acceptedProposal, run: admittedRun },
  askChange: { turn: askProposalTurn, proposal },
  clarification: { turn: clarificationTurn, clarification, answer: selectionMessageRequest, answered: answeredClarification },
  exactRefresh: { old: staleExactProposal, request: refreshCoordination, next: refreshedProposal },
  control: { routerResult: controlRouterResult, turn: controlTurn },
  quotaBlocked: { ...autoChangeTurn, result: { kind: 'change_proposal' as const, proposalId: proposal.id,
    admission: 'blocked' as const, runId: null, admissionError: { code: 'GENERATION_QUOTA_EXCEEDED' as const, message: '生成次数已用完，尚未创建任务', retryable: false } } },
  cancelled: { ...consultTurn, status: 'cancelled' as const, result: null },
  interrupted: { ...consultTurn, status: 'interrupted' as const, result: null,
    error: { code: 'INFERENCE_INTERRUPTED' as const, message: '协调推理被中断，尚未执行应用修改', retryable: false } },
};

export const actionExamples = {
  descriptor: {turnId: consultTurn.id,id:'action_source',kind:'source_download' as const,versionId:version.id,available:true,label:'下载源码'},
  source: {turnId:consultTurn.id,actionId:'action_source',resolution:{kind:'source_download' as const,versionId:version.id,path:`/api/v1/versions/${version.id}/source.zip`}},
  preview: {turnId:consultTurn.id,actionId:'action_preview',resolution:{kind:'preview' as const,versionId:version.id,url:'https://preview.example.test/p/fresh-token/index.html',expiresAt:'2026-11-08T10:00:00.000Z'}},
  cancel: {turnId:consultTurn.id,actionId:'action_cancel',resolution:{kind:'cancel_run' as const,runId:controlTargetRun.id,expectedRevision:2,requiresExplicitAction:true as const}},
};
