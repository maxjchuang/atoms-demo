import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixture from '@atoms/contracts/sharing-fixtures';
import { SharingProtocolVersion, ResolvedSharing } from '@atoms/contracts/sharing';
import { sharingApi, assertDescriptor, assertResolution, retryDelay, SharingError, copyLink } from '../src/sharing-api';

const origin = 'https://workbench-demo.example.test', now = Date.parse(fixture.preview.issuedAt) + 1000;
test('descriptor and resolution bind exact project, fixed version, kind and deployment epoch', () => {
  assertDescriptor(fixture.configured, fixture.configured.projectId, fixture.configured.subjectVersionId);
  assert.throws(() => assertDescriptor(fixture.configured, 'project_other', null), /不一致/);
  assert.throws(() => assertDescriptor(fixture.configured, fixture.configured.projectId, 'version_other'), /不一致/);
  assertResolution(fixture.preview, fixture.configured, 'app_preview', origin, now);
  for (const value of [{ ...fixture.preview, projectId: 'project_other' }, { ...fixture.preview, subjectVersionId: 'version_other' }, { ...fixture.preview, deploymentInstanceId: 'deployment_other' }]) assert.throws(() => assertResolution(value, fixture.configured, 'app_preview', origin, now), /不一致/);
  assert.throws(() => assertResolution(fixture.buildEntry, fixture.configured, 'app_preview', origin, now), /不一致/);
});
test('build root has exact current authority; preview uses distinct host without stale Version URL authority', () => {
  assertResolution(fixture.buildEntry, fixture.configured, 'build_entry', origin, now);
  assert.throws(() => assertResolution({ ...fixture.buildEntry, url: 'https://other.example/' }, fixture.configured, 'build_entry', origin, now), /主机边界/);
  assert.throws(() => assertResolution({ ...fixture.preview, url: fixture.preview.url.replace('preview-demo', 'workbench-demo') }, fixture.configured, 'app_preview', origin, now), /主机边界/);
  assert.throws(() => assertResolution(fixture.preview, fixture.configured, 'app_preview', origin, Date.parse(fixture.preview.expiresAt!)), /到期/);
  assertResolution({ ...fixture.preview, url: fixture.preview.url.replace('preview-demo', 'new-preview') }, fixture.configured, 'app_preview', origin, now);
  for (const url of ['javascript:alert(1)', 'https://user:pw@preview.example/p/a.b/index.html', fixture.preview.url + '?code=secret', fixture.preview.url + '#fragment', 'https://preview.example/arbitrary']) assert.equal(ResolvedSharing.safeParse({ ...fixture.preview, url }).success, false);
});
test('sharing API uses exact versioned authenticated no-store endpoints and no business mutation key cache', async () => {
  const original = globalThis.fetch, requests: { path: string; method: string }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      const path = String(url), method = init?.method ?? 'GET'; requests.push({ path, method });
      assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
      assert.equal(new Headers(init?.headers).get('X-Atoms-Sharing-Version'), SharingProtocolVersion);
      assert.equal(new Headers(init?.headers).has('Idempotency-Key'), false);
      if (method === 'POST') assert.deepEqual(JSON.parse(init!.body as string), fixture.previewRequest);
      return new Response(JSON.stringify(method === 'POST' ? fixture.preview : fixture.configured), { headers: { 'X-Atoms-Sharing-Version': SharingProtocolVersion } });
    };
    await sharingApi.descriptor(fixture.configured.projectId, fixture.configured.subjectVersionId);
    await sharingApi.resolve(fixture.configured.projectId, fixture.previewRequest);
    await sharingApi.resolve(fixture.configured.projectId, fixture.previewRequest);
    assert.equal(requests.length, 3); assert.ok(requests.every(value => value.path.startsWith('/api/sharing/v1/projects/')));
    assert.ok(requests[0].path.endsWith(`?versionId=${fixture.configured.subjectVersionId}`));
  } finally { globalThis.fetch = original; }
});
test('HTTP, network, wrong-version and malformed errors never become successful capabilities or reflected URLs', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 404, 409, 429, 503]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'RUNTIME_UNAVAILABLE', message: 'https://secret.example/p/token.signature/index.html', retryable: true, requestId: 'request_test' } }), { status, headers: { 'Retry-After': '2' } });
      await assert.rejects(sharingApi.descriptor('project_demo', null), (error: unknown) => error instanceof SharingError && error.status === status && !error.message.includes('secret.example') && error.retryAfterSeconds === 2);
    }
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.configured));
    await assert.rejects(sharingApi.descriptor(fixture.configured.projectId, null), /版本不一致/);
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(sharingApi.descriptor('project_demo', null), (error: unknown) => error instanceof SharingError && error.status === 0);
  } finally { globalThis.fetch = original; }
});
test('clipboard success means resolved browser write, denial/absence use manual copy without false success', async () => {
  const copied: string[] = [];
  assert.equal(await copyLink(fixture.preview.url, { writeText: async text => { copied.push(text); } }), 'copied');
  assert.deepEqual(copied, [fixture.preview.url]);
  assert.equal(await copyLink(fixture.preview.url, { writeText: async () => { throw new Error('denied'); } }), 'manual');
  assert.equal(await copyLink(fixture.preview.url, undefined), 'manual');
});
test('Retry-After is bounded, handles date and malformed headers without retry loops', () => {
  assert.equal(retryDelay('2'), 2); assert.equal(retryDelay('9999'), 60); assert.equal(retryDelay('bad'), 0);
  assert.equal(retryDelay('Mon, 09 Nov 2026 03:00:02 GMT', Date.parse('2026-11-09T03:00:00Z')), 2);
});
