/** v0.2 coordination contracts. v0.1 execution contracts remain in index.ts. */
import { z } from 'zod';
import { AcceptanceItem, Id, Mode, OpaqueCursor, Phase, RelativePath, Revision, Run, RunStatus,
  Seq, Session, Sha256, Timestamp, WorkspaceSnapshot } from './index.js';

export const CoordinationProtocolVersion = '0.2.0' as const;
export const CoordinationVersion = z.literal(CoordinationProtocolVersion);
export const COORDINATION_DEFAULTS = Object.freeze({
  messageLimit: 50, messagesPerMinute: 20, routerConcurrency: 1, workerConcurrency: 1,
  perProjectConcurrency: 1, maxPendingTurnsPerProject: 5, maxOpenClarificationsPerProject: 5,
  maxOpenProposalsPerProject: 10, maxModelSteps: 3, maxWallTimeMs: 90000,
  maxInputTokens: 32768, maxOutputTokens: 8192, maxStructuredRetries: 1,
  maxMessageCharacters: 12000, maxSourceFiles: 5, maxSourceBytes: 24576,
  maxRecentMessages: 20, maxRecentMessageBytes: 24576, maxMemoryBytes: 16384,
  clarificationTtlMs: 86400000, proposalTtlMs: 86400000, maxOrdinaryRunQuestions: 2,
});
const Text = z.string().min(1).max(COORDINATION_DEFAULTS.maxMessageCharacters);
export const CoordinationMode = z.enum(['auto', 'ask', 'build']);
export const CoordinationTurnStatus = z.enum(['queued', 'processing', 'cancelling', 'completed', 'cancelled', 'failed', 'interrupted']);
export const CoordinationExecutionStatus = z.enum(['accepted', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'interrupted']);
export const CoordinationErrorCode = z.enum([
  'INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'STALE_REVISION',
  'CLARIFICATION_EXPIRED', 'PROPOSAL_EXPIRED', 'COORDINATION_QUOTA_EXCEEDED', 'GENERATION_QUOTA_EXCEEDED',
  'RATE_LIMITED', 'RUNTIME_UNAVAILABLE', 'BUDGET_EXCEEDED', 'INFERENCE_INTERRUPTED', 'INTERNAL_ERROR',
]);
export const CoordinationFailure = z.object({ code: CoordinationErrorCode, message: z.string(), retryable: z.boolean() }).strict();
export const CoordinationApiError = z.object({ error: CoordinationFailure.extend({ requestId: Id,
  details: z.record(z.unknown()).optional() }).strict() }).strict();

export const ClarificationOption = z.object({ id: Id, label: z.string().min(1).max(240) }).strict();
export const CoordinationReplyTo = z.object({
  clarificationId: Id, expectedRevision: Revision, replyToMessageId: Id,
}).strict();
export const CoordinationInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), content: Text }).strict(),
  z.object({ kind: z.literal('selection'), optionId: Id }).strict(),
  z.object({ kind: z.literal('status'), targetRunId: Id.optional() }).strict(),
  z.object({ kind: z.literal('sharing_help'), contextVersionId: Id.optional() }).strict(),
]);
export const SubmitMessageRequest = z.object({
  input: CoordinationInput, mode: CoordinationMode.default('auto'), runMode: Mode.default('build'),
  contextVersionId: Id.nullable().optional(), replyTo: CoordinationReplyTo.optional(),
}).strict().superRefine((request, ctx) => {
  if (request.input.kind === 'selection' && !request.replyTo) {
    ctx.addIssue({ code: 'custom', message: 'Selection requires an explicit clarification binding' });
  }
  if (request.replyTo && !['text', 'selection'].includes(request.input.kind)) {
    ctx.addIssue({ code: 'custom', message: 'Only text or selection may answer a clarification' });
  }
});
export const ExpectedCoordinationRevision = z.object({ expectedRevision: Revision }).strict();
export const AcceptProposalRequest = ExpectedCoordinationRevision.extend({ runMode: Mode.default('build') }).strict();
export const RefreshProposalRequest = ExpectedCoordinationRevision;

export const ConversationMessage = z.object({
  id: Id, projectId: Id, historySeq: z.number().int().positive(), revision: Revision,
  coordinationTurnId: Id.nullable(), runId: Id.nullable(), replyToMessageId: Id.nullable(),
  role: z.enum(['user', 'assistant']), actor: z.enum(['user', 'coordinator', 'worker', 'system', 'legacy_assistant']),
  content: z.string().max(100000), status: z.enum(['streaming', 'complete']), createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export const ConversationMessagePage = z.object({ items: z.array(ConversationMessage), nextCursor: OpaqueCursor.nullable() }).strict();

export const ContextUsed = z.object({
  contextId: Id, contextRevision: Seq, memoryRevision: Seq, conversationRevision: Seq,
  contextVersionId: Id.nullable(), asOf: Timestamp, hash: Sha256,
}).strict();
export const SourceMessageEvidence = z.object({ messageId: Id, quote: z.string().min(1).max(2000) }).strict();
export const ChangeOrigin = z.enum(['explicit_request', 'confirmed_clarification', 'inferred_suggestion']);
export const ChangeBasePolicy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('latest_on_dispatch') }).strict(),
  z.object({ kind: z.literal('exact_version'), expectedBaseVersionId: Id.nullable() }).strict(),
]);
export const ContextReference = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('version'), versionId: Id }).strict(),
  z.object({ kind: z.literal('run'), runId: Id }).strict(),
  z.object({ kind: z.literal('file'), versionId: Id, path: RelativePath }).strict(),
  z.object({ kind: z.literal('available_action'), actionId: Id }).strict(),
  z.object({ kind: z.literal('decision'), decisionId: Id }).strict(),
]);
export const RunFact = z.object({
  id: Id, revision: Revision, status: RunStatus, phase: Phase.nullable(),
  baseVersionId: Id.nullable(), resultVersionId: Id.nullable(),
}).strict();

export const ProjectDecision = z.object({
  id: Id, projectId: Id, revision: Revision, kind: z.enum(['goal', 'preference', 'decision']),
  text: Text, status: z.enum(['active', 'superseded']), sourceTurnId: Id, sourceMessageIds: z.array(Id).min(1),
  sourceProposalId: Id.nullable(), sourceClarificationId: Id.nullable(), supersedesDecisionId: Id.nullable(),
  confirmedAt: Timestamp, createdAt: Timestamp, updatedAt: Timestamp,
}).strict().refine((value) => value.supersedesDecisionId !== value.id, 'Decision cannot supersede itself');
export const ProjectMemoryView = z.object({
  projectId: Id, revision: Seq, decisions: z.array(ProjectDecision), summary: z.string(),
  summaryThroughConversationRevision: Seq, updatedAt: Timestamp,
}).strict();
export const RouterMemory = z.object({
  projectId: Id, revision: Seq, summary: z.string(), decisionIds: z.array(Id),
  summaryThroughHistorySeq: Seq, consumedConversationRevision: Seq, lastCompletedTurnId: Id.nullable(), updatedAt: Timestamp,
}).strict();
export const ProjectMemoryUpdate = z.object({
  kind: z.enum(['goal', 'preference', 'decision']), text: Text, sourceMessageIds: z.array(Id).min(1),
  supersedesDecisionId: Id.nullable(),
}).strict();

export const Clarification = z.object({
  id: Id, projectId: Id, revision: Revision, originatingTurnId: Id, questionMessageId: Id,
  question: Text, options: z.array(ClarificationOption), allowText: z.boolean(),
  contextVersionId: Id.nullable(), contextRevision: Seq, relatedProposalId: Id.nullable(),
  status: z.enum(['open', 'answered', 'dismissed', 'superseded', 'expired']),
  answerMessageId: Id.nullable(), continuationTurnId: Id.nullable(),
  expiresAt: Timestamp, createdAt: Timestamp, updatedAt: Timestamp,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length) ctx.addIssue({ code: 'custom', message: 'Duplicate option ID' });
  if (!value.allowText && value.options.length === 0) ctx.addIssue({ code: 'custom', message: 'Question must allow a verifiable answer' });
  if (value.status === 'answered' && (!value.answerMessageId || !value.continuationTurnId)) {
    ctx.addIssue({ code: 'custom', message: 'Answered clarification requires durable answer and continuation' });
  }
});
export const ChangeProposal = z.object({
  id: Id, projectId: Id, revision: Revision, originatingTurnId: Id, sourceMessageIds: z.array(Id).min(1),
  summary: Text, goal: Text, acceptance: z.array(AcceptanceItem).min(1), origin: ChangeOrigin,
  basePolicy: ChangeBasePolicy, contextUsed: ContextUsed,
  status: z.enum(['open', 'accepted', 'dismissed', 'expired', 'stale']),
  acceptedRunId: Id.nullable(), supersedesProposalId: Id.nullable(), lastAdmissionError: CoordinationFailure.nullable(),
  expiresAt: Timestamp, createdAt: Timestamp, updatedAt: Timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.status === 'accepted' && !value.acceptedRunId) ctx.addIssue({ code: 'custom', message: 'Accepted proposal requires the admitted run' });
  if (value.status !== 'accepted' && value.acceptedRunId) ctx.addIssue({ code: 'custom', message: 'Only accepted proposal may reference an admitted run' });
  if (value.supersedesProposalId === value.id) ctx.addIssue({ code: 'custom', message: 'Proposal cannot supersede itself' });
});

export const CoordinationOutcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consult'), replyMessageId: Id, contextUsed: ContextUsed, references: z.array(ContextReference) }).strict(),
  z.object({ kind: z.literal('status'), replyMessageId: Id, contextUsed: ContextUsed, observations: z.array(RunFact), references: z.array(ContextReference) }).strict(),
  z.object({ kind: z.literal('change_proposal'), proposalId: Id, admission: z.enum(['proposed', 'run_queued', 'blocked']),
    runId: Id.nullable(), admissionError: CoordinationFailure.nullable() }).strict(),
  z.object({ kind: z.literal('clarify'), clarificationId: Id, replyMessageId: Id }).strict(),
  z.object({ kind: z.literal('control'), action: z.literal('cancel_run'), targetRunId: Id, replyMessageId: Id,
    receipt: z.enum(['cancellation_requested', 'already_terminal', 'not_applied']), run: Run.nullable(),
    reason: CoordinationFailure.nullable() }).strict(),
]);
export const CoordinationTurn = z.object({
  id: Id, projectId: Id, revision: Revision, userMessageId: Id, assistantMessageId: Id.nullable(),
  mode: CoordinationMode, runMode: Mode, status: CoordinationTurnStatus,
  contextVersionId: Id.nullable(), contextRevisionUsed: Seq, memoryRevisionUsed: Seq, conversationRevisionUsed: Seq,
  result: CoordinationOutcome.nullable(), error: CoordinationFailure.nullable(),
  continuationOfTurnId: Id.nullable(), retryOfTurnId: Id.nullable(),
  createdAt: Timestamp, startedAt: Timestamp.nullable(), completedAt: Timestamp.nullable(), updatedAt: Timestamp,
}).strict().superRefine((turn, ctx) => {
  if (turn.status === 'completed' && (!turn.result || !turn.completedAt || !turn.assistantMessageId)) ctx.addIssue({ code: 'custom', message: 'Completed turn requires a committed outcome, reply and completion time' });
  if (turn.status !== 'completed' && turn.result !== null) ctx.addIssue({ code: 'custom', message: 'Uncommitted outcome cannot be public' });
  if (turn.result?.kind === 'change_proposal') {
    if ((turn.result.admission === 'run_queued') !== (turn.result.runId !== null)) ctx.addIssue({ code: 'custom', message: 'Run ID is only present after admission' });
    if (turn.mode === 'ask' && turn.result.runId !== null) ctx.addIssue({ code: 'custom', message: 'Ask turn cannot automatically create a run' });
  }
  if (turn.mode === 'ask' && turn.result?.kind === 'control' && turn.result.receipt === 'cancellation_requested') {
    ctx.addIssue({ code: 'custom', message: 'Ask turn cannot automatically mutate a run' });
  }
  if (turn.result?.kind === 'control' && turn.result.run && turn.result.run.id !== turn.result.targetRunId) {
    ctx.addIssue({ code: 'custom', message: 'Control receipt must reference the authorized target run' });
  }
  if (['failed', 'interrupted'].includes(turn.status) && !turn.error) ctx.addIssue({ code: 'custom', message: 'Failed/interrupted turn requires an explicit error' });
});
export const SubmitMessageResponse = z.object({ userMessage: ConversationMessage, turn: CoordinationTurn }).strict();
export const CancelCoordinationResponse = z.object({
  turn: CoordinationTurn, disposition: z.enum(['cancellation_requested', 'cancelled', 'already_completed', 'already_dispatched']),
  run: Run.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.disposition === 'already_dispatched'
    && (!value.run || value.turn.result?.kind !== 'change_proposal'
      || value.turn.result.admission !== 'run_queued' || value.turn.result.runId !== value.run.id)) {
    ctx.addIssue({ code: 'custom', message: 'Dispatched receipt requires the already admitted run and result' });
  }
  if (value.disposition === 'cancellation_requested' && value.turn.status !== 'cancelling') ctx.addIssue({ code: 'custom', message: 'Cancellation request is not a stopped turn' });
  if (value.disposition === 'cancelled' && value.turn.status !== 'cancelled') ctx.addIssue({ code: 'custom', message: 'Cancelled receipt requires stopped coordination' });
});
export const AcceptProposalResponse = z.object({ proposal: ChangeProposal, run: Run }).strict();
export const CoordinationSession = z.object({
  session: Session,
  coordinationQuota: z.object({ limit: Seq, reserved: Seq, used: Seq }).strict(),
}).strict();

/** Deliberately not a Version DTO: signed URLs and credentials are forbidden keys. */
export const AvailableAction = z.object({
  id: Id, kind: z.enum(['source_download', 'preview', 'deployment_help', 'view_run', 'cancel_run']),
  versionId: Id.optional(), runId: Id.optional(), available: z.boolean(), reason: z.string().optional(),
}).strict();
export const CoordinationFacts = z.object({
  project: z.object({ id: Id, title: z.string().max(120) }).strict(), currentVersionId: Id.nullable(),
  versions: z.array(z.object({ id: Id, summary: z.string(), createdAt: Timestamp,
    checks: z.array(z.object({ kind: z.enum(['typecheck', 'build', 'smoke', 'behavior']),
      status: z.enum(['passed', 'failed', 'not_run', 'skipped']) }).strict()),
  }).strict()),
  runs: z.array(RunFact), availableActions: z.array(AvailableAction),
  deployment: z.object({ scope: z.enum(['local_only', 'public', 'unavailable']), publicDeployment: z.boolean() }).strict(),
}).strict();
export const CoordinationSourceArtifact = z.object({
  versionId: Id, artifactId: Id, manifestSha256: Sha256, allowedPaths: z.array(RelativePath),
}).strict();
export const CoordinationContextSnapshot = z.object({
  id: Id, projectId: Id, contextRevision: Seq, conversationRevision: Seq,
  contextVersionId: Id.nullable(), asOf: Timestamp, hash: Sha256,
  facts: CoordinationFacts, projectMemory: ProjectMemoryView,
  recentMessages: z.array(ConversationMessage), sourceArtifact: CoordinationSourceArtifact.optional(),
  pendingClarifications: z.array(Clarification), relevantProposals: z.array(ChangeProposal),
}).strict();
export const CoordinationBudget = z.object({
  maxModelSteps: z.number().int().positive().default(COORDINATION_DEFAULTS.maxModelSteps),
  maxWallTimeMs: z.number().int().positive().default(COORDINATION_DEFAULTS.maxWallTimeMs),
  maxInputTokens: z.number().int().positive().default(COORDINATION_DEFAULTS.maxInputTokens),
  maxOutputTokens: z.number().int().positive().default(COORDINATION_DEFAULTS.maxOutputTokens),
  maxStructuredRetries: Seq.default(COORDINATION_DEFAULTS.maxStructuredRetries),
  maxSourceFiles: Seq.default(COORDINATION_DEFAULTS.maxSourceFiles),
  maxSourceBytes: Seq.default(COORDINATION_DEFAULTS.maxSourceBytes),
  maxRecentMessages: Seq.default(COORDINATION_DEFAULTS.maxRecentMessages),
  maxRecentMessageBytes: Seq.default(COORDINATION_DEFAULTS.maxRecentMessageBytes),
  maxMemoryBytes: Seq.default(COORDINATION_DEFAULTS.maxMemoryBytes),
}).strict();
export const CoordinationOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), input: CoordinationInput }).strict(),
  z.object({ kind: z.literal('clarification_answer'), questionSnapshot: Clarification,
    relatedProposal: ChangeProposal.nullable(), answerMessageId: Id,
    answer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('selection'), optionId: Id, label: z.string().min(1).max(240) }).strict(),
      z.object({ kind: z.literal('text'), content: Text }).strict(),
    ]),
  }).strict(),
  z.object({ kind: z.literal('proposal_refresh'), proposalId: Id, expectedRevision: Revision,
    forceProposalOnly: z.literal(true) }).strict(),
]);
export const StartCoordinationRequest = z.object({
  protocolVersion: CoordinationVersion, turnId: Id, projectId: Id, inputMessageId: Id,
  assistantMessageId: Id, content: Text, operation: CoordinationOperation,
  mode: CoordinationMode, runMode: Mode, replyTo: CoordinationReplyTo.optional(),
  continuationOfTurnId: Id.optional(), context: CoordinationContextSnapshot, budget: CoordinationBudget,
}).strict().superRefine((request, ctx) => {
  if (request.projectId !== request.context.projectId) ctx.addIssue({ code: 'custom', message: 'Context belongs to another project' });
  if (request.operation.kind === 'proposal_refresh' && request.mode !== 'ask') ctx.addIssue({ code: 'custom', message: 'Proposal refresh is read-only' });
  if (request.operation.kind === 'message') {
    const input = request.operation.input;
    if (input.kind === 'selection' || request.replyTo) ctx.addIssue({ code: 'custom', message: 'Bound answers require the complete clarification_answer operation' });
  } else if (request.operation.kind === 'clarification_answer') {
    const operation = request.operation; const question = operation.questionSnapshot;
    if (!request.replyTo || request.replyTo.clarificationId !== question.id
      || request.replyTo.expectedRevision !== question.revision || request.replyTo.replyToMessageId !== question.questionMessageId
      || question.projectId !== request.projectId || request.continuationOfTurnId !== question.originatingTurnId
      || operation.answerMessageId !== request.inputMessageId) {
      ctx.addIssue({ code: 'custom', message: 'Answer must carry its exact trusted question and continuation binding' });
    }
    if (question.relatedProposalId !== (operation.relatedProposal?.id ?? null)) {
      ctx.addIssue({ code: 'custom', message: 'Related proposal must be available even outside recent history' });
    }
    if (operation.answer.kind === 'selection') {
      const answer = operation.answer;
      const selected = question.options.find((item) => item.id === answer.optionId);
      if (!selected || selected.label !== operation.answer.label) ctx.addIssue({ code: 'custom', message: 'Selection label must come from the bound question option' });
    } else if (!question.allowText) ctx.addIssue({ code: 'custom', message: 'Question does not allow a text answer' });
  } else if (request.replyTo) ctx.addIssue({ code: 'custom', message: 'Proposal refresh cannot masquerade as a clarification answer' });
});

const ResultBase = { contextUsed: ContextUsed, references: z.array(ContextReference), memoryUpdates: z.array(ProjectMemoryUpdate).max(10) };
export const RouterResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consult'), answer: Text, ...ResultBase }).strict(),
  z.object({ kind: z.literal('status'), answer: Text, observations: z.array(RunFact), ...ResultBase }).strict(),
  z.object({ kind: z.literal('change_proposal'), summary: Text, goal: Text, acceptance: z.array(AcceptanceItem).min(1),
    origin: ChangeOrigin, basePolicy: ChangeBasePolicy, evidence: z.array(SourceMessageEvidence).min(1), ...ResultBase }).strict(),
  z.object({ kind: z.literal('clarify'), question: Text, options: z.array(ClarificationOption), allowText: z.boolean(),
    relatedProposalId: Id.nullable(), ...ResultBase }).strict(),
  z.object({ kind: z.literal('control'), action: z.literal('cancel_run'), targetRunId: Id, expectedRevision: Revision,
    sourceMessageIds: z.array(Id).min(1), evidence: z.array(SourceMessageEvidence).min(1), ...ResultBase }).strict(),
]).superRefine((result, ctx) => {
  if (result.kind === 'clarify') {
    if (!result.allowText && result.options.length === 0) ctx.addIssue({ code: 'custom', message: 'Clarification requires an answer path' });
    if (new Set(result.options.map((option) => option.id)).size !== result.options.length) ctx.addIssue({ code: 'custom', message: 'Duplicate clarification option ID' });
  }
});
export const CoordinationUsage = z.object({ modelSteps: Seq, inputTokens: Seq.nullable(), outputTokens: Seq.nullable() }).strict();
export const CoordinationExecutionSnapshot = z.object({
  protocolVersion: CoordinationVersion, id: Id, projectId: Id, revision: Revision,
  status: CoordinationExecutionStatus, lastSourceSeq: Seq, contextUsed: ContextUsed,
  result: RouterResult.nullable(), error: CoordinationFailure.nullable(), usage: CoordinationUsage, updatedAt: Timestamp,
}).strict().superRefine((value, ctx) => {
  if ((value.status === 'completed') !== (value.result !== null)) ctx.addIssue({ code: 'custom', message: 'Only completed coordination execution has a settled result' });
});
export const CoordinationCancelRequest = z.object({ commandId: Id }).strict();
export const CoordinationSourceEventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coordination.accepted'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('coordination.started'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('coordination.progress'), payload: z.object({ messageId: Id, content: Text }).strict() }).strict(),
  z.object({ type: z.literal('coordination.completed'), payload: RouterResult }).strict(),
  z.object({ type: z.literal('coordination.failed'), payload: CoordinationFailure }).strict(),
  z.object({ type: z.literal('coordination.cancelled'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('coordination.interrupted'), payload: CoordinationFailure }).strict(),
]);
export const CoordinationSourceEvent = z.object({
  protocolVersion: CoordinationVersion, projectId: Id, turnId: Id, sourceSeq: z.number().int().positive(),
  occurredAt: Timestamp, event: CoordinationSourceEventBody,
}).strict();
export const CoordinationSourceEventPage = z.object({ items: z.array(CoordinationSourceEvent), nextCursor: Seq, hasMore: z.boolean() }).strict();
export const ConversationEventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.upserted'), payload: ConversationMessage }).strict(),
  z.object({ type: z.literal('turn.updated'), payload: CoordinationTurn }).strict(),
  z.object({ type: z.literal('proposal.updated'), payload: ChangeProposal }).strict(),
  z.object({ type: z.literal('clarification.updated'), payload: Clarification }).strict(),
  z.object({ type: z.literal('control.receipt'), payload: z.object({ turnId: Id, targetRunId: Id,
    receipt: z.enum(['cancellation_requested', 'already_terminal', 'not_applied']), run: Run.nullable() }).strict() }).strict(),
]);
export const ConversationEvent = z.object({
  protocolVersion: CoordinationVersion, projectId: Id, turnId: Id.nullable(), seq: z.number().int().positive(),
  occurredAt: Timestamp, event: ConversationEventBody,
}).strict();
export const ConversationEventPage = z.object({ items: z.array(ConversationEvent), nextCursor: Seq, hasMore: z.boolean() }).strict();
export const CoordinationWorkspace = z.object({
  protocolVersion: CoordinationVersion, execution: WorkspaceSnapshot,
  context: z.object({ contextVersionId: Id.nullable(), contextRevision: Seq, memoryRevision: Seq }).strict(),
  conversationRevision: Seq, messages: z.array(ConversationMessage), olderMessagesCursor: OpaqueCursor.nullable(),
  pendingCoordinationTurns: z.array(CoordinationTurn), latestCoordinationTurn: CoordinationTurn.nullable(),
  clarifications: z.array(Clarification), proposals: z.array(ChangeProposal),
  executionEventCursor: Seq, conversationEventCursor: Seq,
}).strict().refine((value) => value.executionEventCursor === value.execution.eventCursor, 'Execution cursor must match the atomic execution snapshot');

export type ConversationMessageDto = z.infer<typeof ConversationMessage>;
export type SubmitMessageRequestDto = z.infer<typeof SubmitMessageRequest>;
export type CoordinationTurnDto = z.infer<typeof CoordinationTurn>;
export type CoordinationWorkspaceDto = z.infer<typeof CoordinationWorkspace>;
export type CoordinationOutcomeDto = z.infer<typeof CoordinationOutcome>;
export type ChangeProposalDto = z.infer<typeof ChangeProposal>;
export type ClarificationDto = z.infer<typeof Clarification>;
export type ProjectMemoryViewDto = z.infer<typeof ProjectMemoryView>;
export type ProjectDecisionDto = z.infer<typeof ProjectDecision>;
export type StartCoordinationRequestDto = z.infer<typeof StartCoordinationRequest>;
export type RouterResultDto = z.infer<typeof RouterResult>;
export type CoordinationExecutionSnapshotDto = z.infer<typeof CoordinationExecutionSnapshot>;
export type CoordinationSourceEventDto = z.infer<typeof CoordinationSourceEvent>;
export type ConversationEventDto = z.infer<typeof ConversationEvent>;
