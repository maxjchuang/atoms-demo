import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAgentServer } from '../src/runtime.js';
import { FakeDshAdapter, type AdapterContext, type PlanValue } from '../src/adapters.js';
import { applySourceEdit } from '../src/source-edits.js';
import { ControllerFixturePlanner } from './helpers/controller-fixture.js';
import { compactRepairFeedback } from '../src/worker-context.js';
import { verifyApplication, knownSourceTypeErrors } from '../src/verify.js';
import { trustedTemplate } from '../src/trusted-template.js';
import { putFile } from '../src/files.js';
import { seal } from '../src/delivery-files.js';
import { prepareRequest, binding as sampleBinding } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
import { DeliveryReport, VerificationAttempt } from '@atoms/contracts/delivery';
const main = `import React from 'react';import{createRoot}from'react-dom/client';import App from './App';createRoot(document.getElementById('root')!).render(<App/>);`;
function appSource(typeBad: boolean, value: string) { return `export default function App(){const value:number=${typeBad ? "'" + value + "'" : value};return <main><output aria-label="Locale result">{value}</output></main>}`; }
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function execute(t: any, repairLimit: number) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-diagnostic-dag-'));
    if (process.env.ATOMS_KEEP_AGENT_TEST_DATA !== '1')
        t.after(() => rm(dataDir, { recursive: true, force: true }));
    else
        t.diagnostic('DAG evidence: ' + dataDir);
    let calls = 0;
    let completeFeedback = false;
    class Adapter extends FakeDshAdapter {
        async generate(context: AdapterContext, _plan: PlanValue, errors?: string) {
            calls++;
            context.meter({ modelSteps: 1, inputTokens: 0, outputTokens: 0 });
            if (errors) {
                const f = JSON.parse(compactRepairFeedback(errors, context.passedCaseIds));
                completeFeedback = f.checks.some((c: any) => c.kind === 'typecheck' && c.message.includes('TS2322')) && f.failures.some((c: any) => c.caseId === 'case_1' && c.actual.value.sample === '2.5' && c.expected.value === '1.5');
            }
            const files = { 'src/main.tsx': main, 'src/App.tsx': appSource(!errors, errors || repairLimit === 0 ? '1.5' : '2.5') };
            for (const [name, text] of Object.entries(files))
                await applySourceEdit(context.workspace, name, text, context.fileChanged);
            return 'Synthetic typed+behavior diagnosis fixture';
        }
    }
    const adapter = new Adapter();
    const app = createAgentServer({ dataDir, mode: 'fake', serviceToken: 'dag-synthetic-only', adapter, planningAdapter: new ControllerFixturePlanner() });
    t.after(() => app.close());
    const request = structuredClone(prepareRequest);
    request.planningMode = 'model_proposed';
    request.totalBudget.maxRepairRounds = repairLimit;
    request.toolchain = (await trustedTemplate()).descriptor;
    request.seed.goal = 'Display fixed decimal 1.5 with a sound typed implementation.';
    request.seed = seal({ ...request.seed, items: request.seed.items.map(s => ({ ...s, text: request.seed.goal })) });
    await app.planning.start(request, request.preparationId);
    for (let i = 0; i < 500 && app.planning.get(request.preparationId).snapshot.status !== 'completed'; i++)
        await pause(10);
    const p = app.planning.get(request.preparationId).snapshot.result!;
    const binding = seal({ ...sampleBinding, toolchain: request.toolchain, planningMode: request.planningMode, totalBudget: request.totalBudget, planningUsage: p.usage, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: p.spec.id, hash: p.spec.hash }, plan: { id: p.plan.id, hash: p.plan.hash } });
    const budget = { ...request.totalBudget, maxModelSteps: request.totalBudget.maxModelSteps - p.usage.modelSteps, maxInputTokens: request.totalBudget.maxInputTokens - p.usage.inputTokens!, maxOutputTokens: request.totalBudget.maxOutputTokens - p.usage.outputTokens!, maxWallTimeMs: request.totalBudget.maxWallTimeMs - p.usage.activeMs };
    await app.delivery.start({ protocolVersion: '0.1.0', execution: { ...startExecution, mode: 'build', prompt: request.seed.goal, budget }, bundle: { seed: request.seed, spec: p.spec, plan: p.plan, binding } }, request.executionId);
    for (let i = 0; i < 4000 && !['succeeded', 'failed'].includes(app.runtime.get(request.executionId).snapshot.status); i++)
        await pause(50);
    return { dataDir, app, calls, completeFeedback, record: app.runtime.get(request.executionId), report: DeliveryReport.parse(app.delivery.report(request.executionId)) };
}
test('actual main workflow aggregates TS code error plus fresh-build browser failure before one repair; final type/build/smoke/behavior/ZIP all pass', { timeout: 180000 }, async (t) => { const { record, report, calls, completeFeedback } = await execute(t, 2); assert.equal(record.snapshot.status, 'succeeded', JSON.stringify(report.failure)); assert.equal(calls, 2); assert.equal(completeFeedback, true); const first = VerificationAttempt.parse(report.attempts[0]); assert.equal(first.checks.typecheck.status, 'failed'); assert.equal(first.checks.build.status, 'passed'); assert.equal(first.checks.smoke.status, 'passed'); assert.equal(first.caseResults[0].status, 'failed'); assert.ok(first.distHash); assert.equal(report.attempts[1].checks.typecheck.status, 'passed'); assert.equal(report.cleanBuild!.caseResults[0].status, 'passed'); });
test('diagnostic behavior may pass but a failed required type gate can never publish', { timeout: 60000 }, async (t) => { const { record, report, calls } = await execute(t, 0); assert.equal(calls, 1); assert.equal(record.snapshot.status, 'failed'); assert.equal(report.attempts[0].caseResults[0].status, 'passed'); assert.equal(report.attempts[0].checks.typecheck.status, 'failed'); assert.equal(report.quality, 'blocked'); assert.equal(record.snapshot.artifactId, null); assert.equal(report.cleanBuild, null); });
async function workspace(t: any) { const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-dag-dependency-')); t.after(() => rm(root, { recursive: true, force: true })); const source = path.join(root, 'source'); await mkdir(source); const template = await trustedTemplate(); for (const [name, text] of Object.entries(template.files))
    await putFile(source, name, text); await putFile(source, 'src/main.tsx', main); await putFile(source, 'src/App.tsx', appSource(true, '2.5')); return { root, source, template }; }
test('fresh build failure never falls back to a stale dist; dependent browser stages are not run', { timeout: 60000 }, async (t) => { const { root, source, template } = await workspace(t); await putFile(source, 'src/main.tsx', `import Missing from './not_present';console.log(Missing);`); await mkdir(path.join(source, 'dist')); await writeFile(path.join(source, 'dist/index.html'), 'STALE_SENTINEL'); const result = await verifyApplication(source, path.join(root, 'evidence'), new AbortController().signal, () => { }, () => { }, { trustedConfigFiles: template.files }); assert.equal(result.diagnosticDistReady, false); assert.equal(result.checks.find(c => c.kind === 'typecheck')!.status, 'failed'); assert.equal(result.checks.find(c => c.kind === 'build')!.status, 'failed'); assert.ok(!result.checks.some(c => c.kind === 'smoke')); assert.equal(existsSync(path.join(source, 'dist/index.html')), false); assert.equal(existsSync(path.join(root, 'evidence/smoke.log')), false); });
test('cancel after TS result cannot dispatch the diagnostic build/browser or touch stale outputs', { timeout: 60000 }, async (t) => { const { root, source, template } = await workspace(t); await mkdir(path.join(source, 'dist')); await writeFile(path.join(source, 'dist/index.html'), 'STALE_CANCELLED'); const controller = new AbortController(); const checks: string[] = []; await assert.rejects(verifyApplication(source, path.join(root, 'evidence'), controller.signal, c => { checks.push(c.kind); controller.abort('cancel'); }, () => { }, { trustedConfigFiles: template.files }), /aborted/); assert.deepEqual(checks, ['typecheck']); assert.equal(await readFile(path.join(source, 'dist/index.html'), 'utf8'), 'STALE_CANCELLED'); assert.equal(existsSync(path.join(root, 'evidence/build.log')), false); });
test('only controlled-source TS diagnostic headers permit aggregation; global/mixed toolchain diagnostics fail closed', () => { assert.equal(knownSourceTypeErrors("src/Component.tsx(7,3): error TS2345: incompatible value\n  Explanation"), true); assert.equal(knownSourceTypeErrors("error TS2688: Cannot find type definition file"), false); assert.equal(knownSourceTypeErrors("src/Component.tsx(7,3): error TS2345: bad\nnode_modules/types/index.d.ts(1,1): error TS2304: missing dependency"), false); assert.equal(knownSourceTypeErrors("Cannot start type checker"), false); });
