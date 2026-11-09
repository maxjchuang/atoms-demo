import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetRecoveryProtocolVersion, BudgetRecoveryVersionHeader, BudgetRecoveryReadView } from '@atoms/contracts/budget-recovery';
import * as fixture from '@atoms/contracts/budget-recovery-fixtures';
import { retainPending, readPending, clearPending, requestForOffer, validateRecoveryView, validateContinuation, diagnosticSummary, recoveryApi, recoverySelectionKey, continuationRejectionIsDefinitive } from '../src/budget-recovery-api';
import { HttpError } from '../src/api';
function store() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
test('explicit offer request binds all frozen source/semantic/head/revision fields without arbitrary budget', () => {
  assert.deepEqual(requestForOffer(fixture.readView), fixture.continueRequest);
  assert.equal('budget' in requestForOffer(fixture.readView), false);
  const blocked = BudgetRecoveryReadView.parse({ ...fixture.readView, eligible: false, reason: 'PLAN_REVIEW_REQUIRED', offer: null });
  assert.throws(() => requestForOffer(blocked), /没有可用/);
});
test('stable pending key/body survives a reload, new offer does not replace unknown prior authorization', () => {
  const memory = store(), first = retainPending(memory, fixture.readView);
  const changed = BudgetRecoveryReadView.parse({ ...fixture.readView, offer: { ...fixture.offer, revision: 2 } });
  assert.deepEqual(retainPending(memory, changed), first); assert.deepEqual(readPending(memory, fixture.readView.projectId, fixture.readView.runId), first);
  assert.equal(memory.getItem(recoverySelectionKey(fixture.readView.projectId)), fixture.readView.runId);
  assert.equal(readPending(memory, 'project_other', fixture.readView.runId), null);
  clearPending(memory, first.projectId, first.runId); const next = retainPending(memory, changed); assert.notEqual(next.key, first.key); assert.equal(next.request.expectedOfferRevision, 2);
});
test('read and creation receipts reject cross-subject or wrong chain/segment; never revive original Run', () => {
  validateRecoveryView(fixture.readView, fixture.readView.projectId, fixture.readView.runId); validateContinuation(fixture.continueResponse, fixture.readView);
  assert.throws(() => validateRecoveryView(fixture.readView, 'project_other', fixture.readView.runId), /不一致/);
  for (const patch of [{ projectId: 'project_other' }, { predecessorRunId: 'run_other' }, { rootRunId: 'run_other' }, { segment: 4 }]) assert.throws(() => validateContinuation({ ...fixture.continueResponse, ...patch }, fixture.readView), /不一致/);
});
test('typed budget diagnosis distinguishes reservation rejection from actual limit, unknown never guessed', () => {
  assert.match(diagnosticSummary(fixture.diagnosis)!, /预留/); assert.match(diagnosticSummary(fixture.diagnosis)!, /输入 Token/);
  assert.equal(fixture.diagnosis.settledTotal, null); assert.equal(fixture.diagnosis.historicalUsage.inputTokens, null);
  assert.equal(diagnosticSummary(null), null);
  assert.match(diagnosticSummary({ ...fixture.diagnosis, trigger: 'segment_limit_reached' })!, /达到本段上限/);
});
test('408 and unrecognized transport failures retain authorization; only explicit API rejection clears it', () => {
  for (const error of [new HttpError(408, 'RUNTIME_UNAVAILABLE', 'unknown'), new HttpError(429, 'RATE_LIMITED', 'wait'), new HttpError(503, 'RUNTIME_UNAVAILABLE', 'wait'), new HttpError(400, 'HTTP_ERROR', 'proxy'), new HttpError(0, 'NETWORK_ERROR', 'lost')]) assert.equal(continuationRejectionIsDefinitive(error), false);
  for (const [status, code] of [[409, 'STALE_OFFER'], [403, 'QUOTA_EXHAUSTED'], [409, 'PLAN_REVIEW_REQUIRED'], [401, 'UNAUTHENTICATED']] as const) assert.equal(continuationRejectionIsDefinitive(new HttpError(status, code, 'rejected')), true);
});
test('continue uses exact new endpoint/header with stable key and no normal Run/message or source execution', async () => {
  const original = globalThis.fetch, memory = store(), pending = retainPending(memory, fixture.readView), paths: string[] = [];
  try { globalThis.fetch = async (url, init) => {
    paths.push(String(url)); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(new Headers(init?.headers).get(BudgetRecoveryVersionHeader), BudgetRecoveryProtocolVersion);
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), pending.key); assert.deepEqual(JSON.parse(init!.body as string), fixture.continueRequest);
    return new Response(JSON.stringify(fixture.continueResponse), { headers: { [BudgetRecoveryVersionHeader]: BudgetRecoveryProtocolVersion } });
  }; await recoveryApi.continue(fixture.readView, pending); await recoveryApi.continue(fixture.readView, pending);
    assert.deepEqual(paths, Array(2).fill(`/api/budget-recovery/v1/runs/${fixture.readView.runId}/continue`)); assert.deepEqual(readPending(memory, pending.projectId, pending.runId), pending);
  } finally { globalThis.fetch = original; }
});
test('unknown transport response retains pending request; stale offer and plan review retain exact error codes', async () => {
  const original = globalThis.fetch, memory = store(), pending = retainPending(memory, fixture.readView);
  try {
    globalThis.fetch = async () => { throw new Error('lost'); }; await assert.rejects(recoveryApi.continue(fixture.readView, pending), /尚未确认/); assert.deepEqual(readPending(memory, pending.projectId, pending.runId), pending);
    for (const code of ['STALE_OFFER', 'PLAN_REVIEW_REQUIRED', 'QUOTA_EXHAUSTED']) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { code, message: 'Actual API refusal', requestId: 'request_test', retryable: false } }), { status: 409 });
      await assert.rejects(recoveryApi.continue(fixture.readView, pending), (error: unknown) => error instanceof Error && 'code' in error && error.code === code);
    }
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.readView)); await assert.rejects(recoveryApi.read(pending.projectId, pending.runId), /版本不一致/);
  } finally { globalThis.fetch = original; }
});
