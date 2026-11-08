/** API-only HTTP/Fake regression. No model, Agent implementation or browser is executed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import * as D from '@atoms/contracts/delivery';
import {projectCanonicalSeedCoverage} from '@atoms/contracts/delivery-projection';
import {createApi,hash} from '../src/server.js';
import {createFakeDeliveryRuntime} from '../src/fake-delivery-runtime.js';

const signed=<T extends object>(value:T):T&{hash:string}=>({...value,hash:hash(D.deliveryHashBody(value as Record<string,unknown>))});
type Transform=(snapshot:D.PlanPreparationSnapshotDto,request:D.PrepareDeliveryPlanRequestDto)=>D.PlanPreparationSnapshotDto;

function derived(snapshot:D.PlanPreparationSnapshotDto,request:D.PrepareDeliveryPlanRequestDto,allAutomatic=false):D.PlanPreparationSnapshotDto {
 const proposed=snapshot.result!;
 const automatic=request.seed.items.map((item,index)=>({id:`criterion_derived_${index}`,description:`Synthetic automatic leaf ${index}`,required:item.required,seedItemIds:[item.id]}));
 const other=[{id:'criterion_manual',description:'Human review of the intended design',required:request.seed.items[0].required,seedItemIds:[request.seed.items[0].id]},
  {id:'criterion_unsupported',description:'Behavior outside this synthetic DSL fixture',required:request.seed.items[0].required,seedItemIds:[request.seed.items[0].id]}];
 const leaves=[...automatic,...other];
 const spec=D.AcceptanceSpec.parse(signed({...proposed.spec,criteria:[...request.seed.items.map(item=>({id:item.id,description:item.text,required:item.required,seedItemIds:[item.id]})),...leaves]}));
 const cases=automatic.map((criterion,index)=>({id:`case_derived_${index}`,name:`Synthetic automatic case ${index}`,criterionIds:[criterion.id],steps:proposed.plan.cases[0].steps}));
 if(allAutomatic)cases.push({id:'case_derived_extra',name:'Synthetic additional case',criterionIds:other.map(c=>c.id),steps:proposed.plan.cases[0].steps});
 const leafPlan=D.BrowserTestPlan.parse(signed({...proposed.plan,spec:{id:spec.id,hash:spec.hash},cases,
  coverage:leaves.map((criterion,index)=>index<automatic.length
   ? {criterionId:criterion.id,method:'automated',caseIds:[`case_derived_${index}`],reason:null}
   : allAutomatic?{criterionId:criterion.id,method:'automated',caseIds:['case_derived_extra'],reason:null}
   : {criterionId:criterion.id,method:index===automatic.length?'manual':'unsupported',caseIds:[],reason:`Synthetic concrete gap for ${criterion.id}.`})}));
 const plan=D.BrowserTestPlan.parse(signed({...leafPlan,...projectCanonicalSeedCoverage(request.seed,spec,leafPlan)}));
 return {...snapshot,result:{...proposed,spec,plan}};
}

function reseal(snapshot:D.PlanPreparationSnapshotDto):D.PlanPreparationSnapshotDto {
 const proposed=snapshot.result!;
 proposed.spec=signed(proposed.spec);
 proposed.plan=signed({...proposed.plan,spec:{id:proposed.spec.id,hash:proposed.spec.hash}});
 return snapshot;
}

async function fixture(hostProfile=false){
 const directory=await mkdtemp(join(tmpdir(),'atoms-api-projection-')),runtime=createFakeDeliveryRuntime();
 let transform:Transform|undefined,snapshotResponses=0;
 // Transform only the Fake's HTTP boundary. It cannot inspect or mutate API business state.
 runtime.app.addHook('onSend',async(request,reply,payload)=>{
  if(reply.statusCode>=300||!/^\/internal\/delivery\/v1\/preparations\/[^/?]+$/.test(request.url)||typeof payload!=='string')return payload;
  snapshotResponses++;
  if(!transform)return payload;
  const snapshot=JSON.parse(payload) as D.PlanPreparationSnapshotDto;
  if(!snapshot.result)return payload;
  return JSON.stringify(transform(structuredClone(snapshot),runtime.preparations.get(snapshot.id)!.request));
 });
 const address=await runtime.app.listen({host:'127.0.0.1',port:0});
 const options={dataDir:directory,agentUrl:address,serviceToken:'delivery-test-token',previewSecret:'projection-preview-secret',previewOrigin:'http://127.0.0.1:3002',autoSchedule:false,deliveryToolchain:runtime.toolchain,
  ...(hostProfile?{deliveryPlanningMode:'host_profile' as const,deliveryProfileHint:{id:'profile_fixture',hash:'a'.repeat(64)}}:{})};
 let api=await createApi(options),cookie='';api.seedCode('projection-demo',{projectLimit:3,runLimit:20});
 const request=async(method:'GET'|'POST',url:string,body?:unknown)=>{
  const response=await api.app.inject({method,url,headers:{cookie,'idempotency-key':randomUUID(),'x-atoms-delivery-version':D.DeliveryProtocolVersion},...(body?{payload:body as object}:{})});
  return {status:response.statusCode,data:response.json(),headers:response.headers};
 };
 const login=await request('POST','/api/v1/sessions',{code:'projection-demo'});cookie=String(login.headers['set-cookie']).split(';')[0];
 assert.equal(login.status,201);
 const project=(await request('POST','/api/v1/projects',{title:'Projection API fixture'})).data;
 const start=async(prompt='Synthetic mixed derived requirement')=>{const response=await request('POST',`/api/v1/projects/${project.id}/runs`,{prompt,mode:'build'});assert.equal(response.status,202);return response.data.run;};
 const settle=async(runId:string)=>{for(let n=0;n<7;n++){await api.tick();const run=(await request('GET',`/api/v1/runs/${runId}`)).data;if(['succeeded','failed','cancelled','interrupted'].includes(run.status))return run;}throw new Error('Synthetic run did not settle');};
 return {get api(){return api;},runtime,project,request,start,settle,setTransform(value:Transform|undefined){transform=value;},get snapshotResponses(){return snapshotResponses;},
  async restart(){await api.close();api=await createApi(options);},async close(){await api.close();await runtime.app.close();await rm(directory,{recursive:true,force:true});}};
}

test('new mixed derived proposal freezes exact data, publishes partial and preserves concrete leaf/parent gaps',async()=>{
 const f=await fixture();try{
  f.setTransform((snapshot,request)=>derived(snapshot,request));
  const run=await f.start(),done=await f.settle(run.id);assert.equal(done.status,'succeeded');
  const record=f.api.store.state.runs.find(r=>r.dto.id===run.id)!,wrapper=record.delivery!.wrapper!;
  assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);
  const prep=f.runtime.preparations.get(record.delivery!.preparationId)!;
  assert.deepEqual(wrapper.bundle.spec,derived(prep.snapshot,prep.request).result!.spec);
  assert.deepEqual(wrapper.bundle.plan,derived(prep.snapshot,prep.request).result!.plan);
  assert.equal(wrapper.bundle.seed.goal,record.delivery!.prepare!.seed.goal);
  const view=(await f.request('GET',`/api/delivery/v1/runs/${run.id}`)).data;
  assert.equal(view.quality,'partial');assert.equal(view.publication.status,'published');
  for(const id of ['criterion_manual','criterion_unsupported',wrapper.bundle.seed.items[0].id])assert.ok(view.gaps.some((gap:{criterionId:string})=>gap.criterionId===id));
  assert.match(wrapper.bundle.plan.coverage.find(c=>c.criterionId===wrapper.bundle.seed.items[0].id)!.reason!,/criterion_manual.*Human review/);
 }finally{await f.close();}
});

test('API rejects invalid parent/reason/backlinks, required/source and missing Seed/leaf coverage before wrapper or dispatch',async()=>{
 const f=await fixture();try{
  const initial=await f.settle((await f.start('Existing seed-only model fixture')).id);assert.equal(initial.status,'succeeded');
  const mutations:{name:string;allAutomatic?:boolean;change:(snapshot:D.PlanPreparationSnapshotDto,request:D.PrepareDeliveryPlanRequestDto)=>void}[]=[
   {name:'parent_method',change:(s,r)=>{const p=s.result!.plan,parent=p.coverage.find(c=>c.criterionId===r.seed.items[0].id)!;parent.method='automated';parent.caseIds=[p.cases[0].id];parent.reason=null;p.cases[0].criterionIds.push(parent.criterionId);}},
   {name:'parent_reason',change:(s,r)=>{s.result!.plan.coverage.find(c=>c.criterionId===r.seed.items[0].id)!.reason='Invented parent summary';}},
   {name:'missing_backlink',allAutomatic:true,change:(s,r)=>{const p=s.result!.plan,id=r.seed.items[0].id,last=p.cases.at(-1)!;last.criterionIds=last.criterionIds.filter(ref=>ref!==id);p.coverage.find(c=>c.criterionId===id)!.caseIds=p.coverage.find(c=>c.criterionId===id)!.caseIds.filter(ref=>ref!==last.id);}},
   {name:'lower_required',change:s=>{s.result!.spec.criteria.find(c=>c.id==='criterion_derived_0')!.required=false;}},
   {name:'foreign_source',change:s=>{s.result!.spec.criteria.find(c=>c.id==='criterion_derived_0')!.seedItemIds=['criterion_foreign'];}},
   {name:'missing_seed',change:(s,r)=>{const id=r.seed.items[0].id;s.result!.spec.criteria=s.result!.spec.criteria.filter(c=>c.id!==id);s.result!.plan.coverage=s.result!.plan.coverage.filter(c=>c.criterionId!==id);}},
   {name:'missing_leaf_coverage',change:s=>{s.result!.plan.coverage=s.result!.plan.coverage.filter(c=>c.criterionId!=='criterion_manual');}},
   {name:'foreign_case_reference',change:s=>{s.result!.plan.cases[0].criterionIds.push('criterion_foreign');}},
  ];
  for(const mutation of mutations){
   f.setTransform((snapshot,request)=>{const changed=derived(snapshot,request,mutation.allAutomatic);mutation.change(changed,request);return reseal(changed);});
   const run=await f.start(mutation.name),done=await f.settle(run.id);assert.equal(done.status,'failed',mutation.name);
   const record=f.api.store.state.runs.find(r=>r.dto.id===run.id)!;assert.equal(record.delivery!.wrapper,undefined,mutation.name);assert.equal(record.dto.resultVersionId,null,mutation.name);
   assert.equal(f.runtime.executeCalls,1,mutation.name);assert.equal(f.api.store.state.projects.find(p=>p.dto.id===f.project.id)!.dto.currentVersionId,initial.resultVersionId,mutation.name);
  }
  assert.equal(f.runtime.prepareCalls,1+mutations.length);assert.equal(f.api.store.state.versions.length,1);
 }finally{await f.close();}
});

test('existing freeze authority rejects preparation spending beyond planning share even below total budget',async()=>{
 const f=await fixture();try{
  f.setTransform((snapshot,request)=>{
   const changed=derived(snapshot,request);const modelSteps=request.planningBudget.maxModelSteps+1;
   assert.ok(modelSteps<request.totalBudget.maxModelSteps);changed.usage.modelSteps=modelSteps;changed.result!.usage.modelSteps=modelSteps;return changed;
  });
  const run=await f.start(),done=await f.settle(run.id);assert.equal(done.status,'failed');
  const record=f.api.store.state.runs[0];assert.equal(record.delivery!.wrapper,undefined);assert.equal(f.runtime.executeCalls,0);assert.equal(f.api.store.state.versions.length,0);
  assert.equal((await f.request('GET','/api/v1/session')).data.quota.runsUsed,1);
 }finally{await f.close();}
});

test('restart uses the already frozen derived wrapper unchanged without reprojecting or charging preparation again',async()=>{
 const f=await fixture();try{
  f.setTransform((snapshot,request)=>derived(snapshot,request));const run=await f.start();await f.api.tick();
  const wrapper=structuredClone(f.api.store.state.runs[0].delivery!.wrapper!);assert.ok(wrapper);assert.equal(f.runtime.executeCalls,0);
  const responseCount=f.snapshotResponses,quota=(await f.request('GET','/api/v1/session')).data.quota;
  f.setTransform(()=>{throw new Error('A frozen execution must not read or recompile its old preparation');});
  await f.restart();assert.equal((await f.settle(run.id)).status,'succeeded');
  assert.deepEqual(f.api.store.state.runs[0].delivery!.wrapper,wrapper);assert.equal(f.snapshotResponses,responseCount);assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);
  assert.deepEqual((await f.request('GET','/api/v1/session')).data.quota,quota);
  const history=JSON.stringify({runs:f.api.store.state.runs,versions:f.api.store.state.versions});await f.restart();await f.api.tick();
  assert.equal(JSON.stringify({runs:f.api.store.state.runs,versions:f.api.store.state.versions}),history);assert.equal(f.snapshotResponses,responseCount);
 }finally{await f.close();}
});

for(const hostProfile of [false,true])test(`${hostProfile?'host-profile':'old seed-only model'} completed data remains byte-stable on read/restart with no projection or repeated charge`,async()=>{
 const f=await fixture(hostProfile);try{
  const run=await f.start(),done=await f.settle(run.id);assert.equal(done.status,'succeeded');
  const record=f.api.store.state.runs[0],prepared=f.runtime.preparations.get(record.delivery!.preparationId)!;
  assert.deepEqual(record.delivery!.wrapper!.bundle.spec,prepared.snapshot.result!.spec);assert.deepEqual(record.delivery!.wrapper!.bundle.plan,prepared.snapshot.result!.plan);
  const before=JSON.stringify({runs:f.api.store.state.runs,versions:f.api.store.state.versions}),responseCount=f.snapshotResponses,quota=(await f.request('GET','/api/v1/session')).data.quota;
  f.setTransform(()=>{throw new Error('Completed history is read-only');});await f.restart();await f.api.tick();
  assert.equal((await f.request('GET',`/api/delivery/v1/runs/${run.id}`)).data.quality,'complete');
  assert.equal(JSON.stringify({runs:f.api.store.state.runs,versions:f.api.store.state.versions}),before);assert.equal(f.snapshotResponses,responseCount);
  assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);assert.deepEqual((await f.request('GET','/api/v1/session')).data.quota,quota);
 }finally{await f.close();}
});
