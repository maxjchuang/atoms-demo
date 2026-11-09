import { z } from 'zod';

export const PROTOCOL_VERSION = '0.1.0' as const;
export const Id = z.string().regex(/^[a-z][a-z0-9_-]{2,127}$/);
export const Timestamp = z.string().datetime({ offset: true });
export const Seq = z.number().int().nonnegative();
export const Revision = z.number().int().positive();
export const OpaqueCursor = z.string().min(1).max(2048);
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const RelativePath = z.string().min(1).max(512).refine((value) => {
  const parts = value.split('/');
  return !value.startsWith('/') && !/[\\\u0000-\u001f:]/.test(value)
    && parts.every((part) => part !== '' && part !== '.' && part !== '..');
}, 'Expected a normalized relative POSIX path');

export const RunStatus = z.enum([
  'queued', 'running', 'waiting_input', 'cancelling',
  'succeeded', 'failed', 'cancelled', 'interrupted',
]);
export const Phase = z.enum(['planning', 'generating', 'verifying', 'repairing', 'publishing']);
export const ExecutionStatus = z.enum([
  'accepted', 'running', 'waiting_input', 'cancelling',
  'succeeded', 'failed', 'cancelled', 'interrupted',
]);
export const Mode = z.enum(['build', 'plan']);
export const ErrorCode = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_REQUEST',
  'QUOTA_EXCEEDED', 'RATE_LIMITED', 'CONFLICT', 'STALE_REVISION',
  'CURSOR_EXPIRED', 'RUNTIME_UNAVAILABLE', 'BUDGET_EXCEEDED',
  'VERIFICATION_FAILED', 'ARTIFACT_INVALID', 'EXECUTION_INTERRUPTED', 'INTERNAL_ERROR',
]);
export const ApiError = z.object({ error: z.object({
  code: ErrorCode, message: z.string(), retryable: z.boolean(),
  details: z.record(z.unknown()).optional(), requestId: Id,
}).strict() }).strict();

export const Check = z.object({
  id: Id,
  kind: z.enum(['typecheck', 'build', 'smoke', 'behavior']),
  name: z.string(), required: z.boolean(),
  status: z.enum(['passed', 'failed', 'not_run', 'skipped']),
  summary: z.string(), evidenceIds: z.array(Id),
}).strict();
export const AcceptanceItem = z.object({ id: Id, description: z.string() }).strict();
export const Plan = z.object({
  summary: z.string(), tasks: z.array(z.string()).min(1),
  acceptance: z.array(AcceptanceItem).min(1),
}).strict();
export const Attention = z.object({
  id: Id, runId: Id, revision: Revision,
  kind: z.enum(['plan_confirmation', 'question']),
  title: z.string(), description: z.string(),
  options: z.array(z.object({ id: Id, label: z.string() }).strict()),
  allowText: z.boolean(), plan: Plan.optional(), resolution: z.literal('replan').optional(), createdAt: Timestamp,
}).strict();
export const Answer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve_plan') }).strict(),
  z.object({ kind: z.literal('select'), optionId: Id }).strict(),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(10000) }).strict(),
]);
export const AnswerRequest = z.object({
  attentionId: Id, expectedRevision: Revision, answer: Answer,
}).strict();
export const CreateRunRequest = z.object({
  prompt: z.string().min(1).max(20000), mode: Mode,
}).strict();
export const CreateProjectRequest = z.object({ title: z.string().min(1).max(120) }).strict();
export const RedeemCodeRequest = z.object({ code: z.string().min(8).max(128) }).strict();
export const RestoreVersionRequest = z.object({
  versionId: Id, expectedProjectRevision: Revision,
}).strict();
export const Run = z.object({
  id: Id, projectId: Id, revision: Revision,
  status: RunStatus, phase: Phase.nullable(), mode: Mode,
  baseVersionId: Id.nullable(), resultVersionId: Id.nullable(),
  executionId: Id.nullable(), pendingAttention: Attention.nullable(),
  pendingAnswer: z.object({
    attentionId: Id, status: z.enum(['pending', 'accepted']), submittedAt: Timestamp,
  }).strict().nullable(),
  checks: z.array(Check), createdAt: Timestamp, updatedAt: Timestamp,
  error: z.object({ code: ErrorCode, message: z.string() }).strict().nullable(),
}).strict().superRefine((run, ctx) => {
  if ((run.status === 'waiting_input') !== (run.pendingAttention !== null)) {
    ctx.addIssue({ code: 'custom', message: 'waiting_input requires exactly one pendingAttention' });
  }
  if (run.pendingAttention && run.pendingAttention.runId !== run.id) {
    ctx.addIssue({ code: 'custom', message: 'Attention must belong to its run' });
  }
  if (run.pendingAnswer?.status === 'pending'
    && (run.status !== 'waiting_input' || run.pendingAnswer.attentionId !== run.pendingAttention?.id)) {
    ctx.addIssue({ code: 'custom', message: 'Pending answer must reference the current attention' });
  }
  if (run.status === 'succeeded' && !run.resultVersionId) {
    ctx.addIssue({ code: 'custom', message: 'Succeeded run requires a published version' });
  }
});
export const Project = z.object({
  id: Id, title: z.string(), revision: Revision,
  currentVersionId: Id.nullable(), activeRunId: Id.nullable(),
  createdAt: Timestamp, updatedAt: Timestamp,
}).strict();
export const Version = z.object({
  id: Id, projectId: Id, parentVersionId: Id.nullable(),
  restoredFromVersionId: Id.nullable(), runId: Id.nullable(),
  summary: z.string(), checks: z.array(Check),
  previewUrl: z.string().url(), previewExpiresAt: Timestamp, createdAt: Timestamp,
}).strict();
export const Message = z.object({
  id: Id, projectId: Id, runId: Id.nullable(),
  role: z.enum(['user', 'assistant']), status: z.enum(['streaming', 'complete']),
  content: z.string(), createdAt: Timestamp,
}).strict();
export const Session = z.object({
  id: Id, expiresAt: Timestamp,
  quota: z.object({ projectLimit: Seq, runLimit: Seq, projectsUsed: Seq, runsReserved: Seq, runsUsed: Seq }).strict(),
}).strict();
export const WorkspaceSnapshot = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  project: Project, activeRun: Run.nullable(), queuedRuns: z.array(Run),
  latestRun: Run.nullable(),
  currentVersion: Version.nullable(), messages: z.array(Message),
  olderMessagesCursor: OpaqueCursor.nullable(), eventCursor: Seq,
}).strict();

export const ExecutionSnapshot = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), id: Id, runId: Id,
  status: ExecutionStatus, phase: Phase.exclude(['publishing']).nullable(),
  revision: Revision, lastSourceSeq: Seq, pendingAttention: Attention.nullable(),
  artifactId: Id.nullable(), updatedAt: Timestamp,
}).strict().superRefine((execution, ctx) => {
  if ((execution.status === 'waiting_input') !== (execution.pendingAttention !== null)) {
    ctx.addIssue({ code: 'custom', message: 'waiting_input requires exactly one pendingAttention' });
  }
  if (execution.status === 'succeeded' && !execution.artifactId) {
    ctx.addIssue({ code: 'custom', message: 'Succeeded execution requires a candidate artifact' });
  }
});

// Payloads are stable business data. Raw DSH events never cross these interfaces.
export const RuntimeEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('execution.started'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('execution.updated'), payload: ExecutionSnapshot }).strict(),
  z.object({ type: z.literal('phase.changed'), payload: z.object({ phase: Phase.exclude(['publishing']) }).strict() }).strict(),
  z.object({ type: z.literal('message.delta'), payload: z.object({ messageId: Id, delta: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('message.completed'), payload: z.object({ messageId: Id, content: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('file.changed'), payload: z.object({ path: RelativePath, operation: z.enum(['added', 'modified', 'deleted']) }).strict() }).strict(),
  z.object({ type: z.literal('attention.created'), payload: Attention }).strict(),
  z.object({ type: z.literal('attention.resolved'), payload: z.object({ attentionId: Id }).strict() }).strict(),
  z.object({ type: z.literal('check.completed'), payload: Check }).strict(),
  z.object({ type: z.literal('artifact.ready'), payload: z.object({ artifactId: Id, manifestSha256: Sha256 }).strict() }).strict(),
  z.object({ type: z.literal('execution.completed'), payload: z.object({ artifactId: Id }).strict() }).strict(),
  z.object({ type: z.literal('execution.failed'), payload: z.object({ code: ErrorCode, message: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('execution.cancelled'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('execution.interrupted'), payload: z.object({ reason: z.string() }).strict() }).strict(),
]);
export const AgentEvent = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), executionId: Id, runId: Id,
  sourceSeq: z.number().int().positive(), occurredAt: Timestamp, event: RuntimeEvent,
}).strict();
export const BusinessEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.updated'), payload: Run }).strict(),
  z.object({ type: z.literal('version.published'), payload: z.object({ project: Project, version: Version }).strict() }).strict(),
  z.object({ type: z.literal('message.updated'), payload: Message }).strict(),
  z.object({ type: z.literal('activity.recorded'), payload: RuntimeEvent }).strict(),
]);
export const ProjectEvent = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), projectId: Id,
  runId: Id.nullable(), seq: z.number().int().positive(), occurredAt: Timestamp,
  event: BusinessEvent,
}).strict();
export const ProjectEventPage = z.object({
  items: z.array(ProjectEvent), nextCursor: Seq, hasMore: z.boolean(),
}).strict();
export const AgentEventPage = z.object({
  items: z.array(AgentEvent), nextCursor: Seq, hasMore: z.boolean(),
}).strict();

export const Budget = z.object({
  maxWallTimeMs: z.number().int().positive(),
  maxWaitingInputMs: z.number().int().positive(),
  maxRepairRounds: Seq, maxModelSteps: z.number().int().positive(),
  maxInputTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  maxArtifactBytes: z.number().int().positive(),
}).strict();
export const ManifestFile = z.object({
  path: RelativePath, bytes: Seq, sha256: Sha256, mediaType: z.string().min(1),
}).strict();
export const ArtifactManifest = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), id: Id, executionId: Id, runId: Id,
  baseVersionId: Id.nullable(), summary: z.string(),
  files: z.array(ManifestFile).min(1), checks: z.array(Check).min(1),
  evidence: z.array(z.object({
    id: Id, path: RelativePath, kind: z.enum(['log', 'screenshot', 'report']),
  }).strict()),
  createdAt: Timestamp,
}).strict().superRefine((manifest, ctx) => {
  const paths = manifest.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', message: 'Duplicate manifest path' });
  if (!paths.includes('source/package.json') || !paths.includes('dist/index.html')) {
    ctx.addIssue({ code: 'custom', message: 'Artifact requires source/package.json and dist/index.html' });
  }
  for (const kind of ['typecheck', 'build', 'smoke'] as const) {
    if (!manifest.checks.some((check) => check.kind === kind && check.required && check.status === 'passed')) {
      ctx.addIssue({ code: 'custom', message: `Missing passed required ${kind} check` });
    }
  }
  if (manifest.checks.some((check) => check.required && check.status !== 'passed')) {
    ctx.addIssue({ code: 'custom', message: 'Required checks must pass before delivery' });
  }
  const evidenceIds = new Set(manifest.evidence.map((item) => item.id));
  if (evidenceIds.size !== manifest.evidence.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate evidence ID' });
  }
  for (const evidence of manifest.evidence) {
    if (!evidence.path.startsWith('evidence/') || !paths.includes(evidence.path)) {
      ctx.addIssue({ code: 'custom', message: 'Evidence must reference a manifest file under evidence/' });
    }
  }
  for (const check of manifest.checks) {
    if ((check.required && check.evidenceIds.length === 0)
      || check.evidenceIds.some((id) => !evidenceIds.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'Check evidence must resolve to manifest evidence entries' });
    }
  }
});
export const InputSnapshot = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template'), templateId: z.literal('react-vite-v1') }).strict(),
  z.object({ kind: z.literal('version'), versionId: Id, artifactId: Id, manifestSha256: Sha256 }).strict(),
]);
export const StartExecutionRequest = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), executionId: Id, runId: Id, projectId: Id,
  attempt: z.literal(1), prompt: z.string().min(1).max(20000), mode: Mode,
  baseVersionId: Id.nullable(), input: InputSnapshot,
  mandate: z.object({
    scope: z.literal('react_frontend'), allowDependencyChanges: z.literal(false),
    allowPublicDeployment: z.literal(false), allowExternalMessaging: z.literal(false),
    projectMemory: z.string().max(20000),
  }).strict(),
  budget: Budget,
}).strict().superRefine((request, ctx) => {
  const valid = request.input.kind === 'template'
    ? request.baseVersionId === null
    : request.baseVersionId === request.input.versionId;
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Input snapshot must match baseVersionId' });
});
export const AgentInputRequest = AnswerRequest.extend({ commandId: Id }).strict();
export const CancelExecutionRequest = z.object({ commandId: Id }).strict();
export const FileList = z.object({
  versionId: Id, files: z.array(ManifestFile),
}).strict();
export const EvidenceDescriptor = z.object({
  id: Id, kind: z.enum(['log', 'screenshot', 'report']), path: RelativePath,
  mediaType: z.string().min(1), bytes: Seq,
}).strict();
export const RunMutationResponse = z.object({ run: Run }).strict();
export const RestoreVersionResponse = z.object({ project: Project, version: Version }).strict();
export const ProjectList = z.object({ items: z.array(Project), nextCursor: OpaqueCursor.nullable() }).strict();
export const VersionList = z.object({ items: z.array(Version), nextCursor: OpaqueCursor.nullable() }).strict();
export const MessagePage = z.object({ items: z.array(Message), nextCursor: OpaqueCursor.nullable() }).strict();
export const EvidenceList = z.object({ items: z.array(EvidenceDescriptor) }).strict();
export const AgentHealth = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), ready: z.boolean(),
  capabilities: z.object({
    templates: z.array(z.string()), cancel: z.boolean(), attention: z.boolean(), artifacts: z.boolean(),
  }).strict(),
}).strict();

export type RunDto = z.infer<typeof Run>;
export type ProjectDto = z.infer<typeof Project>;
export type VersionDto = z.infer<typeof Version>;
export type WorkspaceSnapshotDto = z.infer<typeof WorkspaceSnapshot>;
export type AgentEventDto = z.infer<typeof AgentEvent>;
export type ProjectEventDto = z.infer<typeof ProjectEvent>;
export type StartExecutionDto = z.infer<typeof StartExecutionRequest>;
export type ExecutionSnapshotDto = z.infer<typeof ExecutionSnapshot>;
export type ArtifactManifestDto = z.infer<typeof ArtifactManifest>;
export type AnswerRequestDto = z.infer<typeof AnswerRequest>;
