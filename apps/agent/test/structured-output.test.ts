import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelJson, requestStructuredJson, StructuredOutputError } from '../src/structured-output.js';

test('empty and truncated model results expose metadata without source text', () => {
  for (const result of [{ text: '', finishReason: 'stop' }, { text: '{"secret":"private', finishReason: 'length' },
    { text: '', finishReason: 'max-tokens' }]) {
    assert.throws(() => parseModelJson(result, 'worker'), (error) => {
      assert.ok(error instanceof StructuredOutputError);
      assert.equal(error.responseLength, result.text.length);
      assert.ok(!error.message.includes('private'));
      return true;
    });
  }
});
test('malformed output retries only once and successful result remains parsed', async () => {
  let calls = 0; let retries = 0;
  const result = await requestStructuredJson('worker', async (retry) => {
    calls++; return { text: retry ? '{"files":{}}' : '', finishReason: 'stop' };
  }, () => retries++);
  assert.deepEqual(result, { files: {} }); assert.equal(calls, 2); assert.equal(retries, 1);
});
test('two malformed responses fail explicitly with no unbounded model loop', async () => {
  let calls = 0; const reasons: string[] = [];
  await assert.rejects(requestStructuredJson('router', async () => {
    calls++; return { text: '{', finishReason: null };
  }, (error) => reasons.push(error.reason)), StructuredOutputError);
  assert.equal(calls, 2);
  assert.deepEqual(reasons, ['invalid_json']);
});
test('retry feedback exposes only reason category and remains bounded at one retry', async () => {
  for (const [response, reason] of [
    [{ text: '', finishReason: 'completed' }, 'empty_response'],
    [{ text: 'private source text', finishReason: 'max-tokens' }, 'output_limit'],
  ] as const) {
    const reports: string[] = []; let calls = 0;
    await requestStructuredJson('worker', async (retry) => {
      calls++; return retry ? { text: '{}', finishReason: 'completed' } : response;
    }, (error) => reports.push(error.reason));
    assert.equal(calls, 2); assert.deepEqual(reports, [reason]);
    assert.ok(!reports.join('').includes('private'));
  }
});
