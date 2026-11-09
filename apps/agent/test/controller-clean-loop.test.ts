import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentServer } from '../src/runtime.js';
import { ControllerFixtureAdapter, ControllerFixturePlanner } from './helpers/controller-fixture.js';
import { prepareRequest, binding as sampleBinding } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
import { DeliveryExecutionRequest, DeliveryReport } from '@atoms/contracts/delivery';
import { seal } from '../src/delivery-files.js';
import { trustedTemplate } from '../src/trusted-template.js';
import { sha256 } from '../src/files.js';
import { validateController } from '../src/repair-controller.js';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function run(t: any, scenario: 'clean_repair' | 'no_change' = 'clean_repair', repairLimit = 2, infra = false, extra?: 'command' | 'install') {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-controller-clean-'));
    if (process.env.ATOMS_KEEP_AGENT_TEST_DATA !== '1')
        t.after(() => rm(dataDir, { recursive: true, force: true }));
    else
        t.diagnostic('Controller evidence: ' + dataDir);
    const adapter = new ControllerFixtureAdapter(scenario);
    const app = createAgentServer({ dataDir, mode: 'fake', serviceToken: 'controller-unit-synthetic', adapter, planningAdapter: new ControllerFixturePlanner(), trustedCleanBrowserLocale: 'fr-FR' });
    t.after(() => app.close());
    const req = structuredClone(prepareRequest);
    req.planningMode = 'model_proposed';
    req.toolchain = (await trustedTemplate()).descriptor;
    req.totalBudget.maxRepairRounds = repairLimit;
    req.seed.goal = 'Render decimal 1.5 with a fixed en-US output convention regardless of browser language.';
    req.seed.items = req.seed.items.map(s => ({ ...s, text: req.seed.goal }));
    req.seed = seal(req.seed);
    await app.planning.start(req, req.preparationId);
    for (let i = 0; i < 500 && app.planning.get(req.preparationId).snapshot.status !== 'completed'; i++)
        await pause(10);
    const prepared = app.planning.get(req.preparationId).snapshot;
    assert.equal(prepared.status, 'completed');
    const { spec, plan, usage } = prepared.result!;
    const binding = seal({ ...sampleBinding, toolchain: req.toolchain, planningMode: req.planningMode, totalBudget: req.totalBudget, planningUsage: usage, seed: { id: req.seed.id, hash: req.seed.hash }, spec: { id: spec.id, hash: spec.hash }, plan: { id: plan.id, hash: plan.hash } });
    const budget = { ...req.totalBudget, maxModelSteps: req.totalBudget.maxModelSteps - usage.modelSteps, maxInputTokens: req.totalBudget.maxInputTokens - usage.inputTokens!, maxOutputTokens: req.totalBudget.maxOutputTokens - usage.outputTokens!, maxWallTimeMs: req.totalBudget.maxWallTimeMs - usage.activeMs };
    const wrapper = DeliveryExecutionRequest.parse({ protocolVersion: '0.1.0', execution: { ...startExecution, mode: 'build', prompt: req.seed.goal, budget }, bundle: { seed: req.seed, spec, plan, binding } });
    const oldChrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    if (infra) {
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = path.join(dataDir, 'not-a-browser');
        t.after(() => { if (oldChrome === undefined)
            delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
        else
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = oldChrome; });
    }
    if (extra === 'command') {
        const exec = process.execPath;
        process.execPath = path.join(dataDir, 'not-a-node');
        t.after(() => { process.execPath = exec; });
    }
    if (extra === 'install') {
        const finish = app.delivery.finish.bind(app.delivery);
        app.delivery.finish = async (...args) => { const oldPath = process.env.PATH; process.env.PATH = path.join(dataDir, 'no-tools'); try {
            return await finish(...args);
        }
        finally {
            process.env.PATH = oldPath;
        } };
    }
    await app.delivery.start(wrapper, wrapper.execution.executionId);
    for (let i = 0; i < 4000 && !['succeeded', 'failed', 'cancelled'].includes(app.runtime.get(wrapper.execution.executionId).snapshot.status); i++)
        await pause(50);
    const record = app.runtime.get(wrapper.execution.executionId);
    const report = DeliveryReport.parse(app.delivery.report(wrapper.execution.executionId));
    return { dataDir, adapter, app, record, report, plan };
}
test('real host workspace passes, exact clean fails in a controlled locale, unified repair changes source then new workspace/ZIP clean passes without rewriting old evidence', { timeout: 180000 }, async (t) => {
    const { dataDir, adapter, record, report, plan } = await run(t);
    assert.equal(record.snapshot.status, 'succeeded', JSON.stringify(report.failure));
    assert.equal(adapter.calls, 2);
    assert.equal(record.repairRoundsUsed, 1);
    assert.equal(report.attempts.length, 2);
    assert.ok(report.attempts.every(a => a.planHash === plan.hash));
    assert.ok(report.cleanBuild!.caseResults.every(c => c.status === 'passed'));
    const receipts = report.evidence.filter(e => e.path.endsWith('round-report.json'));
    assert.equal(receipts.length, 2);
    const first = JSON.parse(await readFile(path.join(dataDir, 'executions', record.request.executionId, receipts[0].path), 'utf8'));
    assert.equal(first.cleanBuild.caseResults[0].status, 'failed');
    assert.match(first.cleanBuild.caseResults[0].failure.actual, /1,5/);
    assert.equal(first.controlledEnvironment.kind, 'trusted_test_locale');
    assert.equal(first.planHash, plan.hash);
    assert.notEqual(first.cleanBuild.sourceBeforeHash, report.cleanBuild!.sourceBeforeHash);
    for (const e of report.evidence) {
        assert.equal(sha256(await readFile(path.join(dataDir, 'executions', record.request.executionId, e.path))), e.sha256);
    }
    validateController(record.repairController!);
    assert.ok(record.repairController!.entries.some(e => e.stage === 'export_clean' && e.decision.action === 'repair'));
    assert.equal(record.repairController!.entries.at(-1)!.decision.action, 'advance');
    assert.equal(record.events.filter(e => e.event.type === 'artifact.ready').length, 1);
});
test('clean behavior failure with no remaining repair budget retains failure and never dispatches another Worker', { timeout: 120000 }, async (t) => { const { record, adapter, report } = await run(t, 'clean_repair', 0); assert.equal(record.snapshot.status, 'failed'); assert.equal(adapter.calls, 1); assert.equal(report.cleanBuild!.caseResults[0].status, 'failed'); assert.equal(report.evidence.filter(e => e.path.endsWith('round-report.json')).length, 1); assert.equal(record.snapshot.artifactId, null); });
test('same-source repair stops no-progress before another verification/export', { timeout: 120000 }, async (t) => { const { record, adapter, report } = await run(t, 'no_change'); assert.equal(record.snapshot.status, 'failed'); assert.equal(adapter.calls, 2); assert.equal(report.attempts.length, 1); assert.ok(record.repairController!.entries.some(e => e.decision.action === 'stop' && e.decision.reason === 'no_progress')); assert.equal(report.cleanBuild!.caseResults[0].status, 'failed'); });
test('actual missing Chromium at workspace verification is infrastructure, not a code-repair request', { timeout: 60000 }, async (t) => { const { record, adapter, report } = await run(t, 'clean_repair', 2, true); assert.equal(record.snapshot.status, 'failed'); assert.equal(adapter.calls, 1); assert.equal(report.cleanBuild, null); assert.ok(record.repairController!.entries.some(e => e.result?.outcome === 'failed' && e.result.failure.category === 'infrastructure' && e.decision.action === 'stop')); assert.equal(record.snapshot.artifactId, null); });
test('actual compiler process cannot launch: typed infrastructure stop occurs before any repair', { timeout: 60000 }, async (t) => { const { record, adapter } = await run(t, 'clean_repair', 2, false, 'command'); assert.equal(record.snapshot.status, 'failed'); assert.equal(adapter.calls, 1); assert.ok(record.repairController!.entries.some(e => e.result?.outcome === 'failed' && e.result.failure.category === 'infrastructure' && e.decision.action === 'stop')); });
test('actual clean install cannot launch: archive/failure evidence retained with no code-repair call', { timeout: 60000 }, async (t) => { const { record, adapter, report } = await run(t, 'clean_repair', 2, false, 'install'); assert.equal(record.snapshot.status, 'failed'); assert.equal(adapter.calls, 1); assert.equal(report.cleanBuild!.stages.install.status, 'failed'); assert.equal(report.evidence.filter(e => e.path.endsWith('round-report.json')).length, 1); assert.ok(record.repairController!.entries.some(e => e.stage === 'export_clean' && e.result?.outcome === 'failed' && e.result.failure.category === 'infrastructure' && e.decision.action === 'stop')); });
test('actual frozen-time-budget validation stops before Worker with replan_required and never silently edits the Plan', { timeout: 15000 }, async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-controller-plan-time-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const adapter = new ControllerFixtureAdapter();
    class TooShortPlanner extends ControllerFixturePlanner {
        async plan(context: import('../src/delivery-planning.js').PlanningContext) { const result = await super.plan(context); return { ...result, plan: seal({ ...result.plan, cases: result.plan.cases.map(c => ({ ...c, steps: [{ id: 'step_open_short', op: 'open_current_app' as const, timeoutMs: 5000 }, { id: 'step_save_short', op: 'save_box' as const, timeoutMs: 100, target: { by: 'test_id' as const, value: 'entity' }, variable: 'before_box' }, { id: 'step_move_short', op: 'expect_box_moved' as const, timeoutMs: 100, target: { by: 'test_id' as const, value: 'entity' }, baseline: 'before_box', dx: 20, dy: 0, tolerancePx: 2 }] })) }) }; }
    }
    const app = createAgentServer({ dataDir, mode: 'fake', serviceToken: 'short-time-synthetic', adapter, planningAdapter: new TooShortPlanner() });
    t.after(() => app.close());
    const request = structuredClone(prepareRequest);
    request.planningMode = 'model_proposed';
    request.toolchain = (await trustedTemplate()).descriptor;
    await app.planning.start(request, request.preparationId);
    for (let i = 0; i < 500 && app.planning.get(request.preparationId).snapshot.status !== 'completed'; i++)
        await pause(10);
    const prepared = app.planning.get(request.preparationId).snapshot.result!;
    const binding = seal({ ...sampleBinding, toolchain: request.toolchain, planningMode: request.planningMode, planningUsage: prepared.usage, totalBudget: request.totalBudget, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: prepared.spec.id, hash: prepared.spec.hash }, plan: { id: prepared.plan.id, hash: prepared.plan.hash } });
    const budget = { ...request.totalBudget, maxModelSteps: request.totalBudget.maxModelSteps - prepared.usage.modelSteps, maxInputTokens: request.totalBudget.maxInputTokens - prepared.usage.inputTokens!, maxOutputTokens: request.totalBudget.maxOutputTokens - prepared.usage.outputTokens!, maxWallTimeMs: request.totalBudget.maxWallTimeMs - prepared.usage.activeMs };
    await app.delivery.start({ protocolVersion: '0.1.0', execution: { ...startExecution, mode: 'build', budget }, bundle: { seed: request.seed, spec: prepared.spec, plan: prepared.plan, binding } }, request.executionId);
    for (let i = 0; i < 500 && app.runtime.get(request.executionId).snapshot.status !== 'failed'; i++)
        await pause(10);
    const record = app.runtime.get(request.executionId);
    assert.equal(record.snapshot.status, 'failed');
    assert.equal(adapter.calls, 0);
    assert.ok(record.repairController!.entries.some(e => e.stage === 'validate_frozen' && e.decision.action === 'stop' && e.decision.reason === 'replan_required'));
    assert.equal(app.delivery.report(request.executionId)!.failure!.code, 'PLAN_INVALID');
    assert.equal(app.delivery.report(request.executionId)!.bundle!.plan.hash, prepared.plan.hash);
});
