import assert from 'node:assert/strict';import test from 'node:test';
import {prepareRequest} from '@atoms/contracts/delivery-fixtures';
import {RequirementSeed} from '@atoms/contracts/delivery';
import {declareDerivedCriteria,ModelPlanSchemaError} from '../src/planning-format.js';
import {seal} from '../src/delivery-files.js';
function requestFixture(){const request=structuredClone(prepareRequest);const [goal,first,second]=request.seed.items;request.seed=RequirementSeed.parse(seal({...request.seed,items:[goal,{...first,required:false,optionalEvidence:[{messageId:request.seed.source.messageIds[0],quote:'Explicit test-only optional requirement'}]},second]}));return request;}

test('derived declarations support n:M sources and required is inherited exclusively from trusted Seed flags',()=>{
  const request=requestFixture();const values=[{ref:'r0',description:'Automatic subset',sourceSeedRefs:['s0','s1']},{ref:'r1',description:'Optional manual subset',sourceSeedRefs:['s1']},{ref:'r2',description:'Second automatic subset',sourceSeedRefs:['s0','s2']}];
  const result=declareDerivedCriteria(values,request);assert.deepEqual(result.map(c=>c.criterion.required),[true,false,true]);assert.deepEqual(result[0].criterion.seedItemIds,[request.seed.items[0].id,request.seed.items[1].id]);
  assert.ok(result.every(c=>c.criterion.id!==c.ref&&c.criterion.id.startsWith('criterion_')));assert.deepEqual(declareDerivedCriteria(values,request),result);
  assert.equal(request.seed.goal,prepareRequest.seed.goal);assert.equal(request.seed.items[0].text,prepareRequest.seed.items[0].text);
});

test('missing/unknown/duplicate source refs, missing Seed mappings and model required/id authority are strictly rejected',()=>{
  const request=requestFixture();const valid=[{ref:'r0',description:'Complete source mapping',sourceSeedRefs:['s0','s1','s2']}];
  for(const invalid of [[],[{...valid[0],sourceSeedRefs:[]}],[{...valid[0],sourceSeedRefs:['s0','s1','s999']}],[{...valid[0],sourceSeedRefs:['s0','s1','s1','s2']}],[{...valid[0],sourceSeedRefs:['s0','s1']}],[valid[0],valid[0]],[{...valid[0],required:false}],[{...valid[0],id:'criterion_model_selected'}]])assert.throws(()=>declareDerivedCriteria(invalid,request),ModelPlanSchemaError);
});

import {FrozenDeliveryBinding,FrozenDeliveryBundle} from '@atoms/contracts/delivery';
import {binding as baseBinding,makeReport} from '@atoms/contracts/delivery-fixtures';
import {assertCanonicalSeedCoverage} from '@atoms/contracts/delivery-projection';
import {mapModelPlan} from '../src/planning-format.js';
import {mixedGoalDerivedProposal,capturedCoverageForms} from './fixtures/planning-schema-capture.js';
function singleGoalRequest(){const request=structuredClone(prepareRequest);request.planningMode='model_proposed';request.profileHint=null;request.seed=RequirementSeed.parse(seal({...request.seed,items:[request.seed.items[0]]}));return request;}

test('one compound Goal compiles six meaningful automatic behavior leaves and a required manual leaf into legal honest partial',async()=>{
  const request=singleGoalRequest();const raw=await mixedGoalDerivedProposal();const {spec,plan}=mapModelPlan(raw,request);
  assert.equal(plan.cases.length,6);assert.equal(plan.cases.reduce((n,c)=>n+c.steps.length,0),31);assert.equal(spec.criteria.length,8);
  const parent=spec.criteria.find(c=>c.id===request.seed.items[0].id)!;assert.equal(parent.description,request.seed.goal);assert.equal(parent.required,true);
  assert.ok(spec.criteria.every(c=>c.required&&c.seedItemIds.includes(parent.id)));assert.equal(plan.coverage.filter(c=>c.method==='automated').length,6);assert.equal(plan.coverage.filter(c=>c.method==='manual').length,2);
  assert.ok(plan.cases.every(c=>!c.criterionIds.includes(parent.id)));assertCanonicalSeedCoverage(request.seed,spec,plan);
  const binding=FrozenDeliveryBinding.parse(seal({...baseBinding,seed:{id:request.seed.id,hash:request.seed.hash},spec:{id:spec.id,hash:spec.hash},plan:{id:plan.id,hash:plan.hash},planningMode:'model_proposed'}));
  const bundle=FrozenDeliveryBundle.parse({seed:request.seed,spec,plan,binding});const report=makeReport(bundle);assert.equal(report.quality,'partial');assert.equal(report.gaps.length,2);assert.ok(report.gaps.every(g=>g.required&&g.coverage==='manual'));
});

test('both captured conflicts stay strict and one budgeted mock correction returns a real split with full Goal mapping',async(t)=>{
  const request=singleGoalRequest();const forms=await capturedCoverageForms();
  assert.equal(forms.first.cases.length,4);assert.equal(forms.first.cases.reduce((n,c)=>n+c.steps.length,0),39);
  assert.equal(forms.second.cases.length,6);assert.equal(forms.second.cases.reduce((n,c)=>n+c.steps.length,0),42);
  for(const [raw,code]of [[forms.first,'case_coverage_backlink'],[forms.second,'coverage_duplicate']] as const){
    let failure!:ModelPlanSchemaError;try{mapModelPlan(raw,request);}catch(error){failure=error as ModelPlanSchemaError;}assert.ok(failure instanceof ModelPlanSchemaError);assert.ok(failure.issues.every(issue=>issue.code===code&&issue.path.length>0));
  }
  assert.equal(forms.first.coverage[0].method,'manual');assert.equal(forms.first.cases.length,4);assert.equal(forms.second.coverage.length,2,'no host dedup or conversion');
  const root=await mkdtemp(path.join(os.tmpdir(),'atoms-derived-mock-correction-'));const good=await mixedGoalDerivedProposal();let calls=0;const caps:(number|undefined)[]=[];const prompts:string[]=[];
  const adapter=new DshPlanningAdapter({apiKey:'unit-test-only-unusable',harnessFactory:options=>{caps.push(options.maxTokens);return{async run(prompt:string,callbacks:{onNotification?:(n:HarnessNotification)=>void}){
    prompts.push(prompt);const index=calls++;const usage=index===0?{inputTokens:1403,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:1130,totalTokens:2533}:{inputTokens:566,cacheReadTokens:1024,cacheWriteTokens:0,outputTokens:1325,totalTokens:2915};
    const emit=(type:string,seq:number,data:object)=>callbacks.onNotification?.({method:'session.event',params:{sessionId:'session_explicit_derived_mock',event:{type,seq,data:{turn:1,step:0,...data}}}});emit('step/start',1,{});emit('assistant/message',2,{usage});
    return{sessionId:'session_explicit_derived_mock',finalResponse:JSON.stringify(index===0?forms.first:good),finishReason:'completed',events:[],notifications:[]} as RunResult;
  },async close(){}} as unknown as DeepSeekHarness;}});
  const app=createAgentServer({dataDir:root,mode:'fake',serviceToken:'derived-model-correction-token',planningAdapter:adapter});t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});request.toolchain=(await trustedTemplate()).descriptor;
  await app.planning.start(request,request.preparationId);for(let i=0;i<1000&&!['completed','failed'].includes(app.planning.get(request.preparationId).snapshot.status);i++)await new Promise(resolve=>setTimeout(resolve,10));
  const record=app.planning.get(request.preparationId);assert.equal(record.snapshot.status,'completed',JSON.stringify(record.snapshot.error));assert.equal(calls,2);assert.deepEqual(caps,[8192,7062]);assert.equal(record.snapshot.usage.modelSteps,2);assert.equal(record.snapshot.usage.inputTokens,2993);assert.equal(record.snapshot.usage.outputTokens,2455);
  assert.ok(prompts[1].includes('case_coverage_backlink'));assert.ok(!prompts[1].includes(forms.first.coverage[0].reason));assert.ok(prompts.every(prompt=>prompt.includes(request.seed.goal)));
  const result=record.snapshot.result!;assert.equal(result.spec.originalGoal,request.seed.goal);assert.ok(result.spec.criteria.every(c=>c.required));assert.equal(result.plan.cases.length,6);assertCanonicalSeedCoverage(request.seed,result.spec,result.plan);assert.equal(result.plan.coverage.filter(c=>c.method==='manual').length,2);assert.equal(app.runtime.records.size,0);

});

import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from'node:os';import path from'node:path';
import {createAgentServer} from '../src/runtime.js';import {trustedTemplate,profileData} from '../src/trusted-template.js';

test('already-completed host_profile and seed-only model results replay byte-for-byte without new compilation or model calls',async(t)=>{
  for(const mode of ['host_profile','model_proposed'] as const){
    const root=await mkdtemp(path.join(os.tmpdir(),'atoms-old-plan-readonly-'));const options={dataDir:root,mode:'fake' as const,serviceToken:'readonly-plan-replay-token'};const app=createAgentServer(options);
    const request=structuredClone(prepareRequest);request.planningMode=mode;request.toolchain=(await trustedTemplate()).descriptor;request.profileHint={id:'profile_notes_v1',hash:(await profileData('profile_notes_v1')).hash};
    await app.planning.start(request,request.preparationId);for(let i=0;i<1000&&app.planning.get(request.preparationId).snapshot.status!=='completed';i++)await new Promise(r=>setTimeout(r,10));
    const old=JSON.stringify(app.planning.get(request.preparationId).snapshot);assert.equal(app.planning.get(request.preparationId).snapshot.result!.spec.criteria.length,request.seed.items.length);await app.close();
    const ledger=path.join(root,'delivery/preparations.json');const bytes=await readFile(ledger,'utf8');let calls=0;
    const replay=createAgentServer({...options,planningAdapter:{ready:()=>true,async plan(){calls++;throw new Error('must not recompile historical result');},async close(){}}});
    await replay.planning.start(request,request.preparationId);assert.equal(JSON.stringify(replay.planning.get(request.preparationId).snapshot),old);assert.equal(calls,0);await replay.close();assert.equal(await readFile(ledger,'utf8'),bytes);await rm(root,{recursive:true,force:true});
  }
});

import {DshPlanningAdapter} from '../src/delivery-planning.js';
import type {DeepSeekHarness,HarnessNotification,RunResult} from '@deepseek-ai/dsh-sdk-client';
