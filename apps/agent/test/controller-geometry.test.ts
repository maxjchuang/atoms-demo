import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compilePlanningRecipes, RECIPE_VERSION } from '../src/planning-recipes.js';
import { mapModelPlan, ModelPlanSchemaError } from '../src/planning-format.js';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { seal } from '../src/delivery-files.js';
import { runBrowserPlan, GEOMETRY_STABLE_MS } from '../src/browser-dsl.js';
import { reviewPlanSemantics } from '../src/planning-semantics.js';
const entity = { testId: 'real_entity' }, control = { role: 'checkbox', name: 'Automatic movement' }, surface = { label: 'Actual workspace' };
const move = { kind: 'geometry_delta', target: entity, actions: [{ action: 'press', target: surface, key: 'ArrowRight' }], dx: 20, dy: 0, tolerancePx: 4 };
function plan(recipe: unknown) { const { plan } = mapModelPlan(compilePlanningRecipes({ formatVersion: RECIPE_VERSION, criteria: [{ ref: 'r0', description: 'Actual entity geometry after a legitimate manual control', sourceSeedRefs: prepareRequest.seed.items.map((_, i) => 's' + i), verification: { method: 'automated', recipes: [recipe] } }] }), prepareRequest); return seal({ ...plan, cases: plan.cases.map(c => ({ ...c, steps: c.steps.map(s => ({ ...s, timeoutMs: s.op === 'open_current_app' ? 5000 : 500 })) })) }); }
async function source(t: any, script: string) { const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-controller-geometry-')); t.after(() => rm(root, { recursive: true, force: true })); await writeFile(path.join(root, 'index.html'), '<!doctype html><main><input type="checkbox" aria-label="Automatic movement" checked><article aria-label="Entry">Entry</article><div aria-label="Actual workspace" tabindex="0" style="width:500px;height:300px;position:relative"><div data-testid="real_entity" style="position:absolute;left:0px;top:0px;width:30px;height:30px;background:blue">Entity</div></div></main><script src="app.js"></script>'); await writeFile(path.join(root, 'app.js'), `const entity=document.querySelector('[data-testid="real_entity"]'),surface=document.querySelector('[aria-label="Actual workspace"]'),control=document.querySelector('input');${script}`); return root; }
async function browser(root: string, recipe: unknown, name: string) { return runBrowserPlan({ dist: root, plan: plan(recipe), evidenceDir: path.join(root, name), signal: new AbortController().signal }); }
test('transient expected20 followed by settled29 cannot pass; actual settled20 passes and successful evidence records stability+delta', { timeout: 15000 }, async (t) => {
    const root = await source(t, `surface.onkeydown=()=>{entity.style.left='20px';setTimeout(()=>entity.style.left='29px',50)};`);
    const transient = await browser(root, move, 'transient');
    assert.equal(transient.caseResults[0].status, 'failed');
    assert.equal(JSON.parse(transient.caseResults[0].failure!.actual!).delta.dx, 29);
    await writeFile(path.join(root, 'app.js'), `const entity=document.querySelector('[data-testid="real_entity"]'),surface=document.querySelector('[aria-label="Actual workspace"]');surface.onkeydown=()=>entity.style.left='20px';`);
    const settled = await browser(root, move, 'settled');
    assert.equal(settled.caseResults[0].status, 'passed', JSON.stringify(settled.caseResults));
    const log = (await readFile(path.join(root, 'settled/case_1.log'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    const observed = JSON.parse(log.find(l => l.op === 'expect_box_moved').actual);
    assert.equal(observed.delta.dx, 20);
    assert.ok(observed.stableForMs >= GEOMETRY_STABLE_MS);
    assert.equal(observed.requiredStableMs, 120);
});
test('drifting baseline fails; explicit real automatic-off precondition permits manual movement, but not if that control disables movement', { timeout: 20000 }, async (t) => {
    const root = await source(t, `let y=0;const timer=setInterval(()=>entity.style.top=(y+=2)+'px',30);control.onchange=()=>{if(!control.checked)clearInterval(timer)};surface.onkeydown=()=>entity.style.left='20px';`);
    const drifting = await browser(root, move, 'drifting');
    assert.equal(drifting.caseResults[0].status, 'failed');
    assert.equal(plan(move).cases[0].steps.find(s => s.op === 'save_box')!.id, drifting.caseResults[0].failure!.stepId);
    const setup = { ...move, setupActions: [{ action: 'check', target: control, checked: false }] };
    const settled = await browser(root, setup, 'setup');
    assert.equal(settled.caseResults[0].status, 'passed', JSON.stringify(settled.caseResults));
    await writeFile(path.join(root, 'app.js'), `const entity=document.querySelector('[data-testid="real_entity"]'),surface=document.querySelector('[aria-label="Actual workspace"]'),control=document.querySelector('input');surface.onkeydown=()=>{if(control.checked)entity.style.left='20px'};`);
    const invalid = await browser(root, setup, 'invalid-setup');
    assert.equal(invalid.caseResults[0].status, 'failed', 'a setup that blocks the operation cannot manufacture a pass');
});
test('initial collection_count preserves a lawful automatic path without delta0; missing real collection name receives precise safe diagnostics', { timeout: 10000 }, async (t) => {
    const recipe = { kind: 'collection_count', collection: { role: 'article', name: 'Entry' }, count: 1 };
    assert.equal(reviewPlanSemantics(plan(recipe)).status, 'policy_pass');
    const root = await source(t, '');
    const result = await browser(root, recipe, 'initial-count');
    assert.equal(result.caseResults[0].status, 'passed');
    assert.throws(() => plan({ ...recipe, collection: { role: 'article' } }), (e: unknown) => e instanceof ModelPlanSchemaError && e.issues.some(i => i.requirement.includes('real accessible name')));
    assert.throws(() => plan({ kind: 'collection_delta', collection: recipe.collection, actions: [{ action: 'click', target: { label: 'Actual workspace' } }], delta: 0 }), ModelPlanSchemaError);
});
test('insufficient frozen geometry timeout is explicitly replan-required, not an impossible code-repair assertion', async () => { const { assertGeometryObservationBudget, GeometryObservationBudgetError } = await import('../src/browser-dsl.js'); const p = plan(move); const old = seal({ ...p, cases: p.cases.map(c => ({ ...c, steps: c.steps.map(s => s.op === 'save_box' ? { ...s, timeoutMs: 100 } : s) })) }); assert.throws(() => assertGeometryObservationBudget(old), GeometryObservationBudgetError); assert.doesNotThrow(() => assertGeometryObservationBudget(p)); });
