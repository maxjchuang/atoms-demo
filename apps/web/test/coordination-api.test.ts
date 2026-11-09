import assert from 'node:assert/strict';
import test from 'node:test';
import { consultUser, consultTurn, controlTargetRun } from '@atoms/contracts/conversation-fixtures';
import { coordinationApi } from '../src/coordination-api.js';
import { HttpError } from '../src/api.js';

test('message submits v2 header, semantic mode and separate run strategy', async () => {
  const original = fetch; let captured: RequestInit | undefined; let target = '';
  globalThis.fetch = async (input, options) => { target = String(input); captured = options; return Response.json({ userMessage: consultUser, turn: consultTurn }, { status: 202 }); };
  try {
    await coordinationApi.submit('project_demo', { input: { kind: 'text', content: '如何分享？' }, mode: 'ask', runMode: 'plan' }, 'message_request_001');
    assert.equal(target, '/api/v2/projects/project_demo/messages');
    assert.equal(new Headers(captured?.headers).get('X-Atoms-Coordination-Version'), '0.2.0');
    assert.equal(new Headers(captured?.headers).get('Idempotency-Key'), 'message_request_001');
    assert.deepEqual(JSON.parse(String(captured?.body)), { input: { kind: 'text', content: '如何分享？' }, mode: 'ask', runMode: 'plan' });
  } finally { globalThis.fetch = original; }
});
test('selection is structured and keeps its exact clarification binding', async () => {
  const original = fetch; let body: unknown;
  globalThis.fetch = async (_input, options) => { body = JSON.parse(String(options?.body)); return Response.json({ userMessage: consultUser, turn: consultTurn }, { status: 202 }); };
  try {
    const request = { input: { kind: 'selection' as const, optionId: 'option_warm' }, mode: 'auto' as const, runMode: 'build' as const,
      replyTo: { clarificationId: 'clarification_demo', expectedRevision: 3, replyToMessageId: 'message_question' } };
    await coordinationApi.submit('project_demo', request); assert.deepEqual(body, request);
  } finally { globalThis.fetch = original; }
});
test('cancel receipt preserves already-dispatched Run rather than falsely stopping it', async () => {
  const original = fetch;
  const turn = { ...consultTurn, result: { kind: 'change_proposal' as const, proposalId: 'proposal_demo', admission: 'run_queued' as const, runId: controlTargetRun.id, admissionError: null } };
  globalThis.fetch = async () => Response.json({ turn, disposition: 'already_dispatched', run: controlTargetRun });
  try { const receipt = await coordinationApi.cancel(turn.id, turn.revision); assert.equal(receipt.disposition, 'already_dispatched'); assert.equal(receipt.run?.status, 'running'); }
  finally { globalThis.fetch = original; }
});
test('v2 errors keep their independent quota code and do not become a build retry', async () => {
  const original = fetch;
  globalThis.fetch = async () => Response.json({ error: { code: 'COORDINATION_QUOTA_EXCEEDED', message: '消息额度不足', retryable: false, requestId: 'request_demo' } }, { status: 403 });
  try { await assert.rejects(coordinationApi.submit('project_demo', { input: { kind: 'text', content: '你好' }, mode: 'ask', runMode: 'build' }), error => error instanceof HttpError && error.code === 'COORDINATION_QUOTA_EXCEEDED'); }
  finally { globalThis.fetch = original; }
});

test('retry accepts the actual shared userMessage+turn response with exactly one POST', async () => {
  const original = fetch; const requests: { path: string; options: RequestInit | undefined }[] = [];
  globalThis.fetch = async (input, options) => { requests.push({ path: String(input), options }); return Response.json({ userMessage: consultUser, turn: consultTurn }, { status: 202 }); };
  try {
    const response = await coordinationApi.retry(consultTurn.id, consultTurn.revision, 'retry_request_001');
    assert.deepEqual(response, { userMessage: consultUser, turn: consultTurn }); assert.equal(requests.length, 1);
    assert.equal(requests[0].path, `/api/v2/coordination-turns/${consultTurn.id}/retry`); assert.equal(requests[0].options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { expectedRevision: consultTurn.revision });
    assert.equal(new Headers(requests[0].options?.headers).get('Idempotency-Key'), 'retry_request_001');
    assert.equal(new Headers(requests[0].options?.headers).get('X-Atoms-Coordination-Version'), '0.2.0');
  } finally { globalThis.fetch = original; }
});
test('explicit retry after a lost retry receipt retains its idempotency key without automatic extra POSTs', async () => {
  const original = fetch; const keys: string[] = []; const accepted = new Set<string>();
  globalThis.fetch = async (_input, options) => {
    const key = new Headers(options?.headers).get('Idempotency-Key')!; keys.push(key); accepted.add(key);
    if (keys.length === 1) throw new TypeError('receipt lost after server accepted turn');
    return Response.json({ userMessage: consultUser, turn: consultTurn }, { status: 202 });
  };
  try {
    await assert.rejects(coordinationApi.retry(consultTurn.id, consultTurn.revision + 1), error => error instanceof HttpError && error.code === 'NETWORK_ERROR');
    assert.equal(keys.length, 1, 'No silent automatic retry after an uncertain response');
    const response = await coordinationApi.retry(consultTurn.id, consultTurn.revision + 1);
    assert.equal(response.turn.id, consultTurn.id); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(accepted.size, 1);
  } finally { globalThis.fetch = original; }
});
