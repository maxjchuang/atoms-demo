/** Pure host-owned metadata projection. No hashing, I/O, model calls or evidence claims. */
import {
  RequirementSeed, AcceptanceSpec, BrowserTestPlan, canonicalDeliveryJson,
  type RequirementSeedDto, type AcceptanceSpecDto, type BrowserTestPlanDto,
} from './delivery.js';

export function hasDerivedModelCriteria(seed: RequirementSeedDto, spec: AcceptanceSpecDto) {
  const parents = new Set(seed.items.map(item => item.id));
  return spec.origin === 'model_proposed' && spec.criteria.some(criterion => !parents.has(criterion.id));
}
function subjects(seed: RequirementSeedDto, spec: AcceptanceSpecDto) {
  RequirementSeed.parse(seed); AcceptanceSpec.parse(spec);
  if (!hasDerivedModelCriteria(seed, spec) || spec.projectId !== seed.projectId || spec.runId !== seed.runId
    || spec.originalGoal !== seed.goal || spec.seed.id !== seed.id || spec.seed.hash !== seed.hash) throw new Error('Derived projection subject or origin mismatch');
  const parents = new Set(seed.items.map(item => item.id));
  for (const item of seed.items) {
    const parent = spec.criteria.find(criterion => criterion.id === item.id);
    if (!parent || parent.description !== item.text || parent.required !== item.required
      || canonicalDeliveryJson(parent.seedItemIds) !== canonicalDeliveryJson([item.id])) throw new Error('Canonical Seed criterion changed');
  }
  const leaves = spec.criteria.filter(criterion => !parents.has(criterion.id));
  for (const leaf of leaves) {
    const sources = leaf.seedItemIds.map(id => seed.items.find(item => item.id === id));
    if (sources.some(source => !source) || leaf.required !== sources.some(source => source!.required)) throw new Error('Derived source or required inheritance mismatch');
  }
  if (seed.items.some(item => !leaves.some(leaf => leaf.seedItemIds.includes(item.id)))) throw new Error('Seed has no derived mapping');
  return { parents, leaves, leafIds: new Set(leaves.map(leaf => leaf.id)) };
}

/** Input is a valid leaf-only plan. Output contains only projected metadata; caller reseals the final plan. */
export function projectCanonicalSeedCoverage(seed: RequirementSeedDto, spec: AcceptanceSpecDto, leafPlan: BrowserTestPlanDto): Pick<BrowserTestPlanDto, 'cases' | 'coverage'> {
  const { leaves, leafIds } = subjects(seed, spec); BrowserTestPlan.parse(leafPlan);
  if (leafPlan.spec.id !== spec.id || leafPlan.spec.hash !== spec.hash) throw new Error('Projection plan/spec mismatch');
  if (leafPlan.coverage.length !== leaves.length || leafPlan.coverage.some(entry => !leafIds.has(entry.criterionId))
    || leaves.some(leaf => leafPlan.coverage.filter(entry => entry.criterionId === leaf.id).length !== 1)
    || leafPlan.cases.some(entry => entry.criterionIds.some(id => !leafIds.has(id)))) throw new Error('Projection requires exact leaf-only coverage/case references');
  const parents = seed.items.map(item => {
    const children = leaves.filter(leaf => leaf.seedItemIds.includes(item.id));
    const coverage = children.map(leaf => leafPlan.coverage.find(entry => entry.criterionId === leaf.id)!);
    const manual = coverage.some(entry => entry.method === 'manual'); const unsupported = coverage.some(entry => entry.method === 'unsupported');
    if (manual || unsupported) {
      const bounded = (text: string, max: number) => text.length <= max ? text : text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
      const gaps = children.flatMap(leaf => { const child = leafPlan.coverage.find(entry => entry.criterionId === leaf.id)!;
        return child.method === 'automated' ? [] : [`[${leaf.id}] ${bounded(leaf.description, 100)} (${child.method}): ${bounded(child.reason!, 80)}`]; });
      return { criterionId: item.id, method: manual ? 'manual' as const : 'unsupported' as const, caseIds: [],
        reason: `Host-owned aggregate: mapped derived criteria include ${[...(manual ? ['manual'] : []), ...(unsupported ? ['unsupported'] : [])].join(' and ')} coverage. Unverified children (bounded summaries; full leaf gaps remain visible): ${gaps.join('; ')}` };
    }
    const union = new Set(coverage.flatMap(entry => entry.caseIds));
    const caseIds = leafPlan.cases.filter(entry => union.has(entry.id)).map(entry => entry.id);
    if (!caseIds.length) throw new Error('Automatic parent requires a nonempty child-case union');
    return { criterionId: item.id, method: 'automated' as const, caseIds, reason: null };
  });
  const cases = leafPlan.cases.map(entry => ({ ...entry,
    criterionIds: [...entry.criterionIds, ...parents.filter(parent => parent.method === 'automated' && parent.caseIds.includes(entry.id)).map(parent => parent.criterionId)] }));
  return { cases, coverage: [...leafPlan.coverage, ...parents] };
}

/** API pre-freeze check for new model_proposed results with derived leaves; no legacy recompilation. */
export function assertCanonicalSeedCoverage(seed: RequirementSeedDto, spec: AcceptanceSpecDto, plan: BrowserTestPlanDto): void {
  const { parents, leafIds } = subjects(seed, spec); BrowserTestPlan.parse(plan);
  if (plan.coverage.some(entry => !parents.has(entry.criterionId) && !leafIds.has(entry.criterionId))
    || plan.cases.some(entry => entry.criterionIds.some(id => !parents.has(id) && !leafIds.has(id)))) throw new Error('Projection has foreign criterion references');
  const leafPlan = { ...plan, cases: plan.cases.map(entry => ({ ...entry, criterionIds: entry.criterionIds.filter(id => leafIds.has(id)) })),
    coverage: plan.coverage.filter(entry => leafIds.has(entry.criterionId)) };
  const expected = projectCanonicalSeedCoverage(seed, spec, leafPlan);
  if (canonicalDeliveryJson(plan.cases) !== canonicalDeliveryJson(expected.cases)
    || canonicalDeliveryJson(plan.coverage) !== canonicalDeliveryJson(expected.coverage)) throw new Error('Canonical parent projection or backlinks changed');
}
