import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { runBrowserPlan } from '../src/browser-dsl.js';
import { trustedTemplate, profileData, profileProposal } from '../src/trusted-template.js';
import { fakeApplication } from '../src/template.js';
import { fakeCalculatorFiles } from '../src/delivery-examples.js';
import { putFile } from '../src/files.js';
import { verifyApplication } from '../src/verify.js';
import { fingerprints, inventoryHash, seal } from '../src/delivery-files.js';

for (const profileId of ['profile_notes_v1', 'profile_calculator_v1']) test(`real browser executes shared interpreter for ${profileId}`, { timeout: 60000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atoms-dsl-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'source'); await mkdir(workspace); const template = await trustedTemplate();
  for (const [name, content] of Object.entries(template.files)) await putFile(workspace, name, content);
  for (const [name, content] of Object.entries(profileId === 'profile_notes_v1' ? fakeApplication('project_dsl', '搜索') : fakeCalculatorFiles)) await putFile(workspace, name, content);
  const built = await verifyApplication(workspace, path.join(dir, 'baseline'), new AbortController().signal, () => {});
  assert.equal(built.errors, null);
  const request = structuredClone(prepareRequest); request.toolchain = template.descriptor;
  request.profileHint = { id: profileId, hash: (await profileData(profileId)).hash };
  const { plan } = await profileProposal(request, profileId); const before = inventoryHash(await fingerprints(workspace, 'source/'));
  const result = await runBrowserPlan({ dist: path.join(workspace, 'dist'), plan, evidenceDir: path.join(dir, 'behavior'), signal: new AbortController().signal });
  assert.equal(result.caseResults.length, profileId === 'profile_notes_v1' ? 6 : 2);
  assert.ok(result.caseResults.every((entry) => entry.status === 'passed'), JSON.stringify(result.caseResults.filter((entry) => entry.status !== 'passed')));
  assert.equal(inventoryHash(await fingerprints(workspace, 'source/')), before);
  assert.ok(result.files.some((file) => file.kind === 'screenshot'));
});

test('unsafe DSL is rejected before opening any browser or external target', async () => {
  const { profileData: readProfile } = await import('../src/trusted-template.js');
  const request = structuredClone(prepareRequest); request.profileHint = { id: 'profile_notes_v1', hash: (await readProfile('profile_notes_v1')).hash };
  const { plan } = await profileProposal(request, 'profile_notes_v1');
  const bad = { ...plan, cases: [{ ...plan.cases[0], steps: [{ id: 'step_eval', op: 'evaluate', code: 'process.env' }] }] };
  await assert.rejects(runBrowserPlan({ dist: '/does-not-exist', plan: bad as never, evidenceDir: '/does-not-exist', signal: new AbortController().signal }));
});

test('real browser blocks outbound/frame access and records bounded assertion failure', { timeout: 20000 }, async (t) => {
  const { createServer } = await import('node:http'); let outbound = 0;
  const remote = createServer((_req, res) => { outbound++; res.end('forbidden'); }); await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => remote.close(() => resolve()))); const address = remote.address(); if (!address || typeof address === 'string') throw new Error('Missing remote');
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-dsl-boundary-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><div data-testid="result">Ready</div><script src="./boundary.js"></script>');
  await writeFile(path.join(root, 'boundary.js'), `fetch('http://127.0.0.1:${address.port}/secret').catch(()=>{});const f=document.createElement('iframe');f.src='http://127.0.0.1:${address.port}/frame';document.body.append(f);`);
  const request = structuredClone(prepareRequest); request.profileHint = { id: 'profile_calculator_v1', hash: (await profileData('profile_calculator_v1')).hash };
  const { plan: base } = await profileProposal(request, 'profile_calculator_v1');
  const plan = { ...base, cases: [{ ...base.cases[0], steps: [base.cases[0].steps[0]] }], coverage: base.coverage.map((entry) => ({ ...entry, caseIds: entry.caseIds.filter((id) => id === base.cases[0].id) })) };
  const result = await runBrowserPlan({ dist: root, plan, evidenceDir: path.join(root, 'evidence'), signal: new AbortController().signal });
  assert.equal(outbound, 0); assert.equal(result.caseResults[0].status, 'failed');
  await writeFile(path.join(root, 'boundary.js'), '');
  const bounded = { ...plan, cases: [{ ...plan.cases[0], steps: [plan.cases[0].steps[0], { id: 'step_never', timeoutMs: 100, op: 'expect_text' as const, target: { by: 'test_id' as const, value: 'result' }, comparison: 'exact' as const, value: 'Never' }] }] };
  const before = Date.now(); const failed = await runBrowserPlan({ dist: root, plan: bounded, evidenceDir: path.join(root, 'bounded'), signal: new AbortController().signal });
  assert.equal(failed.caseResults[0].status, 'failed'); assert.ok(Date.now() - before < 10000);
});
