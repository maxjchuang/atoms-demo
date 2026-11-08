import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { prepareRequest, binding as fixtureBinding } from '@atoms/contracts/delivery-fixtures';
import { FrozenDeliveryBundle } from '@atoms/contracts/delivery';
import { trustedTemplate, profileData, profileProposal } from '../src/trusted-template.js';
import { seal, assertSealed, inventoryHash } from '../src/delivery-files.js';
import { putFile, sha256 } from '../src/files.js';
import { fakeCalculatorFiles } from '../src/delivery-examples.js';
import { exportAndVerify, verifyArchive } from '../src/delivery-export.js';

test('exact portable ZIP installs independently, builds and replays the same generic calculator plan', { timeout: 180000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-clean-export-')); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace); const template = await trustedTemplate();
  for (const [name, content] of Object.entries({ ...template.files, ...fakeCalculatorFiles })) await putFile(workspace, name, content);
  const request = structuredClone(prepareRequest); request.toolchain = template.descriptor; request.profileHint = { id: 'profile_calculator_v1', hash: (await profileData('profile_calculator_v1')).hash };
  const { spec, plan } = await profileProposal(request, 'profile_calculator_v1');
  const binding = seal({ ...fixtureBinding, toolchain: template.descriptor, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: spec.id, hash: spec.hash }, plan: { id: plan.id, hash: plan.hash } });
  const bundle = FrozenDeliveryBundle.parse({ seed: request.seed, spec, plan, binding });
  const result = await exportAndVerify({ workspace, root: path.join(root, 'export'), bundle, signal: new AbortController().signal, activity: () => {} });
  assertSealed(result.exported); assertSealed(result.clean);
  assert.ok(Object.values(result.clean.stages).every((entry) => entry.status === 'passed'), JSON.stringify(result.clean.stages) + ' ' + await readFile(path.join(root, 'export/evidence/clean/failure.log'), 'utf8').catch(() => ''));
  assert.ok(result.clean.caseResults.every((entry) => entry.status === 'passed'));
  assert.equal(result.clean.sourceBeforeHash, result.clean.sourceAfterHash); assert.equal(result.clean.usedPlatformSymlinks, false);
  const entries = unzipSync(result.archive); assert.ok(entries['source/pnpm-lock.yaml']); assert.ok(entries['contents-manifest.json']);
  assert.equal(sha256(entries['contents-manifest.json']), result.exported.contentsManifestHash);
  assert.deepEqual(Object.keys(entries).sort(), [...result.exported.files.map((entry) => entry.path), 'contents-manifest.json'].sort());
  const wrongPlan = seal({ ...bundle.plan, revision: bundle.plan.revision + 1 });
  const wrongBinding = seal({ ...bundle.binding, plan: { id: wrongPlan.id, hash: wrongPlan.hash } });
  const wrong = await verifyArchive({ root: path.join(root, 'wrong-plan'), bundle: { ...bundle, plan: wrongPlan, binding: wrongBinding }, exported: result.exported, archive: result.archive, signal: new AbortController().signal, activity: () => {} });
  assert.equal(wrong.clean.stages.install.status, 'failed'); assert.equal(wrong.clean.distHash, null);
  // A genuinely broken calculator in a new exact ZIP still builds; same frozen behavioral assertions fail.
  await putFile(workspace, 'src/App.tsx', fakeCalculatorFiles['src/App.tsx'].replace('left+right', 'left+right+1'));
  const broken = await exportAndVerify({ workspace, root: path.join(root, 'behavior-failure'), bundle, signal: new AbortController().signal, activity: () => {} });
  assert.ok(Object.values(broken.clean.stages).every((entry) => entry.status === 'passed'));
  assert.equal(broken.clean.caseResults.find((entry) => entry.caseId === 'case_addition')!.status, 'failed');

  // A corrupted exact archive cannot install or become deliverable, even if a caller changes its outer archive hash.
  delete entries['source/pnpm-lock.yaml']; const corrupted = zipSync(entries); const badExport = seal({ ...result.exported, archive: { ...result.exported.archive, bytes: corrupted.length, sha256: sha256(corrupted) } });
  const bad = await verifyArchive({ root: path.join(root, 'corrupt'), bundle, exported: badExport, archive: corrupted, signal: new AbortController().signal, activity: () => {} });
  assert.equal(bad.clean.stages.install.status, 'failed'); assert.equal(bad.clean.distHash, null);
  assert.match(await readFile(path.join(root, 'corrupt/evidence/clean/install.log'), 'utf8'), /entries|manifest/);
});
