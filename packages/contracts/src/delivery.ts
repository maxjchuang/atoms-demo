/** Independent M2 delivery data contracts. No execution/conversation DTO is extended. */
import { z } from 'zod';
import { Budget, Id, InputSnapshot, OpaqueCursor, RelativePath, Revision, Seq, Sha256, StartExecutionRequest,
  ExecutionSnapshot, AgentEventPage, AgentInputRequest, CancelExecutionRequest, Timestamp } from './index.js';
import { CoordinationExecutionSnapshot, CoordinationSourceEventPage, StartCoordinationRequest, CoordinationCancelRequest } from './conversation.js';

export const DeliveryProtocolVersion = '0.1.0' as const;
export const BrowserDslVersion = 'browser-dsl-v1' as const;
export const DeliveryPolicyRevision = 'delivery-auto-v1' as const;
export const ExportPolicyRevision = 'export-frozen-v1' as const;
export const DELIVERY_LIMITS = Object.freeze({ maxCriteria: 50, maxCases: 10, maxSteps: 120,
  maxVariablesPerCase: 10, maxStepTimeoutMs: 5000, maxBrowserTimeMs: 90000,
  maxDiffFiles: 100, diffPageSize: 20, maxDiffTextBytes: 1048576,
  maxDiffSingleFileBytes: 262144, maxDiffLines: 5000, maxDiffTimeMs: 1000 });
const Version = z.literal(DeliveryProtocolVersion);
const Text = z.string().min(1).max(20000);
const Short = z.string().min(1).max(240);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const DigestRef = z.object({ id: Id, hash: Sha256 }).strict();
export const DeliveryFailure = z.object({ code: z.enum(['INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND',
  'CONFLICT', 'STALE_REVISION', 'CURSOR_EXPIRED', 'RATE_LIMITED', 'RUNTIME_UNAVAILABLE', 'BUDGET_EXCEEDED',
  'PLANNING_FAILED', 'PLAN_INVALID', 'BINDING_MISMATCH', 'SOURCE_CHANGED', 'EVIDENCE_INVALID',
  'REQUIRED_BEHAVIOR_FAILED', 'EXPORT_FAILED', 'EXECUTION_INTERRUPTED', 'CANCELLED', 'INTERNAL_ERROR']), message: Text,
  retryable: z.boolean() }).strict();
export const DeliveryApiError = z.object({ error: DeliveryFailure.extend({ requestId: Id, details: z.record(z.unknown()).optional() }).strict() }).strict();
export function canonicalDeliveryJson(value: unknown): string {
  const assertJson = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const entry of item) assertJson(entry); return; }
    if (typeof item === 'object' && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      for (const entry of Object.values(item)) assertJson(entry); return;
    }
    throw new TypeError('Delivery hash input must be normalized JSON, without undefined/non-finite/code values');
  };
  assertJson(value);
  return JSON.stringify(value, (_key, data) => data && typeof data === 'object' && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))) : data);
}
export function deliveryHashBody(value: Record<string, unknown>) { const { hash: _hash, ...body } = value; return canonicalDeliveryJson(body); }

export const RequirementSeedItem = z.object({ id: Id, kind: z.enum(['goal', 'declared_acceptance']), text: Text,
  required: z.boolean().default(true), optionalEvidence: z.array(z.object({ messageId: Id, quote: Short }).strict()).optional(),
}).strict().superRefine((item, ctx) => {
  if (!item.required && !item.optionalEvidence?.length) ctx.addIssue({ code: 'custom', message: 'Optional seed needs trusted explicit source evidence' });
});
export const RequirementSeed = z.object({ protocolVersion: Version, id: Id, hash: Sha256,
  projectId: Id, runId: Id, executionId: Id, revision: Revision, goal: Text,
  items: z.array(RequirementSeedItem).min(1).max(DELIVERY_LIMITS.maxCriteria),
  source: z.object({ admission: z.enum(['auto_explicit_request', 'explicit_proposal_acceptance', 'confirmed_plan', 'direct_request']),
    messageIds: z.array(Id).min(1), turnId: Id.nullable(), proposalId: Id.nullable(), planAttentionId: Id.nullable(),
    admittedAt: Timestamp }).strict(), createdAt: Timestamp,
}).strict().superRefine((seed, ctx) => {
  if (!unique(seed.items.map((item) => item.id))) ctx.addIssue({ code: 'custom', message: 'Duplicate seed item ID' });
  if (!seed.items.some((item) => item.kind === 'goal' && item.text === seed.goal && item.required)) ctx.addIssue({ code: 'custom', message: 'Seed must preserve the full authorized goal as required' });
  if (!unique(seed.source.messageIds) || seed.items.some((item) => item.optionalEvidence?.some((evidence) => !seed.source.messageIds.includes(evidence.messageId)))) ctx.addIssue({ code: 'custom', message: 'Seed evidence must cite unique authorized source messages' });
  if (seed.source.admission === 'explicit_proposal_acceptance' && !seed.source.proposalId) ctx.addIssue({ code: 'custom', message: 'Proposal acceptance requires its real proposal' });
  if (seed.source.admission === 'confirmed_plan' && !seed.source.planAttentionId) ctx.addIssue({ code: 'custom', message: 'Plan confirmation requires its real Attention' });
});
export const AcceptanceCriterion = z.object({ id: Id, description: Text, required: z.boolean().default(true),
  seedItemIds: z.array(Id).min(1) }).strict().refine((criterion) => unique(criterion.seedItemIds), 'Duplicate seed mapping');
export const AcceptanceSpec = z.object({ protocolVersion: Version, id: Id, hash: Sha256, revision: Revision,
  projectId: Id, runId: Id, seed: DigestRef, originalGoal: Text,
  origin: z.enum(['host_profile', 'model_proposed']),
  criteria: z.array(AcceptanceCriterion).min(1).max(DELIVERY_LIMITS.maxCriteria), createdAt: Timestamp,
}).strict().refine((spec) => unique(spec.criteria.map((item) => item.id)), 'Duplicate criterion ID');

export const LocatorSpec = z.discriminatedUnion('by', [
  z.object({ by: z.literal('role'), role: z.enum(['button', 'textbox', 'checkbox', 'heading', 'article', 'link', 'listitem', 'option']),
    name: Short, exact: z.boolean().default(true), nth: z.number().int().min(0).max(99).optional() }).strict(),
  z.object({ by: z.literal('label'), name: Short, exact: z.boolean().default(true), nth: z.number().int().min(0).max(99).optional() }).strict(),
  z.object({ by: z.literal('test_id'), value: Short, nth: z.number().int().min(0).max(99).optional() }).strict(),
]);
const step = { id: Id, timeoutMs: z.number().int().positive().max(DELIVERY_LIMITS.maxStepTimeoutMs).default(5000) };
export const CountExpectation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.number().int().min(0).max(1000) }).strict(),
  z.object({ kind: z.literal('offset'), variable: Id, offset: z.number().int().min(-100).max(100) }).strict(),
]);
export const BrowserStep = z.discriminatedUnion('op', [
  z.object({ ...step, op: z.literal('open_current_app') }).strict(),
  z.object({ ...step, op: z.literal('reload') }).strict(),
  z.object({ ...step, op: z.literal('click'), target: LocatorSpec }).strict(),
  z.object({ ...step, op: z.literal('fill'), target: LocatorSpec, value: z.string().max(2000) }).strict(),
  z.object({ ...step, op: z.literal('check'), target: LocatorSpec, checked: z.boolean() }).strict(),
  z.object({ ...step, op: z.literal('press'), target: LocatorSpec, key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) }).strict(),
  z.object({ ...step, op: z.literal('save_count'), target: LocatorSpec, variable: Id }).strict(),
  z.object({ ...step, op: z.literal('save_box'), target: LocatorSpec, relativeTo: LocatorSpec.optional(), variable: Id }).strict(),
  z.object({ ...step, op: z.literal('drag_by'), target: LocatorSpec, dx: z.number().min(-512).max(512), dy: z.number().min(-512).max(512) }).strict(),
  z.object({ ...step, op: z.literal('expect_visible'), target: LocatorSpec, visible: z.boolean() }).strict(),
  z.object({ ...step, op: z.literal('expect_text'), target: LocatorSpec, comparison: z.enum(['exact', 'contains']), value: z.string().max(2000) }).strict(),
  z.object({ ...step, op: z.literal('expect_value'), target: LocatorSpec, comparison: z.enum(['exact', 'contains']), value: z.string().max(2000) }).strict(),
  z.object({ ...step, op: z.literal('expect_count'), target: LocatorSpec, expected: CountExpectation }).strict(),
  z.object({ ...step, op: z.literal('expect_box_moved'), target: LocatorSpec, baseline: Id, dx: z.number().min(-512).max(512), dy: z.number().min(-512).max(512), tolerancePx: z.number().min(0).max(20) }).strict(),
  z.object({ ...step, op: z.literal('expect_box_same'), target: LocatorSpec, baseline: Id, tolerancePx: z.number().min(0).max(20) }).strict(),
]);
export const BrowserCase = z.object({ id: Id, name: Short, criterionIds: z.array(Id).min(1),
  steps: z.array(BrowserStep).min(1).max(DELIVERY_LIMITS.maxSteps) }).strict().refine((entry) => unique(entry.criterionIds), 'Duplicate criterion mapping');
export const CriterionCoverage = z.object({ criterionId: Id, method: z.enum(['automated', 'manual', 'unsupported']),
  caseIds: z.array(Id), reason: Text.nullable() }).strict().superRefine((coverage, ctx) => {
  if (!unique(coverage.caseIds)) ctx.addIssue({ code: 'custom', message: 'Duplicate mapped case ID' });
  if (coverage.method === 'automated' ? coverage.caseIds.length === 0 : coverage.caseIds.length !== 0 || !coverage.reason) {
    ctx.addIssue({ code: 'custom', message: 'Automated coverage needs cases; manual/unsupported need a reason and no invented case' });
  }
});
export const BrowserTestPlan = z.object({ protocolVersion: Version, dslVersion: z.literal(BrowserDslVersion),
  id: Id, hash: Sha256, revision: Revision, spec: DigestRef,
  cases: z.array(BrowserCase).max(DELIVERY_LIMITS.maxCases), coverage: z.array(CriterionCoverage).min(1).max(DELIVERY_LIMITS.maxCriteria),
  browserBudgetMs: z.number().int().positive().max(DELIVERY_LIMITS.maxBrowserTimeMs), createdAt: Timestamp,
}).strict().superRefine((plan, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!unique(plan.cases.map((item) => item.id)) || !unique(plan.coverage.map((item) => item.criterionId))) issue('Duplicate case/coverage ID');
  if (plan.cases.reduce((sum, item) => sum + item.steps.length, 0) > DELIVERY_LIMITS.maxSteps) issue('Browser total step budget exceeded');
  const caseIds = new Set(plan.cases.map((item) => item.id));
  for (const coverage of plan.coverage) for (const id of coverage.caseIds) {
    if (!caseIds.has(id) || !plan.cases.find((item) => item.id === id)?.criterionIds.includes(coverage.criterionId)) issue('Coverage refers to an absent or unrelated case');
  }
  for (const item of plan.cases) {
    if (!unique(item.steps.map((entry) => entry.id))) issue('Duplicate step ID');
    for (const criterionId of item.criterionIds) if (!plan.coverage.some((entry) => entry.criterionId === criterionId && entry.caseIds.includes(item.id))) issue('Case does not map back to frozen automated coverage');
    const variables = new Map<string, 'count' | 'box'>();
    for (const entry of item.steps) {
      if (entry.op === 'save_count' || entry.op === 'save_box') {
        if (variables.has(entry.variable)) issue('Variable cannot be redefined');
        variables.set(entry.variable, entry.op === 'save_count' ? 'count' : 'box');
      }
      if (entry.op === 'expect_count' && entry.expected.kind === 'offset' && variables.get(entry.expected.variable) !== 'count') issue('Count variable must be defined earlier in this case');
      if ((entry.op === 'expect_box_same' || entry.op === 'expect_box_moved') && variables.get(entry.baseline) !== 'box') issue('Box variable must be defined earlier in this case');
    }
    if (variables.size > DELIVERY_LIMITS.maxVariablesPerCase) issue('Case variable budget exceeded');
  }
});

export const ToolchainDescriptor = z.object({ id: Id, templateId: Id, templateHash: Sha256,
  packageJsonHash: Sha256, scriptsHash: Sha256, lockfileHash: Sha256,
  nodeVersion: Short, pnpmVersion: Short, os: Short, arch: Short,
  registry: z.literal('https://registry.npmjs.org'), lifecycleScripts: z.literal('disabled') }).strict();
export const BudgetUsage = z.object({ activeMs: Seq, modelSteps: Seq, inputTokens: Seq.nullable(), outputTokens: Seq.nullable() }).strict();
export const KnownBudgetUsage = z.object({ activeMs: Seq, modelSteps: Seq, inputTokens: Seq, outputTokens: Seq }).strict();
export const PlanningBudget = z.object({ maxModelSteps: z.number().int().positive().max(3),
  maxWallTimeMs: z.number().int().positive().max(60000), maxInputTokens: z.number().int().positive().max(32768),
  maxOutputTokens: z.number().int().positive().max(8192), maxStructuredRetries: z.number().int().min(0).max(1) }).strict();
export const PrepareDeliveryPlanRequest = z.object({ protocolVersion: Version, preparationId: Id, projectId: Id,
  runId: Id, executionId: Id, seed: RequirementSeed, baseVersionId: Id.nullable(), input: InputSnapshot,
  planningMode: z.enum(['host_profile', 'model_proposed']), profileHint: DigestRef.nullable(),
  toolchain: ToolchainDescriptor, totalBudget: Budget, planningBudget: PlanningBudget,
}).strict().superRefine((request, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (request.seed.projectId !== request.projectId || request.seed.runId !== request.runId || request.seed.executionId !== request.executionId) issue('Seed must belong to preparation subject');
  if ((request.input.kind === 'template' && request.baseVersionId !== null)
    || (request.input.kind === 'version' && request.input.versionId !== request.baseVersionId)) issue('Prepare input baseline mismatch');
  if (request.planningMode === 'host_profile' && !request.profileHint) issue('Host profile must be an explicit trusted hint');
  for (const key of ['maxModelSteps', 'maxWallTimeMs', 'maxInputTokens', 'maxOutputTokens'] as const) if (request.planningBudget[key] > request.totalBudget[key]) issue('Planning share cannot exceed total Run budget');
});
export const ProposedDeliveryPlan = z.object({ protocolVersion: Version, preparationId: Id, seed: DigestRef,
  spec: AcceptanceSpec, plan: BrowserTestPlan, usage: KnownBudgetUsage,
}).strict().superRefine((proposal, ctx) => {
  if (proposal.spec.seed.id !== proposal.seed.id || proposal.spec.seed.hash !== proposal.seed.hash
    || proposal.plan.spec.id !== proposal.spec.id || proposal.plan.spec.hash !== proposal.spec.hash) ctx.addIssue({ code: 'custom', message: 'Proposed spec/plan must reference the exact preceding objects' });
});
export const PlanPreparationSnapshot = z.object({ protocolVersion: Version, id: Id, projectId: Id, runId: Id, executionId: Id,
  planningMode: z.enum(['host_profile', 'model_proposed']),
  revision: Revision, requestHash: Sha256, status: z.enum(['accepted', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  lastSourceSeq: Seq, usage: BudgetUsage, result: ProposedDeliveryPlan.nullable(), error: DeliveryFailure.nullable(), updatedAt: Timestamp,
}).strict().superRefine((snapshot, ctx) => {
  if ((snapshot.status === 'completed') !== (snapshot.result !== null)) ctx.addIssue({ code: 'custom', message: 'Only completed preparation has a settled proposal' });
  if (snapshot.result && (snapshot.result.preparationId !== snapshot.id || snapshot.result.usage.activeMs !== snapshot.usage.activeMs
    || snapshot.result.usage.modelSteps !== snapshot.usage.modelSteps || snapshot.result.usage.inputTokens !== snapshot.usage.inputTokens
    || snapshot.result.usage.outputTokens !== snapshot.usage.outputTokens)) ctx.addIssue({ code: 'custom', message: 'Settled planning usage must be exact, not reset between stages' });
  if (snapshot.result && (snapshot.result.spec.projectId !== snapshot.projectId || snapshot.result.spec.runId !== snapshot.runId
    || snapshot.result.spec.origin !== snapshot.planningMode)) ctx.addIssue({ code: 'custom', message: 'Preparation result subject or provenance mismatch' });
  if (snapshot.planningMode === 'host_profile' && (snapshot.usage.modelSteps !== 0 || (snapshot.usage.inputTokens ?? 0) !== 0 || (snapshot.usage.outputTokens ?? 0) !== 0)) ctx.addIssue({ code: 'custom', message: 'Host profile cannot disguise billable planning' });
});
export const FrozenDeliveryBinding = z.object({ protocolVersion: Version, id: Id, hash: Sha256, projectId: Id, runId: Id,
  executionId: Id, preparationId: Id, seed: DigestRef, spec: DigestRef, plan: DigestRef, baseVersionId: Id.nullable(),
  input: InputSnapshot, planningMode: z.enum(['host_profile', 'model_proposed']),
  toolchain: ToolchainDescriptor, policyRevision: z.literal(DeliveryPolicyRevision), exportPolicyRevision: z.literal(ExportPolicyRevision),
  totalBudget: Budget, planningUsage: KnownBudgetUsage, frozenAt: Timestamp }).strict().superRefine((binding, ctx) => {
  for (const [budgetKey, usageKey] of [['maxWallTimeMs', 'activeMs'], ['maxModelSteps', 'modelSteps'], ['maxInputTokens', 'inputTokens'], ['maxOutputTokens', 'outputTokens']] as const) {
    if (binding.planningUsage[usageKey] >= binding.totalBudget[budgetKey]) ctx.addIssue({ code: 'custom', message: 'Exhausted planning budget cannot be frozen for dispatch' });
  }
  if (binding.planningMode === 'host_profile' && (binding.planningUsage.modelSteps || binding.planningUsage.inputTokens || binding.planningUsage.outputTokens)) ctx.addIssue({ code: 'custom', message: 'Host planning cannot hide billable inference' });
  if (binding.input.kind === 'template' ? binding.baseVersionId !== null : binding.input.versionId !== binding.baseVersionId) ctx.addIssue({ code: 'custom', message: 'Frozen input must match baseline' });
});
export const FrozenDeliveryBundle = z.object({ seed: RequirementSeed, spec: AcceptanceSpec, plan: BrowserTestPlan, binding: FrozenDeliveryBinding }).strict().superRefine((bundle, ctx) => {
  const { seed, spec, plan, binding } = bundle; const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (spec.originalGoal !== seed.goal || spec.seed.id !== seed.id || spec.seed.hash !== seed.hash
    || binding.seed.id !== seed.id || binding.seed.hash !== seed.hash || binding.spec.id !== spec.id || binding.spec.hash !== spec.hash
    || binding.plan.id !== plan.id || binding.plan.hash !== plan.hash || plan.spec.id !== spec.id || plan.spec.hash !== spec.hash) issue('Frozen references or full goal mismatch');
  if (spec.projectId !== seed.projectId || spec.runId !== seed.runId || binding.projectId !== seed.projectId
    || binding.runId !== seed.runId || binding.executionId !== seed.executionId) issue('Frozen subject mismatch');
  if (spec.origin !== binding.planningMode) issue('Spec provenance must match actual planning mode');
  for (const item of seed.items) {
    const preserved = spec.criteria.find((criterion) => criterion.id === item.id);
    if (!preserved || preserved.description !== item.text || preserved.required !== item.required || !preserved.seedItemIds.includes(item.id)) issue('Every seed item must remain verbatim with required unchanged');
  }
  for (const criterion of spec.criteria) {
    for (const id of criterion.seedItemIds) {
      const item = seed.items.find((entry) => entry.id === id);
      if (!item || (item.required && !criterion.required)) issue('Derived criterion cannot invent a seed or lower required');
    }
    if (!plan.coverage.some((entry) => entry.criterionId === criterion.id)) issue('Missing criterion coverage');
  }
  if (plan.coverage.some((entry) => !spec.criteria.some((criterion) => criterion.id === entry.criterionId))) issue('Coverage cannot invent a criterion');
});
export const DeliveryExecutionRequest = z.object({ protocolVersion: Version, execution: StartExecutionRequest,
  bundle: FrozenDeliveryBundle }).strict().superRefine((request, ctx) => {
  const { execution, bundle: { binding } } = request; const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (execution.executionId !== binding.executionId || execution.runId !== binding.runId || execution.projectId !== binding.projectId
    || execution.baseVersionId !== binding.baseVersionId || canonicalDeliveryJson(execution.input) !== canonicalDeliveryJson(binding.input)) issue('Wrapper cannot change the frozen subject, exact input artifact or baseline');
  for (const [budgetKey, usageKey] of [['maxWallTimeMs', 'activeMs'], ['maxModelSteps', 'modelSteps'], ['maxInputTokens', 'inputTokens'], ['maxOutputTokens', 'outputTokens']] as const) {
    if (execution.budget[budgetKey] !== binding.totalBudget[budgetKey] - binding.planningUsage[usageKey]) issue('Worker budget must be total minus the exact planning usage');
  }
  for (const key of ['maxWaitingInputMs', 'maxRepairRounds', 'maxArtifactBytes'] as const) if (execution.budget[key] !== binding.totalBudget[key]) issue('Phase transition cannot expand other Run limits');
});
/** API-local freeze validation, never a model-authored authority message. */
export const FreezeDeliveryPlanRequest = z.object({ preparationRequest: PrepareDeliveryPlanRequest,
  preparation: PlanPreparationSnapshot, bundle: FrozenDeliveryBundle }).strict().superRefine((input, ctx) => {
  const { preparationRequest: request, preparation, bundle } = input; const { binding } = bundle;
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (preparation.status !== 'completed' || !preparation.result) { issue('Only an actually completed read-only plan may freeze'); return; }
  if (preparation.id !== request.preparationId || binding.preparationId !== request.preparationId
    || preparation.projectId !== request.projectId || preparation.runId !== request.runId || preparation.executionId !== request.executionId) issue('Freeze cannot select another preparation or subject');
  if (canonicalDeliveryJson(bundle.seed) !== canonicalDeliveryJson(request.seed)
    || canonicalDeliveryJson(bundle.spec) !== canonicalDeliveryJson(preparation.result.spec)
    || canonicalDeliveryJson(bundle.plan) !== canonicalDeliveryJson(preparation.result.plan)) issue('Freeze cannot replace the authorized seed or completed proposal');
  if (binding.baseVersionId !== request.baseVersionId || canonicalDeliveryJson(binding.input) !== canonicalDeliveryJson(request.input)
    || canonicalDeliveryJson(binding.toolchain) !== canonicalDeliveryJson(request.toolchain)
    || canonicalDeliveryJson(binding.totalBudget) !== canonicalDeliveryJson(request.totalBudget)
    || canonicalDeliveryJson(binding.planningUsage) !== canonicalDeliveryJson(preparation.result.usage)
    || binding.planningMode !== request.planningMode) issue('Freeze must preserve baseline, trusted policy and measured spending');
  for (const [budgetKey, usageKey] of [['maxWallTimeMs', 'activeMs'], ['maxModelSteps', 'modelSteps'], ['maxInputTokens', 'inputTokens'], ['maxOutputTokens', 'outputTokens']] as const) {
    if (binding.planningUsage[usageKey] > request.planningBudget[budgetKey]) issue('Preparation exceeded its bounded planning share');
  }
});
export const DeliveryCommand = z.object({ commandId: Id }).strict();
export const DeliveryAnswer = AgentInputRequest;
export const DeliveryCancel = CancelExecutionRequest;

export const FileFingerprint = z.object({ path: RelativePath, bytes: Seq, sha256: Sha256, mediaType: Short }).strict();
const GateResult = z.object({ status: z.enum(['passed', 'failed', 'not_run']), evidenceIds: z.array(Id), reason: Text.nullable() }).strict()
  .superRefine((gate, ctx) => {
    if (gate.status === 'not_run' && !gate.reason) ctx.addIssue({ code: 'custom', message: 'Not-run gate needs an explicit reason' });
    if (gate.status !== 'not_run' && !gate.evidenceIds.length) ctx.addIssue({ code: 'custom', message: 'Executed gate requires evidence' });
  });
export const CaseResult = z.object({ caseId: Id, criterionIds: z.array(Id).min(1), status: z.enum(['passed', 'failed', 'not_run']),
  steps: z.array(z.object({ stepId: Id, status: z.enum(['passed', 'failed', 'not_run']) }).strict()),
  failure: z.object({ stepId: Id, message: Text, expected: z.string().max(2000).nullable(), actual: z.string().max(2000).nullable() }).strict().nullable(),
  reason: Text.nullable(), evidenceIds: z.array(Id),
}).strict().superRefine((result, ctx) => {
  if (result.status === 'passed' && (result.steps.length === 0 || result.steps.some((step) => step.status !== 'passed') || result.failure)) ctx.addIssue({ code: 'custom', message: 'Passed case needs actual passing steps only' });
  if (result.status === 'failed' && (!result.failure || !result.steps.some((step) => step.stepId === result.failure?.stepId && step.status === 'failed'))) ctx.addIssue({ code: 'custom', message: 'Failed case needs an actual failed step' });
  if (result.status === 'not_run' && (!result.reason || result.steps.some((step) => step.status !== 'not_run') || result.failure)) ctx.addIssue({ code: 'custom', message: 'Not-run cannot conceal failed steps' });
  if (result.status !== 'not_run' && !result.evidenceIds.length) ctx.addIssue({ code: 'custom', message: 'Executed case needs actual evidence' });
});
export const AttemptSourceProvenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('model_output'), adapterMode: z.enum(['dsh', 'fake']) }).strict(),
  z.object({ kind: z.literal('controlled_regression'), baseSourceHash: Sha256, patchHash: Sha256,
    injectedSourceHash: Sha256, patchEvidenceId: Id }).strict(),
  z.object({ kind: z.literal('synthetic_fixture') }).strict(),
]);
export const VerificationAttempt = z.object({ id: Id, hash: Sha256, runId: Id, executionId: Id,
  bindingHash: Sha256, specHash: Sha256, planHash: Sha256, repairRound: Seq, previousAttemptId: Id.nullable(),
  sourceBeforeHash: Sha256, sourceAfterHash: Sha256.nullable(), distHash: Sha256.nullable(), lockfileHash: Sha256, toolchainId: Id,
  status: z.enum(['passed', 'failed', 'incomplete', 'invalid', 'cancelled', 'interrupted']),
  sourceProvenance: AttemptSourceProvenance.optional(),
  checks: z.object({ typecheck: GateResult, build: GateResult, smoke: GateResult }).strict(),
  caseResults: z.array(CaseResult).max(DELIVERY_LIMITS.maxCases), startedAt: Timestamp, finishedAt: Timestamp,
}).strict().superRefine((attempt, ctx) => {
  if (attempt.sourceProvenance?.kind === 'controlled_regression'
    && attempt.sourceProvenance.injectedSourceHash !== attempt.sourceBeforeHash) ctx.addIssue({ code: 'custom', message: 'Controlled injected source must be the actually verified source' });
});
export const VerificationEvidenceBinding = z.object({ id: Id, path: RelativePath, sha256: Sha256, bytes: Seq,
  kind: z.enum(['log', 'screenshot', 'report', 'trace']), mediaType: z.enum(['text/plain', 'image/png', 'image/jpeg', 'application/json', 'application/zip']),
  scope: z.enum(['planning', 'verification', 'clean_export']), attemptId: Id.nullable(), sourceSnapshotHash: Sha256.nullable(),
  specHash: Sha256.nullable(), planHash: Sha256.nullable(),
}).strict().superRefine((evidence, ctx) => {
  if (!evidence.path.startsWith('evidence/')) ctx.addIssue({ code: 'custom', message: 'Evidence path must be inside its controlled manifest root' });
  if (evidence.scope === 'verification' && (!evidence.attemptId || !evidence.sourceSnapshotHash || !evidence.specHash || !evidence.planHash)) ctx.addIssue({ code: 'custom', message: 'Verification evidence needs complete attempt provenance' });
  if (evidence.kind === 'screenshot' && !['image/png', 'image/jpeg'].includes(evidence.mediaType)) ctx.addIssue({ code: 'custom', message: 'Screenshots cannot contain executable image markup' });
  if (evidence.kind === 'trace' && evidence.mediaType !== 'application/zip') ctx.addIssue({ code: 'custom', message: 'Trace is a download, not executable HTML' });
});
export const SourceExportManifest = z.object({ protocolVersion: Version, id: Id, hash: Sha256, projectId: Id, runId: Id, executionId: Id,
  bindingHash: Sha256, sourceSnapshotHash: Sha256, templateId: Id, templateHash: Sha256,
  packageJsonHash: Sha256, scriptsHash: Sha256, lockfileHash: Sha256, toolchainId: Id,
  files: z.array(FileFingerprint).min(1).max(1000), contentsManifestHash: Sha256,
  archive: z.object({ id: Id, sha256: Sha256, bytes: Seq }).strict(), createdAt: Timestamp,
}).strict().superRefine((manifest, ctx) => {
  if (!unique(manifest.files.map((file) => file.path))) ctx.addIssue({ code: 'custom', message: 'Duplicate export file' });
  const paths = manifest.files.map((file) => file.path);
  if (!paths.includes('source/package.json') || !paths.includes('source/pnpm-lock.yaml') || !paths.includes('source/README.md')) ctx.addIssue({ code: 'custom', message: 'Trusted export requires its own package, lockfile and instructions' });
  if (paths.some((path) => !path.startsWith('source/') || path.split('/').some((segment) => ['.env', '.git', '.dsh', 'node_modules'].includes(segment)))) ctx.addIssue({ code: 'custom', message: 'Export contains a forbidden source path' });
  if (manifest.files.find((file) => file.path === 'source/package.json')?.sha256 !== manifest.packageJsonHash
    || manifest.files.find((file) => file.path === 'source/pnpm-lock.yaml')?.sha256 !== manifest.lockfileHash) ctx.addIssue({ code: 'custom', message: 'Export package/lock fingerprint mismatch' });
});
export const CleanBuildReport = z.object({ protocolVersion: Version, id: Id, hash: Sha256, runId: Id, executionId: Id,
  bindingHash: Sha256, exportManifestHash: Sha256, archiveHash: Sha256, sourceBeforeHash: Sha256, sourceAfterHash: Sha256.nullable(),
  distHash: Sha256.nullable(), lockfileHash: Sha256, toolchainId: Id,
  verifiedPlatform: z.object({ nodeVersion: Short, pnpmVersion: Short, os: Short, arch: Short }).strict(),
  registry: z.literal('https://registry.npmjs.org'), frozenLockfile: z.literal(true), lifecycleScripts: z.literal('disabled'),
  usedPlatformSymlinks: z.literal(false),
  stages: z.object({ install: GateResult, typecheck: GateResult, build: GateResult, smoke: GateResult }).strict(),
  caseResults: z.array(CaseResult).max(DELIVERY_LIMITS.maxCases), startedAt: Timestamp, finishedAt: Timestamp,
}).strict();
export const DeliveryQuality = z.enum(['pending', 'complete', 'partial', 'blocked']);
export const CriterionGap = z.object({ criterionId: Id, description: Text, required: z.boolean(),
  coverage: z.enum(['automated', 'manual', 'unsupported']), result: z.enum(['failed', 'not_run']), reason: Text }).strict();
const DeliveryReportData = z.object({ protocolVersion: Version, id: Id, hash: Sha256, revision: Revision, final: z.boolean(),
  projectId: Id, runId: Id, executionId: Id, preparationId: Id,
  lifecycle: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  seed: RequirementSeed, bundle: FrozenDeliveryBundle.nullable(), attempts: z.array(VerificationAttempt), finalAttemptId: Id.nullable(),
  exportManifest: SourceExportManifest.nullable(), cleanBuild: CleanBuildReport.nullable(),
  evidence: z.array(VerificationEvidenceBinding), quality: DeliveryQuality, gaps: z.array(CriterionGap),
  failure: DeliveryFailure.nullable(), policyRevision: z.literal(DeliveryPolicyRevision), updatedAt: Timestamp,
}).strict();
export type DeliveryReportDataDto = z.infer<typeof DeliveryReportData>;
const gatesPass = (checks: Record<string, { status: string }>) => Object.values(checks).every((item) => item.status === 'passed');
function caseSetMatches(plan: z.infer<typeof BrowserTestPlan>, results: z.infer<typeof CaseResult>[]) {
  return results.length === plan.cases.length && unique(results.map((entry) => entry.caseId)) && results.every((result) => {
    const expected = plan.cases.find((entry) => entry.id === result.caseId);
    return expected && canonicalDeliveryJson(expected.criterionIds) === canonicalDeliveryJson(result.criterionIds)
      && canonicalDeliveryJson(expected.steps.map((entry) => entry.id)) === canonicalDeliveryJson(result.steps.map((entry) => entry.stepId));
  });
}
function validBehaviorAttempt(report: DeliveryReportDataDto, attempt: z.infer<typeof VerificationAttempt>) {
  if (!report.bundle) return false;
  const { binding, spec, plan } = report.bundle;
  return ['passed', 'failed', 'incomplete'].includes(attempt.status) && attempt.sourceBeforeHash === attempt.sourceAfterHash
    && attempt.distHash !== null && gatesPass(attempt.checks) && attempt.bindingHash === binding.hash
    && attempt.specHash === spec.hash && attempt.planHash === plan.hash
    && attempt.lockfileHash === binding.toolchain.lockfileHash && attempt.toolchainId === binding.toolchain.id && caseSetMatches(plan, attempt.caseResults);
}

/** Pure fixed policy only. API must FIRST verify real files, authority and evidence. */
export function deriveDeliveryQuality(report: DeliveryReportDataDto): z.infer<typeof DeliveryQuality> {
  if (!report.final) return 'pending';
  if (report.lifecycle !== 'completed' || report.failure || !report.bundle || !report.exportManifest || !report.cleanBuild) return 'blocked';
  const { binding, spec, plan } = report.bundle;
  const last = report.attempts.at(-1); const clean = report.cleanBuild; const exported = report.exportManifest;
  if (!last || report.finalAttemptId !== last.id || last.sourceBeforeHash !== last.sourceAfterHash || !last.distHash
    || !gatesPass(last.checks) || ['invalid', 'cancelled', 'interrupted'].includes(last.status) || !caseSetMatches(plan, last.caseResults)) return 'blocked';
  if (report.attempts.some((attempt) => attempt.bindingHash !== binding.hash || attempt.specHash !== spec.hash || attempt.planHash !== plan.hash
    || attempt.lockfileHash !== binding.toolchain.lockfileHash || attempt.toolchainId !== binding.toolchain.id)) return 'blocked';
  if (exported.bindingHash !== binding.hash || exported.sourceSnapshotHash !== last.sourceBeforeHash || exported.toolchainId !== binding.toolchain.id || exported.templateId !== binding.toolchain.templateId
    || exported.lockfileHash !== binding.toolchain.lockfileHash || exported.templateHash !== binding.toolchain.templateHash
    || exported.packageJsonHash !== binding.toolchain.packageJsonHash || exported.scriptsHash !== binding.toolchain.scriptsHash) return 'blocked';
  if (!gatesPass(clean.stages) || clean.bindingHash !== binding.hash || clean.exportManifestHash !== exported.hash
    || clean.archiveHash !== exported.archive.sha256 || clean.sourceBeforeHash !== last.sourceBeforeHash
    || clean.sourceBeforeHash !== clean.sourceAfterHash || clean.lockfileHash !== exported.lockfileHash || clean.toolchainId !== exported.toolchainId || !clean.distHash
    || !caseSetMatches(plan, clean.caseResults)) return 'blocked';
  let partial = false;
  for (const criterion of spec.criteria) {
    const coverage = plan.coverage.find((entry) => entry.criterionId === criterion.id);
    if (!coverage) return 'blocked';
    if (coverage.method !== 'automated') { partial = true; continue; }
    for (const caseId of coverage.caseIds) {
      const latest = last.caseResults.find((entry) => entry.caseId === caseId);
      const cleanCase = clean.caseResults.find((entry) => entry.caseId === caseId);
      const lastDecisive = [...report.attempts].reverse().filter((attempt) => validBehaviorAttempt(report, attempt))
        .flatMap((attempt) => attempt.caseResults.filter((entry) => entry.caseId === caseId && entry.status !== 'not_run'))[0];
      if (criterion.required && (latest?.status === 'failed' || cleanCase?.status === 'failed'
        || (lastDecisive?.status === 'failed' && latest?.status !== 'passed'))) return 'blocked';
      if (latest?.status !== 'passed' || cleanCase?.status !== 'passed') partial = true;
    }
  }
  return partial ? 'partial' : 'complete';
}
export function deriveCriterionGaps(report: DeliveryReportDataDto): z.infer<typeof CriterionGap>[] {
  if (!report.bundle) return [];
  const { spec, plan } = report.bundle; const last = report.attempts.at(-1);
  return spec.criteria.flatMap((criterion): z.infer<typeof CriterionGap>[] => {
    const coverage = plan.coverage.find((entry) => entry.criterionId === criterion.id)
      ?? { method: 'unsupported' as const, caseIds: [], reason: 'Frozen criterion coverage is invalid.' };
    const base = { criterionId: criterion.id, description: criterion.description, required: criterion.required, coverage: coverage.method };
    if (coverage.method !== 'automated') return [{ ...base, result: 'not_run' as const, reason: coverage.reason! }];
    let missing = false; let failed = false;
    for (const id of coverage.caseIds) {
      const actual = last && validBehaviorAttempt(report, last) ? last.caseResults.find((entry) => entry.caseId === id) : undefined;
      const clean = report.cleanBuild?.caseResults.find((entry) => entry.caseId === id);
      const decisive = [...report.attempts].reverse().filter((attempt) => validBehaviorAttempt(report, attempt))
        .flatMap((attempt) => attempt.caseResults.filter((entry) => entry.caseId === id && entry.status !== 'not_run'))[0];
      if (actual?.status === 'failed' || clean?.status === 'failed' || (criterion.required && decisive?.status === 'failed' && actual?.status !== 'passed')) failed = true;
      if (actual?.status !== 'passed' || clean?.status !== 'passed') missing = true;
    }
    return failed ? [{ ...base, result: 'failed' as const, reason: 'Frozen automatic verification has an unresolved failure.' }]
      : missing ? [{ ...base, result: 'not_run' as const, reason: 'This criterion lacks a current passing application and clean-export result.' }] : [];
  });
}
export const DeliveryReport = DeliveryReportData.superRefine((report, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ((report.lifecycle === 'running') === report.final) issue('Final report and actual lifecycle must agree');
  if (report.seed.projectId !== report.projectId || report.seed.runId !== report.runId || report.seed.executionId !== report.executionId) issue('Report subject must match seed');
  if (report.bundle && (report.bundle.binding.runId !== report.runId || report.bundle.binding.executionId !== report.executionId
    || report.bundle.binding.preparationId !== report.preparationId || report.bundle.seed.hash !== report.seed.hash)) issue('Report frozen subject mismatch');
  if (!report.bundle && (report.attempts.length || report.finalAttemptId || report.exportManifest || report.cleanBuild)) issue('Pre-freeze failure cannot invent execution objects');
  if (report.exportManifest && (report.exportManifest.projectId !== report.projectId || report.exportManifest.runId !== report.runId
    || report.exportManifest.executionId !== report.executionId)) issue('Export manifest belongs to a foreign report subject');
  if (report.attempts.length && report.finalAttemptId !== report.attempts.at(-1)?.id) issue('Cannot select an old passing attempt');
  if (!unique(report.attempts.map((entry) => entry.id)) || !unique(report.evidence.map((entry) => entry.id))) issue('Duplicate attempt/evidence ID');
  const evidence = new Map(report.evidence.map((entry) => [entry.id, entry]));
  for (let index = 0; index < report.attempts.length; index++) {
    const attempt = report.attempts[index];
    if (attempt.runId !== report.runId || attempt.executionId !== report.executionId || attempt.repairRound !== index
      || attempt.previousAttemptId !== (report.attempts[index - 1]?.id ?? null)) issue('Attempt chain or subject mismatch');
    if (report.bundle) {
      const cases = report.bundle.plan.cases;
      if (!unique(attempt.caseResults.map((entry) => entry.caseId)) || attempt.caseResults.length !== cases.length) issue('Every planned case needs exactly one result');
      for (const result of attempt.caseResults) {
        const planned = cases.find((entry) => entry.id === result.caseId);
        if (!planned || canonicalDeliveryJson(result.criterionIds) !== canonicalDeliveryJson(planned.criterionIds)
          || canonicalDeliveryJson(result.steps.map((entry) => entry.stepId)) !== canonicalDeliveryJson(planned.steps.map((entry) => entry.id))) issue('Case cannot change frozen criterion or step references');
      }
    }
    const ids = [...Object.values(attempt.checks).flatMap((entry) => entry.evidenceIds), ...attempt.caseResults.flatMap((entry) => entry.evidenceIds)];
    if (attempt.sourceProvenance?.kind === 'controlled_regression') {
      const patch = evidence.get(attempt.sourceProvenance.patchEvidenceId);
      if (!patch || patch.sha256 !== attempt.sourceProvenance.patchHash || patch.attemptId !== attempt.id
        || patch.sourceSnapshotHash !== attempt.sourceBeforeHash) issue('Controlled regression requires matching host patch evidence');
    }
    for (const id of ids) {
      const item = evidence.get(id);
      if (!item || item.attemptId !== attempt.id || item.sourceSnapshotHash !== attempt.sourceBeforeHash
        || item.specHash !== attempt.specHash || item.planHash !== attempt.planHash) issue('Evidence must bind to the actual attempt/source/plan');
    }
  }
  if (report.cleanBuild && report.bundle) {
    const clean = report.cleanBuild; const { plan, spec } = report.bundle;
    if (clean.runId !== report.runId || clean.executionId !== report.executionId
      || !unique(clean.caseResults.map((entry) => entry.caseId)) || clean.caseResults.length !== plan.cases.length) issue('Clean export must retain the exact case set and subject');
    for (const result of clean.caseResults) {
      const planned = plan.cases.find((entry) => entry.id === result.caseId);
      if (!planned || canonicalDeliveryJson(result.criterionIds) !== canonicalDeliveryJson(planned.criterionIds)
        || canonicalDeliveryJson(result.steps.map((entry) => entry.stepId)) !== canonicalDeliveryJson(planned.steps.map((entry) => entry.id))) issue('Clean export cannot change frozen cases/steps');
    }
    for (const id of [...Object.values(clean.stages).flatMap((entry) => entry.evidenceIds), ...clean.caseResults.flatMap((entry) => entry.evidenceIds)]) {
      const item = evidence.get(id); if (!item || item.scope !== 'clean_export' || item.sourceSnapshotHash !== clean.sourceBeforeHash
        || item.specHash !== spec.hash || item.planHash !== plan.hash) issue('Clean export evidence mismatch');
    }
  }
  if (deriveDeliveryQuality(report) !== report.quality) issue('Declared quality differs from fixed host policy');
  if (canonicalDeliveryJson([...report.gaps].sort((a, b) => a.criterionId.localeCompare(b.criterionId)))
    !== canonicalDeliveryJson(deriveCriterionGaps(report).sort((a, b) => a.criterionId.localeCompare(b.criterionId)))) issue('Every actual gap must remain visible with its real required/method/result');
});

export const ReportBinding = z.object({ deliveryId: Id, reportHash: Sha256, reportRevision: Revision,
  sourceSnapshotHash: Sha256.nullable() }).strict();
export function sameReportBinding(expected: z.infer<typeof ReportBinding>, actual: z.infer<typeof ReportBinding>) {
  return canonicalDeliveryJson(expected) === canonicalDeliveryJson(actual);
}
export const Publication = z.object({ status: z.enum(['not_published', 'publishing', 'published', 'rejected', 'cancelled']),
  publishedVersionId: Id.nullable() }).strict().refine((value) => (value.status === 'published') === (value.publishedVersionId !== null), 'Published version must reflect a real publication');
export const DeliveryProvenance = z.object({ subjectVersionId: Id.nullable(), restoredFromVersionId: Id.nullable(),
  originVersionId: Id.nullable(), originRunId: Id.nullable(), originExecutionId: Id.nullable(), report: DigestRef.nullable(),
  sourceSnapshotHash: Sha256.nullable(), evidenceReuse: z.enum(['original', 'restored_unchanged_source', 'legacy_unverified']),
  verificationRerun: z.boolean() }).strict().superRefine((value, ctx) => {
  if (value.evidenceReuse === 'restored_unchanged_source' && (!value.subjectVersionId || !value.restoredFromVersionId
    || !value.originVersionId || !value.originRunId || !value.originExecutionId || !value.report || !value.sourceSnapshotHash || value.verificationRerun)) {
    ctx.addIssue({ code: 'custom', message: 'Restored evidence must point at original verification without pretending to rerun' });
  }
  if (value.evidenceReuse === 'legacy_unverified' && (value.report || value.verificationRerun)) ctx.addIssue({ code: 'custom', message: 'Legacy restore cannot invent new verification' });
});
const subject = { projectId: Id, runId: Id.nullable(), subjectVersionId: Id.nullable(), revision: Revision, updatedAt: Timestamp };
export const DeliveryReadView = z.discriminatedUnion('state', [
  z.object({ ...subject, protocolVersion: Version, state: z.literal('pending'), phase: z.enum(['preparing', 'freezing', 'executing', 'verifying', 'clean_export', 'publishing']),
    preparationId: Id.nullable(), publication: Publication }).strict(),
  z.object({ ...subject, protocolVersion: Version, state: z.literal('available'), binding: ReportBinding,
    reportFinal: z.boolean(), apiVerification: z.enum(['pending', 'verified', 'invalid']), quality: DeliveryQuality,
    publication: Publication, provenance: DeliveryProvenance, report: DeliveryReport.nullable(), gaps: z.array(CriterionGap), error: DeliveryFailure.nullable() }).strict(),
  z.object({ ...subject, protocolVersion: Version, state: z.literal('legacy'), reason: z.literal('no_delivery_binding'),
    quality: z.literal('legacy_unverified'), publication: Publication, provenance: DeliveryProvenance }).strict(),
]).superRefine((view, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!view.runId && !view.subjectVersionId) issue('Read view requires a real subject');
  if (view.state === 'pending' && view.publication.status === 'published') issue('Pending report is not a published success');
  if (view.state === 'available') {
    if (view.report && (view.report.id !== view.binding.deliveryId || view.report.hash !== view.binding.reportHash
      || view.report.revision !== view.binding.reportRevision || view.report.final !== view.reportFinal
      || view.report.projectId !== view.projectId || (view.runId !== null && view.report.runId !== view.runId)
      || view.binding.sourceSnapshotHash !== (view.report.attempts.at(-1)?.sourceBeforeHash ?? null)
      || canonicalDeliveryJson(view.gaps) !== canonicalDeliveryJson(view.report.gaps))) issue('View/report subject, source, gaps or revision mismatch');
    if ((!view.reportFinal || view.apiVerification === 'pending') && view.quality !== 'pending') issue('Provisional/unverified report cannot announce terminal quality');
    if (view.apiVerification === 'verified' && (!view.report || view.quality !== view.report.quality)) issue('Verified view must reflect exact report quality');
    if (view.apiVerification === 'invalid' && (view.quality !== 'blocked' || !view.error || view.report)) issue('Invalid evidence cannot be presented as a trusted report');
    if (view.publication.status === 'published' && (!view.reportFinal || view.apiVerification !== 'verified'
      || !['complete', 'partial'].includes(view.quality))) issue('Only verified final complete/partial can publish');
    if (view.quality === 'partial' && !view.gaps.length) issue('Partial must have visible gaps');
    if (view.provenance.subjectVersionId !== view.subjectVersionId) issue('Read provenance must use requested version');
    if (view.report && (view.provenance.report?.id !== view.report.id || view.provenance.report.hash !== view.report.hash
      || view.provenance.originRunId !== view.report.runId || view.provenance.originExecutionId !== view.report.executionId
      || view.provenance.sourceSnapshotHash !== view.binding.sourceSnapshotHash)) issue('Verification origin must refer to the exact immutable report');
    if (view.provenance.evidenceReuse === 'original' && view.subjectVersionId !== null
      && view.provenance.originVersionId !== view.subjectVersionId) issue('Another version requires explicit restored-source provenance');
  }
});
export const ReportRead = z.discriminatedUnion('state', [
  z.object({ protocolVersion: Version, state: z.literal('pending'), preparationId: Id, executionId: Id, runId: Id, revision: Revision }).strict(),
  z.object({ protocolVersion: Version, state: z.literal('available'), binding: ReportBinding, report: DeliveryReport }).strict(),
]).superRefine((view, ctx) => {
  if (view.state === 'available' && (view.binding.deliveryId !== view.report.id || view.binding.reportHash !== view.report.hash
    || view.binding.reportRevision !== view.report.revision || view.binding.sourceSnapshotHash !== (view.report.attempts.at(-1)?.sourceBeforeHash ?? null))) ctx.addIssue({ code: 'custom', message: 'Report read binding mismatch' });
});
export const AttemptPage = z.object({ protocolVersion: Version, binding: ReportBinding,
  subject: z.object({ projectId: Id, runId: Id, executionId: Id }).strict(),
  items: z.array(VerificationAttempt), nextCursor: OpaqueCursor.nullable() }).strict().refine((page) => page.items.every((attempt) => attempt.runId === page.subject.runId && attempt.executionId === page.subject.executionId), 'Attempt page subject mismatch');
export const EvidenceDescriptor = z.object({ protocolVersion: Version, binding: ReportBinding, id: Id,
  kind: z.enum(['log', 'screenshot', 'report', 'trace']), fileName: Short.regex(/^[^/\\\u0000]+$/), sha256: Sha256, bytes: Seq,
  mediaType: z.enum(['text/plain', 'image/png', 'image/jpeg', 'application/json', 'application/zip']),
  attemptId: Id.nullable(), evidenceSourceHash: Sha256.nullable(), specHash: Sha256.nullable(), planHash: Sha256.nullable(),
  disposition: z.enum(['inline', 'attachment']), expiresAt: Timestamp.nullable() }).strict().superRefine((value, ctx) => {
    if ((value.kind === 'trace' && (value.disposition !== 'attachment' || value.mediaType !== 'application/zip'))
      || (value.kind === 'screenshot' && !['image/png', 'image/jpeg'].includes(value.mediaType))
      || (value.kind === 'log' && value.mediaType !== 'text/plain') || (value.kind === 'report' && value.mediaType !== 'application/json')) ctx.addIssue({ code: 'custom', message: 'Evidence kind/MIME/disposition mismatch' });
  });
export const SourceDownloadRef = z.discriminatedUnion('verification', [
  z.object({ verification: z.literal('verified'), subjectVersionId: Id, archiveId: Id, archiveHash: Sha256 }).strict(),
  z.object({ verification: z.literal('legacy_unverified'), subjectVersionId: Id, archiveId: z.null(), archiveHash: z.null() }).strict(),
]);
export const ExportReadView = z.object({ protocolVersion: Version, projectId: Id, subjectVersionId: Id,
  status: z.enum(['pending', 'verified', 'failed', 'legacy_unverified']), binding: ReportBinding.nullable(),
  provenance: DeliveryProvenance, manifest: SourceExportManifest.nullable(), cleanBuild: CleanBuildReport.nullable(),
  downloadRef: SourceDownloadRef.nullable(), error: DeliveryFailure.nullable() }).strict().superRefine((view, ctx) => {
  if (view.provenance.subjectVersionId !== view.subjectVersionId || (view.downloadRef && view.downloadRef.subjectVersionId !== view.subjectVersionId)) ctx.addIssue({ code: 'custom', message: 'Export subject mismatch' });
  if (view.status === 'verified' && (!view.binding || !view.manifest || !view.cleanBuild || !view.downloadRef
    || view.downloadRef.verification !== 'verified' || view.downloadRef.archiveId !== view.manifest.archive.id || view.downloadRef.archiveHash !== view.manifest.archive.sha256
    || view.manifest.projectId !== view.projectId || view.manifest.runId !== view.provenance.originRunId || view.manifest.executionId !== view.provenance.originExecutionId
    || view.binding.sourceSnapshotHash !== view.manifest.sourceSnapshotHash || view.provenance.sourceSnapshotHash !== view.binding.sourceSnapshotHash
    || view.provenance.report?.id !== view.binding.deliveryId || view.provenance.report.hash !== view.binding.reportHash
    || view.manifest.bindingHash !== view.cleanBuild.bindingHash || view.cleanBuild.exportManifestHash !== view.manifest.hash
    || view.cleanBuild.runId !== view.manifest.runId || view.cleanBuild.executionId !== view.manifest.executionId
    || view.cleanBuild.sourceBeforeHash !== view.manifest.sourceSnapshotHash || view.cleanBuild.sourceAfterHash !== view.manifest.sourceSnapshotHash
    || view.cleanBuild.lockfileHash !== view.manifest.lockfileHash || view.cleanBuild.toolchainId !== view.manifest.toolchainId
    || view.manifest.archive.sha256 !== view.cleanBuild.archiveHash || !gatesPass(view.cleanBuild.stages))) ctx.addIssue({ code: 'custom', message: 'Verified export needs the exact clean-verified archive' });
  if (view.status === 'legacy_unverified' && (view.manifest || view.cleanBuild || view.binding
    || (view.downloadRef && view.downloadRef.verification !== 'legacy_unverified'))) ctx.addIssue({ code: 'custom', message: 'Legacy download cannot invent a new verified manifest' });
});

export const DiffComparison = z.object({ id: Id, projectId: Id, baseVersionId: Id.nullable(), headVersionId: Id,
  baseSourceHash: Sha256.nullable(), headSourceHash: Sha256 }).strict().refine((pair) => (pair.baseVersionId === null) === (pair.baseSourceHash === null), 'Empty baseline must be explicit');
export const DiffLine = z.object({ kind: z.enum(['context', 'added', 'deleted']), text: z.string().max(10000),
  oldLine: z.number().int().positive().nullable(), newLine: z.number().int().positive().nullable() }).strict();
export const DiffHunk = z.object({ oldStart: Seq, newStart: Seq, lines: z.array(DiffLine).max(DELIVERY_LIMITS.maxDiffLines) }).strict();
export const VersionDiffFile = z.object({ path: RelativePath, status: z.enum(['added', 'modified', 'deleted']),
  before: FileFingerprint.nullable(), after: FileFingerprint.nullable(), kind: z.enum(['text', 'binary']),
  hunks: z.array(DiffHunk), truncated: z.boolean(), reason: Text.nullable() }).strict().superRefine((file, ctx) => {
  if ((file.status === 'added' && (file.before || !file.after)) || (file.status === 'deleted' && (!file.before || file.after))
    || (file.status === 'modified' && (!file.before || !file.after || file.before.sha256 === file.after.sha256))) ctx.addIssue({ code: 'custom', message: 'Diff operation must match actual before/after metadata' });
  if ([file.before, file.after].some((entry) => entry && entry.path !== file.path)) ctx.addIssue({ code: 'custom', message: 'Diff metadata path mismatch' });
  if (file.kind === 'binary' && file.hunks.length) ctx.addIssue({ code: 'custom', message: 'Binary files are metadata only' });
  if (file.truncated && !file.reason) ctx.addIssue({ code: 'custom', message: 'Truncation must remain visible' });
});
export const VersionDiffPage = z.object({ protocolVersion: Version, comparison: DiffComparison,
  files: z.array(VersionDiffFile).max(DELIVERY_LIMITS.diffPageSize), hasMore: z.boolean(), nextCursor: OpaqueCursor.nullable(),
  truncated: z.boolean(), reason: Text.nullable() }).strict().superRefine((page, ctx) => {
  if (page.hasMore !== (page.nextCursor !== null)) ctx.addIssue({ code: 'custom', message: 'Diff cursor must describe exactly the fixed comparison page' });
  if (page.truncated && !page.reason) ctx.addIssue({ code: 'custom', message: 'Truncated diff cannot look like no change' });
  if (page.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines)).length > DELIVERY_LIMITS.maxDiffLines) ctx.addIssue({ code: 'custom', message: 'Diff line budget exceeded' });
});

const PlanningEventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('planning.accepted'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('planning.started'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('planning.model_started'), payload: z.object({ modelStep: z.number().int().positive() }).strict() }).strict(),
  z.object({ type: z.literal('planning.progress'), payload: z.object({ content: Text }).strict() }).strict(),
  z.object({ type: z.literal('planning.completed'), payload: ProposedDeliveryPlan }).strict(),
  z.object({ type: z.literal('planning.failed'), payload: DeliveryFailure }).strict(),
  z.object({ type: z.literal('planning.cancelled'), payload: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('planning.interrupted'), payload: DeliveryFailure }).strict(),
]);
export const PlanningSourceEvent = z.object({ protocolVersion: Version, preparationId: Id, runId: Id, executionId: Id,
  sourceSeq: z.number().int().positive(), occurredAt: Timestamp, event: PlanningEventBody }).strict();
export const PlanningEventPage = z.object({ items: z.array(PlanningSourceEvent), nextCursor: Seq, hasMore: z.boolean() }).strict();
export const DeliveryExecutionSnapshot = z.object({ protocolVersion: Version, execution: ExecutionSnapshot,
  binding: DigestRef, phase: z.enum(['accepted', 'implementing', 'verifying', 'repairing', 'clean_export', 'completed', 'failed', 'cancelled', 'interrupted']),
  report: ReportBinding.nullable(), cumulativeUsage: BudgetUsage }).strict();
export const DeliveryExecutionEventPage = z.object({ protocolVersion: Version, binding: DigestRef, page: AgentEventPage }).strict();

export const DeliveryActionRef = z.object({ id: Id, kind: z.enum(['view_report', 'view_diff', 'source_download', 'evidence_download']),
  versionId: Id.nullable(), runId: Id.nullable(), available: z.boolean(), reason: Text.nullable() }).strict();
const FactQuality = z.enum(['pending', 'complete', 'partial', 'blocked', 'legacy_unverified']);
export const DeliveryFacts = z.object({ protocolVersion: Version, projectId: Id, revision: Seq, asOf: Timestamp, hash: Sha256,
  versions: z.array(z.object({ versionId: Id, quality: FactQuality, report: DigestRef.nullable(), sourceSnapshotHash: Sha256.nullable(),
    provenance: DeliveryProvenance, gaps: z.array(CriterionGap) }).strict()),
  runs: z.array(z.object({ runId: Id, quality: FactQuality, report: DigestRef.nullable(), gaps: z.array(CriterionGap) }).strict()),
  availableActions: z.array(DeliveryActionRef),
}).strict().superRefine((facts, ctx) => {
  if (JSON.stringify(facts).match(/https?:\/\/|file:\/\/|\/Users\/|\/home\//i)) ctx.addIssue({ code: 'custom', message: 'Delivery facts must use host references, never URLs or host paths' });
  for (const item of [...facts.versions, ...facts.runs]) if (item.quality === 'partial' && !item.gaps.length) ctx.addIssue({ code: 'custom', message: 'Router must see concrete partial gaps' });
});
export const DeliveryFactsUsed = z.object({ projectId: Id, revision: Seq, asOf: Timestamp, hash: Sha256 }).strict();
export const DeliveryCoordinationRequest = z.object({ protocolVersion: Version, hash: Sha256,
  coordination: StartCoordinationRequest, deliveryFacts: DeliveryFacts }).strict().superRefine((wrapper, ctx) => {
  if (wrapper.coordination.projectId !== wrapper.deliveryFacts.projectId) ctx.addIssue({ code: 'custom', message: 'Delivery facts belong to a foreign project' });
  if (wrapper.deliveryFacts.versions.some((entry) => !wrapper.coordination.context.facts.versions.some((version) => version.id === entry.versionId))
    || wrapper.deliveryFacts.runs.some((entry) => !wrapper.coordination.context.facts.runs.some((run) => run.id === entry.runId))) ctx.addIssue({ code: 'custom', message: 'Delivery facts must refer to the authorized coordination context' });
});
export const DeliveryCoordinationSnapshot = z.object({ protocolVersion: Version, coordination: CoordinationExecutionSnapshot,
  deliveryFactsUsed: DeliveryFactsUsed }).strict().refine((wrapper) => wrapper.coordination.projectId === wrapper.deliveryFactsUsed.projectId, 'Outer/inner project mismatch');
export const DeliveryCoordinationEventPage = z.object({ protocolVersion: Version, deliveryFactsUsed: DeliveryFactsUsed, page: CoordinationSourceEventPage }).strict();
export const DeliveryCoordinationCancel = CoordinationCancelRequest;

export type RequirementSeedDto = z.infer<typeof RequirementSeed>;
export type AcceptanceSpecDto = z.infer<typeof AcceptanceSpec>;
export type BrowserTestPlanDto = z.infer<typeof BrowserTestPlan>;
export type BrowserStepDto = z.infer<typeof BrowserStep>;
export type PrepareDeliveryPlanRequestDto = z.infer<typeof PrepareDeliveryPlanRequest>;
export type PlanPreparationSnapshotDto = z.infer<typeof PlanPreparationSnapshot>;
export type FrozenDeliveryBundleDto = z.infer<typeof FrozenDeliveryBundle>;
export type DeliveryExecutionRequestDto = z.infer<typeof DeliveryExecutionRequest>;
export type VerificationAttemptDto = z.infer<typeof VerificationAttempt>;
export type DeliveryReportDto = z.infer<typeof DeliveryReport>;
export type DeliveryReadViewDto = z.infer<typeof DeliveryReadView>;
export type DeliveryFactsDto = z.infer<typeof DeliveryFacts>;
export type DeliveryCoordinationRequestDto = z.infer<typeof DeliveryCoordinationRequest>;
