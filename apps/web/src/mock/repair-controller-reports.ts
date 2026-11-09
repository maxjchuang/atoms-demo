/** Synthetic producer fixtures, not model/source/verification evidence. */
import { DeliveryReport, deriveDeliveryQuality, deriveCriterionGaps } from '@atoms/contracts/delivery';
import { complete, repaired, makeReport } from '@atoms/contracts/delivery-fixtures';

function cleanFailure(final: boolean) {
  const report = structuredClone(complete), clean = report.cleanBuild!;
  const target = clean.caseResults.find(item => report.bundle!.plan.cases.find(test => test.id === item.caseId)?.steps.some(step => step.op === 'expect_box_moved')) ?? clean.caseResults[0];
  target.status = 'failed'; target.steps.at(-1)!.status = 'failed';
  target.failure = { stepId: target.steps.at(-1)!.stepId, message: 'Synthetic clean behavior movement did not match the frozen expectation', expected: 'dx=20, dy=0, tolerance=4', actual: 'dx=29, dy=174' };
  report.final = final; report.lifecycle = final ? 'failed' : 'running'; report.failure = final ? { code: 'EXPORT_FAILED', message: 'Synthetic independent behavior failure; not a packaging-only failure.', retryable: false } : null;
  report.quality = deriveDeliveryQuality(report); report.gaps = deriveCriterionGaps(report);
  return DeliveryReport.parse(report);
}
export const cleanBehaviorFailure = cleanFailure(true);
export const cleanRepairProvisional = cleanFailure(false);
const sourceRepair = { ...structuredClone(repaired.attempts[1]), previousAttemptId: complete.attempts[0].id };
const repairedReport = makeReport(complete.bundle!, [structuredClone(complete.attempts[0]), sourceRepair]);
repairedReport.revision = 2;
repairedReport.evidence.push({ ...structuredClone(complete.evidence.find(item => item.scope === 'clean_export')!), id: 'evidence_clean_previous', path: 'evidence/previous-clean.json' });
export const cleanRepairComplete = DeliveryReport.parse(repairedReport);
export const previousCleanEvidence = JSON.stringify({ synthetic: true, scope: 'prior independent clean verification', sourceHash: complete.attempts[0].sourceBeforeHash, expected: 'dx=20, dy=0, tolerance=4', actual: 'dx=29, dy=174', status: 'failed', note: 'Prior immutable clean evidence; not the current passing source.' }, null, 2);

const missingResults = structuredClone(cleanBehaviorFailure);
for (const item of missingResults.cleanBuild!.caseResults) { item.status = 'not_run'; item.failure = null; item.evidenceIds = []; item.reason = 'Synthetic browser cases not run after install failure.'; for (const step of item.steps) step.status = 'not_run'; }
missingResults.cleanBuild!.stages.install = { status: 'failed', evidenceIds: ['evidence_clean'], reason: 'Synthetic install stopped before browser cases could run.' };
missingResults.seed.goal = 'Synthetic full authorized goal. '.repeat(40) + 'END OF FULL GOAL';
missingResults.seed.items.find(item => item.kind === 'goal')!.text = missingResults.seed.goal;
missingResults.bundle!.seed = structuredClone(missingResults.seed);
missingResults.bundle!.spec.originalGoal = missingResults.seed.goal;
missingResults.bundle!.spec.criteria.find(item => item.id === missingResults.seed.items.find(seed => seed.kind === 'goal')!.id)!.description = missingResults.seed.goal;
missingResults.quality = deriveDeliveryQuality(missingResults); missingResults.gaps = deriveCriterionGaps(missingResults);
export const cleanCasesNotRun = DeliveryReport.parse(missingResults);
