import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeepSeekHarness, DeepSeekHarnessOptions, HarnessNotification, RunResult } from '@deepseek-ai/dsh-sdk-client';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { PlanPreparationSnapshot } from '@atoms/contracts/delivery';
import { DshPlanningAdapter } from '../src/delivery-planning.js';
import { trustedTemplate } from '../src/trusted-template.js';
import { createAgentServer } from '../src/runtime.js';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T, done: (value: T) => boolean) { for (let i=0;i<1000;i++) { const value=read(); if(done(value))return value; await pause(10); } throw new Error('observation timeout'); }
const notify = (callback: ((notification: HarnessNotification) => void) | undefined, type: string, seq: number, step: number, usage?: object) => callback?.({ method: 'session.event', params: { sessionId: 'session_explicit_mock_sdk', event: { type, seq, data: { turn: 1, step, ...(usage ? { usage } : {}) } } } });
async function setup(t: { after: (fn: () => Promise<void>) => void }, factory: (options: DeepSeekHarnessOptions) => DeepSeekHarness) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-preparation-observation-')); const adapter = new DshPlanningAdapter({ apiKey: 'unit-test-only-unusable', harnessFactory: factory });
  const options = { dataDir: root, mode: 'fake' as const, serviceToken: 'observation-service-test-token', planningAdapter: adapter };
  const app = createAgentServer(options); t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const request = structuredClone(prepareRequest); request.planningMode = 'model_proposed'; request.profileHint = null; request.toolchain = (await trustedTemplate()).descriptor;
  return { root, app, request, options };
}

test('captured invalid JSON/settled usage replay stops before an unaffordable second request', async (t) => {
  let calls=0;
  const factory = (options: DeepSeekHarnessOptions) => {
    assert.equal(options.reasoningEffort, 'off'); assert.equal(options.provider, 'deepseek-official'); assert.equal(options.model, 'deepseek-flash');
    return { async run(_prompt: string, callbacks: {onNotification?: (n: HarnessNotification)=>void}) {
      calls++; notify(callbacks.onNotification,'step/start',1,0); notify(callbacks.onNotification,'assistant/message',2,0,{inputTokens:684,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:5269,totalTokens:5953});
      return { sessionId:'session_explicit_mock_sdk',finalResponse:'{"cases":[{"name":"RAW_RESPONSE_MUST_NOT_PERSIST","steps":[{"op":"open_current_app"}}],"coverage":[]}',finishReason:'stop',events:[],notifications:[] } as RunResult;
    }, async close() {} } as unknown as DeepSeekHarness;
  };
  const {root,app,request}=await setup(t,factory); await app.planning.start(request,request.preparationId);
  const record=await until(()=>app.planning.get(request.preparationId),r=>r.snapshot.status==='failed');
  assert.equal(calls,1); assert.equal(record.snapshot.error!.code,'BUDGET_EXCEEDED'); assert.equal(record.snapshot.usage.inputTokens,684); assert.equal(record.snapshot.usage.outputTokens,5269); assert.equal(record.pendingModelRequest,false);
  const files=[path.join(root,'delivery',request.preparationId,'model/model-diagnostics.jsonl'),path.join(root,'delivery',request.preparationId,'model-diagnostics.jsonl')];
  const diagnostics=(await Promise.all(files.map(file=>readFile(file,'utf8')))).join('\n'); assert.ok(!diagnostics.includes('RAW_RESPONSE_MUST_NOT_PERSIST'));
  assert.match(diagnostics,/array_delimiter/); assert.match(diagnostics,/retry_skipped/); assert.match(diagnostics,/2923/); assert.equal(app.runtime.records.size,0);
});

test('unsettled interruption exposes null totals, keeps settled lower bound, and replays cancelled state unchanged', async (t) => {
  let rejectRun: ((error: Error)=>void)|undefined; let calls=0;
  const factory=()=>({ run(_prompt:string,callbacks:{onNotification?:(n:HarnessNotification)=>void}) {
    calls++; notify(callbacks.onNotification,'step/start',1,0); notify(callbacks.onNotification,'assistant/message',2,0,{inputTokens:10,cacheReadTokens:5,outputTokens:20,totalTokens:35}); notify(callbacks.onNotification,'step/start',3,1);
    return new Promise((_resolve,reject)=>{rejectRun=reject;});
  },async close(){rejectRun?.(new Error('EXPLICIT_MOCK_SDK_DISPOSED'));} } as unknown as DeepSeekHarness);
  const {root,app,request,options}=await setup(t,factory); await app.planning.start(request,request.preparationId);
  await until(()=>app.planning.get(request.preparationId).snapshot.usage.modelSteps,n=>n===2);
  // Rehydrate an exact in-flight ledger copy as a crash fixture, without resuming the original model.
  const interruptedRoot=await mkdtemp(path.join(os.tmpdir(),'atoms-preparation-crash-replay-')); await mkdir(path.join(interruptedRoot,'delivery'));
  await copyFile(path.join(root,'delivery/preparations.json'),path.join(interruptedRoot,'delivery/preparations.json'));
  const interrupted=createAgentServer({...options,dataDir:interruptedRoot}); const interruptedSnapshot=interrupted.planning.get(request.preparationId).snapshot;
  assert.equal(interruptedSnapshot.status,'interrupted'); assert.equal(interruptedSnapshot.usage.inputTokens,null); assert.equal(interruptedSnapshot.usage.outputTokens,null); assert.deepEqual(interrupted.planning.get(request.preparationId).settledUsage,{inputTokens:15,outputTokens:20});
  await interrupted.close(); await rm(interruptedRoot,{recursive:true,force:true}); assert.equal(calls,1);
  await app.planning.cancel(request.preparationId,'command_interrupt_native');
  const record=await until(()=>app.planning.get(request.preparationId),r=>r.snapshot.status==='cancelled');
  PlanPreparationSnapshot.parse(record.snapshot); assert.equal(record.snapshot.usage.inputTokens,null); assert.equal(record.snapshot.usage.outputTokens,null); assert.deepEqual(record.settledUsage,{inputTokens:15,outputTokens:20}); assert.equal(record.snapshot.result,null);
  const serialized=JSON.stringify(record.snapshot); await app.close(); const replay=createAgentServer(options); t.after(()=>replay.close());
  assert.equal(JSON.stringify(replay.planning.get(request.preparationId).snapshot),serialized); await replay.planning.start(request,request.preparationId); assert.equal(calls,1);
  const log=await readFile(path.join(root,'delivery',request.preparationId,'model/model-diagnostics.jsonl'),'utf8'); assert.match(log,/"usageKnown":false/); assert.match(log,/"interruption":"cancelled"/); assert.ok(!log.includes('EXPLICIT_MOCK_SDK_DISPOSED'));
});

test('complete known preparation remains freezeable and replay never requests another model turn', async (t) => {
  let calls=0; let requestItems=0;
  const factory=()=>({ async run(_prompt:string,callbacks:{onNotification?:(n:HarnessNotification)=>void}) {
    calls++; notify(callbacks.onNotification,'step/start',1,0); notify(callbacks.onNotification,'assistant/message',2,0,{inputTokens:10,outputTokens:20,totalTokens:30});
    return {sessionId:'session_explicit_mock_sdk',finalResponse:JSON.stringify({criteria:Array.from({length:requestItems},(_,index)=>({ref:`r${index}`,description:`Explicit unsupported derived item ${index}`,sourceSeedRefs:[`s${index}`]})),cases:[],coverage:Array.from({length:requestItems},(_,index)=>({criterionRef:`r${index}`,method:'unsupported',caseRefs:[],reason:'Explicit local mock has no supported browser assertion.'}))}),finishReason:'stop',events:[],notifications:[]} as RunResult;
  },async close(){} } as unknown as DeepSeekHarness);
  const {app,request,options}=await setup(t,factory); requestItems=request.seed.items.length; await app.planning.start(request,request.preparationId);
  const record=await until(()=>app.planning.get(request.preparationId),r=>['completed','failed'].includes(r.snapshot.status));
  assert.equal(record.snapshot.status,'completed',JSON.stringify(record.snapshot.error)); assert.equal(record.snapshot.usage.inputTokens,10); assert.equal(record.snapshot.result!.usage.outputTokens,20); assert.equal(record.pendingModelRequest,false);
  const serialized=JSON.stringify(record.snapshot); await app.close(); const replay=createAgentServer(options); t.after(()=>replay.close()); await replay.planning.start(request,request.preparationId); assert.equal(JSON.stringify(replay.planning.get(request.preparationId).snapshot),serialized); assert.equal(calls,1);
});
