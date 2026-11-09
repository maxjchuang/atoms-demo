import { RequirementSeed, AcceptanceSpec, BrowserTestPlan, FrozenDeliveryBundle } from '@atoms/contracts/delivery';
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

// Synthetic planning fallback: one invalid automatic item is explicitly manual,
// while three independent valid automatic items remain. No actual execution proof.
const demotionSeed = RequirementSeed.parse({ ...projectionSeed, items: [projectionSeed.items[0]] });
const demotionSpec = AcceptanceSpec.parse({ ...projectionSpec, criteria: [projectionSpec.criteria[0],
  ...['新增便签后显示', '编辑便签文字', '搜索便签过滤', '跨窗口拖放排序符合原目标'].map((description, index) => ({ id: `criterion_demotion_${index}`, description, required: true, seedItemIds: [demotionSeed.items[0].id] }))] });
const demotionLeafPlan = BrowserTestPlan.parse({ ...projectionLeafPlan,
  cases: Array.from({ length: 3 }, (_, index) => ({ id: `case_demotion_${index}`, name: demotionSpec.criteria[index + 1].description, criterionIds: [`criterion_demotion_${index}`], steps: [{ id: `step_demotion_${index}`, op: 'open_current_app' }] })),
  coverage: demotionSpec.criteria.slice(1).map((criterion, index) => index < 3 ? { criterionId: criterion.id, method: 'automated', caseIds: [`case_demotion_${index}`], reason: null } : { criterionId: criterion.id, method: 'manual', caseIds: [], reason: '原自动检查包含当前解释器不支持的组合操作，无法可靠自动核验跨窗口排序；保留原目标与必需要求，需人工确认排序及其他便签保留，未执行不代表通过。' }) });
const demotionPlan = BrowserTestPlan.parse({ ...demotionLeafPlan, ...projectCanonicalSeedCoverage(demotionSeed, demotionSpec, demotionLeafPlan) });
export const manualDemotionProjection = makeReport(FrozenDeliveryBundle.parse({ ...projectionBundle, seed: demotionSeed, spec: demotionSpec, plan: demotionPlan }));
