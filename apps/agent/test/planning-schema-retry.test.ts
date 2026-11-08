import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import type {DeepSeekHarness,DeepSeekHarnessOptions,HarnessNotification,RunResult} from '@deepseek-ai/dsh-sdk-client';
import {BrowserStep} from '@atoms/contracts/delivery';
import {prepareRequest} from '@atoms/contracts/delivery-fixtures';
import {createAgentServer} from '../src/runtime.js';
import {DshPlanningAdapter} from '../src/delivery-planning.js';
import {mapModelPlan,ModelPlanSchemaError,planningSyntaxExamples,planningPrompt} from '../src/planning-format.js';
import {trustedTemplate} from '../src/trusted-template.js';
import {planningSchemaCapture} from './fixtures/planning-schema-capture.js';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(read:()=>T,done:(v:T)=>boolean){for(let i=0;i<1000;i++){const v=read();if(done(v))return v;await delay(10);}throw new Error('schema replay timeout');}
function sdkFixture(outputs:string[],costs:number[]=[],known=true){
  const state={calls:0,prompts:[] as string[],caps:[] as (number|undefined)[]};
  const factory=(options:DeepSeekHarnessOptions)=>{state.caps.push(options.maxTokens);return{async run(prompt:string,callbacks:{onNotification?:(n:HarnessNotification)=>void}){
    const index=state.calls++;state.prompts.push(prompt);const emit=(type:string,seq:number,usage?:object)=>callbacks.onNotification?.({method:'session.event',params:{sessionId:'session_schema_replay',event:{type,seq,data:{turn:1,step:0,...(usage?{usage}:{})}}}});
    emit('step/start',1);const outputTokens=costs[index]??1512;if(known)emit('assistant/message',2,{inputTokens:817,cacheReadTokens:0,cacheWriteTokens:0,outputTokens,totalTokens:817+outputTokens});
    return{sessionId:'session_schema_replay',finalResponse:outputs[index]??'{}',finishReason:'completed',events:[],notifications:[]} as RunResult;
  },async close(){}} as unknown as DeepSeekHarness;};return{state,factory};
}
async function setup(t:{after:(f:()=>Promise<void>)=>void},factory:(options:DeepSeekHarnessOptions)=>DeepSeekHarness,apiInternalUrl?:string){
  const root=await mkdtemp(path.join(os.tmpdir(),'atoms-dsl-schema-retry-'));const adapter=new DshPlanningAdapter({apiKey:'unit-test-only-unusable',harnessFactory:factory});
  const app=createAgentServer({dataDir:root,mode:'fake',serviceToken:'schema-replay-service-token',planningAdapter:adapter,apiInternalUrl});t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const request=structuredClone(prepareRequest);request.planningMode='model_proposed';request.profileHint=null;request.toolchain=(await trustedTemplate()).descriptor;
  return{root,app,request};
}

test('every operation example uses the shared schema, complete Seed stays visible, and twelve captured issues are rejected unchanged',async()=>{
  const examples=planningSyntaxExamples();assert.deepEqual([...new Set(examples.map(step=>step.op))].sort(),BrowserStep.options.map(schema=>schema.shape.op.value).sort());
  for(const [index,step]of examples.entries())BrowserStep.parse({...step,id:`step_valid_${index}`,timeoutMs:5000});
  const prompt=planningPrompt(prepareRequest,[]);assert.ok(prompt.includes(prepareRequest.seed.goal));for(const item of prepareRequest.seed.items)assert.ok(prompt.includes(item.text));
  assert.match(prompt,/drag_by has target,dx,dy ONLY/);assert.match(prompt,/baseline,dx,dy,tolerancePx/);assert.match(prompt,/lowercase/);
  const {good,bad}=await planningSchemaCapture();let failure!:ModelPlanSchemaError;try{mapModelPlan(bad,prepareRequest);}catch(error){failure=error as ModelPlanSchemaError;}
  assert.ok(failure instanceof ModelPlanSchemaError);assert.equal(failure.issues.length,12);assert.ok(!JSON.stringify(failure.issues).includes('RAW_MODEL_LABEL_DO_NOT_LOG'));
  assert.equal(bad.cases[5].steps[4].tolerancePx,8);assert.equal(bad.cases[5].steps[3].variable,'beforeBox','host must not normalize model assertions');
  const accepted=mapModelPlan(good,prepareRequest);assert.equal(accepted.plan.cases.length,7);assert.equal(accepted.plan.cases.reduce((n,c)=>n+c.steps.length,0),46);
});

test('DSL schema failure uses one budgeted mock correction, with complete cases/Seed/required and cumulative known usage',async(t)=>{
  const {good,bad}=await planningSchemaCapture();const fixture=sdkFixture([JSON.stringify(bad),JSON.stringify(good)],[1512,1000]);const {app,root,request}=await setup(t,fixture.factory);
  await app.planning.start(request,request.preparationId);const record=await until(()=>app.planning.get(request.preparationId),r=>['completed','failed'].includes(r.snapshot.status));
  assert.equal(record.snapshot.status,'completed',JSON.stringify(record.snapshot.error));assert.equal(fixture.state.calls,2);assert.deepEqual(fixture.state.caps,[8192,6680]);
  assert.equal(record.snapshot.usage.modelSteps,2);assert.equal(record.snapshot.usage.inputTokens,1634);assert.equal(record.snapshot.usage.outputTokens,2512);assert.deepEqual(record.snapshot.result!.usage,record.snapshot.usage);
  assert.equal(record.snapshot.result!.plan.cases.length,7);for(const item of request.seed.items){const actual=record.snapshot.result!.spec.criteria.find(c=>c.id===item.id)!;assert.equal(actual.description,item.text);assert.equal(actual.required,item.required);}
  assert.equal(fixture.state.prompts.filter(p=>p.includes('Prior output failed structural validation')).length,1);assert.ok(fixture.state.prompts[1].includes('dsl_schema_invalid'));assert.ok(!fixture.state.prompts[1].includes('RAW_MODEL_LABEL_DO_NOT_LOG'));
  for(const prompt of fixture.state.prompts)assert.ok(prompt.includes(request.seed.goal));assert.equal(record.events.filter(e=>e.event.type==='planning.progress').length,1);
  const logs=(await readFile(path.join(root,'delivery',request.preparationId,'model/model-diagnostics.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const schema=logs.find(e=>e.stage==='dsl_schema_invalid');assert.equal(schema.issues.length,12);assert.equal(schema.interruption,null);assert.ok(!JSON.stringify(logs).includes('RAW_MODEL_LABEL_DO_NOT_LOG'));assert.equal(app.runtime.records.size,0);
});

test('DSL retry is skipped when remaining original output cannot fund the previous observed cost',async(t)=>{
  const {good,bad}=await planningSchemaCapture();const fixture=sdkFixture([JSON.stringify(bad),JSON.stringify(good)],[5269,1000]);const {app,root,request}=await setup(t,fixture.factory);
  await app.planning.start(request,request.preparationId);const r=await until(()=>app.planning.get(request.preparationId),r=>r.snapshot.status==='failed');assert.equal(fixture.state.calls,1);assert.equal(r.snapshot.error!.code,'BUDGET_EXCEEDED');assert.equal(r.snapshot.usage.outputTokens,5269);assert.equal(r.snapshot.result,null);
  const log=await readFile(path.join(root,'delivery',request.preparationId,'model-diagnostics.jsonl'),'utf8');assert.match(log,/retry_skipped/);assert.match(log,/insufficient_settled_output/);
});

test('JSON and DSL failures share the same single retry, never a separate retry per error category',async(t)=>{
  const {good,bad}=await planningSchemaCapture();for(const outputs of [[JSON.stringify(bad),'{',JSON.stringify(good)],['{',JSON.stringify(bad),JSON.stringify(good)]]){
    const fixture=sdkFixture(outputs,[100,100,100]);const {app,request}=await setup(t,fixture.factory);await app.planning.start(request,request.preparationId);const r=await until(()=>app.planning.get(request.preparationId),r=>r.snapshot.status==='failed');
    assert.equal(fixture.state.calls,2);assert.equal(r.snapshot.usage.modelSteps,2);assert.equal(r.snapshot.usage.outputTokens,200);assert.equal(r.snapshot.result,null);assert.equal(r.events.filter(e=>e.event.type==='planning.progress').length,1);
  }
});

test('unknown native usage and real input authorization/hash failures never enter model-format retry',async(t)=>{
  const {bad}=await planningSchemaCapture();const fixture=sdkFixture([JSON.stringify(bad)],[],false);const {app,request}=await setup(t,fixture.factory);await app.planning.start(request,request.preparationId);const r=await until(()=>app.planning.get(request.preparationId),r=>r.snapshot.status==='failed');
  assert.equal(fixture.state.calls,1);assert.equal(r.snapshot.usage.inputTokens,null);assert.equal(r.snapshot.usage.outputTokens,null);assert.equal(r.events.filter(e=>e.event.type==='planning.progress').length,0);
  for(const status of [403,200]){
    const server=createServer((_req,res)=>{res.writeHead(status,{'content-type':'application/json'});res.end('{}');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address();if(!address||typeof address==='string')throw new Error('no test input origin');
    const blocked=sdkFixture(['{}']);const instance=await setup(t,blocked.factory,`http://127.0.0.1:${address.port}`);instance.request.baseVersionId='version_fixture';instance.request.input={kind:'version',versionId:'version_fixture',artifactId:'artifact_fixture',manifestSha256:'a'.repeat(64)};
    await instance.app.planning.start(instance.request,instance.request.preparationId);const stopped=await until(()=>instance.app.planning.get(instance.request.preparationId),r=>r.snapshot.status==='failed');assert.equal(blocked.state.calls,0);assert.equal(stopped.snapshot.usage.modelSteps,0);assert.equal(stopped.events.filter(e=>e.event.type==='planning.progress').length,0);
  }
});
