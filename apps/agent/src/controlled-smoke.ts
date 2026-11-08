import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import { ArtifactManifest, type ArtifactManifestDto } from '@atoms/contracts';
import { startExecution } from '@atoms/contracts/fixtures';
import { prepareRequest } from '@atoms/contracts/delivery-fixtures';
import { AcceptanceSpec, BrowserTestPlan, DeliveryReport, RequirementSeed, DeliveryExecutionRequest, FrozenDeliveryBinding, canonicalDeliveryJson,
  type AcceptanceSpecDto,type BrowserTestPlanDto,type RequirementSeedDto } from '@atoms/contracts/delivery';
import { createAgentServer } from './runtime.js';
import { DshAdapter,FakeDshAdapter,type AdapterContext,type PlanValue } from './adapters.js';
import { SourceBaselineAdapter,STORAGE_FAULT_FILE,STORAGE_FAULT_IMPORT,STORAGE_FAULT_MARKER,STORAGE_FAULT_PREFIX } from './controlled-repair.js';
import { putFile,safeFile,listFiles,sha256 } from './files.js';
import { fingerprints,inventoryHash,seal,assertSealed } from './delivery-files.js';
import { trustedTemplate,profileData,profileProposal } from './trusted-template.js';
import { verifyApplication,mediaType } from './verify.js';
import { runBrowserPlan } from './browser-dsl.js';
import { assertControlledSource } from './source-policy.js';
import { fakeApplication } from './template.js';
import { applySourceEdit } from './source-edits.js';

export const CONTROLLED_BUDGET={maxWallTimeMs:900000,maxWaitingInputMs:86400000,maxRepairRounds:2,maxModelSteps:8,maxInputTokens:65536,maxOutputTokens:24576,maxArtifactBytes:20971520};
export type ControlledBaseline={artifactRoot:string;manifest:ArtifactManifestDto;rawManifest:Buffer;seed:RequirementSeedDto;spec:AcceptanceSpecDto;plan:BrowserTestPlanDto;
  sourceHash:string;versionId:string;originExecutionId:string;reportHash:string;kind:'real_verified_source'|'fake_fixture'};
const token='controlled_input_'+randomUUID().replaceAll('-','');
const uid=(prefix:string)=>`${prefix}_${randomUUID().replaceAll('-','').slice(0,22)}`;
function expect(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
export function assertControlledRealGuard(args:string[],env:Record<string,string|undefined>){
  const real=args.includes('--real');const fake=args.includes('--fake');
  if(real===fake)throw new Error('Choose explicit --fake or double-guarded --real.');
  if(real&&env.ATOMS_ALLOW_REAL_CONTROLLED_REPAIR!=='1')throw new Error('Real controlled repair requires ATOMS_ALLOW_REAL_CONTROLLED_REPAIR=1 and --real.');
  if(real&&(!args.includes('--base-artifact')||!args.includes('--base-version')))throw new Error('Real mode requires reviewed --base-artifact and --base-version.');
  return real;
}
export async function loadControlledBaseline(artifactRoot:string,versionId:string):Promise<ControlledBaseline>{
  const rawManifest=await readFile(path.join(artifactRoot,'manifest.json'));const manifest=ArtifactManifest.parse(JSON.parse(rawManifest.toString()));
  let total=0;for(const file of manifest.files){expect(/^(source|dist|evidence)\//.test(file.path)&&!/(^|\/)(\.env(?:\..*)?|node_modules|\.git|\.dsh)(\/|$)/.test(file.path),'Unsafe baseline path');const bytes=await readFile(await safeFile(artifactRoot,file.path));total+=bytes.length;expect(bytes.length===file.bytes&&sha256(bytes)===file.sha256&&total<=CONTROLLED_BUDGET.maxArtifactBytes,'Baseline byte/hash/budget mismatch');}
  const report=DeliveryReport.parse(JSON.parse(await readFile(await safeFile(artifactRoot,'evidence/delivery-report.json'),'utf8')));assertSealed(report);
  expect(report.final&&report.lifecycle==='completed'&&['complete','partial'].includes(report.quality)&&report.bundle,'Real source requires an actual final verified delivery report');
  for(const value of [report.seed,report.bundle!.spec,report.bundle!.plan,report.bundle!.binding,...report.attempts,...(report.exportManifest?[report.exportManifest]:[]),...(report.cleanBuild?[report.cleanBuild]:[])])assertSealed(value);
  expect(report.executionId===manifest.executionId&&report.runId===manifest.runId,'Baseline report/artifact subject mismatch');
  const attempt=report.attempts.at(-1)!;expect(report.attempts.length===1&&attempt.status==='passed'&&attempt.sourceProvenance?.kind==='model_output'&&attempt.sourceProvenance.adapterMode==='dsh','Real baseline cannot come from Fake/controlled output');
  const sourceHash=inventoryHash(manifest.files.filter(f=>f.path.startsWith('source/')));expect(attempt.sourceBeforeHash===sourceHash&&attempt.sourceAfterHash===sourceHash&&report.exportManifest?.sourceSnapshotHash===sourceHash,'Real source inventory mismatch');
  expect(report.cleanBuild&&Object.values(report.cleanBuild.stages).every(g=>g.status==='passed')&&report.cleanBuild.caseResults.every(c=>c.status==='passed'),'Original baseline clean evidence incomplete');
  return{artifactRoot,manifest,rawManifest,seed:report.seed,spec:report.bundle!.spec,plan:report.bundle!.plan,sourceHash,versionId,originExecutionId:report.executionId,reportHash:report.hash,kind:'real_verified_source'};
}
/** Explicit deterministic fixture setup, outside the new Run, with bounded actual build/smoke. */
export async function makeFakeControlledBaseline(root:string):Promise<ControlledBaseline>{
  const started=Date.now();const workspace=path.join(root,'fixture-workspace'),artifactRoot=path.join(root,'fixture-artifact');await mkdir(workspace,{recursive:true});await mkdir(artifactRoot,{recursive:true});const template=await trustedTemplate();
  for(const[name,value]of Object.entries({...template.files,...fakeApplication('project_demo','搜索')}))await putFile(workspace,name,value);
  const request=structuredClone(prepareRequest);request.toolchain=template.descriptor;request.profileHint={id:'profile_notes_v1',hash:(await profileData('profile_notes_v1')).hash};const {spec,plan}=await profileProposal(request,'profile_notes_v1');
  const evidence=path.join(root,'fixture-evidence');const verified=await verifyApplication(workspace,evidence,AbortSignal.timeout(60000),()=>{});expect(!verified.errors,'Fake source fixture build failed');
  for(const file of await listFiles(workspace))await putFile(artifactRoot,file.startsWith('dist/')?file:'source/'+file,await readFile(await safeFile(workspace,file)));
  for(const file of await listFiles(evidence))await putFile(artifactRoot,'evidence/'+file,await readFile(await safeFile(evidence,file)));
  const files=await Promise.all((await listFiles(artifactRoot)).map(async file=>{const bytes=await readFile(await safeFile(artifactRoot,file));return{path:file,bytes:bytes.length,sha256:sha256(bytes),mediaType:mediaType(file)};}));
  const manifest=ArtifactManifest.parse({protocolVersion:'0.1.0',id:'artifact_controlled_fixture',executionId:'execution_controlled_fixture',runId:'run_controlled_fixture',baseVersionId:null,summary:'Explicit Fake source fixture; actual setup build/smoke, no model generation.',files,checks:verified.checks,evidence:[...['typecheck','build','smoke'].map(kind=>({id:`evidence_${kind}`,path:`evidence/${kind}.log`,kind:'log'})),{id:'evidence_screenshot',path:'evidence/screenshot.png',kind:'screenshot'}],createdAt:new Date().toISOString()});
  const rawManifest=Buffer.from(JSON.stringify(manifest));await writeFile(path.join(artifactRoot,'manifest.json'),rawManifest);const sourceHash=inventoryHash(files.filter(f=>f.path.startsWith('source/')));
  const summary={kind:'fake_fixture',setupActiveMs:Date.now()-started,modelRequests:0,sourceHash,checks:verified.checks.map(c=>({kind:c.kind,status:c.status}))};await writeFile(path.join(root,'fixture-setup.json'),JSON.stringify(summary));
  return{artifactRoot,manifest,rawManifest,seed:request.seed,spec,plan,sourceHash,versionId:'version_controlled_fixture',originExecutionId:manifest.executionId,reportHash:sha256(canonicalDeliveryJson(summary)),kind:'fake_fixture'};
}
class ExplicitFakeRepair extends FakeDshAdapter{
  override async generate(context:AdapterContext,plan:PlanValue,errors?:string){
    const result=await super.generate(context,plan,errors);if(typeof result==='string'){
      const template=await trustedTemplate();await applySourceEdit(context.workspace,'src/main.tsx',template.files['src/main.tsx'],context.fileChanged);
      await applySourceEdit(context.workspace,STORAGE_FAULT_FILE,'export {};\n',context.fileChanged);
    }return result;
  }
}
export async function runControlledRepair(options:{mode:'fake'|'dsh';baseline:ControlledBaseline;apiKey?:string}){
  const {baseline}=options;expect(options.mode==='fake'||baseline.kind==='real_verified_source','DSH repair requires verified real source');expect(options.mode==='fake'||Boolean(options.apiKey),'No real key configured; no Fake fallback');
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'atoms-controlled-repair-'));const runtimeData=path.join(dataDir,'agent');const runId=uid('run_controlled'),executionId=uid('execution_controlled'),preparationId=uid('preparation_controlled');
  const now=new Date().toISOString();const seed=RequirementSeed.parse(seal({...baseline.seed,id:uid('seed_controlled'),runId,executionId,revision:1,createdAt:now,
    source:{...baseline.seed.source,admission:'direct_request',turnId:null,proposalId:null,planAttentionId:null,admittedAt:now,messageIds:[...baseline.seed.source.messageIds,'message_controlled_operator']}}));
  const capturedHash=sha256(canonicalDeliveryJson({seedItems:baseline.seed.items,goal:baseline.seed.goal,criteria:baseline.spec.criteria,cases:baseline.plan.cases,coverage:baseline.plan.coverage,sourceHash:baseline.sourceHash,reportHash:baseline.reportHash,versionId:baseline.versionId,originExecutionId:baseline.originExecutionId}));
  const profileId='profile_trusted_controlled_capture';
  const inputService=createServer(async(req,res)=>{try{const url=new URL(req.url||'/','http://input');if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401).end();return;}const prefix=`/internal/v1/input-artifacts/${baseline.manifest.id}`;if(url.pathname===prefix+'/manifest'){res.end(baseline.rawManifest);return;}if(url.pathname===prefix+'/file'){const name=url.searchParams.get('path')||'';const f=baseline.manifest.files.find(f=>f.path===name);if(f){res.end(await readFile(await safeFile(baseline.artifactRoot,name)));return;}}res.writeHead(404).end();}catch{res.writeHead(500).end('Controlled input read failed');}});
  await new Promise<void>(resolve=>inputService.listen(0,'127.0.0.1',resolve));const address=inputService.address();if(!address||typeof address==='string')throw new Error('No controlled input origin');
  const delegate=options.mode==='dsh'?new DshAdapter({apiKey:options.apiKey,model:'deepseek-flash'}):new ExplicitFakeRepair();let injected=0;
  const app=createAgentServer({dataDir:runtimeData,mode:options.mode,serviceToken:token,apiInternalUrl:`http://127.0.0.1:${address.port}`,adapter:new SourceBaselineAdapter(delegate),
    trustedHostPlan:{id:profileId,hash:capturedHash,async prepare(request){
      expect(request.seed.goal===baseline.seed.goal&&canonicalDeliveryJson(request.seed.items)===canonicalDeliveryJson(baseline.seed.items),'Captured Goal/required changed');
      expect(request.projectId===baseline.seed.projectId&&request.baseVersionId===baseline.versionId&&request.input.kind==='version'&&request.input.versionId===baseline.versionId&&request.input.artifactId===baseline.manifest.id&&request.input.manifestSha256===sha256(baseline.rawManifest),'Captured profile source subject changed');
      const spec=AcceptanceSpec.parse(seal({...baseline.spec,id:`spec_${runId}`,hash:'0'.repeat(64),runId,seed:{id:seed.id,hash:seed.hash},origin:'host_profile',createdAt:now}));
      const plan=BrowserTestPlan.parse(seal({...baseline.plan,id:`plan_${runId}`,hash:'0'.repeat(64),spec:{id:spec.id,hash:spec.hash},createdAt:now}));
      expect(canonicalDeliveryJson({cases:plan.cases,coverage:plan.coverage})===canonicalDeliveryJson({cases:baseline.plan.cases,coverage:baseline.plan.coverage}),'Captured assertions changed');return{spec,plan};
    }},
    trustedSourceFault:async context=>{
      expect(++injected===1,'Fault may be injected once only');expect(inventoryHash(await fingerprints(context.workspace,'source/'))===baseline.sourceHash,'Imported source differs from reviewed baseline');
      await assertControlledSource(context.workspace);const checks=await verifyApplication(context.workspace,context.baselineEvidenceDir,context.signal,()=>{},context.report);expect(!checks.errors,'Pre-fault baseline build failed');
      const browser=await runBrowserPlan({dist:path.join(context.workspace,'dist'),plan:context.plan,evidenceDir:context.baselineEvidenceDir,signal:context.signal});expect(!browser.interrupted&&browser.caseResults.every(c=>c.status==='passed'),'Pre-fault original plan did not pass; no provider/host repair is allowed');
      await writeFile(path.join(context.baselineEvidenceDir,'baseline-summary.json'),JSON.stringify({kind:'host_preflight_inside_run',sourceHash:baseline.sourceHash,planHash:context.plan.hash,modelRequests:0,caseResults:browser.caseResults}));
      const main=await readFile(await safeFile(context.workspace,'src/main.tsx'),'utf8');expect(!main.includes('atoms-controlled-fault'),'Baseline already contains fault import');
      return{edits:[{path:'src/main.tsx',expectedBeforeSha256:sha256(main),after:STORAGE_FAULT_IMPORT+main},{path:STORAGE_FAULT_FILE,expectedBeforeSha256:null,after:STORAGE_FAULT_PREFIX}],explanation:'Trusted test deliberately disables localStorage writes before app module evaluation; no natural defect claim. Worker must repair source, not tests.',origin:{kind:baseline.kind,versionId:baseline.versionId,executionId:baseline.originExecutionId,reportHash:baseline.reportHash,originalPlanHash:baseline.plan.hash,sourceHash:baseline.sourceHash}};
    }});
  let summary:unknown;
  try{
    const toolchain=(await trustedTemplate()).descriptor;const request={protocolVersion:'0.1.0',preparationId,projectId:seed.projectId,runId,executionId,seed,baseVersionId:baseline.versionId,input:{kind:'version',versionId:baseline.versionId,artifactId:baseline.manifest.id,manifestSha256:sha256(baseline.rawManifest)},planningMode:'host_profile',profileHint:{id:profileId,hash:capturedHash},toolchain,totalBudget:CONTROLLED_BUDGET,planningBudget:{maxWallTimeMs:60000,maxModelSteps:3,maxInputTokens:32768,maxOutputTokens:8192,maxStructuredRetries:1}};
    await app.planning.start(request,preparationId);while(app.planning.get(preparationId).snapshot.status==='accepted'||app.planning.get(preparationId).snapshot.status==='running')await new Promise(resolve=>setTimeout(resolve,20));const prep=app.planning.get(preparationId).snapshot;expect(prep.status==='completed'&&prep.result,'Captured preparation failed');expect(prep.usage.modelSteps===0&&prep.usage.inputTokens===0&&prep.usage.outputTokens===0,'Captured profile must not claim provider usage');
    const {spec,plan}=prep.result;const binding=FrozenDeliveryBinding.parse(seal({protocolVersion:'0.1.0',id:uid('binding_controlled'),hash:'0'.repeat(64),projectId:seed.projectId,runId,executionId,preparationId,seed:{id:seed.id,hash:seed.hash},spec:{id:spec.id,hash:spec.hash},plan:{id:plan.id,hash:plan.hash},baseVersionId:baseline.versionId,input:request.input,planningMode:'host_profile',toolchain,policyRevision:'delivery-auto-v1',exportPolicyRevision:'export-frozen-v1',totalBudget:CONTROLLED_BUDGET,planningUsage:prep.result.usage,frozenAt:new Date().toISOString()}));
    const wrapper=DeliveryExecutionRequest.parse({protocolVersion:'0.1.0',execution:{...startExecution,executionId,runId,projectId:seed.projectId,baseVersionId:baseline.versionId,input:request.input,prompt:seed.goal,mode:'build',budget:{...CONTROLLED_BUDGET,maxWallTimeMs:CONTROLLED_BUDGET.maxWallTimeMs-prep.usage.activeMs}},bundle:{seed,spec,plan,binding}});
    await writeFile(path.join(dataDir,'controlled-context.json'),JSON.stringify({mode:options.mode,baselineKind:baseline.kind,originVersionId:baseline.versionId,originExecutionId:baseline.originExecutionId,sourceHash:baseline.sourceHash,originalReportHash:baseline.reportHash,originalPlanHash:baseline.plan.hash,frozenPlanHash:plan.hash,runId,executionId,preparationId,budget:CONTROLLED_BUDGET,initialModelGeneration:false}));
    await app.delivery.start(wrapper,executionId);while(!['succeeded','failed','cancelled','interrupted'].includes(app.runtime.get(executionId).snapshot.status)){if(app.runtime.get(executionId).snapshot.status==='waiting_input'){await app.runtime.cancel(executionId,{commandId:uid('command_unanswered')});throw new Error('Controlled repair requested user input; stopped, no replacement Run');}await new Promise(resolve=>setTimeout(resolve,100));}
    const record=app.runtime.get(executionId);const report=app.delivery.report(executionId);expect(record.snapshot.status==='succeeded'&&report,'Controlled repair did not complete; retained isolated evidence');
    expect(report.attempts.length>=2&&report.attempts[0].status==='failed','Must observe actual first failure before repair');expect(report.attempts[0].sourceProvenance?.kind==='controlled_regression','Initial attempt cannot be claimed as model output/natural failure');
    expect(report.attempts[0].caseResults.some(c=>c.status==='failed')&&Object.values(report.attempts[0].checks).every(g=>g.status==='passed'),'Controlled failure must reach actual browser behavior after passing basic gates');
    const persistenceCases=new Set(plan.cases.filter(c=>c.steps.some(step=>step.op==='reload')).map(c=>c.id));expect(persistenceCases.size>0&&report.attempts[0].caseResults.filter(c=>c.status==='failed').every(c=>persistenceCases.has(c.caseId))&&report.attempts[0].caseResults.filter(c=>!persistenceCases.has(c.caseId)).every(c=>c.status==='passed'),'Only the captured persistence/reload cases may fail under the injected storage fault');
    const final=report.attempts.at(-1)!;expect(final.status==='passed'&&final.sourceProvenance?.kind==='model_output'&&final.sourceProvenance.adapterMode===delegate.mode,'Final source must come from explicit delegate mode');
    expect(report.attempts.every(a=>a.planHash===plan.hash&&a.specHash===spec.hash&&a.sourceBeforeHash===a.sourceAfterHash),'Frozen plan/source evidence mismatch');expect(final.caseResults.every(c=>c.status==='passed')&&report.cleanBuild?.caseResults.every(c=>c.status==='passed')&&Object.values(report.cleanBuild.stages).every(g=>g.status==='passed'),'Final and exact clean replay must pass all original cases');
    const workspace=path.join(runtimeData,'executions',executionId,'workspace');for(const f of await listFiles(workspace))if(f.startsWith('src/'))expect(!(await readFile(await safeFile(workspace,f),'utf8')).includes(STORAGE_FAULT_MARKER),'Host fault marker remains; host will not repair it');
    const usage=app.delivery.snapshot(executionId).cumulativeUsage;expect(usage.inputTokens!==null&&usage.outputTokens!==null&&usage.modelSteps>0&&usage.modelSteps<=8&&usage.inputTokens<=65536&&usage.outputTokens<=24576&&usage.activeMs<=900000,'Unknown/exceeded original total budget');
    expect(app.runtime.records.size===1&&app.planning.records.size===1&&app.coordinator.records.size===0,'No replacement Run/Router allowed');
    summary={accepted:true,modelMode:options.mode,initialSource:baseline.kind,initialModelGeneration:false,controlledNotNatural:true,runId,executionId,planHash:plan.hash,originalPlanHash:baseline.plan.hash,attempts:report.attempts.map(a=>({id:a.id,status:a.status,repairRound:a.repairRound,provenance:a.sourceProvenance})),quality:report.quality,usage,dataDir,reportHash:report.hash,archiveHash:report.exportManifest!.archive.sha256};
    await writeFile(path.join(dataDir,'controlled-result.json'),JSON.stringify(summary));return summary;
  }catch(error){await writeFile(path.join(dataDir,'controlled-failed.json'),JSON.stringify({accepted:false,dataDir,runId,executionId,noReplacement:true,error:error instanceof Error?error.message:'Controlled test failed'}));throw new Error(`Controlled test failed; isolated evidence retained at ${dataDir}. No replacement Run was created.`);}
  finally{await app.close();await new Promise<void>(resolve=>inputService.close(()=>resolve()));}
}
