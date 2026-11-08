import type { DeliveryReportDto } from '@atoms/contracts/delivery';
import { hasDerivedModelCriteria } from '@atoms/contracts/delivery-projection';
/** Presentation only: preserve all authoritative objects, methods, results and order within each group. */
export function deliveryGroups(report: DeliveryReportDto | null) {
  const spec = report?.bundle?.spec;
  const derived = !!report && !!spec && hasDerivedModelCriteria(report.seed, spec);
  const parents = new Set(derived ? report!.seed.items.map(item => item.id) : []);
  return {
    derived,
    criteria: (spec?.criteria ?? []).filter(item => !parents.has(item.id)),
    parents: (spec?.criteria ?? []).filter(item => parents.has(item.id)),
    gaps: (report?.gaps ?? []).filter(item => !parents.has(item.criterionId)),
    parentGaps: (report?.gaps ?? []).filter(item => parents.has(item.criterionId)),
  };
}
