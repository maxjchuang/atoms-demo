import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { ArtifactManifest } from '@atoms/contracts';
import { FakeDshAdapter, type AdapterContext, type PlanValue } from '../src/adapters.js';
import { FakePlanningAdapter, type PlanningAdapter, type PlanningContext } from '../src/delivery-planning.js';
import { profileProposal } from '../src/trusted-template.js';
import { templateFiles, fakeApplication } from '../src/template.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareRequest, binding as sampleBinding } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
import { DeliveryExecutionSnapshot, DeliveryExecutionRequest, PlanPreparationSnapshot, ReportRead, DeliveryReport, canonicalDeliveryJson } from '@atoms/contracts/delivery';
import { createAgentServer } from '../src/runtime.js';
import { seal, assertSealed, inventoryHash } from '../src/delivery-files.js';
import { trustedTemplate, profileData } from '../src/trusted-template.js';
import { sha256 } from '../src/files.js';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t: { after: (f: () => Promise<void>) => void }, overrides: { apiInternalUrl?: string; adapter?: FakeDshAdapter; planningAdapter?: PlanningAdapter } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-m2-runtime-'));
  const app = createAgentServer({ dataDir, mode: 'fake', serviceToken: 'delivery-runtime-test-token', allowControlledRegression: true, ...overrides }); const origin = await app.listen();
  t.after(async () => { await app.close(); if (process.env.ATOMS_KEEP_AGENT_TEST_DATA === '1') console.log('Retained Fake Agent delivery evidence:', dataDir); else await rm(dataDir, { recursive: true, force: true }); });
  const call = (route: string, method = 'GET', body?: unknown) => fetch(origin + '/internal/delivery/v1' + route, { method, headers: { authorization: 'Bearer delivery-runtime-test-token', 'x-atoms-delivery-version': '0.1.0', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, dataDir, origin, call };
}
async function wait<T>(read: () => Promise<T>, done: (v: T) => boolean) {
  const end = Date.now() + 150000; while (Date.now() < end) { const value = await read(); if (done(value)) return value; await pause(50); } throw new Error('Timed out');
}
async function prepare(call: Awaited<ReturnType<typeof setup>>['call'], prompt: string, profileId = 'profile_notes_v1', input?: { kind: 'version'; versionId: string; artifactId: string; manifestSha256: string }, modelPlanning = false) {
  const request = structuredClone(prepareRequest); if (modelPlanning) request.planningMode = 'model_proposed'; request.toolchain = (await trustedTemplate()).descriptor; if (input) { request.input = input; request.baseVersionId = input.versionId; }
  request.profileHint = { id: profileId, hash: (await profileData(profileId)).hash };
  request.seed.goal = prompt; request.seed.items[0].text = prompt; request.seed = seal(request.seed);
  assert.equal((await call(`/preparations/${request.preparationId}`, 'PUT', request)).status, 201);
  const prepared = await wait(async () => PlanPreparationSnapshot.parse(await (await call(`/preparations/${request.preparationId}`)).json()), (v) => ['completed', 'failed'].includes(v.status));
  assert.equal(prepared.status, 'completed'); const { spec, plan } = prepared.result!;
  const binding = seal({ ...sampleBinding, input: request.input, baseVersionId: request.baseVersionId, toolchain: request.toolchain, planningMode: request.planningMode, totalBudget: request.totalBudget, planningUsage: prepared.result!.usage,
    seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: spec.id, hash: spec.hash }, plan: { id: plan.id, hash: plan.hash } });
  const budget = { ...request.totalBudget }; budget.maxWallTimeMs -= prepared.usage.activeMs; budget.maxModelSteps -= prepared.usage.modelSteps; budget.maxInputTokens -= prepared.usage.inputTokens!; budget.maxOutputTokens -= prepared.usage.outputTokens!;
  const wrapper = DeliveryExecutionRequest.parse({ protocolVersion: '0.1.0', execution: { ...startExecution, input: request.input, baseVersionId: request.baseVersionId, mode: 'build', prompt, budget }, bundle: { seed: request.seed, spec, plan, binding } });
  return { request, prepared, wrapper };
}

test('HTTP delivery preserves plan, observes real controlled failure then repair, and verifies exact independent export', { timeout: 180000 }, async (t) => {
  const { app, call, origin, dataDir } = await setup(t); const { request, wrapper } = await prepare(call, '创建便签墙 [controlled-persistence]');
  const route = `/executions/${request.executionId}`;
  const tampered = structuredClone(wrapper); tampered.execution.input = { kind: 'version', versionId: 'version_other', artifactId: 'artifact_other', manifestSha256: 'a'.repeat(64) };
  assert.equal((await call(route, 'PUT', tampered)).status, 400, 'cannot replace frozen source artifact');
  assert.equal((await call(route, 'PUT', wrapper)).status, 201); assert.equal((await call(route, 'PUT', wrapper)).status, 200);
  assert.equal((await call(`/preparations/${request.preparationId}/cancel`, 'POST', { commandId: 'command_late_cancel' })).status, 409);
  const completed = await wait(async () => DeliveryExecutionSnapshot.parse(await (await call(route)).json()), (v) => ['succeeded', 'failed'].includes(v.execution.status));
  const read = ReportRead.parse(await (await call(route + '/report')).json()); assert.equal(read.state, 'available'); if (read.state !== 'available') throw new Error('No report');
  const report = DeliveryReport.parse(read.report); assertSealed(report);
  assert.equal(completed.execution.status, 'succeeded', JSON.stringify({ error: report.failure, quality: report.quality, attempts: report.attempts.map((a) => ({ status: a.status, cases: a.caseResults.filter((c) => c.status !== 'passed') })), clean: report.cleanBuild }));
  assert.equal(report.quality, 'complete'); assert.equal(report.attempts.length, 2); assert.equal(report.attempts[0].sourceProvenance?.kind, 'controlled_regression');
  assert.equal(report.attempts[0].caseResults.find((entry) => entry.caseId === 'case_persist')!.status, 'failed');
  assert.ok(report.attempts[1].caseResults.every((entry) => entry.status === 'passed')); assert.equal(report.attempts[1].sourceProvenance?.kind, 'model_output');
  assert.ok(report.attempts.every((entry) => entry.planHash === wrapper.bundle.plan.hash && entry.sourceBeforeHash === entry.sourceAfterHash));
  assert.ok(Object.values(report.cleanBuild!.stages).every((entry) => entry.status === 'passed')); assert.ok(report.cleanBuild!.caseResults.every((entry) => entry.status === 'passed'));
  assert.equal(completed.cumulativeUsage.modelSteps, 2, 'host planning zero and two Fake Worker generations; no budget reset');
  assert.equal(completed.cumulativeUsage.inputTokens, 0); assert.ok(completed.cumulativeUsage.activeMs > report.bundle!.binding.planningUsage.activeMs);
  const archive = Buffer.from(await (await call(route + `/export/${report.exportManifest!.archive.id}`)).arrayBuffer()); assert.equal(sha256(archive), report.exportManifest!.archive.sha256);
  for (const evidence of report.evidence) assert.equal(sha256(Buffer.from(await (await call(route + `/evidence/${evidence.id}`)).arrayBuffer())), evidence.sha256);
  const candidate = app.runtime.get(request.executionId).snapshot.artifactId!;
  const response = await fetch(`${origin}/internal/v1/executions/${request.executionId}/artifacts/${candidate}/manifest`, { headers: { authorization: 'Bearer delivery-runtime-test-token', 'x-atoms-protocol-version': '0.1.0' } });
  assert.equal(response.status, 200); const manifest = await response.json() as { files: { path: string; sha256: string }[] };
  assert.equal(manifest.files.find((entry) => entry.path === 'source/pnpm-lock.yaml')!.sha256, wrapper.bundle.binding.toolchain.lockfileHash);
  assert.ok(manifest.files.some((entry) => entry.path === 'evidence/delivery-report.json'));
  const fullManifest = ArtifactManifest.parse(manifest); assert.equal(report.attempts.at(-1)!.distHash, inventoryHash(fullManifest.files.filter((entry) => entry.path.startsWith('dist/'))));
  const logs = await readFile(path.join(dataDir, 'executions', request.executionId, 'evidence/clean/install.log'), 'utf8'); assert.match(logs, /Done|Already/);
});

test('completed preparation can be cancelled without starting a Worker or changing immutable result', async (t) => {
  const { app, call } = await setup(t); const { request, prepared, wrapper } = await prepare(call, '创建便签墙');
  await call(`/preparations/${request.preparationId}/cancel`, 'POST', { commandId: 'command_pre_dispatch' });
  const after = await (await call(`/preparations/${request.preparationId}`)).json(); assert.equal(canonicalDeliveryJson(after), canonicalDeliveryJson(prepared));
  const read = ReportRead.parse(await (await call(`/preparations/${request.preparationId}/report`)).json()); if (read.state !== 'available') throw new Error('No cancellation report');
  assert.equal(read.report.lifecycle, 'cancelled'); assert.equal(read.report.bundle, null); assert.equal(read.report.attempts.length, 0);
  assert.equal((await call(`/executions/${request.executionId}`, 'PUT', wrapper)).status, 409); assert.equal(app.runtime.records.size, 0);
});

test('M2 edits a hash-verified legacy artifact without a lock/report, preserves user code and upgrades only candidate toolchain', { timeout: 180000 }, async (t) => {
  const files = new Map<string, Buffer>();
  for (const [name, text] of Object.entries({ ...templateFiles, ...fakeApplication('project_demo', '搜索'), 'src/user-module.ts': 'export const userOwned = "legacy-user-owned-keep";\n' })) files.set('source/' + name, Buffer.from(text));
  files.set('dist/index.html', Buffer.from('<!doctype html><div>legacy fixture; no new delivery verification claimed</div>'));
  const checks = ['typecheck', 'build', 'smoke'].map((kind) => { files.set(`evidence/${kind}.log`, Buffer.from('Synthetic legacy input fixture only.'));
    return { id: `check_${kind}`, kind, name: kind, required: true, status: 'passed', summary: 'Legacy fixture metadata, not M2 verification evidence.', evidenceIds: [`evidence_${kind}`] }; });
  const manifest = ArtifactManifest.parse({ protocolVersion: '0.1.0', id: 'artifact_legacy', executionId: 'execution_legacy', runId: 'run_legacy', baseVersionId: null, summary: 'Legacy input fixture with actual content fingerprints.',
    files: [...files].map(([path, value]) => ({ path, bytes: value.length, sha256: sha256(value), mediaType: path.endsWith('.html') ? 'text/html' : 'text/plain' })), checks,
    evidence: checks.map((entry) => ({ id: entry.evidenceIds[0], path: `evidence/${entry.kind}.log`, kind: 'log' })), createdAt: new Date().toISOString() });
  const raw = Buffer.from(JSON.stringify(manifest)); const requested: string[] = [];
  const inputService = createServer((req, res) => { const url = new URL(req.url!, 'http://input');
    if (req.headers.authorization !== 'Bearer delivery-runtime-test-token' || req.headers['x-atoms-protocol-version'] !== '0.1.0') { res.writeHead(401).end(); return; }
    requested.push(url.pathname + url.search);
    if (url.pathname === '/internal/v1/input-artifacts/artifact_legacy/manifest') { res.end(raw); return; }
    const file = url.pathname === '/internal/v1/input-artifacts/artifact_legacy/file' ? files.get(url.searchParams.get('path')!) : null;
    if (!file) { res.writeHead(404).end(); return; } res.end(file);
  });
  await new Promise<void>((resolve) => inputService.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>((resolve) => inputService.close(() => resolve())));
  const address = inputService.address(); if (!address || typeof address === 'string') throw new Error('No input origin');
  let observed = 0;
  class PreservingFake extends FakeDshAdapter {
    override async generate(context: AdapterContext, plan: PlanValue, errors?: string) {
      assert.match(await readFile(path.join(context.workspace, 'src/user-module.ts'), 'utf8'), /legacy-user-owned-keep/);
      assert.equal(sha256(await readFile(path.join(context.workspace, 'package.json'))), (await trustedTemplate()).descriptor.packageJsonHash);
      observed++; return super.generate(context, plan, errors);
    }
  }
  const oldPackage = files.get('source/package.json')!.toString();
  const { app, call } = await setup(t, { apiInternalUrl: `http://127.0.0.1:${address.port}`, adapter: new PreservingFake() });
  const { request, wrapper } = await prepare(call, '为已有便签保留搜索功能', 'profile_notes_v1', { kind: 'version', versionId: 'version_legacy', artifactId: 'artifact_legacy', manifestSha256: sha256(raw) });
  const route = `/executions/${request.executionId}`; assert.equal((await call(route, 'PUT', wrapper)).status, 201);
  const completed = await wait(async () => DeliveryExecutionSnapshot.parse(await (await call(route)).json()), (value) => ['succeeded', 'failed'].includes(value.execution.status));
  const report = app.delivery.report(request.executionId)!; assert.equal(completed.execution.status, 'succeeded', JSON.stringify(report.failure)); assert.equal(observed, 1);
  const artifactId = completed.execution.artifactId!;
  const candidate = ArtifactManifest.parse(JSON.parse((await app.runtime.artifact(request.executionId, artifactId, 'manifest.json')).toString()));
  assert.ok(candidate.files.some((entry) => entry.path === 'source/pnpm-lock.yaml')); assert.equal(candidate.files.find((entry) => entry.path === 'source/src/user-module.ts')!.sha256, sha256(files.get('source/src/user-module.ts')!));
  assert.equal(files.get('source/package.json')!.toString(), oldPackage); assert.equal(sha256(raw), request.input.kind === 'version' ? request.input.manifestSha256 : '');
  assert.ok(requested.some((entry) => entry.includes('/manifest'))); assert.ok(requested.some((entry) => entry.includes('user-module')));
  assert.equal(report.bundle!.binding.baseVersionId, 'version_legacy'); assert.ok(report.cleanBuild!.caseResults.every((entry) => entry.status === 'passed'));
  const rejected = await setup(t, { apiInternalUrl: `http://127.0.0.1:${address.port}`, adapter: new PreservingFake() });
  const bad = await prepare(rejected.call, '编辑旧版便签', 'profile_notes_v1', { kind: 'version', versionId: 'version_legacy', artifactId: 'artifact_legacy', manifestSha256: 'a'.repeat(64) });
  await rejected.call(`/executions/${bad.request.executionId}`, 'PUT', bad.wrapper);
  const stopped = await wait(async () => DeliveryExecutionSnapshot.parse(await (await rejected.call(`/executions/${bad.request.executionId}`)).json()), (value) => value.execution.status === 'failed');
  assert.equal(stopped.execution.artifactId, null); assert.equal(rejected.app.runtime.get(bad.request.executionId).events.filter((event) => event.event.type === 'execution.started').length, 0, 'input integrity failure cannot claim a billable start'); assert.equal(observed, 1, 'tampered manifest never reaches source generation');
  assert.equal(rejected.app.delivery.report(bad.request.executionId)!.quality, 'blocked');

});

test('required unsupported declarations remain partial and can form a candidate without inventing behavior passes', { timeout: 180000 }, async (t) => {
  class UnsupportedPlanner extends FakePlanningAdapter {
    override async plan(context: PlanningContext) {
      context.meter({ modelSteps: 1, inputTokens: 0, outputTokens: 0 }); const proposed = await profileProposal(context.request, 'profile_notes_v1');
      const plan = seal({ ...proposed.plan, cases: [], coverage: proposed.spec.criteria.map((criterion) => ({ criterionId: criterion.id, method: 'unsupported' as const, caseIds: [], reason: 'Explicit Fake planning fixture has no automatic coverage.' })) });
      return { spec: proposed.spec, plan };
    }
  }
  const { app, call } = await setup(t, { planningAdapter: new UnsupportedPlanner() });
  const { request, wrapper } = await prepare(call, '实现便签，复杂声明保留待人工检查', 'profile_notes_v1', undefined, true);
  const route = `/executions/${request.executionId}`; assert.equal((await call(route, 'PUT', wrapper)).status, 201);
  const done = await wait(async () => DeliveryExecutionSnapshot.parse(await (await call(route)).json()), (entry) => ['succeeded', 'failed'].includes(entry.execution.status));
  const report = app.delivery.report(request.executionId)!; assert.equal(done.execution.status, 'succeeded', JSON.stringify(report.failure));
  assert.equal(report.quality, 'partial'); assert.equal(report.gaps.length, wrapper.bundle.spec.criteria.length); assert.ok(report.gaps.every((gap) => gap.required && gap.coverage === 'unsupported' && gap.result === 'not_run'));
  assert.equal(report.attempts[0].caseResults.length, 0); assert.equal(done.cumulativeUsage.modelSteps, 2, 'one explicit Fake prepare step plus one generation');
  const manifest = ArtifactManifest.parse(JSON.parse((await app.runtime.artifact(request.executionId, done.execution.artifactId!, 'manifest.json')).toString()));
  assert.equal(manifest.checks.find((entry) => entry.kind === 'behavior')!.status, 'not_run');
});
