import assert from 'node:assert/strict'; import test from 'node:test';
import { BrowserTestPlan, deriveCriterionGaps, deriveDeliveryQuality } from '../src/delivery.js';
import { hasDerivedModelCriteria, projectCanonicalSeedCoverage, assertCanonicalSeedCoverage } from '../src/delivery-projection.js';
import { projectionSeed as seed, projectionSpec as spec, projectionLeafPlan as leafPlan, projectionPlan as plan, projectionPartialReport as report } from '../src/delivery-projection-fixtures.js';

test('projection preserves canonical text/required and all leaf steps/methods, with conservative manual priority and concrete gaps', () => {
  const before = JSON.stringify({ seed, spec, leafPlan }); const projected = projectCanonicalSeedCoverage(seed, spec, leafPlan);
  assert.equal(JSON.stringify({ seed, spec, leafPlan }), before); assert.deepEqual(projected.cases.map(c => c.steps), leafPlan.cases.map(c => c.steps));
  assert.deepEqual(projected.coverage.slice(0, leafPlan.coverage.length), leafPlan.coverage);
  const parent = projected.coverage.find(c => c.criterionId === seed.items[0].id)!; assert.equal(parent.method, 'manual'); assert.deepEqual(parent.caseIds, []);
  for (const id of ['criterion_leaf_manual', 'criterion_leaf_unsupported']) { assert.ok(parent.reason!.includes(id)); assert.ok(parent.reason!.includes(spec.criteria.find(c => c.id === id)!.description)); }
  assert.match(parent.reason!, /manual and unsupported/); assert.match(parent.reason!, /Human must review/);
  assert.equal(projected.coverage.find(c => c.criterionId === seed.items[2].id)!.method, 'automated');
  assert.ok(projected.cases.find(c => c.id === 'case_required')!.criterionIds.includes(seed.items[2].id));
  assert.ok(projected.cases.every(c => !c.criterionIds.includes(seed.items[0].id) && !c.criterionIds.includes(seed.items[1].id)));
});

test('all automatic derived children use a nonempty union in original case order, with parent backlinks only', () => {
  const automatic = structuredClone(leafPlan);
  automatic.coverage = automatic.coverage.map(c => ({ criterionId: c.criterionId, method: 'automated', caseIds: ['case_required', 'case_auto'], reason: null }));
  automatic.cases = automatic.cases.map(c => ({ ...c, criterionIds: leafPlan.coverage.map(c => c.criterionId) }));
  const projected = projectCanonicalSeedCoverage(seed, spec, automatic);
  for (const item of seed.items) { const parent = projected.coverage.find(c => c.criterionId === item.id)!; assert.equal(parent.method, 'automated'); assert.deepEqual(parent.caseIds, ['case_auto', 'case_required']); }
  assert.deepEqual(projected.cases[0].criterionIds, [...automatic.cases[0].criterionIds, ...seed.items.map(i => i.id)]);
  assert.deepEqual(projected.cases.map(c => c.steps), automatic.cases.map(c => c.steps));
});

test('independent API assertion rejects changed parent method/reason, missing parent coverage and foreign backlinks', () => {
  assertCanonicalSeedCoverage(seed, spec, plan);
  const changed = structuredClone(plan); const parent = changed.coverage.find(c => c.criterionId === seed.items[0].id)!;
  parent.method = 'automated'; parent.caseIds = ['case_auto']; parent.reason = null; changed.cases[0].criterionIds.push(parent.criterionId);
  BrowserTestPlan.parse(changed); assert.throws(() => assertCanonicalSeedCoverage(seed, spec, changed));
  const reason = structuredClone(plan); reason.coverage.find(c => c.criterionId === seed.items[0].id)!.reason = 'Invented parent summary'; assert.throws(() => assertCanonicalSeedCoverage(seed, spec, reason));
  const missing = structuredClone(plan); const id = seed.items[2].id; missing.coverage = missing.coverage.filter(c => c.criterionId !== id); missing.cases.forEach(c => { c.criterionIds = c.criterionIds.filter(v => v !== id); }); assert.throws(() => assertCanonicalSeedCoverage(seed, spec, missing));
  const foreign = structuredClone(plan); foreign.cases[0].criterionIds.push('criterion_foreign'); assert.throws(() => assertCanonicalSeedCoverage(seed, spec, foreign));
});

test('wrong required inheritance, unknown sources, unmapped Seeds and duplicate/mixed leaf coverage are rejected without repair', () => {
  const required = structuredClone(spec); required.criteria.find(c => c.id === 'criterion_leaf_auto')!.required = false; assert.throws(() => projectCanonicalSeedCoverage(seed, required, leafPlan));
  const source = structuredClone(spec); source.criteria.find(c => c.id === 'criterion_leaf_auto')!.seedItemIds.push('criterion_unknown'); assert.throws(() => projectCanonicalSeedCoverage(seed, source, leafPlan));
  const unmapped = structuredClone(spec); unmapped.criteria.filter(c => c.id.startsWith('criterion_leaf')).forEach(c => { c.seedItemIds = c.seedItemIds.filter(v => v !== seed.items[2].id); }); assert.throws(() => projectCanonicalSeedCoverage(seed, unmapped, leafPlan));
  const duplicate = structuredClone(leafPlan); duplicate.coverage.push({ ...duplicate.coverage[0], method: 'manual', caseIds: [], reason: 'Do not merge conflicting methods.' }); assert.throws(() => projectCanonicalSeedCoverage(seed, spec, duplicate));
});

test('manual/unsupported required leaves and canonical parents remain visible partial, required automatic failure stays blocked', () => {
  assert.equal(report.quality, 'partial'); assert.ok(report.gaps.some(g => g.criterionId === 'criterion_leaf_manual' && g.required)); assert.ok(report.gaps.some(g => g.criterionId === seed.items[0].id && g.required));
  const failed = structuredClone(report); const actual = failed.attempts[0].caseResults[0]; actual.status = 'failed'; actual.steps[0].status = 'failed'; actual.failure = { stepId: actual.steps[0].stepId, message: 'Synthetic failure', expected: null, actual: null };
  assert.equal(deriveDeliveryQuality(failed), 'blocked'); assert.ok(deriveCriterionGaps(failed).some(g => g.criterionId === 'criterion_leaf_auto' && g.result === 'failed' && g.required));
});

test('projection eligibility excludes host profiles and seed-only model results; summary remains within strict Text bounds', () => {
  assert.equal(hasDerivedModelCriteria(seed, { ...spec, origin: 'host_profile' }), false); assert.equal(hasDerivedModelCriteria(seed, { ...spec, criteria: spec.criteria.filter(c => seed.items.some(s => s.id === c.id)) }), false);
  const long = structuredClone(spec); long.criteria.filter(c => c.id.startsWith('criterion_leaf')).forEach(c => { c.description = 'x'.repeat(20000); });
  const longPlan = structuredClone(leafPlan); longPlan.coverage.filter(c => c.method !== 'automated').forEach(c => { c.reason = 'y'.repeat(20000); });
  const projected = projectCanonicalSeedCoverage(seed, long, longPlan); assert.ok(projected.coverage.every(c => c.reason === null || c.reason.length <= 20000));
  long.criteria.filter(c => c.id.startsWith('criterion_leaf')).forEach(c => { c.description = '😀'.repeat(10000); }); longPlan.coverage.filter(c => c.method !== 'automated').forEach(c => { c.reason = '😀'.repeat(10000); });
  for (const c of projectCanonicalSeedCoverage(seed, long, longPlan).coverage) if (c.reason) { assert.ok(c.reason.length <= 20000); assert.equal(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(c.reason), false); }
});
