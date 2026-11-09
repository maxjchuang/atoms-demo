import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlanningRecipes, inspectRecipeFields, RECIPE_VERSION } from '../src/planning-recipes.js';
import { mapModelPlan, ModelPlanSchemaError } from '../src/planning-format.js';
import { geometryBoundaryIssues, assertGeometryBoundary } from '../src/geometry-contract.js';
import { reviewPlanSemantics } from '../src/planning-semantics.js';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { profileProposal } from '../src/trusted-template.js';
import { seal } from '../src/delivery-files.js';
const entity = { testId: 'entity' }, surface = { label: 'Workspace' }, press = { action: 'press', target: surface, key: 'ArrowRight' };
const raw = (recipe: any) => ({ formatVersion: RECIPE_VERSION, criteria: [{ ref: 'r0', description: 'One actual user interaction', sourceSeedRefs: prepareRequest.seed.items.map((_, i) => 's' + i), verification: { method: 'automated', recipes: [recipe] } }] });
const recipe = { kind: 'geometry_delta', target: entity, setupActions: [{ action: 'click', target: { role: 'button', name: 'Initialize' } }], actions: [press], dx: 20, dy: 0, tolerancePx: 4 };
test('geometry separates explicit initialization before baseline and one measured effect without silently reordering model actions', () => { const input = raw(recipe), before = JSON.stringify(input); const { plan } = mapModelPlan(compilePlanningRecipes(input), prepareRequest); assert.deepEqual(plan.cases[0].steps.map(s => s.op), ['open_current_app', 'click', 'save_box', 'press', 'expect_box_moved']); assert.equal(geometryBoundaryIssues(plan).length, 0); assert.equal(reviewPlanSemantics(plan).status, 'policy_pass'); assert.equal(JSON.stringify(input), before); const bad = raw({ ...recipe, setupActions: [], actions: [recipe.setupActions[0], press] }); const saved = JSON.stringify(bad); assert.throws(() => compilePlanningRecipes(bad), ModelPlanSchemaError); assert.ok(inspectRecipeFields(bad).some(i => i.requirement.includes('exactly ONE'))); assert.equal(JSON.stringify(bad), saved); });
test('legacy multiple interactions yield explicit plan review; single implicit-focus press and drag stay supported', () => { const { plan } = mapModelPlan(compilePlanningRecipes(raw(recipe)), prepareRequest); const c = plan.cases[0]; const saved = c.steps.find(s => s.op === 'save_box')!, effect = c.steps.find(s => s.op === 'press')!, assertion = c.steps.at(-1)!; const legacy = seal({ ...plan, cases: [{ ...c, steps: [c.steps[0], saved, { id: 'step_initialize_late', op: 'click' as const, timeoutMs: 5000, target: { by: 'role' as const, role: 'button' as const, name: 'Initialize', exact: true } }, effect, assertion] }] }); assert.throws(() => assertGeometryBoundary(legacy), /冻结几何/); assert.ok(reviewPlanSemantics(legacy).issues.some(i => i.code === 'ACTION_WITHOUT_POSTCONDITION')); for (const action of [press, { action: 'drag', target: entity, dx: 20, dy: 0 }])
    assert.doesNotThrow(() => assertGeometryBoundary(mapModelPlan(compilePlanningRecipes(raw({ ...recipe, actions: [action] })), prepareRequest).plan)); });
test('existing host notes single drag and single reload-persistence contracts pass boundary check', async () => { for (const id of ['profile_notes_v1', 'profile_calculator_v1']) {
    const request = structuredClone(prepareRequest);
    request.planningMode = 'model_proposed';
    const { plan } = await profileProposal(request, id);
    assert.doesNotThrow(() => assertGeometryBoundary(plan));
} });
