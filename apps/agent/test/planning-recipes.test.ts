import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { canonicalDeliveryJson, BrowserTestPlan } from '@atoms/contracts/delivery';
import { compilePlanningRecipes, RECIPE_VERSION, recipePlanningPrompt } from '../src/planning-recipes.js';
import { mapModelPlan, ModelPlanSchemaError } from '../src/planning-format.js';
import { reviewPlanSemantics } from '../src/planning-semantics.js';
import { sha256 } from '../src/files.js';
import { runBrowserPlan } from '../src/browser-dsl.js';
import { DshPlanningAdapter } from '../src/delivery-planning.js';
import { createAgentServer } from '../src/runtime.js';
import { trustedTemplate } from '../src/trusted-template.js';
const role = (role: string, name: string) => ({ role, name });
const hook = (testId: string) => ({ testId });
const clearInputRecipe = {kind:'text_outcome',actions:[{action:'fill',target:role('textbox','Input'),value:'before clear'},{action:'fill',target:role('textbox','Input'),value:''}],target:role('textbox','Input'),observation:'value',exact:''};
const action = { action: 'click', target: role('button', 'Add') };
const seedRefs = prepareRequest.seed.items.map((_, i) => 's' + i);
const recipes = [
    { kind: 'initial_controls', targets: [role('button', 'Add'), role('textbox', 'Input'), hook('tile')] },
    { kind: 'text_outcome', actions: [{ action: 'fill', target: role('textbox', 'Input'), value: 'User text' }, { action: 'click', target: role('button', 'Show') }], target: hook('output'), observation: 'text', exact: 'User text' },
    { kind: 'collection_delta', collection: role('listitem', 'Entry'), actions: [action], delta: 1 },
    { kind: 'geometry_delta', target: hook('tile'), actions: [{ action: 'press', target: hook('tile'), key: 'ArrowRight' }], dx: 40, dy: 0, tolerancePx: 2 },
];
const input = () => ({ formatVersion: RECIPE_VERSION, criteria: [{ ref: 'r0', description: 'Controls, text, collection and geometry outcomes', sourceSeedRefs: seedRefs, verification: { method: 'automated', recipes: structuredClone(recipes) } }, { ref: 'r1', description: 'Complex spatial presentation still required', sourceSeedRefs: seedRefs, verification: { method: 'manual', reason: 'Human review of real spatial presentation; not permission to omit it.' } }] });
function compiled(raw: unknown) { return mapModelPlan(compilePlanningRecipes(raw), prepareRequest); }
test('versioned recipes compile four generic capabilities with host coverage/variables and preserve required manual scope', () => {
    const raw = input(), before = canonicalDeliveryJson(raw), out = compiled(raw);
    assert.equal(canonicalDeliveryJson(raw), before);
    BrowserTestPlan.parse(out.plan);
    assert.equal(out.plan.cases.length, 4);
    assert.ok(out.spec.criteria.every(c => c.required));
    assert.ok(out.plan.coverage.some(c => c.method === 'manual'));
    assert.equal(reviewPlanSemantics(out.plan).status, 'policy_pass');
    assert.ok(out.plan.cases[3].steps.some(s => s.op === 'save_box' && s.variable === 'box_before'));
    assert.equal(out.plan.cases[1].steps.at(-1)?.op, 'expect_text');
    assert.ok(out.plan.cases[1].steps.some(s => 'target' in s && s.target.by === 'role' && s.target.role === 'button'));
    const clear=input();(clear.criteria[0].verification.recipes as unknown[]).push(clearInputRecipe);const cleared=compiled(clear);assert.ok(cleared.plan.cases.at(-1)!.steps.some(s=>s.op==='expect_value'&&s.value===''));
    const prompt = recipePlanningPrompt(prepareRequest, []);
    assert.match(prompt, /planning-recipes-v1/);
    assert.match(prompt, /every required feature/);
    assert.ok(Buffer.byteLength(JSON.stringify(raw)) < Buffer.byteLength(JSON.stringify(compilePlanningRecipes(raw))));
});
test('unsupported/version/authority/ambiguous locators/limits/missing Seed are rejected; no legacy locator repair', () => {
    const bad = (change: (o: any) => void) => { const raw = input(); change(raw); assert.throws(() => compiled(raw), ModelPlanSchemaError); };
    bad(o=>{o.criteria[0].verification.recipes[1].contains='';delete o.criteria[0].verification.recipes[1].exact;});
    bad(o => o.formatVersion = 'planning-recipes-v2');
    bad(o => o.required = false);
    bad(o => o.criteria[0].verification.recipes[0].kind = 'natural_terminal');
    bad(o => o.criteria[0].verification.recipes[0].targets[0] = { role: 'button', name: 'Add', testId: 'add' });
    for (const field of ['url', 'code', 'path', 'budget', 'policy'])
        bad(o => o.criteria[0].verification.recipes[1][field] = 'not permitted');
    bad(o => o.criteria[0].sourceSeedRefs = []);
    bad(o => o.criteria.forEach((c: any) => c.sourceSeedRefs = ['s0']));
    bad(o => o.criteria[0].verification.recipes = Array.from({ length: 11 }, () => recipes[0]));
    bad(o => o.criteria[0].verification.recipes[3].dx = 513);
    const legacy = { criteria: [{ ref: 'r0', description: 'Captured invalid locator shape', sourceSeedRefs: seedRefs }], cases: [{ ref: 'c0', name: 'Captured invalid discriminator', criterionRefs: ['r0'], steps: [{ op: 'open_current_app' }, { op: 'click', target: { by: 'button', role: 'button', name: 'Start' } }] }], coverage: [{ criterionRef: 'r0', method: 'automated', caseRefs: ['c0'], reason: null }] };
    assert.throws(() => mapModelPlan(legacy, prepareRequest), ModelPlanSchemaError);
});
test('no-motion geometry, HUD collection and fake terminal effects cannot acquire automation through recipes or legacy semantic review', () => {
    for (const dx of [-1, 0, 1]) {
        const raw = input();
        Object.assign(raw.criteria[0].verification.recipes![3], { dx, dy: 0, tolerancePx: 8 });
        assert.throws(() => compiled(raw), ModelPlanSchemaError);
    }
    const out = compiled(input());
    const legacy = structuredClone(out.plan);
    const movement = legacy.cases[3].steps.find(s => s.op === 'expect_box_moved')!;
    if (movement.op === 'expect_box_moved')
        Object.assign(movement, { dx: -1, dy: 0, tolerancePx: 8 });
    assert.equal(reviewPlanSemantics(legacy).status, 'known_invalid');
    const scalar = input();
    Object.assign(scalar.criteria[0].verification.recipes![2], { collection: hook('numeric_hud') });
    assert.ok(reviewPlanSemantics(compiled(scalar).plan).issues.some(i => i.code === 'COLLECTION_UNPROVEN'));
    const terminal = input();
    (terminal.criteria[0].verification.recipes as unknown[])[0] = { kind: 'initial_controls', targets: [hook('terminal')], actions: [{ action: 'press', target: hook('surface'), key: 'ArrowDown' }] };
    assert.throws(() => compiled(terminal), ModelPlanSchemaError);
});
test('actual generic browser executes recipe-compiled static/text/list/geometry checks without model code', { timeout: 20000 }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-recipe-browser-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, 'index.html'), `<!doctype html><input aria-label="Input"><button id="show">Show</button><span data-testid="output"></span><button id="add">Add</button><ul id="entries"></ul><div data-testid="tile" tabindex="0" style="position:absolute;left:100px;top:200px;width:40px;height:40px;background:blue">Tile</div><script src="app.js"></script>`);
    await writeFile(path.join(root, 'app.js'), `document.querySelector('#show').onclick=()=>document.querySelector('[data-testid="output"]').textContent=document.querySelector('input').value;document.querySelector('#add').onclick=()=>{const e=document.createElement('li');e.setAttribute('aria-label','Entry');e.textContent='Entry';document.querySelector('#entries').append(e)};const tile=document.querySelector('[data-testid="tile"]');tile.onkeydown=e=>{if(e.key==='ArrowRight')tile.style.left=(parseFloat(tile.style.left)+40)+'px'};`);
    const raw=input();(raw.criteria[0].verification.recipes as unknown[]).push(clearInputRecipe);const frozen=compiled(raw).plan;
    const result = await runBrowserPlan({ dist: root, plan: frozen, evidenceDir: path.join(root, 'evidence'), signal: new AbortController().signal });
    assert.equal(result.caseResults.length, 5);
    assert.ok(result.caseResults.every(c => c.status === 'passed'), JSON.stringify(result.caseResults.filter(c => c.status !== 'passed')));
    const source = await readFile(path.join(root, 'app.js'), 'utf8');
    await writeFile(path.join(root, 'app.js'), source.replace("+40", "+0"));
    const noMotion = await runBrowserPlan({ dist: root, plan: frozen, evidenceDir: path.join(root, 'no-motion'), signal: new AbortController().signal });
    assert.deepEqual(noMotion.caseResults.map(c => c.status), ['passed', 'passed', 'passed', 'failed','passed'], 'the same generated geometry assertion must fail if the app does not move');
});
test('DSH mock recipe output passes strict compilation and stores versioned receipt tied to frozen plan; one malformed recipe gets only original retry', { timeout: 15000 }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-recipe-preparation-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let calls = 0;
    const adapter = new DshPlanningAdapter({ apiKey: 'synthetic-no-provider', harnessFactory: () => ({ async run(prompt: string, callback: any) { assert.match(prompt, /planning-recipes-v1/); const index = calls++; callback.onNotification({ method: 'session.event', params: { sessionId: 'session_recipe_mock', event: { type: 'step/start', seq: 1, data: { turn: 1, step: 0 } } } }); callback.onNotification({ method: 'session.event', params: { sessionId: 'session_recipe_mock', event: { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 } } } } }); const raw = input(); if (index === 0)
                (raw.criteria[0].verification.recipes as any)[0].targets = [{ by: 'button', role: 'button', name: 'Add' }]; return { sessionId: 'session_recipe_mock', finishReason: 'completed', finalResponse: JSON.stringify(raw) }; }, async close() { } } as unknown as DeepSeekHarness) });
    const app = createAgentServer({ dataDir: root, mode: 'fake', serviceToken: 'recipe-test-token', planningAdapter: adapter });
    t.after(() => app.close());
    const req = structuredClone(prepareRequest);
    req.planningMode = 'model_proposed';
    req.profileHint = null;
    req.toolchain = (await trustedTemplate()).descriptor;
    await app.planning.start(req, req.preparationId);
    for (let n = 0; n < 1000 && !['completed', 'failed'].includes(app.planning.get(req.preparationId).snapshot.status); n++)
        await new Promise(r => setTimeout(r, 10));
    const state = app.planning.get(req.preparationId).snapshot;
    assert.equal(state.status, 'completed', JSON.stringify(state.error));
    assert.equal(calls, 2);
    assert.equal(state.usage.modelSteps, 2);
    assert.equal(app.runtime.records.size, 0);
    const dir = path.join(root, 'delivery', req.preparationId, 'model');
    const file = path.join(dir, 'recipe-compilation_1.json');
    const receipt = JSON.parse(await readFile(file, 'utf8'));
    const { receiptHash, ...body } = receipt;
    assert.equal(receipt.formatVersion, RECIPE_VERSION);
    assert.equal(receipt.planHash, state.result!.plan.hash);
    assert.equal(receiptHash, sha256(canonicalDeliveryJson(body)));
    assert.equal((await stat(file)).mode & 511, 0o600);
    const semantic = JSON.parse(await readFile(path.join(dir, 'plan-semantic-review.json'), 'utf8'));
    assert.equal(semantic.planHash, state.result!.plan.hash);
    assert.equal(semantic.status, 'policy_pass');
    const proposal = JSON.parse(await readFile(path.join(dir, 'planner-proposals/attempt_1.json'), 'utf8'));
    assert.equal(proposal.payload.proposal.formatVersion, RECIPE_VERSION);
    assert.equal(proposal.payload.proposal.criteria[0].verification.method, 'automated');
});
