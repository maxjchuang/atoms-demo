import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  AcceptanceSpec, AttemptPage, BrowserStep, BrowserTestPlan, DeliveryApiError, DeliveryCoordinationRequest,
  DeliveryExecutionRequest, DeliveryFacts, DeliveryReadView, DeliveryReport, EvidenceDescriptor, ExportReadView,
  FreezeDeliveryPlanRequest, FrozenDeliveryBinding, FrozenDeliveryBundle, LocatorSpec, PlanPreparationSnapshot,
  PrepareDeliveryPlanRequest, ReportRead, RequirementSeed, SourceExportManifest, VersionDiffPage,
  canonicalDeliveryJson, deliveryHashBody, deriveCriterionGaps, deriveDeliveryQuality, sameReportBinding,
} from '../src/delivery.js';
import * as f from '../src/delivery-fixtures.js';

const clone = <T>(value: T): T => structuredClone(value);
test('typed seed, read-only preparation, API freeze and immutable execution wrapper form one subject', () => {
  RequirementSeed.parse(f.seed); PrepareDeliveryPlanRequest.parse(f.prepareRequest);
  PlanPreparationSnapshot.parse(f.preparationSnapshot); FrozenDeliveryBundle.parse(f.bundle);
  FreezeDeliveryPlanRequest.parse(f.freezeRequest); DeliveryExecutionRequest.parse(f.executionRequest);
});
test('browser-safe canonical payload has fixed Chinese nested UTF-8 vector and excludes only its own hash', () => {
  const body = deliveryHashBody(f.seed);
  assert.equal(Buffer.byteLength(body), 1202);
  assert.equal(createHash('sha256').update(body).digest('hex'), '769646b0930ff5c4923bd9eb056a0579995db3aa98656822effbbd002143321b');
  assert.equal(f.seed.hash, createHash('sha256').update(body).digest('hex'));
  assert.match(deliveryHashBody({ hash: 'own', nested: { hash: 'retain' } }), /retain/);
  assert.equal(canonicalDeliveryJson({ b: [2, 1], a: null }), '{"a":null,"b":[2,1]}');
  assert.throws(() => canonicalDeliveryJson({ missing: undefined }), TypeError);
  assert.throws(() => canonicalDeliveryJson([undefined]), TypeError);
});
test('one generic DSL describes all six notes behaviors and two calculator cases without domain code', () => {
  BrowserTestPlan.parse(f.notesPlan); BrowserTestPlan.parse(f.calculatorPlan);
  assert.equal(f.notesPlan.cases.length, 6); assert.equal(f.calculatorPlan.cases.length, 2);
  for (const plan of [f.notesPlan, f.calculatorPlan]) plan.cases.forEach((entry) => entry.steps.forEach((step) => BrowserStep.parse(step)));
});
test('DSL rejects model JavaScript, external navigation, CSS/XPath, unbounded keys and scripts', () => {
  for (const step of [
    { id: 'step_bad', op: 'evaluate', script: 'process.exit()' },
    { id: 'step_bad', op: 'open_current_app', url: 'https://evil.test/' },
    { id: 'step_bad', op: 'press', target: { by: 'test_id', value: 'input' }, key: 'Meta+L' },
    { id: 'step_bad', op: 'click', target: { by: 'test_id', value: 'input' }, js: 'alert(1)' },
  ]) assert.equal(BrowserStep.safeParse(step).success, false);
  assert.equal(LocatorSpec.safeParse({ by: 'css', value: 'body' }).success, false);
  assert.equal(LocatorSpec.safeParse({ by: 'role', role: 'button', name: 'x', xpath: '//*' }).success, false);
});
test('DSL variables are typed, defined before use, local to each case and never redefined', () => {
  const unknown = clone(f.notesPlan);
  const last = unknown.cases[5].steps.at(-1)!;
  if (last.op !== 'expect_box_same') throw new Error('Wrong fixture');
  last.baseline = 'before_box'; // Defined in another case only.
  assert.equal(BrowserTestPlan.safeParse(unknown).success, false);
  const redefined = clone(f.notesPlan);
  redefined.cases[0].steps.push({ id: 'step_redefine', op: 'save_count', target: { by: 'test_id', value: 'note_card' }, variable: 'before_count', timeoutMs: 5000 });
  assert.equal(BrowserTestPlan.safeParse(redefined).success, false);
});
test('DSL hard limits reject oversized budgets and undefined coverage', () => {
  assert.equal(BrowserTestPlan.safeParse({ ...f.notesPlan, browserBudgetMs: 90001 }).success, false);
  assert.equal(BrowserStep.safeParse({ id: 'step_bad', op: 'drag_by', target: { by: 'test_id', value: 'card' }, dx: 513, dy: 0 }).success, false);
  assert.equal(BrowserTestPlan.safeParse({ ...f.notesPlan, coverage: f.notesPlan.coverage.slice(0, 1) }).success, false);
});
test('seed keeps complete authorized goal, confirmation basis, source IDs and trusted optional evidence', () => {
  assert.equal(RequirementSeed.safeParse({ ...f.seed, goal: 'silently replaced goal' }).success, false);
  assert.equal(RequirementSeed.safeParse({ ...f.seed, source: { ...f.seed.source, admission: 'confirmed_plan', planAttentionId: null } }).success, false);
  const optional = clone(f.seed); optional.items[1].required = false;
  assert.equal(RequirementSeed.safeParse(optional).success, false);
});
test('freeze rejects changed required, lost original text and invented or omitted criteria', () => {
  const lower = clone(f.bundle); lower.spec.criteria[0].required = false;
  assert.equal(FrozenDeliveryBundle.safeParse(lower).success, false);
  const rewrite = clone(f.bundle); rewrite.spec.criteria[0].description = 'different goal';
  assert.equal(FrozenDeliveryBundle.safeParse(rewrite).success, false);
  const missing = clone(f.bundle); missing.plan.coverage.pop();
  assert.equal(FrozenDeliveryBundle.safeParse(missing).success, false);
});
test('freeze rejects another preparation, subject, planning origin or replacement completed plan', () => {
  assert.equal(FreezeDeliveryPlanRequest.safeParse({ ...f.freezeRequest, preparation: { ...f.preparationSnapshot, id: 'preparation_other' } }).success, false);
  const origin = clone(f.bundle); origin.spec.origin = 'model_proposed';
  assert.equal(FrozenDeliveryBundle.safeParse(origin).success, false);
  const mutated = clone(f.freezeRequest); mutated.bundle.plan.cases[0].name = 'changed after planning';
  assert.equal(FreezeDeliveryPlanRequest.safeParse(mutated).success, false);
});
test('worker remaining time/model/input/output are exact total minus observed planning usage, other bounds stay fixed', () => {
  const reset = clone(f.executionRequest); reset.execution.budget.maxWallTimeMs = reset.bundle.binding.totalBudget.maxWallTimeMs;
  assert.equal(DeliveryExecutionRequest.safeParse(reset).success, false);
  const expanded = clone(f.executionRequest); expanded.execution.budget.maxRepairRounds++;
  assert.equal(DeliveryExecutionRequest.safeParse(expanded).success, false);
  assert.equal(FrozenDeliveryBinding.safeParse({ ...f.binding, planningUsage: { ...f.planningUsage, activeMs: f.binding.totalBudget.maxWallTimeMs } }).success, false);
  assert.equal(FrozenDeliveryBinding.safeParse({ ...f.binding, planningUsage: { ...f.planningUsage, modelSteps: 1 } }).success, false);
});
test('wrapper cannot switch the exact input artifact while retaining the same version ID', () => {
  const good = clone(f.executionRequest);
  const input = { kind: 'version' as const, versionId: 'version_base', artifactId: 'artifact_one', manifestSha256: 'a'.repeat(64) };
  good.execution.baseVersionId = input.versionId; good.execution.input = input;
  good.bundle.binding.baseVersionId = input.versionId; good.bundle.binding.input = clone(input);
  DeliveryExecutionRequest.parse(good);
  good.execution.input.artifactId = 'artifact_other';
  assert.equal(DeliveryExecutionRequest.safeParse(good).success, false);
});

for (const [name, report, quality] of [
  ['complete', f.complete, 'complete'], ['required unsupported partial', f.partial, 'partial'],
  ['optional automatic failure partial', f.optionalFailure, 'partial'], ['required failure', f.requiredFailure, 'blocked'],
  ['same-plan repair', f.repaired, 'complete'], ['invalid pass cannot clear debt', f.washedInvalidPass, 'blocked'],
  ['source mutation', f.sourceChanged, 'blocked'], ['clean export failure', f.exportFailure, 'blocked'],
  ['early planning failure', f.planningFailure, 'blocked'], ['cancelled delivery', f.cancelled, 'blocked'],
  ['provisional progress', f.provisional, 'pending'],
] as const) test(`report policy fixture: ${name}`, () => {
  DeliveryReport.parse(report); assert.equal(deriveDeliveryQuality(report), quality);
});
test('required automatic failure cannot be published as partial or washed by invalid passed attempt then not_run', () => {
  assert.equal(DeliveryReport.safeParse({ ...f.requiredFailure, quality: 'partial' }).success, false);
  assert.equal(f.washedInvalidPass.attempts.length, 3);
  assert.equal(deriveDeliveryQuality(f.washedInvalidPass), 'blocked');
  assert.equal(DeliveryReport.safeParse({ ...f.washedInvalidPass, quality: 'partial' }).success, false);
});
test('normal application pass cannot hide a required behavior failure in the actual clean ZIP', () => {
  const report = clone(f.complete); const result = report.cleanBuild!.caseResults[0];
  result.status = 'failed'; result.steps.at(-1)!.status = 'failed';
  result.failure = { stepId: result.steps.at(-1)!.stepId, message: 'Actual clean-export assertion failure', expected: '2', actual: '1' };
  report.quality = deriveDeliveryQuality(report); report.gaps = deriveCriterionGaps(report);
  assert.equal(report.quality, 'blocked'); DeliveryReport.parse(report);
});
test('clean ZIP cases/steps/spec/plan evidence must be the full exact frozen plan', () => {
  const wrongSteps = clone(f.complete); wrongSteps.cleanBuild!.caseResults[0].steps.reverse();
  assert.equal(deriveDeliveryQuality(wrongSteps), 'blocked'); assert.equal(DeliveryReport.safeParse(wrongSteps).success, false);
  const missing = clone(f.complete); missing.cleanBuild!.caseResults.pop();
  assert.equal(DeliveryReport.safeParse(missing).success, false);
  const evidence = clone(f.complete); evidence.evidence.find((entry) => entry.scope === 'clean_export')!.planHash = '0'.repeat(64);
  assert.equal(DeliveryReport.safeParse(evidence).success, false);
});
test('report/export subject and template cannot be switched to a different project or run', () => {
  const foreign = clone(f.complete); foreign.exportManifest!.projectId = 'project_other';
  assert.equal(DeliveryReport.safeParse(foreign).success, false);
  const template = clone(f.complete); template.exportManifest!.templateId = 'template_other';
  assert.equal(deriveDeliveryQuality(template), 'blocked');
});
test('partial gaps are a complete fixed-policy set, never omitted or downgraded to optional', () => {
  assert.ok(f.partial.gaps.some((gap) => gap.criterionId === 'criterion_drag' && gap.required));
  assert.equal(DeliveryReport.safeParse({ ...f.partial, gaps: [] }).success, false);
  const lower = clone(f.partial); lower.gaps[0].required = false;
  assert.equal(DeliveryReport.safeParse(lower).success, false);
  const forged = clone(f.partial); forged.gaps[0].criterionId = 'criterion_unknown';
  assert.equal(DeliveryReport.safeParse(forged).success, false);
});
test('early preparation failure is readable independently before any execution PUT or Version', () => {
  ReportRead.parse({ protocolVersion: '0.1.0', state: 'available', binding: f.reportBinding(f.planningFailure), report: f.planningFailure });
  assert.equal(f.planningFailure.bundle, null); assert.equal(f.planningFailure.attempts.length, 0);
});
test('pending, provisional, final-unpublished and published are distinct safe read states', () => {
  for (const view of [f.pendingView, f.provisionalView, f.finalUnpublishedView, f.view]) DeliveryReadView.parse(view);
  assert.equal(DeliveryReadView.safeParse({ ...f.provisionalView, publication: { status: 'published', publishedVersionId: 'version_delivered' } }).success, false);
});
test('view cannot combine another subject, source, gaps or report revision', () => {
  assert.equal(DeliveryReadView.safeParse({ ...f.view, projectId: 'project_other' }).success, false);
  assert.equal(DeliveryReadView.safeParse({ ...f.view, binding: { ...f.view.binding, sourceSnapshotHash: '0'.repeat(64) } }).success, false);
  assert.equal(DeliveryReadView.safeParse({ ...f.view, binding: { ...f.view.binding, reportRevision: 99 } }).success, false);
  assert.equal(DeliveryReadView.safeParse({ ...f.view, gaps: f.partial.gaps }).success, false);
});
test('restore reuses original immutable verification, while legacy restore stays unverified', () => {
  DeliveryReadView.parse(f.restoredView); DeliveryReadView.parse(f.legacyView);
  assert.equal(f.restoredView.report?.runId, f.complete.runId); assert.equal(f.restoredView.provenance.verificationRerun, false);
  assert.equal(DeliveryReadView.safeParse({ ...f.restoredView, provenance: { ...f.restoredView.provenance, verificationRerun: true } }).success, false);
});
test('evidence descriptors have kind-safe MIME, no raw path/URL and explicit report/attempt source binding', () => {
  EvidenceDescriptor.parse(f.evidenceDescriptor);
  assert.equal(EvidenceDescriptor.safeParse({ ...f.evidenceDescriptor, kind: 'screenshot', mediaType: 'application/zip' }).success, false);
  assert.equal(EvidenceDescriptor.safeParse({ ...f.evidenceDescriptor, url: 'https://model.invalid/' }).success, false);
});
test('clean export downloadRef points at the same subject and exact verified archive, without unresolved action IDs', () => {
  ExportReadView.parse(f.exportView);
  assert.equal(ExportReadView.safeParse({ ...f.exportView, subjectVersionId: 'version_other' }).success, false);
  assert.equal(ExportReadView.safeParse({ ...f.exportView, downloadRef: { ...f.exportView.downloadRef, archiveHash: '0'.repeat(64) } }).success, false);
  assert.equal(SourceExportManifest.safeParse({ ...f.complete.exportManifest, archiveHash: '0'.repeat(64) }).success, false, 'archive/clean report is external, never recursively stuffed into ZIP manifest');
});
test('report-bound attempt pagination rejects mixing revisions and preserves explicit retry error', () => {
  AttemptPage.parse(f.attemptPage); AttemptPage.parse(f.revisedAttemptPage); DeliveryApiError.parse(f.revisionConflict);
  assert.equal(sameReportBinding(f.attemptPage.binding, f.revisedAttemptPage.binding), false);
  assert.equal(ReportRead.safeParse({ protocolVersion: '0.1.0', state: 'available', binding: f.revisedAttemptPage.binding, report: f.complete }).success, false);
});
test('diff safely carries HTML as text and distinguishes empty baseline, binary and truncation', () => {
  VersionDiffPage.parse(f.diffPage);
  assert.match(f.diffPage.files[0].hunks[0].lines[0].text, /<script>/);
  assert.equal(VersionDiffPage.safeParse({ ...f.diffPage, comparison: { ...f.diffPage.comparison, baseVersionId: 'version_missing_hash' } }).success, false);
  assert.equal(VersionDiffPage.safeParse({ ...f.diffPage, files: [{ ...f.diffPage.files[0], kind: 'binary' }] }).success, false);
  assert.equal(VersionDiffPage.safeParse({ ...f.diffPage, truncated: true, reason: null }).success, false);
});
test('delivery-aware coordination outer facts keep old context intact and reject URLs/foreign versions', () => {
  DeliveryFacts.parse(f.deliveryFacts); DeliveryCoordinationRequest.parse(f.coordinationWrapper);
  assert.equal(f.coordinationWrapper.coordination.protocolVersion, '0.2.0');
  assert.equal(DeliveryCoordinationRequest.safeParse({ ...f.coordinationWrapper, deliveryFacts: { ...f.deliveryFacts, projectId: 'project_other' } }).success, false);
  assert.equal(DeliveryFacts.safeParse({ ...f.deliveryFacts, availableActions: [{ id: 'action_bad', kind: 'view_report', versionId: null, runId: null, available: false, reason: 'https://secret.invalid/?token=x' }] }).success, false);
});
