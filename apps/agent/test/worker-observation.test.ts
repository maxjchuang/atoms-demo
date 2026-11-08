import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeepSeekHarness, HarnessNotification } from '@deepseek-ai/dsh-sdk-client';
import { prepareRequest, binding as sampleBinding } from '@atoms/contracts/delivery-fixtures';
import { startExecution } from '@atoms/contracts/fixtures';
import { DeliveryExecutionRequest, DeliveryExecutionSnapshot } from '@atoms/contracts/delivery';
import { DshAdapter } from '../src/adapters.js';
import { trustedTemplate, profileData } from '../src/trusted-template.js';
import { seal } from '../src/delivery-files.js';
import { createAgentServer } from '../src/runtime.js';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(read:()=>T,done:(v:T)=>boolean){for(let i=0;i<1000;i++){const v=read();if(done(v))return v;await delay(10);}throw new Error('worker observation timeout');}

test('M2 Worker transport interruption exposes unknown totals while settled lower bound and terminal replay remain durable',async(t)=>{
  let calls=0;
  const run=async(_prompt:string,callbacks:{onNotification?:(n:HarnessNotification)=>void})=>{
    calls++;const emit=(type:string,seq:number,step:number,usage?:object)=>callbacks.onNotification?.({method:'session.event',params:{sessionId:'session_explicit_mock_worker',event:{type,seq,data:{turn:1,step,...(usage?{usage}:{})}}}});
    emit('step/start',1,0);emit('assistant/message',2,0,{inputTokens:10,cacheReadTokens:5,outputTokens:20,totalTokens:35});emit('step/start',3,1);
    throw new Error('RAW_TRANSPORT_DETAIL_MUST_NOT_LOG');
  };
  const adapter=new DshAdapter({apiKey:'unit-test-only-unusable',harnessFactory:()=>({async start(){},session(){return{run};},async resumeSession(){return{run};},async close(){}} as unknown as DeepSeekHarness)});
  const root=await mkdtemp(path.join(os.tmpdir(),'atoms-worker-observation-'));const options={dataDir:root,mode:'fake' as const,serviceToken:'worker-observation-service-token',adapter};
  const app=createAgentServer(options);t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const request=structuredClone(prepareRequest);request.toolchain=(await trustedTemplate()).descriptor;request.profileHint={id:'profile_notes_v1',hash:(await profileData('profile_notes_v1')).hash};
  await app.planning.start(request,request.preparationId);const prep=await until(()=>app.planning.get(request.preparationId).snapshot,p=>p.status==='completed');const {spec,plan}=prep.result!;
  const binding=seal({...sampleBinding,toolchain:request.toolchain,seed:{id:request.seed.id,hash:request.seed.hash},spec:{id:spec.id,hash:spec.hash},plan:{id:plan.id,hash:plan.hash},planningUsage:prep.result!.usage});
  const wrapper=DeliveryExecutionRequest.parse({protocolVersion:'0.1.0',execution:{...startExecution,mode:'build',budget:{...request.totalBudget,maxWallTimeMs:request.totalBudget.maxWallTimeMs-prep.usage.activeMs}},bundle:{seed:request.seed,spec,plan,binding}});
  await app.delivery.start(wrapper,request.executionId);const item=await until(()=>app.runtime.get(request.executionId),r=>r.snapshot.status==='failed');
  const snapshot=DeliveryExecutionSnapshot.parse(app.delivery.snapshot(request.executionId));assert.equal(snapshot.cumulativeUsage.inputTokens,null);assert.equal(snapshot.cumulativeUsage.outputTokens,null);assert.equal(snapshot.cumulativeUsage.modelSteps,2);
  assert.deepEqual(item.usage,{modelSteps:2,inputTokens:15,outputTokens:20});assert.equal(item.usageKnown,false);assert.equal(item.snapshot.artifactId,null);assert.equal(app.delivery.report(request.executionId)!.quality,'blocked');
  const log=await readFile(path.join(root,'dsh',request.projectId,'model-diagnostics.jsonl'),'utf8');assert.match(log,/"usageKnown":false/);assert.match(log,/sdk_or_transport/);assert.ok(!log.includes('RAW_TRANSPORT_DETAIL_MUST_NOT_LOG'));
  await app.close();const replay=createAgentServer(options);t.after(()=>replay.close());const replaySnapshot=replay.delivery.snapshot(request.executionId);assert.equal(replaySnapshot.cumulativeUsage.inputTokens,null);assert.equal(replaySnapshot.cumulativeUsage.outputTokens,null);
  await replay.delivery.start(wrapper,request.executionId);assert.equal(calls,1);assert.equal(replay.runtime.get(request.executionId).events.filter(e=>e.event.type==='execution.started').length,1);
});
