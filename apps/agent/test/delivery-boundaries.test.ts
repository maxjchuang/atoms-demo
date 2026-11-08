import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareRequest, binding as sampleBinding } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
import { startCoordination } from '@atoms/contracts/conversation-fixtures';
import { DeliveryCoordinationRequest, DeliveryCoordinationSnapshot, DeliveryExecutionRequest, DeliveryFacts, FrozenDeliveryBundle } from '@atoms/contracts/delivery';
import { createAgentServer } from '../src/runtime.js';
import { contextDigest } from '../src/coordination-context.js';
import { seal } from '../src/delivery-files.js';
import { trustedTemplate, profileData } from '../src/trusted-template.js';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T, done: (v: T) => boolean) { for (let i = 0; i < 500; i++) { const v = read(); if (done(v)) return v; await delay(20); } throw new Error('timeout'); }
async function setup(t: { after: (f: () => Promise<void>) => void }) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'atoms-delivery-boundaries-')); const options = { dataDir, serviceToken: 'delivery-boundary-test', mode: 'fake' as const };
  const app = createAgentServer(options); const origin = await app.listen(); t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const call = (route: string, method = 'GET', body?: unknown, prefix = 'delivery/v1') => fetch(origin + '/internal/' + prefix + route, { method, headers: { authorization: 'Bearer delivery-boundary-test', 'content-type': 'application/json', [prefix === 'delivery/v1' ? 'x-atoms-delivery-version' : 'x-atoms-coordination-version']: prefix === 'delivery/v1' ? '0.1.0' : '0.2.0' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, options, call };
}
test('delivery-aware coordination preserves outer facts/hash and cannot downgrade through the v2 path', async (t) => {
  const { app, call } = await setup(t); const coordination = structuredClone(startCoordination); coordination.context.hash = contextDigest(coordination.context);
  const facts = DeliveryFacts.parse(seal({ protocolVersion: '0.1.0' as const, projectId: coordination.projectId, revision: 1, asOf: coordination.context.asOf, hash: '0'.repeat(64), versions: [], runs: [], availableActions: [] }));
  const wrapper = DeliveryCoordinationRequest.parse(seal({ protocolVersion: '0.1.0' as const, hash: '0'.repeat(64), coordination, deliveryFacts: facts }));
  const route = `/coordination-turns/${coordination.turnId}`;
  assert.equal((await call(route, 'PUT', wrapper)).status, 201); assert.equal((await call(route, 'PUT', wrapper)).status, 200);
  await until(() => app.coordinator.get(coordination.turnId).snapshot.status, (status) => status === 'completed');
  const snapshot = DeliveryCoordinationSnapshot.parse(await (await call(route)).json()); assert.equal(snapshot.deliveryFactsUsed.hash, facts.hash);
  assert.equal((await call(route, 'PUT', coordination, 'v2')).status, 409);
  const tampered = structuredClone(wrapper); tampered.deliveryFacts.revision++; assert.equal((await call(route, 'PUT', tampered)).status, 400, 'bad host hash cannot be accepted');
  assert.equal(app.runtime.records.size, 0);
});
test('plan approval uses one execution/started event and immutable frozen tests; cancel retains no candidate', async (t) => {
  const { app, call } = await setup(t); const request = structuredClone(prepareRequest); request.toolchain = (await trustedTemplate()).descriptor; request.profileHint = { id: 'profile_notes_v1', hash: (await profileData('profile_notes_v1')).hash };
  await call(`/preparations/${request.preparationId}`, 'PUT', request); await until(() => app.planning.get(request.preparationId).snapshot.status, (status) => status === 'completed');
  const prepared = app.planning.get(request.preparationId).snapshot; const { spec, plan } = prepared.result!;
  const binding = seal({ ...sampleBinding, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: spec.id, hash: spec.hash }, plan: { id: plan.id, hash: plan.hash }, planningUsage: prepared.result!.usage, toolchain: request.toolchain });
  const bundle = FrozenDeliveryBundle.parse({ seed: request.seed, spec, plan, binding }); const budget = { ...request.totalBudget, maxWallTimeMs: request.totalBudget.maxWallTimeMs - prepared.usage.activeMs };
  const wrapper = DeliveryExecutionRequest.parse({ protocolVersion: '0.1.0', execution: { ...startExecution, mode: 'plan', prompt: '创建便签 [slow]', budget }, bundle });
  await call(`/executions/${request.executionId}`, 'PUT', wrapper); await until(() => app.runtime.get(request.executionId).snapshot.status, (status) => status === 'waiting_input');
  const item = app.runtime.get(request.executionId); const question = item.snapshot.pendingAttention!;
  assert.equal(item.events.filter((event) => event.event.type === 'execution.started').length, 0, 'host plan confirmation is not a billable model start');
  assert.equal(item.usage.modelSteps, 0); assert.equal(item.snapshot.artifactId, null);
  assert.equal((await call(`/executions/${request.executionId}/inputs`, 'POST', { commandId: 'command_approve', attentionId: question.id, expectedRevision: question.revision, answer: { kind: 'approve_plan' } })).status, 202);
  await until(() => app.runtime.get(request.executionId).usage.modelSteps, (steps) => steps === 1);
  await call(`/executions/${request.executionId}/cancel`, 'POST', { commandId: 'command_cancel_worker' });
  await until(() => app.runtime.get(request.executionId).snapshot.status, (status) => status === 'cancelled');
  assert.equal(item.events.filter((event) => event.event.type === 'execution.started').length, 1);
  assert.equal(item.delivery!.bundle.plan.hash, plan.hash); assert.equal(item.snapshot.artifactId, null);
  assert.equal(app.delivery.report(request.executionId)!.lifecycle, 'cancelled');
});

test('M2 pre-meter cancellation is not billable and a resumed ordinary question never emits a second model start', async (t) => {
  const prepareOne = async (instance: Awaited<ReturnType<typeof setup>>, mode: 'plan' | 'build', prompt: string) => {
    const request = structuredClone(prepareRequest); request.toolchain = (await trustedTemplate()).descriptor; request.profileHint = { id: 'profile_notes_v1', hash: (await profileData('profile_notes_v1')).hash };
    await instance.call(`/preparations/${request.preparationId}`, 'PUT', request); await until(() => instance.app.planning.get(request.preparationId).snapshot.status, (status) => status === 'completed');
    const result = instance.app.planning.get(request.preparationId).snapshot.result!;
    const binding = seal({ ...sampleBinding, seed: { id: request.seed.id, hash: request.seed.hash }, spec: { id: result.spec.id, hash: result.spec.hash }, plan: { id: result.plan.id, hash: result.plan.hash }, planningUsage: result.usage, toolchain: request.toolchain });
    const wrapper = DeliveryExecutionRequest.parse({ protocolVersion: '0.1.0', execution: { ...startExecution, mode, prompt, budget: { ...request.totalBudget, maxWallTimeMs: request.totalBudget.maxWallTimeMs - result.usage.activeMs } }, bundle: { seed: request.seed, spec: result.spec, plan: result.plan, binding } });
    await instance.call(`/executions/${request.executionId}`, 'PUT', wrapper); await until(() => instance.app.runtime.get(request.executionId).snapshot.status, (status) => status === 'waiting_input'); return request;
  };
  const pre = await setup(t); const before = await prepareOne(pre, 'plan', '创建便签');
  await pre.call(`/executions/${before.executionId}/cancel`, 'POST', { commandId: 'command_cancel_unbilled' });
  assert.equal(pre.app.runtime.get(before.executionId).usage.modelSteps, 0);
  assert.equal(pre.app.runtime.get(before.executionId).events.filter((event) => event.event.type === 'execution.started').length, 0);
  assert.equal(pre.app.delivery.report(before.executionId)!.lifecycle, 'cancelled');
  const first = await setup(t); const request = await prepareOne(first, 'build', '[question] [slow] 创建便签');
  assert.equal(first.app.runtime.get(request.executionId).events.filter((event) => event.event.type === 'execution.started').length, 1);
  await first.app.close(); const resumed = createAgentServer(first.options); await resumed.listen(); t.after(() => resumed.close());
  const item = resumed.runtime.get(request.executionId); const question = item.snapshot.pendingAttention!;
  resumed.runtime.answer(request.executionId, { commandId: 'command_resume_question', attentionId: question.id, expectedRevision: question.revision, answer: { kind: 'select', optionId: question.options[0].id } });
  await until(() => item.usage.modelSteps, (steps) => steps === 2);
  await resumed.runtime.cancel(request.executionId, { commandId: 'command_cancel_resumed' }); await until(() => item.snapshot.status, (status) => status === 'cancelled');
  assert.equal(item.events.filter((event) => event.event.type === 'execution.started').length, 1);
  assert.equal(resumed.delivery.snapshot(request.executionId).cumulativeUsage.modelSteps, 2);
});
