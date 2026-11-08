/** Synthetic G0 data. Digest/bytes are binding examples, NOT browser/build evidence. */
import { time, startExecution } from './fixtures.js';
import { startCoordination } from './conversation-fixtures.js';
import {
  AcceptanceSpec, BrowserCase, BrowserStep, BrowserTestPlan, CleanBuildReport, DeliveryExecutionRequest,
  DeliveryPolicyRevision, DeliveryProtocolVersion, ExportPolicyRevision, FrozenDeliveryBinding, FrozenDeliveryBundle,
  PrepareDeliveryPlanRequest, RequirementSeed, SourceExportManifest, ToolchainDescriptor, VerificationAttempt,
  DeliveryReport, deriveCriterionGaps, deriveDeliveryQuality, type DeliveryReportDataDto,
} from './delivery.js';

const h = (value: string) => value.repeat(64);
export const hashes = { seed: '769646b0930ff5c4923bd9eb056a0579995db3aa98656822effbbd002143321b', spec: h('2'), plan: h('3'), binding: h('4'), sourceA: h('5'), sourceB: h('6'),
  dist: h('7'), template: h('8'), lock: h('9'), package: h('a'), scripts: h('b'), export: h('c'), archive: h('d'), clean: h('e'), report: h('f') };
const features = ['add', 'edit', 'delete', 'search', 'drag', 'persist'] as const;
const descriptions = ['新增便签', '编辑便签内容', '删除便签', '按内容搜索便签', '拖拽移动便签', '刷新后保留内容和位置'];
export const seed = RequirementSeed.parse({ protocolVersion: DeliveryProtocolVersion, id: 'seed_notes', hash: hashes.seed,
  projectId: 'project_demo', runId: 'run_demo', executionId: 'execution_demo', revision: 1,
  goal: '创建可新增、编辑、删除、搜索、拖拽并刷新保存的便签墙。',
  items: [{ id: 'criterion_goal', kind: 'goal', text: '创建可新增、编辑、删除、搜索、拖拽并刷新保存的便签墙。', required: true },
    ...features.map((feature, index) => ({ id: `criterion_${feature}`, kind: 'declared_acceptance', text: descriptions[index], required: true }))],
  source: { admission: 'auto_explicit_request', messageIds: ['message_goal'], turnId: 'turn_goal', proposalId: 'proposal_notes', planAttentionId: null, admittedAt: time }, createdAt: time,
});
export const spec = AcceptanceSpec.parse({ protocolVersion: DeliveryProtocolVersion, id: 'spec_notes', hash: hashes.spec,
  projectId: seed.projectId, runId: seed.runId, revision: 1, seed: { id: seed.id, hash: seed.hash }, originalGoal: seed.goal,
  origin: 'host_profile', criteria: seed.items.map((item) => ({ id: item.id, description: item.text, required: item.required, seedItemIds: [item.id] })), createdAt: time });
let stepNumber = 0;
const step = (op: string, data: Record<string, unknown> = {}) => BrowserStep.parse({ id: `step_${++stepNumber}`, op, ...data });
const tid = (value: string) => ({ by: 'test_id', value });
const label = (name: string, nth?: number) => ({ by: 'label', name, ...(nth === undefined ? {} : { nth }) });
const button = (name: string) => ({ by: 'role', role: 'button', name });
const notesCase = (feature: string, steps: ReturnType<typeof BrowserStep.parse>[]) => BrowserCase.parse({ id: `case_${feature}`, name: `便签 ${feature}`,
  criterionIds: ['criterion_goal', `criterion_${feature}`], steps });
export const notesPlan = BrowserTestPlan.parse({ protocolVersion: DeliveryProtocolVersion, dslVersion: 'browser-dsl-v1',
  id: 'plan_notes', hash: hashes.plan, revision: 1, spec: { id: spec.id, hash: spec.hash }, browserBudgetMs: 90000,
  cases: [
    notesCase('add', [step('open_current_app'), step('save_count', { target: tid('note_card'), variable: 'before_count' }), step('click', { target: button('新建便签') }), step('expect_count', { target: tid('note_card'), expected: { kind: 'offset', variable: 'before_count', offset: 1 } })]),
    notesCase('edit', [step('open_current_app'), step('click', { target: button('新建便签') }), step('fill', { target: label('便签内容', 1), value: '验收便签 A' }), step('expect_value', { target: label('便签内容', 1), comparison: 'exact', value: '验收便签 A' })]),
    notesCase('delete', [step('open_current_app'), step('save_count', { target: tid('note_card'), variable: 'before_count' }), step('click', { target: label('删除便签', 0) }), step('expect_count', { target: tid('note_card'), expected: { kind: 'offset', variable: 'before_count', offset: -1 } })]),
    notesCase('search', [step('open_current_app'), step('fill', { target: label('便签内容', 0), value: '苹果验收' }), step('click', { target: button('新建便签') }), step('fill', { target: label('便签内容', 1), value: '香蕉验收' }), step('fill', { target: label('搜索便签'), value: '苹果' }), step('expect_count', { target: tid('note_card'), expected: { kind: 'literal', value: 1 } }), step('fill', { target: label('搜索便签'), value: '' }), step('expect_count', { target: tid('note_card'), expected: { kind: 'literal', value: 2 } })]),
    notesCase('drag', [step('open_current_app'), step('save_box', { target: { ...tid('note_card'), nth: 0 }, relativeTo: tid('note_board'), variable: 'before_box' }), step('drag_by', { target: label('拖动便签', 0), dx: 80, dy: 40 }), step('expect_box_moved', { target: { ...tid('note_card'), nth: 0 }, baseline: 'before_box', dx: 80, dy: 40, tolerancePx: 8 })]),
    notesCase('persist', [step('open_current_app'), step('fill', { target: label('便签内容', 0), value: '刷新验收' }), step('drag_by', { target: label('拖动便签', 0), dx: 60, dy: 30 }), step('save_box', { target: { ...tid('note_card'), nth: 0 }, relativeTo: tid('note_board'), variable: 'saved_box' }), step('reload'), step('expect_value', { target: label('便签内容', 0), comparison: 'exact', value: '刷新验收' }), step('expect_box_same', { target: { ...tid('note_card'), nth: 0 }, baseline: 'saved_box', tolerancePx: 8 })]),
  ], coverage: [
    { criterionId: 'criterion_goal', method: 'automated', caseIds: features.map((feature) => `case_${feature}`), reason: null },
    ...features.map((feature) => ({ criterionId: `criterion_${feature}`, method: 'automated', caseIds: [`case_${feature}`], reason: null })),
  ], createdAt: time,
});
export const calculatorPlan = BrowserTestPlan.parse({ protocolVersion: DeliveryProtocolVersion, dslVersion: 'browser-dsl-v1', id: 'plan_calculator', hash: h('a'), revision: 1,
  spec: { id: 'spec_calculator', hash: h('b') }, browserBudgetMs: 90000,
  cases: [
    { id: 'case_addition', name: '计算器加法', criterionIds: ['criterion_arithmetic'], steps: [step('open_current_app'), ...['7', '+', '5', '='].map((name) => step('click', { target: button(name) })), step('expect_text', { target: tid('result'), comparison: 'exact', value: '12' })] },
    { id: 'case_multiply', name: '计算器乘法与清空', criterionIds: ['criterion_arithmetic'], steps: [step('open_current_app'), ...['C', '9', '×', '3', '='].map((name) => step('click', { target: button(name) })), step('expect_text', { target: tid('result'), comparison: 'exact', value: '27' }), step('click', { target: button('C') }), step('expect_text', { target: tid('result'), comparison: 'exact', value: '0' })] },
  ], coverage: [{ criterionId: 'criterion_arithmetic', method: 'automated', caseIds: ['case_addition', 'case_multiply'], reason: null }], createdAt: time,
});
export const toolchain = ToolchainDescriptor.parse({ id: 'toolchain_react', templateId: 'template_react_export', templateHash: hashes.template,
  packageJsonHash: hashes.package, scriptsHash: hashes.scripts, lockfileHash: hashes.lock,
  nodeVersion: '26.5.0', pnpmVersion: '10.33.0', os: 'darwin', arch: 'arm64', registry: 'https://registry.npmjs.org', lifecycleScripts: 'disabled' });
export const prepareRequest = PrepareDeliveryPlanRequest.parse({ protocolVersion: DeliveryProtocolVersion, preparationId: 'preparation_notes', projectId: seed.projectId,
  runId: seed.runId, executionId: seed.executionId, seed, baseVersionId: null, input: startExecution.input,
  planningMode: 'host_profile', profileHint: { id: 'profile_notes', hash: h('a') }, toolchain,
  totalBudget: startExecution.budget, planningBudget: { maxModelSteps: 3, maxWallTimeMs: 60000, maxInputTokens: 32768, maxOutputTokens: 8192, maxStructuredRetries: 1 } });
export const planningUsage = { activeMs: 100, modelSteps: 0, inputTokens: 0, outputTokens: 0 };
export const binding = FrozenDeliveryBinding.parse({ protocolVersion: DeliveryProtocolVersion, id: 'binding_notes', hash: hashes.binding,
  projectId: seed.projectId, runId: seed.runId, executionId: seed.executionId, preparationId: prepareRequest.preparationId,
  seed: { id: seed.id, hash: seed.hash }, spec: { id: spec.id, hash: spec.hash }, plan: { id: notesPlan.id, hash: notesPlan.hash },
  baseVersionId: null, input: startExecution.input, planningMode: 'host_profile', toolchain,
  policyRevision: DeliveryPolicyRevision, exportPolicyRevision: ExportPolicyRevision, totalBudget: startExecution.budget, planningUsage, frozenAt: time });
export const bundle = FrozenDeliveryBundle.parse({ seed, spec, plan: notesPlan, binding });
export const executionRequest = DeliveryExecutionRequest.parse({ protocolVersion: DeliveryProtocolVersion,
  execution: { ...startExecution, budget: { ...startExecution.budget, maxWallTimeMs: startExecution.budget.maxWallTimeMs - planningUsage.activeMs } }, bundle });

type Bundle = typeof bundle;
type Attempt = ReturnType<typeof VerificationAttempt.parse>;
type Case = Attempt['caseResults'][number];
function caseResult(planned: Bundle['plan']['cases'][number], status: Case['status'], evidenceId: string): Case {
  const failingStep = planned.steps.at(-1)!.id;
  return { caseId: planned.id, criterionIds: planned.criterionIds, status,
    steps: planned.steps.map((entry) => ({ stepId: entry.id, status: status === 'not_run' ? 'not_run' : status === 'failed' && entry.id === failingStep ? 'failed' : 'passed' })),
    failure: status === 'failed' ? { stepId: failingStep, message: 'Synthetic observed assertion failure', expected: 'expected fixture state', actual: 'different fixture state' } : null,
    reason: status === 'not_run' ? 'Synthetic fixture did not execute this case.' : null, evidenceIds: status === 'not_run' ? [] : [evidenceId] };
}
function attempt(frozen: Bundle, id: string, source: string, round: number, previous: string | null,
  failedCase?: string, notRunCase?: string, invalid = false): Attempt {
  const log = `evidence_${id}`;
  return VerificationAttempt.parse({ id, hash: h(round ? 'a' : 'b'), runId: seed.runId, executionId: seed.executionId,
    bindingHash: frozen.binding.hash, specHash: frozen.spec.hash, planHash: frozen.plan.hash,
    repairRound: round, previousAttemptId: previous, sourceBeforeHash: source, sourceAfterHash: invalid ? hashes.dist : source,
    distHash: hashes.dist, lockfileHash: toolchain.lockfileHash, toolchainId: toolchain.id,
    status: invalid ? 'invalid' : failedCase ? 'failed' : notRunCase ? 'incomplete' : 'passed',
    checks: Object.fromEntries(['typecheck', 'build', 'smoke'].map((kind) => [kind, { status: 'passed', evidenceIds: [log], reason: null }])),
    caseResults: frozen.plan.cases.map((entry) => caseResult(entry, entry.id === failedCase ? 'failed' : entry.id === notRunCase ? 'not_run' : 'passed', log)),
    startedAt: time, finishedAt: time });
}
function evidence(frozen: Bundle, attempts: Attempt[], source: string) {
  return [...attempts.map((entry) => ({ id: `evidence_${entry.id}`, path: `evidence/${entry.id}.log`, sha256: h('a'), bytes: 100,
    kind: 'log' as const, mediaType: 'text/plain' as const, scope: 'verification' as const, attemptId: entry.id,
    sourceSnapshotHash: entry.sourceBeforeHash, specHash: frozen.spec.hash, planHash: frozen.plan.hash })),
  { id: 'evidence_clean', path: 'evidence/clean.log', sha256: h('b'), bytes: 100, kind: 'log' as const, mediaType: 'text/plain' as const,
    scope: 'clean_export' as const, attemptId: null, sourceSnapshotHash: source, specHash: frozen.spec.hash, planHash: frozen.plan.hash }];
}
function exported(frozen: Bundle, source: string) {
  return SourceExportManifest.parse({ protocolVersion: DeliveryProtocolVersion, id: 'export_notes', hash: hashes.export,
    projectId: seed.projectId, runId: seed.runId, executionId: seed.executionId, bindingHash: frozen.binding.hash,
    sourceSnapshotHash: source, templateId: toolchain.templateId, templateHash: toolchain.templateHash,
    packageJsonHash: toolchain.packageJsonHash, scriptsHash: toolchain.scriptsHash, lockfileHash: toolchain.lockfileHash, toolchainId: toolchain.id,
    files: [{ path: 'source/package.json', bytes: 100, sha256: toolchain.packageJsonHash, mediaType: 'application/json' },
      { path: 'source/pnpm-lock.yaml', bytes: 100, sha256: toolchain.lockfileHash, mediaType: 'text/plain' },
      { path: 'source/README.md', bytes: 100, sha256: h('a'), mediaType: 'text/plain' },
      { path: 'source/src/App.tsx', bytes: 100, sha256: h('b'), mediaType: 'text/plain' }],
    contentsManifestHash: h('a'), archive: { id: 'archive_notes', sha256: hashes.archive, bytes: 1000 }, createdAt: time });
}
function clean(frozen: Bundle, source: string, archive: ReturnType<typeof exported>, failedCase?: string) {
  return CleanBuildReport.parse({ protocolVersion: DeliveryProtocolVersion, id: 'clean_notes', hash: hashes.clean,
    runId: seed.runId, executionId: seed.executionId, bindingHash: frozen.binding.hash, exportManifestHash: archive.hash,
    archiveHash: archive.archive.sha256, sourceBeforeHash: source, sourceAfterHash: source, distHash: hashes.dist,
    lockfileHash: toolchain.lockfileHash, toolchainId: toolchain.id,
    verifiedPlatform: { nodeVersion: toolchain.nodeVersion, pnpmVersion: toolchain.pnpmVersion, os: toolchain.os, arch: toolchain.arch },
    registry: toolchain.registry, frozenLockfile: true, lifecycleScripts: 'disabled', usedPlatformSymlinks: false,
    stages: Object.fromEntries(['install', 'typecheck', 'build', 'smoke'].map((kind) => [kind, { status: 'passed', evidenceIds: ['evidence_clean'], reason: null }])),
    caseResults: frozen.plan.cases.map((entry) => caseResult(entry, entry.id === failedCase ? 'failed' : 'passed', 'evidence_clean')),
    startedAt: time, finishedAt: time });
}
export function makeReport(frozen: Bundle = bundle, attempts: Attempt[] = [attempt(frozen, 'attempt_initial', hashes.sourceA, 0, null)]) {
  const source = attempts.at(-1)!.sourceBeforeHash; const archive = exported(frozen, source);
  const raw: DeliveryReportDataDto = { protocolVersion: DeliveryProtocolVersion, id: 'delivery_notes', hash: hashes.report, revision: 1, final: true,
    projectId: seed.projectId, runId: seed.runId, executionId: seed.executionId, preparationId: prepareRequest.preparationId,
    lifecycle: 'completed', seed: frozen.seed, bundle: frozen, attempts, finalAttemptId: attempts.at(-1)!.id,
    exportManifest: archive, cleanBuild: clean(frozen, source, archive), evidence: evidence(frozen, attempts, source),
    quality: 'complete', gaps: [], failure: null, policyRevision: DeliveryPolicyRevision, updatedAt: time };
  raw.quality = deriveDeliveryQuality(raw); raw.gaps = deriveCriterionGaps(raw); return DeliveryReport.parse(raw);
}
export const complete = makeReport();
const partialBundle = structuredClone(bundle);
partialBundle.plan.cases = partialBundle.plan.cases.filter((entry) => entry.id !== 'case_drag');
partialBundle.plan.coverage = partialBundle.plan.coverage.map((entry) => entry.criterionId === 'criterion_drag'
  ? { ...entry, method: 'unsupported', caseIds: [], reason: 'Synthetic interpreter capability gap, required remains true.' }
  : { ...entry, caseIds: entry.caseIds.filter((id) => id !== 'case_drag') });
export const partial = makeReport(FrozenDeliveryBundle.parse(partialBundle));
const optionalBundle = structuredClone(bundle);
optionalBundle.seed.source.messageIds.push('message_optional');
optionalBundle.seed.items.push({ id: 'criterion_optional', kind: 'declared_acceptance', text: '可选的主题按钮', required: false,
  optionalEvidence: [{ messageId: 'message_optional', quote: '主题按钮可选' }] });
optionalBundle.spec.criteria.push({ id: 'criterion_optional', description: '可选的主题按钮', required: false, seedItemIds: ['criterion_optional'] });
optionalBundle.plan.cases.push(BrowserCase.parse({ id: 'case_optional', name: '可选主题按钮', criterionIds: ['criterion_optional'],
  steps: [step('open_current_app'), step('expect_visible', { target: button('切换主题'), visible: true })] }));
optionalBundle.plan.coverage.push({ criterionId: 'criterion_optional', method: 'automated', caseIds: ['case_optional'], reason: null });
export const optionalFailure = makeReport(FrozenDeliveryBundle.parse(optionalBundle), [attempt(optionalBundle, 'attempt_optional', hashes.sourceA, 0, null, 'case_optional')]);
export const requiredFailure = makeReport(bundle, [attempt(bundle, 'attempt_failed', hashes.sourceA, 0, null, 'case_add')]);
export const repaired = makeReport(bundle, [attempt(bundle, 'attempt_failed', hashes.sourceA, 0, null, 'case_add'),
  attempt(bundle, 'attempt_repaired', hashes.sourceB, 1, 'attempt_failed')]);
export const washedInvalidPass = makeReport(bundle, [attempt(bundle, 'attempt_failed', hashes.sourceA, 0, null, 'case_add'),
  attempt(bundle, 'attempt_invalid', hashes.sourceB, 1, 'attempt_failed', undefined, undefined, true),
  attempt(bundle, 'attempt_unrun', hashes.template, 2, 'attempt_invalid', undefined, 'case_add')]);
const sourceChangedRaw = makeReport(bundle, [attempt(bundle, 'attempt_changed', hashes.sourceA, 0, null, undefined, undefined, true)]);
export const sourceChanged = sourceChangedRaw;
const exportFailureRaw = structuredClone(complete);
exportFailureRaw.cleanBuild!.stages.install = { status: 'failed', evidenceIds: ['evidence_clean'], reason: 'Synthetic clean-install failure' };
exportFailureRaw.quality = deriveDeliveryQuality(exportFailureRaw); exportFailureRaw.gaps = deriveCriterionGaps(exportFailureRaw);
export const exportFailure = DeliveryReport.parse(exportFailureRaw);
export const planningFailure = DeliveryReport.parse({ ...complete, id: 'delivery_plan_failed', bundle: null, attempts: [], finalAttemptId: null,
  lifecycle: 'failed', exportManifest: null, cleanBuild: null, evidence: [], quality: 'blocked', gaps: [],
  failure: { code: 'PLANNING_FAILED', message: 'Synthetic read-only planning failure before freeze.', retryable: false } });
export const provisional = DeliveryReport.parse({ ...complete, revision: 1, final: false, lifecycle: 'running', quality: 'pending' });
export const cancelled = DeliveryReport.parse({ ...complete, id: 'delivery_cancelled', lifecycle: 'cancelled', quality: 'blocked',
  failure: { code: 'CANCELLED', message: 'Cancelled before publication; prior preview retained.', retryable: false } });

export const reportBinding = (report = complete) => ({ deliveryId: report.id, reportHash: report.hash, reportRevision: report.revision,
  sourceSnapshotHash: report.attempts.at(-1)?.sourceBeforeHash ?? null });
export const provenance = { subjectVersionId: 'version_delivered', restoredFromVersionId: null, originVersionId: 'version_delivered',
  originRunId: seed.runId, originExecutionId: seed.executionId, report: { id: complete.id, hash: complete.hash },
  sourceSnapshotHash: hashes.sourceA, evidenceReuse: 'original' as const, verificationRerun: true };
export const view = { protocolVersion: DeliveryProtocolVersion, state: 'available' as const, projectId: seed.projectId, runId: seed.runId,
  subjectVersionId: 'version_delivered', revision: 1, updatedAt: time, binding: reportBinding(), reportFinal: true, apiVerification: 'verified' as const,
  quality: complete.quality, publication: { status: 'published' as const, publishedVersionId: 'version_delivered' },
  provenance, report: complete, gaps: complete.gaps, error: null };
export const restoredView = { ...view, runId: null, subjectVersionId: 'version_restored',
  publication: { status: 'published' as const, publishedVersionId: 'version_restored' },
  provenance: { ...provenance, subjectVersionId: 'version_restored', restoredFromVersionId: 'version_delivered', evidenceReuse: 'restored_unchanged_source' as const, verificationRerun: false } };
export const legacyView = { protocolVersion: DeliveryProtocolVersion, state: 'legacy' as const, projectId: seed.projectId, runId: null,
  subjectVersionId: 'version_legacy_restored', revision: 1, updatedAt: time, reason: 'no_delivery_binding' as const, quality: 'legacy_unverified' as const,
  publication: { status: 'published' as const, publishedVersionId: 'version_legacy_restored' }, provenance: { subjectVersionId: 'version_legacy_restored',
    restoredFromVersionId: 'version_legacy', originVersionId: 'version_legacy', originRunId: null, originExecutionId: null, report: null,
    sourceSnapshotHash: null, evidenceReuse: 'legacy_unverified' as const, verificationRerun: false } };
export const pendingView = { protocolVersion: DeliveryProtocolVersion, state: 'pending' as const, projectId: seed.projectId, runId: seed.runId,
  subjectVersionId: null, revision: 1, updatedAt: time, phase: 'preparing' as const, preparationId: prepareRequest.preparationId,
  publication: { status: 'not_published' as const, publishedVersionId: null } };
export const provisionalView = { ...view, subjectVersionId: null, reportFinal: false, report: provisional, apiVerification: 'pending' as const,
  quality: 'pending' as const, provenance: { ...provenance, subjectVersionId: null, originVersionId: null },
  publication: { status: 'not_published' as const, publishedVersionId: null } };
export const finalUnpublishedView = { ...view, subjectVersionId: null,
  provenance: { ...provenance, subjectVersionId: null, originVersionId: null }, publication: { status: 'not_published' as const, publishedVersionId: null } };
export const exportView = { protocolVersion: DeliveryProtocolVersion, projectId: seed.projectId, subjectVersionId: 'version_delivered',
  status: 'verified' as const, binding: reportBinding(), provenance, manifest: complete.exportManifest, cleanBuild: complete.cleanBuild,
  downloadRef: { verification: 'verified' as const, subjectVersionId: 'version_delivered', archiveId: complete.exportManifest!.archive.id, archiveHash: complete.exportManifest!.archive.sha256 }, error: null };
export const diffPage = { protocolVersion: DeliveryProtocolVersion, comparison: { id: 'comparison_empty', projectId: seed.projectId,
  baseVersionId: null, headVersionId: 'version_delivered', baseSourceHash: null, headSourceHash: hashes.sourceA },
  files: [{ path: 'source/index.html', status: 'added' as const, before: null,
    after: { path: 'source/index.html', bytes: 100, sha256: hashes.package, mediaType: 'text/html' }, kind: 'text' as const,
    hunks: [{ oldStart: 0, newStart: 1, lines: [{ kind: 'added' as const, text: '<script>untrusted source text only</script>', oldLine: null, newLine: 1 }] }], truncated: false, reason: null }],
  hasMore: false, nextCursor: null, truncated: false, reason: null };
export const deliveryFacts = { protocolVersion: DeliveryProtocolVersion, projectId: seed.projectId, revision: 1, asOf: time, hash: hashes.report,
  versions: [], runs: [], availableActions: [] };
export const coordinationWrapper = { protocolVersion: DeliveryProtocolVersion, hash: hashes.binding,
  coordination: startCoordination, deliveryFacts };
export const preparationSnapshot = { protocolVersion: DeliveryProtocolVersion, id: prepareRequest.preparationId,
  projectId: seed.projectId, runId: seed.runId, executionId: seed.executionId, planningMode: 'host_profile' as const,
  revision: 2, requestHash: h('a'), status: 'completed' as const, lastSourceSeq: 3, usage: planningUsage,
  result: { protocolVersion: DeliveryProtocolVersion, preparationId: prepareRequest.preparationId,
    seed: { id: seed.id, hash: seed.hash }, spec, plan: notesPlan, usage: planningUsage }, error: null, updatedAt: time };
export const freezeRequest = { preparationRequest: prepareRequest, preparation: preparationSnapshot, bundle };
export const attemptPage = { protocolVersion: DeliveryProtocolVersion, binding: reportBinding(),
  subject: { projectId: seed.projectId, runId: seed.runId, executionId: seed.executionId }, items: complete.attempts, nextCursor: null };
export const revisedAttemptPage = { ...attemptPage, binding: { ...attemptPage.binding, reportRevision: 2, reportHash: h('a') } };
export const revisionConflict = { error: { code: 'STALE_REVISION' as const, message: 'Report revision changed; reload before requesting another page.',
  retryable: true, requestId: 'request_report_revision', details: { expectedReportRevision: 1, currentReportRevision: 2 } } };
export const evidenceDescriptor = { protocolVersion: DeliveryProtocolVersion, binding: reportBinding(),
  id: complete.evidence[0].id, kind: 'log' as const, fileName: 'attempt.log', sha256: complete.evidence[0].sha256, bytes: complete.evidence[0].bytes,
  mediaType: 'text/plain' as const, disposition: 'inline' as const, expiresAt: null,
  attemptId: complete.evidence[0].attemptId, evidenceSourceHash: complete.evidence[0].sourceSnapshotHash,
  specHash: spec.hash, planHash: notesPlan.hash };
