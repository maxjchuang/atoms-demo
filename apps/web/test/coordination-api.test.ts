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
