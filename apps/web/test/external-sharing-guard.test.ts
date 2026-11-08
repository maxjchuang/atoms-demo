import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExternalSharingConfig, externalRequestAllowed, safeExternalPath, readProtectedReviewerCode } from '../scripts/external-sharing-guard';
const env = { ATOMS_ALLOW_EXTERNAL_SHARING_AUDIT: '1', ATOMS_EXTERNAL_OS_GATE: 'accepted', ATOMS_EXTERNAL_WORKBENCH_ORIGIN: 'https://workbench-approved.trycloudflare.com', ATOMS_EXTERNAL_PREVIEW_ORIGIN: 'https://preview-approved.trycloudflare.com', ATOMS_EXTERNAL_PROJECT_ID: 'project_existing', ATOMS_EXTERNAL_VERSION_ID: 'version_existing', ATOMS_EXTERNAL_CODE_FILE: '/private/runtime/reviewer-code', ATOMS_EXTERNAL_APP_ADD_SELECTOR: '#add-note', ATOMS_EXTERNAL_APP_EDITOR_SELECTOR: 'textarea' };
test('external audit is explicitly opted-in, two exact HTTPS hosts and approved existing subjects only', () => {
  const config = readExternalSharingConfig(env); assert.equal(config.workbenchOrigin, env.ATOMS_EXTERNAL_WORKBENCH_ORIGIN);
  for (const values of [{ ATOMS_ALLOW_EXTERNAL_SHARING_AUDIT: '0' }, { ATOMS_EXTERNAL_OS_GATE: '' }, { ATOMS_EXTERNAL_WORKBENCH_ORIGIN: 'http://localhost:5173' }, { ATOMS_EXTERNAL_WORKBENCH_ORIGIN: 'https://127.0.0.1/' }, { ATOMS_EXTERNAL_WORKBENCH_ORIGIN: env.ATOMS_EXTERNAL_PREVIEW_ORIGIN }, { ATOMS_EXTERNAL_WORKBENCH_ORIGIN: env.ATOMS_EXTERNAL_WORKBENCH_ORIGIN + '/?token=private' }, { ATOMS_EXTERNAL_CODE_FILE: '' }, { ATOMS_EXTERNAL_VERSION_ID: '' }]) assert.throws(() => readExternalSharingConfig({ ...env, ...values }));
});
test('reviewer code read requires nonsymlink regular current-owner exact0600 before any network; errors omit path/content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-reviewer-file-')), path = join(directory, 'reviewer-code'), dummy = 'synthetic_reviewer_code';
  const original = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected network'); };
  try {
    await writeFile(path, `${dummy}\n`, { mode: 0o600 }); await chmod(path, 0o600);
    assert.equal(await readProtectedReviewerCode(path), dummy);
    for (const mode of [0o400, 0o640]) {
      await chmod(path, mode);
      await assert.rejects(readProtectedReviewerCode(path), (error: unknown) => error instanceof Error && /exact 0600/.test(error.message) && !error.message.includes(path) && !error.message.includes(dummy));
    }
    await chmod(path, 0o600); const link = join(directory, 'symlink-code'); await symlink(path, link);
    const folder = join(directory, 'directory-code'); await mkdir(folder, { mode: 0o700 });
    for (const invalid of [link, folder, join(directory, 'missing')]) await assert.rejects(readProtectedReviewerCode(invalid), (error: unknown) => error instanceof Error && !error.message.includes(directory) && !error.message.includes(dummy));
    await writeFile(path, 'bad content with spaces');
    await assert.rejects(readProtectedReviewerCode(path), /exact 0600/);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
test('external audit allows only exact login and typed sharing mint writes, never business/model work or a third host', () => {
  const config = readExternalSharingConfig(env), previewBody = JSON.stringify({ kind: 'app_preview', versionId: config.versionId, expectedDeploymentInstanceId: 'deployment_existing' });
  assert.equal(externalRequestAllowed('POST', `${config.workbenchOrigin}/api/v1/sessions`, config, '{}'), true);
  assert.equal(externalRequestAllowed('POST', `${config.workbenchOrigin}/api/sharing/v1/projects/${config.projectId}/resolve`, config, previewBody), true);
  for (const path of ['/api/v2/projects/project_existing/messages', '/api/v1/projects/project_existing/runs', '/api/v1/projects/project_existing/restore', '/internal/v1/executions/execution_existing']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(externalRequestAllowed(method, config.workbenchOrigin + path, config, previewBody), false);
  assert.equal(externalRequestAllowed('GET', 'https://not-allowed.trycloudflare.com/', config), false);
  assert.equal(externalRequestAllowed('GET', config.workbenchOrigin + '/__mock/sharing/seed', config), false);
  assert.equal(externalRequestAllowed('POST', `${config.workbenchOrigin}/api/sharing/v1/projects/${config.projectId}/resolve`, config, previewBody.replace('version_existing', 'version_foreign')), false);
  assert.equal(externalRequestAllowed('GET', config.workbenchOrigin + '/internal/v1/health', config), true, 'Real negative probe may reach gateway, which must reject it.');
  assert.deepEqual(safeExternalPath(`${config.previewOrigin}/p/private.signature/assets/index.js?secret=x`), { origin: config.previewOrigin, path: '/p/[redacted]/assets/index.js' });
});
