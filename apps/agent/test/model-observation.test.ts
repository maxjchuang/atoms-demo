import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeRequestAccounting, UsageAccountingError } from '../src/native-usage.js';
import { parseModelJson, StructuredOutputError } from '../src/structured-output.js';
import { structuredDiagnostic, writeModelDiagnostic } from '../src/model-diagnostics.js';
import { structuredRetryAdmission } from '../src/retry-admission.js';
import { PLANNING_DSH_PATCH } from '../src/planning-profile.js';
import { verifyDshToolPolicy } from '../src/dsh-policy.js';

test('settled request is known, a later uncompleted request cannot reuse its lower bound as a total', () => {
  const settled = new NativeRequestAccounting(); settled.begin(); settled.step('one'); settled.add('usage_one', { inputTokens: 684, outputTokens: 5269, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 5953 }); settled.assertObservable();
  assert.equal(settled.isUnknown(), false); assert.equal(settled.metadata().effectiveInputTokens, 684);
  const interrupted = new NativeRequestAccounting(); interrupted.begin(); interrupted.step('one'); interrupted.add('usage_one', { inputTokens: 10, outputTokens: 20 }); interrupted.step('two');
  assert.equal(interrupted.isUnknown(), true); assert.throws(() => interrupted.assertObservable(), UsageAccountingError);
  assert.equal(interrupted.metadata().effectiveInputTokens, 10); assert.equal(interrupted.metadata().outputTokens, 20);
  const notStarted = new NativeRequestAccounting(); assert.equal(notStarted.isUnknown(), false);
});

test('sanitized captured delimiter failure remains rejected and numerical diagnostics contain no raw text', async (t) => {
  // Same malformed array/object delimiter category as PMMN5g; no original text/goal/reasoning is retained.
  const bad = '{"cases":[{"name":"DO_NOT_LOG_RAW_RESPONSE","steps":[{"op":"open_current_app"}}],"coverage":[]}';
  let error!: StructuredOutputError;
  try { parseModelJson({ text: bad, finishReason: 'stop' }, 'delivery-planning'); } catch (value) { error = value as StructuredOutputError; }
  assert.ok(error instanceof StructuredOutputError); assert.equal(error.jsonErrorClass, 'SyntaxError'); assert.equal(error.jsonErrorCategory, 'array_delimiter'); assert.ok(error.jsonErrorPosition! > 0);
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-model-diagnostic-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeModelDiagnostic(root, { stage: 'structured_rejected', role: 'delivery-planning', id: 'preparation_capture', ...structuredDiagnostic(error), remaining: { activeMs: 24200, outputTokens: 2923 } });
  const log = await readFile(path.join(root, 'model-diagnostics.jsonl'), 'utf8'); assert.ok(!log.includes('DO_NOT_LOG_RAW_RESPONSE')); assert.ok(!log.includes('open_current_app')); assert.equal(JSON.parse(log).textLength, bad.length);
  assert.throws(() => parseModelJson({ text: bad, finishReason: 'stop' }, 'delivery-planning'), StructuredOutputError, 'no automatic bracket repair');
});

test('retry admission replays observed PMMN5g limits without resetting time or output', () => {
  const captured = { usageKnown: true, remainingMs: 24200, remainingOutputTokens: 2923, remainingModelSteps: 2, previousMs: 35800, previousOutputTokens: 5269 };
  assert.equal(structuredRetryAdmission(captured).allowed, false);
  assert.equal(structuredRetryAdmission({ ...captured, remainingMs: 60000 }).reason, 'insufficient_settled_output');
  assert.equal(structuredRetryAdmission({ ...captured, remainingMs: 60000, remainingOutputTokens: 6000 }).allowed, true);
  assert.equal(structuredRetryAdmission({ ...captured, usageKnown: false }).reason, 'usage_unknown');
});

test('pinned CLI composes thinking disabled/off and all no-tools rows without initialization or inference', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-planning-profile-off-')); t.after(() => rm(root, { recursive: true, force: true })); const patch = path.join(root, 'planning.yml'); await writeFile(patch, PLANNING_DSH_PATCH);
  const result = verifyDshToolPolicy(root, patch, { requireThinkingOff: true }); assert.equal(result.thinking, 'disabled'); assert.equal(result.reasoningEffort, 'off'); assert.equal(result.runtimeVersion, '0.2.2-rc.1');
});

test('actual pinned Messages serializer maps off to disabled and never adds unsupported Chat JSON fields', async () => {
  const require = createRequire(import.meta.url); const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-sdk-client'));
  const provider = await import(sdkRequire.resolve('@deepseek-ai/dsh-llm-deepseek'));
  const original = globalThis.fetch; let wire: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url, init) => { wire = JSON.parse(String(init?.body)); throw new Error('LOCAL_ZERO_NETWORK_SERIALIZER_CAPTURE'); }) as typeof fetch;
  try {
    const connection = provider.resolveAdapterOptions({ baseURL: 'https://api.deepseek.com/anthropic', thinking: 'disabled', reasoningEffort: 'off' });
    const adapter = new provider.DeepSeekAdapter({ options: () => connection, resolveAuth: async () => ({ headers: {} }), resolveUserId: () => 'local-no-network', prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) });
    await assert.rejects(async () => { for await (const _ of adapter.stream({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off', maxTokens: 8192, messages: [{ role: 'user', content: [{ type: 'text', text: 'Return json: {}' }] }] })) {} });
    assert.ok(wire, 'real provider must have reached the stubbed fetch boundary'); assert.deepEqual(wire.thinking, { type: 'disabled' }); assert.equal(wire.max_tokens, 8192); assert.equal(wire.model, 'deepseek-flash');
    assert.ok(!('response_format' in wire)); assert.ok(!('text' in wire)); assert.ok(!('output_config' in wire));
  } finally { globalThis.fetch = original; }
});
