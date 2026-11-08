import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { PlanPreparationSnapshot, ProposedDeliveryPlan, ReportRead, ToolchainDescriptor } from '@atoms/contracts/delivery';
import { startExecution } from '@atoms/contracts/fixtures';
import { createAgentServer } from '../src/runtime.js';
import { profileData, TOOLCHAIN_ID } from '../src/trusted-template.js';
import { assertSealed } from '../src/delivery-files.js';

const token = 'delivery-planning-test-token';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t: { after: (callback: () => Promise<void>) => void }, dataDir?: string) {
  const directory = dataDir || await mkdtemp(path.join(os.tmpdir(), 'atoms-planning-'));
  const app = createAgentServer({ dataDir: directory, serviceToken: token, mode: 'fake' }); const origin = await app.listen();
  t.after(async () => { await app.close(); if (!dataDir) await rm(directory, { recursive: true, force: true }); });
  const call = (route: string, method = 'GET', body?: unknown, version = 'delivery/v1') => fetch(`${origin}/internal/${version}${route}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      [version === 'delivery/v1' ? 'x-atoms-delivery-version' : 'x-atoms-protocol-version']: '0.1.0' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const descriptor = ToolchainDescriptor.parse(await (await call(`/toolchains/${TOOLCHAIN_ID}`)).json());
  const request = structuredClone(prepareRequest); request.toolchain = descriptor;
  request.profileHint = { id: 'profile_notes_v1', hash: (await profileData('profile_notes_v1')).hash };
  return { app, call, request, directory };
}
async function wait(call: Awaited<ReturnType<typeof setup>>['call'], id: string, statuses = ['completed']) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const value = PlanPreparationSnapshot.parse(await (await call(`/preparations/${id}`)).json());
    if (statuses.includes(value.status)) return value;
    if (['failed', 'cancelled', 'interrupted'].includes(value.status)) throw new Error(JSON.stringify(value.error));
    await delay(20);
  }
  throw new Error('Preparation timeout');
}
test('authenticated real toolchain and readonly preparation are immutable, unique, sealed and source-write free', async (t) => {
  const { app, call, request, directory } = await setup(t);
  const url = `/preparations/${request.preparationId}`;
  assert.equal((await call(url, 'PUT', request)).status, 201);
  assert.equal((await call(url, 'PUT', request)).status, 200);
  const complete = await wait(call, request.preparationId); ProposedDeliveryPlan.parse(complete.result);
  assertSealed(complete.result!.spec); assertSealed(complete.result!.plan);
  assert.equal(complete.usage.modelSteps, 0); assert.equal(complete.usage.inputTokens, 0);
  assert.equal(complete.result!.spec.originalGoal, request.seed.goal);
  assert.ok(!existsSync(path.join(directory, 'executions')), 'readonly planning does not prepare application source');
  assert.equal(app.runtime.records.size, 0);
  assert.equal((await call(url, 'PUT', { ...request, planningMode: 'model_proposed' })).status, 409);
  assert.equal((await call('/preparations/preparation_other', 'PUT', { ...request, preparationId: 'preparation_other' })).status, 409);
  assert.equal((await call(`/executions/${request.executionId}`, 'PUT', startExecution, 'v1')).status, 409, 'legacy handler cannot bypass delivery reservation');
  assert.equal(app.planning.get(request.preparationId).events.filter((event) => event.event.type === 'planning.model_started').length, 0);
});
test('Fake model planning has explicit step/budget evidence and cancellation has independently readable failure logs', async (t) => {
  const { app, call, request } = await setup(t); request.planningMode = 'model_proposed';
  request.seed.goal += ' [slow]'; request.seed.items[0].text = request.seed.goal;
  const { seal } = await import('../src/delivery-files.js'); request.seed = seal(request.seed);
  await call(`/preparations/${request.preparationId}`, 'PUT', request); await wait(call, request.preparationId, ['running']);
  await call(`/preparations/${request.preparationId}/cancel`, 'POST', { commandId: 'command_cancel_plan' });
  const stopped = await wait(call, request.preparationId, ['cancelled']); assert.equal(stopped.result, null);
  const report = ReportRead.parse(await (await call(`/preparations/${request.preparationId}/report`)).json());
  assert.equal(report.state, 'available');
  if (report.state !== 'available') throw new Error('No report');
  assert.equal(report.report.bundle, null); assert.equal(report.report.quality, 'blocked');
  const evidence = await call(`/preparations/${request.preparationId}/evidence/${report.report.evidence[0].id}`);
  assert.equal(evidence.status, 200); assert.match(await evidence.text(), /preparation|Cancelled/i);
  assert.equal(app.runtime.records.size, 0);
});
test('completed readonly plan survives process restart and cannot silently regenerate', async (t) => {
  const first = await setup(t); await first.call(`/preparations/${first.request.preparationId}`, 'PUT', first.request);
  const before = await wait(first.call, first.request.preparationId); await first.app.close();
  const resumed = await setup(t, first.directory); const after = await wait(resumed.call, first.request.preparationId);
  assert.equal(after.requestHash, before.requestHash); assert.equal(after.result!.plan.hash, before.result!.plan.hash);
  assert.equal((await resumed.call(`/preparations/${first.request.preparationId}`, 'PUT', first.request)).status, 200);
});
test('preparation and legacy workers share one generation lane without sharing Router state', async (t) => {
  const { app, call, request } = await setup(t);
  await call(`/executions/${startExecution.executionId}`, 'PUT', { ...startExecution, prompt: '[slow] notes' }, 'v1');
  await delay(30);
  const other = structuredClone(request); other.runId = 'run_other'; other.executionId = 'execution_other'; other.seed.runId = other.runId; other.seed.executionId = other.executionId;
  const { seal } = await import('../src/delivery-files.js'); other.seed = seal(other.seed);
  await call(`/preparations/${other.preparationId}`, 'PUT', other); await delay(30);
  assert.equal(app.planning.get(other.preparationId).snapshot.status, 'accepted');
  await call(`/executions/${startExecution.executionId}/cancel`, 'POST', { commandId: 'command_release_lane' }, 'v1');
  await wait(call, other.preparationId); assert.equal(app.coordinator.records.size, 0);
});

test('preparation budget exhaustion is durable and another preparation ID cannot reset a Run budget', async (t) => {
  const { app, call, request } = await setup(t); request.planningMode = 'model_proposed'; request.planningBudget.maxModelSteps = 1;
  request.planningBudget.maxInputTokens = 1;
  const adapter = app.planning.adapter; let invoked = 0;
  adapter.plan = async (context) => { invoked++; context.meter({ modelSteps: 1, inputTokens: 2 }); throw new Error('Budget should abort before returning'); };
  await call(`/preparations/${request.preparationId}`, 'PUT', request);
  const failed = await wait(call, request.preparationId, ['failed']); assert.equal(failed.error!.code, 'BUDGET_EXCEEDED'); assert.equal(failed.usage.inputTokens, 2);
  await call(`/preparations/${request.preparationId}`, 'PUT', request); assert.equal(invoked, 1);
  assert.equal((await call('/preparations/preparation_reset', 'PUT', { ...request, preparationId: 'preparation_reset' })).status, 409);
  assert.equal(app.runtime.records.size, 0);
});
