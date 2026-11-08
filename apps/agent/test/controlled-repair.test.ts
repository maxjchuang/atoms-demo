import assert from'node:assert/strict';import test from'node:test';
import{mkdtemp,readFile,rm}from'node:fs/promises';import os from'node:os';import path from'node:path';
import{unzipSync}from'fflate';
import{executionRequest}from'@atoms/contracts/delivery-fixtures';import{DeliveryExecutionRequest}from'@atoms/contracts/delivery';
import{assertControlledRealGuard,makeFakeControlledBaseline,loadControlledBaseline,runControlledRepair,CONTROLLED_BUDGET}from'../src/controlled-smoke.js';
import{SourceBaselineAdapter,STORAGE_FAULT_MARKER}from'../src/controlled-repair.js';import{FakeDshAdapter}from'../src/adapters.js';
import{createAgentServer}from'../src/runtime.js';import{sha256}from'../src/files.js';import{browserEnvironment}from'../src/verify.js';

test('real controlled command requires both explicit guards and reviewed source flags without reading model credentials',()=>{
  const env=new Proxy({ATOMS_ALLOW_REAL_CONTROLLED_REPAIR:'1'} as Record<string,string|undefined>,{get(target,key){if(key==='DEEPSEEK_API_KEY')throw new Error('Guard must not read model key');return target[String(key)];}});
  assert.equal(assertControlledRealGuard(['--fake'],env),false);
  for(const [args,e]of [[['--real'],{}],[['--real','--base-artifact','x','--base-version','version_x'],{}],[['--real'],env],[['--real','--fake'],env],[[],env]] as const)assert.throws(()=>assertControlledRealGuard([...args],e));
  assert.equal(assertControlledRealGuard(['--real','--base-artifact','x','--base-version','version_x'],env),true);
  assert.ok(!('DEEPSEEK_API_KEY'in browserEnvironment()));
});

test('source-baseline mode cannot be used without trusted constructor provenance and wire cannot enable hooks',()=>{
  assert.throws(()=>createAgentServer({dataDir:path.join(os.tmpdir(),'must-not-create-controlled'),mode:'fake',serviceToken:'constructor-provenance-token',adapter:new SourceBaselineAdapter(new FakeDshAdapter())}),/trusted controlled provenance/);
  assert.equal(DeliveryExecutionRequest.safeParse({...executionRequest,trustedSourceFault:true}).success,false);
  assert.equal(DeliveryExecutionRequest.safeParse({...executionRequest,trustedHostPlan:{id:'profile_from_wire'}}).success,false);
});

test('Fake real-browser controlled failure repairs same plan, preserves source/patch proof and exact clean export; bad baseline never creates replacement', {timeout:240000},async(t)=>{
  const fixture=await mkdtemp(path.join(os.tmpdir(),'atoms-controlled-test-fixture-'));const baseline=await makeFakeControlledBaseline(fixture);const originalHash=sha256(await readFile(path.join(baseline.artifactRoot,'manifest.json')));
  t.after(async()=>{if(process.env.ATOMS_KEEP_AGENT_TEST_DATA!=='1')await rm(fixture,{recursive:true,force:true});});
  await assert.rejects(loadControlledBaseline(baseline.artifactRoot,'version_test'),'Fake fixture must never qualify as a verified real source');
  let failedDir='';try{await runControlledRepair({mode:'fake',baseline:{...baseline,sourceHash:'a'.repeat(64)}});}catch(error){failedDir=(error as Error).message.match(/evidence retained at (.+?)\. No replacement/)?.[1]||'';}
  assert.ok(failedDir);const failed=JSON.parse(await readFile(path.join(failedDir,'controlled-failed.json'),'utf8'));assert.equal(failed.noReplacement,true);
  const failedRecords=JSON.parse(await readFile(path.join(failedDir,'agent/executions.json'),'utf8'));assert.equal(failedRecords.length,1);assert.equal(failedRecords[0].snapshot.status,'failed');assert.equal(failedRecords[0].usage.modelSteps,0);assert.equal(failedRecords[0].events.filter((e:any)=>e.event.type==='execution.started').length,0);
  const result=await runControlledRepair({mode:'fake',baseline,apiKey:'UNIT_SENTINEL_MUST_NOT_ENTER_SOURCE'}) as {dataDir:string;executionId:string;planHash:string;modelMode:string;usage:{modelSteps:number};attempts:unknown[]};
  assert.equal(result.modelMode,'fake');assert.equal(result.usage.modelSteps,1);assert.equal(result.attempts.length,2);
  const report=JSON.parse(await readFile(path.join(result.dataDir,'agent/executions',result.executionId,'delivery-state.json'),'utf8')).report;
  assert.deepEqual(report.attempts.map((a:any)=>a.status),['failed','passed']);assert.equal(report.attempts[0].sourceProvenance.kind,'controlled_regression');assert.equal(report.attempts[1].sourceProvenance.adapterMode,'fake');
  assert.deepEqual(report.attempts[0].caseResults.filter((c:any)=>c.status==='failed').map((c:any)=>c.caseId),['case_persist']);assert.ok(report.attempts.every((a:any)=>a.planHash===result.planHash&&a.sourceBeforeHash===a.sourceAfterHash));
  const base=path.join(result.dataDir,'agent/executions',result.executionId);const patch=await readFile(path.join(base,'evidence/attempt_0/controlled-patch.json'));assert.equal(sha256(patch),report.attempts[0].sourceProvenance.patchHash);
  const parsed=JSON.parse(patch.toString());assert.equal(parsed.origin.kind,'fake_fixture');assert.equal(parsed.edits.length,2);assert.equal(parsed.baseSourceHash,baseline.sourceHash);assert.equal(parsed.frozenPlanHash,result.planHash);assert.equal(parsed.originalPlanHash,baseline.plan.hash);
  assert.equal(sha256(await readFile(path.join(base,'controlled/base/source/src/main.tsx'))),parsed.edits[0].beforeHash);
  assert.equal(sha256(await readFile(path.join(base,'controlled/injected/source/src/main.tsx'))),parsed.edits[0].afterHash);
  const exported=await readFile(path.join(base,'delivery/source.zip'));assert.equal(sha256(exported),report.exportManifest.archive.sha256);
  for(const [name,bytes]of Object.entries(unzipSync(exported))){const text=Buffer.from(bytes).toString();assert.ok(!text.includes('UNIT_SENTINEL_MUST_NOT_ENTER_SOURCE'),name);assert.ok(!text.includes(STORAGE_FAULT_MARKER),name);}
  const records=JSON.parse(await readFile(path.join(result.dataDir,'agent/executions.json'),'utf8'));assert.equal(records.length,1);assert.equal(records[0].events.filter((e:any)=>e.event.type==='execution.started').length,1);assert.equal(records[0].repairRoundsUsed,1);
  assert.deepEqual(records[0].delivery.bundle.plan.cases,baseline.plan.cases);assert.deepEqual(records[0].delivery.bundle.plan.coverage,baseline.plan.coverage);assert.deepEqual(records[0].delivery.bundle.spec.criteria,baseline.spec.criteria);assert.deepEqual(records[0].delivery.bundle.binding.totalBudget,CONTROLLED_BUDGET);
  assert.equal(sha256(await readFile(path.join(baseline.artifactRoot,'manifest.json'))),originalHash);
  if(process.env.ATOMS_KEEP_AGENT_TEST_DATA==='1')console.log('Controlled Fake test retained:',result.dataDir,'negative:',failedDir);else{await rm(result.dataDir,{recursive:true,force:true});await rm(failedDir,{recursive:true,force:true});}
});
