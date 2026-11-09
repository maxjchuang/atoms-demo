import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentServer } from '../src/runtime.js';
import { ControllerFixturePlanner, ControllerFixtureAdapter } from './helpers/controller-fixture.js';
import type { PlanningContext } from '../src/delivery-planning.js';
import { seal } from '../src/delivery-files.js';
import { trustedTemplate } from '../src/trusted-template.js';
import { prepareRequest, binding as sample } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
test('actual legacy multi-interaction frozen geometry is replan-required before any Worker, preserving exact Plan', { timeout: 15000 }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-frozen-geometry-boundary-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const adapter = new ControllerFixtureAdapter();
    class AmbiguousPlanner extends ControllerFixturePlanner {
        async plan(context: PlanningContext) { const r = await super.plan(context); const target = { by: 'test_id' as const, value: 'actual_entity' }, button = { by: 'role' as const, role: 'button' as const, name: 'Initialize', exact: true }; return { ...r, plan: seal({ ...r.plan, cases: r.plan.cases.map(c => ({ ...c, steps: [{ id: 'open', op: 'open_current_app' as const, timeoutMs: 5000 }, { id: 'baseline', op: 'save_box' as const, timeoutMs: 5000, target, variable: 'before_box' }, { id: 'initialization_late', op: 'click' as const, timeoutMs: 5000, target: button }, { id: 'effect', op: 'press' as const, timeoutMs: 5000, target, key: 'ArrowRight' as const }, { id: 'observation', op: 'expect_box_moved' as const, timeoutMs: 5000, target, baseline: 'before_box', dx: 20, dy: 0, tolerancePx: 4 }] })) }) }; }
    }
    const app = createAgentServer({ dataDir: root, mode: 'fake', serviceToken: 'geometry-gate-unit-only', adapter, planningAdapter: new AmbiguousPlanner() });
    t.after(() => app.close());
    const request = structuredClone(prepareRequest);
    request.planningMode = 'model_proposed';
    request.toolchain = (await trustedTemplate()).descriptor;
    await app.planning.start(request, request.preparationId);
    for (let i = 0; i < 500 && app.planning.get(request.preparationId).snapshot.status !== 'completed'; i++)
        await new Promise(r => setTimeout(r, 10));
    const result = app.planning.get(request.preparationId).snapshot.result!;
    const binding = seal({ ...sample, toolchain: request.toolchain, planningMode: request.planningMode, totalBudget: request.totalBudget, planningUsage: result.usage, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: result.spec.id, hash: result.spec.hash }, plan: { id: result.plan.id, hash: result.plan.hash } });
    const budget = { ...request.totalBudget, maxModelSteps: request.totalBudget.maxModelSteps - result.usage.modelSteps, maxInputTokens: request.totalBudget.maxInputTokens - result.usage.inputTokens!, maxOutputTokens: request.totalBudget.maxOutputTokens - result.usage.outputTokens!, maxWallTimeMs: request.totalBudget.maxWallTimeMs - result.usage.activeMs };
    await app.delivery.start({ protocolVersion: '0.1.0', execution: { ...startExecution, mode: 'build', budget }, bundle: { seed: request.seed, spec: result.spec, plan: result.plan, binding } }, request.executionId);
    for (let i = 0; i < 500 && app.runtime.get(request.executionId).snapshot.status !== 'failed'; i++)
        await new Promise(r => setTimeout(r, 10));
    const record = app.runtime.get(request.executionId);
    assert.equal(record.snapshot.status, 'failed');
    assert.equal(adapter.calls, 0);
    assert.ok(record.repairController!.entries.some(e => e.stage === 'validate_frozen' && e.decision.action === 'stop' && e.decision.reason === 'replan_required'));
    const report = app.delivery.report(request.executionId)!;
    assert.equal(report.failure!.code, 'PLAN_INVALID');
    assert.equal(report.bundle!.plan.hash, result.plan.hash);
    assert.equal(report.attempts.length, 0);
    assert.equal(record.snapshot.artifactId, null);
});
