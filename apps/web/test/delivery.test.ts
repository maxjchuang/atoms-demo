import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryReadView, DeliveryReport, VersionDiffPage, EvidenceDescriptor, ReportBinding } from '@atoms/contracts/delivery';
import * as fixture from '@atoms/contracts/delivery-fixtures';
import { assertReportBinding, shouldPollDelivery, validateSubject, criterionResult, deliveryApi, verifiedBytes } from '../src/delivery-api';

test('pending, provisional and final unpublished keep polling; published final and blocked settle', () => {
  for (const view of [fixture.pendingView, fixture.provisionalView, fixture.finalUnpublishedView]) assert.equal(shouldPollDelivery(DeliveryReadView.parse(view)), true);
  assert.equal(shouldPollDelivery(DeliveryReadView.parse(fixture.view)), false);
  assert.equal(shouldPollDelivery(DeliveryReadView.parse(fixture.legacyView)), false);
});
test('subject identity rejects same-schema foreign project/run/version responses', () => {
  const view = DeliveryReadView.parse(fixture.view);
  assert.throws(() => validateSubject(view, { kind: 'versions', projectId: 'foreign', id: view.subjectVersionId! }), /不一致/);
  assert.throws(() => validateSubject(view, { kind: 'runs', projectId: view.projectId, id: 'another_run' }), /不一致/);
  assert.equal(validateSubject(view, { kind: 'versions', projectId: view.projectId, id: view.subjectVersionId! }), view);
});
test('report-bound pagination and delayed evidence reject another revision or source', () => {
  assertReportBinding(fixture.attemptPage.binding, fixture.attemptPage.binding);
  assert.throws(() => assertReportBinding(fixture.attemptPage.binding, fixture.revisedAttemptPage.binding), /版本已变化/);
  assert.throws(() => assertReportBinding(fixture.attemptPage.binding, ReportBinding.parse({ ...fixture.attemptPage.binding, sourceSnapshotHash: 'f'.repeat(64) })), /版本已变化/);
});
test('criterion summary preserves required manual/unsupported and optional failures without greenwashing', () => {
  assert.equal(criterionResult(fixture.complete, fixture.spec.criteria[0].id), 'passed');
  assert.equal(fixture.partial.quality, 'partial');
  assert.ok(fixture.partial.gaps.some(gap => gap.required));
  for (const gap of fixture.partial.gaps) assert.equal(criterionResult(fixture.partial, gap.criterionId), gap.result);
  assert.ok(fixture.optionalFailure.gaps.some(gap => !gap.required && gap.result === 'failed'));
  for (const gap of fixture.optionalFailure.gaps) assert.equal(criterionResult(fixture.optionalFailure, gap.criterionId), gap.result);
});
test('failed runs retain standalone reports; legacy restore never becomes a fresh verification', () => {
  assert.equal(DeliveryReport.parse(fixture.planningFailure).bundle, null);
  assert.equal(fixture.requiredFailure.quality, 'blocked');
  assert.equal(fixture.sourceChanged.quality, 'blocked');
  const restored = DeliveryReadView.parse(fixture.restoredView);
  assert.equal(restored.state === 'available' && restored.provenance.verificationRerun, false);
  assert.equal(DeliveryReadView.parse(fixture.legacyView).state, 'legacy');
});
test('HTML diff remains data and evidence descriptors enforce MIME', () => {
  assert.match(VersionDiffPage.parse(fixture.diffPage).files[0].hunks[0].lines[0].text, /<script>/);
  assert.equal(EvidenceDescriptor.safeParse({ ...fixture.evidenceDescriptor, kind: 'screenshot', mediaType: 'application/zip' }).success, false);
});
test('HTTP failure never becomes a legacy fallback; delivery request uses independent version header', async () => {
  const original = globalThis.fetch;
  try { globalThis.fetch = async (_url, options) => { assert.equal(new Headers(options?.headers).get('X-Atoms-Delivery-Version'), '0.1.0'); return new Response(JSON.stringify({ error: { code: 'RUNTIME_UNAVAILABLE', message: 'report unavailable', retryable: true, requestId: 'request_test' } }), { status: 503 }); };
    await assert.rejects(deliveryApi.read({ kind: 'versions', projectId: 'project_demo', id: 'version_delivered' }), /report unavailable/);
  } finally { globalThis.fetch = original; }
});
test('download verifies actual bytes and MIME before granting browser content', async () => {
  const original = globalThis.fetch; const data = new TextEncoder().encode('safe text');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
  try { globalThis.fetch = async () => new Response(data, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    assert.equal(await (await verifiedBytes('/content', hash, data.length, 'text/plain')).text(), 'safe text');
    await assert.rejects(verifiedBytes('/content', '0'.repeat(64), data.length, 'text/plain'), /指纹/);
    await assert.rejects(verifiedBytes('/content', hash, data.length + 1, 'text/plain'), /大小/);
    await assert.rejects(verifiedBytes('/content', hash, data.length, 'image/png'), /类型/);
  } finally { globalThis.fetch = original; }
});
