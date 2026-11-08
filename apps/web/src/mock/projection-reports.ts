import { BrowserTestPlan, FrozenDeliveryBundle } from '@atoms/contracts/delivery';
import { makeReport } from '@atoms/contracts/delivery-fixtures';
import { projectionBundle, projectionLeafPlan, projectionSeed, projectionSpec, projectionPartialReport } from '@atoms/contracts/delivery-projection-fixtures';
import { projectCanonicalSeedCoverage } from '@atoms/contracts/delivery-projection';
export const mixedProjection = projectionPartialReport;
const automatic = BrowserTestPlan.parse({ ...projectionLeafPlan,
  coverage: projectionLeafPlan.coverage.map(item => ({ criterionId: item.criterionId, method: 'automated', caseIds: projectionLeafPlan.cases.map(item => item.id), reason: null })),
  cases: projectionLeafPlan.cases.map(item => ({ ...item, criterionIds: projectionLeafPlan.coverage.map(item => item.criterionId) })),
});
const plan = BrowserTestPlan.parse({ ...automatic, ...projectCanonicalSeedCoverage(projectionSeed, projectionSpec, automatic) });
export const automaticProjection = makeReport(FrozenDeliveryBundle.parse({ ...projectionBundle, plan }));
