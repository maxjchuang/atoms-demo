import assert from 'node:assert/strict';
import test from 'node:test';
import { project } from '@atoms/contracts/fixtures';
import { api, HttpError } from '../src/api.js';

test('mutation sends the public route, body and idempotency header', async () => {
  const original = globalThis.fetch;
  const calls: { path: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (input, options) => { calls.push({ path: String(input), options }); return Response.json(project, { status: 201 }); };
  try {
    await api.createProject('test', 'operation_1234');
    assert.equal(calls[0].path, '/api/v1/projects');
    assert.equal(calls[0].options?.credentials, 'same-origin');
    assert.equal(new Headers(calls[0].options?.headers).get('Idempotency-Key'), 'operation_1234');
    assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { title: 'test' });
  } finally { globalThis.fetch = original; }
});
test('a lost response retains the mutation key for an explicit retry', async () => {
  const original = globalThis.fetch;
  const keys: (string | null)[] = [];
  globalThis.fetch = async (_input, options) => {
    keys.push(new Headers(options?.headers).get('Idempotency-Key'));
    if (keys.length === 1) throw new TypeError('network lost');
    return Response.json(project, { status: 201 });
  };
  try {
    await assert.rejects(api.createProject('lost-response'), (error: unknown) => error instanceof HttpError && error.status === 0);
    await api.createProject('lost-response');
    assert.ok(keys[0]); assert.equal(keys[0], keys[1]);
  } finally { globalThis.fetch = original; }
});
test('schema mismatch is shown as protocol error, never fake success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'invalid' });
  try { await assert.rejects(api.projects(), (error: unknown) => error instanceof HttpError && error.code === 'PROTOCOL_ERROR'); }
  finally { globalThis.fetch = original; }
});
test('quota failures preserve server error code and message', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: 'QUOTA_EXCEEDED', message: '额度已用完', retryable: false, requestId: 'request_demo' } }, { status: 403 });
  try { await assert.rejects(api.createProject('quota'), (error: unknown) => error instanceof HttpError && error.code === 'QUOTA_EXCEEDED' && error.message === '额度已用完'); }
  finally { globalThis.fetch = original; }
});
