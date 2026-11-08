import type {FastifyInstance,FastifyRequest} from 'fastify';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {unzipSync} from 'fflate';
import {AgentEventPage,ArtifactManifest,RelativePath,type ArtifactManifestDto,type RunDto,type AgentEventDto} from '@atoms/contracts';
import * as D from '@atoms/contracts/delivery';
import type {Store,RunRecord,SessionRecord,VersionRecord,ProjectRecord} from './store.js';

type Host={app:FastifyInstance;store:Store;dataDir:string;agentUrl:string;serviceToken:string;toolchainId:string;
  toolchain?:ReturnType<typeof D.ToolchainDescriptor.parse>;planningMode?:'host_profile'|'model_proposed';profileHint?:{id:string;hash:string};
  hash:(value:string|Uint8Array)=>string;id:(prefix:string)=>string;now:()=>string;
  fail:(status:number,code:string,message:string)=>never;authorize:(r:FastifyRequest)=>SessionRecord;
  ownRun:(id:string,s:SessionRecord)=>RunRecord;ownProject:(id:string,s:SessionRecord)=>ProjectRecord;ownVersion:(id:string,s:SessionRecord)=>VersionRecord;
  updateRun:(r:RunRecord,change:Partial<RunDto>)=>void;finish:(r:RunRecord,status:'failed'|'cancelled'|'interrupted',code?:string,message?:string)=>void;
  message:(r:RunRecord,content:string,time?:string)=>void;
};
const terminal=(s:string)=>['succeeded','failed','cancelled','interrupted'].includes(s);
const p=(r:FastifyRequest,key:string)=>String((r.params as Record<string,string>)[key]);
const q=(r:FastifyRequest)=>r.query as Record<string,string|undefined>;
export function registerDelivery(h:Host){
 const {store,app,hash,id,now,fail}=h;
 const digest=(v:Record<string,unknown>)=>hash(D.deliveryHashBody(v));
 const assertHash=(v:{hash:string})=>{if(digest(v)!==v.hash)throw new Error('Canonical hash mismatch');};
 const signed=<T extends object>(v:T):T&{hash:string}=>({...v,hash:hash(D.deliveryHashBody(v as Record<string,unknown>))});
 const request=async(path:string,method='GET',body?:unknown)=>{
  const r=await fetch(h.agentUrl.replace(/\/$/,'')+path,{method,headers:{authorization:`Bearer ${h.serviceToken}`,'X-Atoms-Delivery-Version':D.DeliveryProtocolVersion,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)}).catch(error=>{throw Object.assign(error,{transport:true});});
  if(!r.ok)throw Object.assign(new Error('Delivery runtime unavailable'),{status:r.status});return r;
 };
 const bounded=async(r:Response,max:number)=>{const chunks:Uint8Array[]=[];let size=0;if(!r.body)throw new Error('Missing body');const reader=r.body.getReader();try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max)throw new Error('Resource exceeds limit');chunks.push(item.value);}}finally{await reader.cancel();}return Buffer.concat(chunks);};
 const data=async(path:string)=>JSON.parse((await bounded(await request(path),4*1024*1024)).toString());
 const persist=(fn:()=>void)=>store.transaction(fn);
 const current=(runId:string)=>store.state.runs.find(r=>r.dto.id===runId)!;
 const markUsed=(r:RunRecord)=>{r.started=true;};
 const sourceHash=(files:{path:string;bytes:number;sha256:string}[])=>hash(D.canonicalDeliveryJson(files.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)));
 const pathSet=(paths:string[])=>{const keys=new Set<string>();for(const path of paths){if(!RelativePath.safeParse(path).success||! /^(source|dist|evidence)\//.test(path)||/(^|\/)(\.env(?:\..*)?|node_modules|\.git|\.dsh)(\/|$)/.test(path))throw new Error('Unsafe artifact path');const key=path.normalize('NFC').toLowerCase();if(keys.has(key))throw new Error('Colliding artifact paths');keys.add(key);}};
 const prepare=async(r:RunRecord)=>{
  const d=r.delivery!;if(d.prepare)return;
  let discovered:unknown=h.toolchain;if(!discovered)try{discovered=await data(`/internal/delivery/v1/toolchains/${encodeURIComponent(h.toolchainId)}`);}catch(error){if((error as {status?:number}).status===404)throw new Error('Configured trusted toolchain is not supported');throw error;}
  const toolchain=D.ToolchainDescriptor.parse(discovered);if(toolchain.id!==h.toolchainId)throw new Error('Toolchain identity mismatch');
  const proposal=store.state.coordination.proposals.find(v=>v.id===r.proposalId);
  const confirmation=store.state.coordination.proposalConfirmations.find(c=>c.proposalId===r.proposalId&&c.runId===r.dto.id);
  const sourceMessages=r.sourceMessageId?[r.sourceMessageId]:store.state.messages.filter(m=>m.runId===r.dto.id&&m.role==='user').map(m=>m.id);
  const goal=proposal?.goal??r.prompt;
  const items=[{id:id('criterion'),kind:'goal' as const,text:goal,required:true},...(proposal?.acceptance??[]).map(a=>({id:id('criterion'),kind:'declared_acceptance' as const,text:a.description,required:true}))];
  const seed=D.RequirementSeed.parse(signed({protocolVersion:D.DeliveryProtocolVersion,id:id('seed'),projectId:r.dto.projectId,runId:r.dto.id,executionId:r.dto.executionId!,revision:1,goal,items,
   source:{admission:confirmation?.kind==='explicit_accept'?'explicit_proposal_acceptance':'auto_explicit_request',messageIds:sourceMessages,turnId:r.originTurnId??null,proposalId:r.proposalId??null,planAttentionId:null,admittedAt:r.dto.createdAt},createdAt:now()}));
  const total=r.request!.budget;
  const req=D.PrepareDeliveryPlanRequest.parse({protocolVersion:D.DeliveryProtocolVersion,preparationId:d.preparationId,projectId:r.dto.projectId,runId:r.dto.id,executionId:r.dto.executionId,seed,baseVersionId:r.dto.baseVersionId,input:r.request!.input,
   planningMode:h.planningMode??'model_proposed',profileHint:h.profileHint??null,toolchain,totalBudget:total,planningBudget:{maxModelSteps:Math.min(3,total.maxModelSteps),maxWallTimeMs:Math.min(60000,total.maxWallTimeMs),maxInputTokens:Math.min(32768,total.maxInputTokens),maxOutputTokens:Math.min(8192,total.maxOutputTokens),maxStructuredRetries:1}});
  persist(()=>{const record=current(r.dto.id);record.delivery!.prepare=req;record.delivery!.prepareHash=hash(D.canonicalDeliveryJson(req));record.delivery!.putPending=false;});
 };
 const freeze=(r:RunRecord,snapshot:ReturnType<typeof D.PlanPreparationSnapshot.parse>)=>{
  const d=r.delivery!,req=d.prepare!,proposed=snapshot.result!;
  assertHash(proposed.spec);assertHash(proposed.plan);
  if(snapshot.requestHash!==d.prepareHash||snapshot.id!==d.preparationId||snapshot.runId!==r.dto.id||snapshot.executionId!==r.dto.executionId||snapshot.projectId!==r.dto.projectId)throw new Error('Preparation subject mismatch');
  const binding=D.FrozenDeliveryBinding.parse(signed({protocolVersion:D.DeliveryProtocolVersion,id:id('binding'),projectId:r.dto.projectId,runId:r.dto.id,executionId:r.dto.executionId,preparationId:d.preparationId,
   seed:{id:req.seed.id,hash:req.seed.hash},spec:{id:proposed.spec.id,hash:proposed.spec.hash},plan:{id:proposed.plan.id,hash:proposed.plan.hash},baseVersionId:req.baseVersionId,input:req.input,planningMode:req.planningMode,toolchain:req.toolchain,
   policyRevision:D.DeliveryPolicyRevision,exportPolicyRevision:D.ExportPolicyRevision,totalBudget:req.totalBudget,planningUsage:proposed.usage,frozenAt:now()}));
  const bundle=D.FrozenDeliveryBundle.parse({seed:req.seed,spec:proposed.spec,plan:proposed.plan,binding});
  const budget={...req.totalBudget,maxWallTimeMs:req.totalBudget.maxWallTimeMs-proposed.usage.activeMs,maxModelSteps:req.totalBudget.maxModelSteps-proposed.usage.modelSteps,maxInputTokens:req.totalBudget.maxInputTokens-proposed.usage.inputTokens,maxOutputTokens:req.totalBudget.maxOutputTokens-proposed.usage.outputTokens};
  const wrapper=D.DeliveryExecutionRequest.parse({protocolVersion:D.DeliveryProtocolVersion,execution:{...r.request!,budget},bundle});
  persist(()=>{const record=current(r.dto.id);if(record.dto.status==='cancelling')return;if(record.delivery!.wrapper){if(D.canonicalDeliveryJson(record.delivery!.wrapper)!==D.canonicalDeliveryJson(wrapper))throw new Error('Already frozen');return;}record.delivery!.wrapper=wrapper;record.delivery!.stage='executing';record.delivery!.executionPutPending=false;record.delivery!.runtimeStopped=false;});
 };
 const reportPath=(r:RunRecord)=>r.delivery!.stage==='preparing'?`/internal/delivery/v1/preparations/${r.delivery!.preparationId}`:`/internal/delivery/v1/executions/${r.dto.executionId}`;
 const loadReport=async(r:RunRecord,prefix=reportPath(r))=>{
  const raw=await data(prefix+'/report');
  const parsed='state'in raw?D.ReportRead.parse(raw):{state:'available' as const,report:D.DeliveryReport.parse(raw)};
  if(parsed.state!=='available')return;
  const report=parsed.report;assertHash(report);
  if(report.projectId!==r.dto.projectId||report.runId!==r.dto.id||report.executionId!==r.dto.executionId||report.preparationId!==r.delivery!.preparationId||D.canonicalDeliveryJson(report.seed)!==D.canonicalDeliveryJson(r.delivery!.prepare!.seed))throw new Error('Report subject mismatch');
  if(report.bundle&&D.canonicalDeliveryJson(report.bundle)!==D.canonicalDeliveryJson(r.delivery!.wrapper?.bundle))throw new Error('Report changed frozen bundle');
  if(r.delivery!.report?.final&&report.hash!==r.delivery!.report.hash)throw new Error('Final report is immutable');
  if(r.delivery!.report&&report.revision<r.delivery!.report.revision)throw new Error('Stale report');
  if(r.delivery!.report&&report.revision===r.delivery!.report.revision&&report.hash!==r.delivery!.report.hash)throw new Error('Report revision changed body');
  for(const object of [...report.attempts,...(report.exportManifest?[report.exportManifest]:[]),...(report.cleanBuild?[report.cleanBuild]:[])])assertHash(object);
  const dir=join(h.dataDir,'deliveries',r.delivery!.preparationId,`${report.revision}-${report.hash}`);await mkdir(dir,{recursive:true});
  pathSet(report.evidence.map(e=>e.path));let total=0;
  for(const evidence of report.evidence){total+=evidence.bytes;if(total>r.request!.budget.maxArtifactBytes)throw new Error('Evidence exceeds budget');const bytes=await bounded(await request(prefix+`/evidence/${encodeURIComponent(evidence.id)}`),evidence.bytes);if(bytes.length!==evidence.bytes||hash(bytes)!==evidence.sha256)throw new Error('Evidence checksum mismatch');
   if(evidence.mediaType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG');
   if(evidence.mediaType==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217))throw new Error('Invalid JPEG');
   const target=join(dir,evidence.path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes);
  }
  await writeFile(join(dir,'report.json'),JSON.stringify(report));
  persist(()=>{const record=current(r.dto.id);record.delivery!.report=report;record.delivery!.reportDirectory=dir;});
  return report;
 };
 const validateZipDirectory=(bytes:Buffer)=>{
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)throw new Error('Invalid archive directory');
  const count=bytes.readUInt16LE(end+10),length=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);if(count>1001||count===65535||start+length!==end)throw new Error('Invalid archive directory bounds');
  let cursor=start;const paths=new Set<string>();for(let i=0;i<count;i++){if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid archive entry');
   const flags=bytes.readUInt16LE(cursor+8),attrs=bytes.readUInt32LE(cursor+38),nameSize=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32);if(flags&1||((attrs>>>16)&0xf000)===0xa000)throw new Error('Encrypted or symlink archive entry');
   const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameSize));if(paths.has(name)||name.endsWith('/'))throw new Error('Duplicate or directory archive entry');paths.add(name);cursor+=46+nameSize+extra+comment;
  }if(cursor!==end)throw new Error('Archive directory mismatch');
 };
 const verifyArchive=async(r:RunRecord,report:D.DeliveryReportDto)=>{
  const manifest=report.exportManifest!;const max=r.request!.budget.maxArtifactBytes;
  const bytes=await bounded(await request(reportPath(r)+`/export/${encodeURIComponent(manifest.archive.id)}`),Math.min(max,manifest.archive.bytes));
  if(bytes.length!==manifest.archive.bytes||hash(bytes)!==manifest.archive.sha256)throw new Error('Archive checksum mismatch');
  validateZipDirectory(bytes);
  let expanded=0;const seen=new Set<string>();const zip=unzipSync(bytes,{filter:file=>{expanded+=file.originalSize;if(seen.has(file.name)||seen.size>1000||expanded>max)throw new Error('Archive expansion or duplicate entry exceeds budget');seen.add(file.name);return true;}});
  const paths=Object.keys(zip).filter(p=>p!=='contents-manifest.json');pathSet(paths);let total=0;
  if(paths.length!==manifest.files.length||!zip['contents-manifest.json'])throw new Error('Archive file set mismatch');
  const contents=D.canonicalDeliveryJson({protocolVersion:D.DeliveryProtocolVersion,sourceSnapshotHash:manifest.sourceSnapshotHash,templateId:manifest.templateId,toolchainId:manifest.toolchainId,files:manifest.files.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)});
  if(!Buffer.from(zip['contents-manifest.json']).equals(Buffer.from(contents))||hash(contents)!==manifest.contentsManifestHash)throw new Error('Archive contents manifest mismatch');
  for(const file of manifest.files){total+=file.bytes;if(total>max)throw new Error('Archive exceeds budget');const content=zip[file.path];if(!content||content.length!==file.bytes||hash(content)!==file.sha256)throw new Error('Archive file mismatch');}
  if(sourceHash(manifest.files)!==manifest.sourceSnapshotHash)throw new Error('Export source hash mismatch');
  const packageFile=zip['source/package.json'];const pkg=JSON.parse(Buffer.from(packageFile).toString());
  if(hash(D.canonicalDeliveryJson(pkg.scripts))!==manifest.scriptsHash||!String(pkg.packageManager??'').startsWith('pnpm@'))throw new Error('Untrusted package scripts or package manager');
  const lock=Buffer.from(zip['source/pnpm-lock.yaml']).toString();if(/workspace:|file:|link:|https?:\/\/(?!registry\.npmjs\.org(?:\/|\b))/.test(lock))throw new Error('Nonpublic lockfile');
  const path=join(r.delivery!.reportDirectory!,'source.zip');await writeFile(path,bytes);persist(()=>{current(r.dto.id).delivery!.archiveFile=path;});
 };
 const verifyCandidate=async(r:RunRecord,manifest:ArtifactManifestDto,directory:string)=>{
  const finalSnapshot=D.DeliveryExecutionSnapshot.parse(await data(`/internal/delivery/v1/executions/${r.dto.executionId}`));
  if(finalSnapshot.execution.id!==r.dto.executionId||finalSnapshot.execution.runId!==r.dto.id||finalSnapshot.binding.hash!==r.delivery!.wrapper!.bundle.binding.hash||finalSnapshot.binding.id!==r.delivery!.wrapper!.bundle.binding.id||finalSnapshot.execution.artifactId!==manifest.id)throw new Error('Final snapshot binding mismatch');
  if(finalSnapshot.execution.status!=='succeeded')throw Object.assign(new Error('Awaiting terminal execution snapshot'),{status:503});
  persist(()=>{current(r.dto.id).delivery!.finalUsage=finalSnapshot.cumulativeUsage;});
  const usage=finalSnapshot.cumulativeUsage;const budget=r.delivery!.prepare!.totalBudget;
  if(!usage||usage.inputTokens===null||usage.outputTokens===null||usage.activeMs>budget.maxWallTimeMs||usage.modelSteps>budget.maxModelSteps||usage.inputTokens>budget.maxInputTokens||usage.outputTokens>budget.maxOutputTokens)throw new Error('Unknown or exceeded total usage');
  const report=await loadReport(r);if(!report?.final||report.lifecycle!=='completed'||!['complete','partial'].includes(D.deriveDeliveryQuality(report)))throw new Error('Delivery blocked or provisional');
  const files=manifest.files;pathSet(files.map(f=>f.path));
  if(sourceHash(files.filter(f=>f.path.startsWith('source/')))!==report.attempts.at(-1)!.sourceBeforeHash||sourceHash(files.filter(f=>f.path.startsWith('dist/')))!==report.attempts.at(-1)!.distHash)throw new Error('Candidate source/dist mismatch');
  for(const file of files){const bytes=await readFile(join(directory,file.path));if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw new Error('Candidate checksum mismatch');}
  if(report.exportManifest!.files.length!==files.filter(f=>f.path.startsWith('source/')).length)throw new Error('Incomplete export source set');
  for(const exported of report.exportManifest!.files){const candidate=files.find(f=>f.path===exported.path);if(!candidate||candidate.sha256!==exported.sha256||candidate.bytes!==exported.bytes)throw new Error('Export changed candidate source');}
  await verifyArchive(r,report);persist(()=>{current(r.dto.id).delivery!.verified=true;});
  return report;
 };
 const tick=async(r:RunRecord,ingest:(r:RunRecord,event:AgentEventDto)=>Promise<void>,publish:(r:RunRecord,artifactId:string)=>Promise<void>)=>{
  const runId=r.dto.id;
  if(r.dto.status==='cancelling'&&!r.delivery!.prepare){persist(()=>h.finish(current(runId),'cancelled'));return;}
  await prepare(r);r=current(runId);const d=r.delivery!;
  const path=reportPath(r);
  if(r.dto.status==='cancelling'){
   try{await request(path);}catch(error){if((error as {status?:number}).status===404){if((d.stage==='preparing'?d.putPending:d.executionPutPending)===false&&!(d.stage==='preparing'?d.prepareAccepted:d.executionAccepted)){if(d.stage==='executing'){const prefix=`/internal/delivery/v1/preparations/${d.preparationId}`;await request(prefix+'/cancel','POST',r.cancelCommand??{commandId:id('command')});const report=await loadReport(r,prefix);if(!report?.final)return;}persist(()=>{if(d.stage==='preparing')current(runId).delivery!.noReportExpected=true;h.finish(current(runId),'cancelled');});return;}throw error;}throw error;}
   if(!r.cancelCommand)persist(()=>{current(runId).cancelCommand={commandId:id('command')};});
   await request(path+'/cancel','POST',r.cancelCommand);
  }else{
   const key=d.stage==='preparing'?'putPending':'executionPutPending';persist(()=>{current(runId).delivery![key]=true;});
   await request(path,'PUT',d.stage==='preparing'?d.prepare:d.wrapper);persist(()=>{current(runId).delivery![key]=false;if(d.stage==='preparing')current(runId).delivery!.prepareAccepted=true;else current(runId).delivery!.executionAccepted=true;});
  }
  r=current(runId);
  if(r.delivery!.stage==='preparing'){
   const page=D.PlanningEventPage.parse(await data(path+`/events?after=${r.delivery!.planningSeq}&limit=100`));
   for(const source of page.items){r=current(runId);if(source.preparationId!==d.preparationId||source.runId!==runId||source.executionId!==r.dto.executionId)throw new Error('Planning ownership mismatch');if(source.sourceSeq<=r.delivery!.planningSeq)continue;if(source.sourceSeq!==r.delivery!.planningSeq+1)throw new Error('Planning event gap');
    persist(()=>{if(source.event.type==='planning.model_started'){markUsed(r);if(r.dto.status!=='cancelling')h.updateRun(r,{status:'running',phase:'planning'});}if(source.event.type==='planning.progress')h.message(r,source.event.payload.content,source.occurredAt);r.delivery!.planningSeq=source.sourceSeq;});
   }
   const snapshot=D.PlanPreparationSnapshot.parse(await data(path));
   if(snapshot.requestHash!==d.prepareHash||snapshot.id!==d.preparationId||snapshot.runId!==runId||snapshot.projectId!==r.dto.projectId||snapshot.executionId!==r.dto.executionId)throw new Error('Planning snapshot mismatch');
   persist(()=>{current(runId).delivery!.runtimeStopped=['completed','failed','cancelled','interrupted'].includes(snapshot.status);if(snapshot.usage.modelSteps>0)markUsed(current(runId));});
   if(r.delivery!.invalid&&r.delivery!.runtimeStopped){persist(()=>h.finish(current(runId),'failed','ARTIFACT_INVALID','交付证据无效，执行服务已确认停止。'));return;}
   if(snapshot.status==='completed'&&r.dto.status!=='cancelling'){freeze(r,snapshot);return;}
   if(['failed','cancelled','interrupted'].includes(snapshot.status)||snapshot.status==='completed'&&r.dto.status==='cancelling'){
    const finalReport=await loadReport(r);if(!finalReport?.final)return;persist(()=>{r=current(runId);h.finish(r,r.dto.status==='cancelling'?'cancelled':snapshot.status==='interrupted'?'interrupted':'failed',r.dto.status==='cancelling'?undefined:'VERIFICATION_FAILED','交付计划准备未完成，未发布新版本。');});
   }
  }else{
   if(r.answerCommand&&r.dto.status!=='cancelling'){await request(path+'/inputs','POST',r.answerCommand);persist(()=>{current(runId).answerCommand=undefined;});}
   const snapshot=D.DeliveryExecutionSnapshot.parse(await data(path));
   if(snapshot.binding.id!==d.wrapper!.bundle.binding.id||snapshot.binding.hash!==d.wrapper!.bundle.binding.hash||snapshot.execution.id!==r.dto.executionId||snapshot.execution.runId!==r.dto.id)throw new Error('Execution snapshot binding mismatch');
   persist(()=>{current(runId).delivery!.finalUsage=snapshot.cumulativeUsage;current(runId).delivery!.runtimeStopped=['succeeded','failed','cancelled','interrupted'].includes(snapshot.execution.status);});
   if(r.delivery!.invalid&&r.delivery!.runtimeStopped){persist(()=>h.finish(current(runId),'failed','ARTIFACT_INVALID','交付证据无效，执行服务已确认停止。'));return;}
   try{if(!r.delivery!.invalid)await loadReport(r);}catch(error){if((error as {status?:number}).status!==404)throw error;}
   const page=D.DeliveryExecutionEventPage.parse(await data(path+`/events?after=${r.sourceSeq}&limit=100`));
   if(page.binding.id!==d.wrapper!.bundle.binding.id||page.binding.hash!==d.wrapper!.bundle.binding.hash)throw new Error('Execution page binding mismatch');
   for(const event of AgentEventPage.parse(page.page).items)await ingest(current(runId),event);
   r=current(runId);if(!terminal(r.dto.status)&&r.dto.phase==='publishing'&&snapshot.execution.status==='succeeded'&&snapshot.execution.artifactId)await publish(r,snapshot.execution.artifactId);
  }
 };
 const origin=(v:VersionRecord)=>store.state.runs.find(r=>r.dto.id===v.deliveryOriginRunId);
 const binding=(report:D.DeliveryReportDto)=>({deliveryId:report.id,reportHash:report.hash,reportRevision:report.revision,sourceSnapshotHash:report.attempts.at(-1)?.sourceBeforeHash??null});
 const provenance=(v:VersionRecord|undefined,r:RunRecord|undefined)=>({subjectVersionId:v?.dto.id??null,restoredFromVersionId:v?.dto.restoredFromVersionId??null,
  originVersionId:v?(v.dto.restoredFromVersionId?store.state.versions.find(x=>x.dto.runId===r?.dto.id)?.dto.id??null:v.dto.id):null,
  originRunId:r?.dto.id??null,originExecutionId:r?.dto.executionId??null,report:r?.delivery?.report?{id:r.delivery.report.id,hash:r.delivery.report.hash}:null,
  sourceSnapshotHash:r?.delivery?.report?.attempts.at(-1)?.sourceBeforeHash??null,evidenceReuse:r?.delivery?(v?.dto.restoredFromVersionId?'restored_unchanged_source':'original'):'legacy_unverified',verificationRerun:!!r?.delivery?.report?.attempts.length&&!v?.dto.restoredFromVersionId});
 const publication=(v:VersionRecord|undefined,r:RunRecord|undefined)=>({status:v?'published':r?.dto.status==='cancelling'||r?.dto.status==='cancelled'?'cancelled':r&&terminal(r.dto.status)?'rejected':r?.dto.phase==='publishing'?'publishing':'not_published',publishedVersionId:v?.dto.id??null});
 const view=(r:RunRecord|undefined,v?:VersionRecord)=>{
  const subject={protocolVersion:D.DeliveryProtocolVersion,projectId:v?.dto.projectId??r!.dto.projectId,runId:r?.dto.id??null,subjectVersionId:v?.dto.id??null,revision:r?.dto.revision??1,updatedAt:r?.dto.updatedAt??v!.dto.createdAt};
  if(!r?.delivery)return D.DeliveryReadView.parse({...subject,state:'legacy',reason:'no_delivery_binding',quality:'legacy_unverified',publication:publication(v,r),provenance:provenance(v,r)});
  const d=r.delivery;
  if(d.invalid&&!d.report)fail(409,'EVIDENCE_INVALID','交付证据未通过校验，原报告不可作为可信内容读取');
  if(d.invalid)return D.DeliveryReadView.parse({...subject,state:'available',binding:d.report?binding(d.report):{deliveryId:d.preparationId,reportHash:hash(d.invalid),reportRevision:1,sourceSnapshotHash:null},reportFinal:true,apiVerification:'invalid',quality:'blocked',publication:publication(undefined,r),provenance:provenance(v,r),report:null,gaps:[],error:{code:'EVIDENCE_INVALID',message:'交付证据未通过完整性校验。',retryable:false}});
  if(!d.report&&terminal(r.dto.status)&&d.noReportExpected)fail(404,'NOT_FOUND','任务在派发前停止，没有生成验证报告');
  if(!d.report)return D.DeliveryReadView.parse({...subject,state:'pending',phase:d.stage==='preparing'?'preparing':'executing',preparationId:d.preparationId,publication:publication(v,r)});
  const report=d.report;const trusted=report.quality==='blocked'||d.verified===true;return D.DeliveryReadView.parse({...subject,state:'available',binding:binding(report),reportFinal:report.final,apiVerification:report.final&&trusted?'verified':'pending',quality:report.final&&trusted?report.quality:'pending',publication:publication(v,r),provenance:provenance(v,r),report,gaps:report.gaps,error:null});
 };
 const base='/api/delivery/v1';
 app.addHook('onRequest',async(r,reply)=>{if(r.url.startsWith(base+'/')){reply.header('X-Atoms-Delivery-Version',D.DeliveryProtocolVersion);if(r.headers['x-atoms-delivery-version']!==D.DeliveryProtocolVersion)fail(400,'INVALID_REQUEST','Delivery protocol header required');}});
 app.get(base+'/runs/:runId',r=>{const record=h.ownRun(p(r,'runId'),h.authorize(r));const version=store.state.versions.find(v=>v.dto.id===record.dto.resultVersionId);return view(record,version);});
 app.get(base+'/versions/:versionId',r=>{const v=h.ownVersion(p(r,'versionId'),h.authorize(r));return view(origin(v)??store.state.runs.find(r=>r.dto.id===v.dto.runId),v);});
 const ownedReport=(r:FastifyRequest)=>{const s=h.authorize(r);const record=store.state.runs.find(run=>run.delivery?.report?.id===p(r,'deliveryId')&&run.codeId===s.codeId);if(!record)fail(404,'NOT_FOUND','报告不存在或不可访问');if(record!.delivery!.invalid)fail(409,'EVIDENCE_INVALID','报告证据不可信');return record!;};
 const encodeCursor=(scope:string,offset:number)=>Buffer.from(JSON.stringify({scope,offset,signature:hash(h.serviceToken+':'+scope+':'+offset)})).toString('base64url');
 const decodeCursor=(cursor:string|undefined,scope:string)=>{if(!cursor)return 0;let parsed:{scope:string;offset:number;signature:string};try{parsed=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{return fail(400,'INVALID_REQUEST','无效游标');}if(parsed.scope!==scope||!Number.isSafeInteger(parsed.offset)||parsed.offset<0||parsed.signature!==hash(h.serviceToken+':'+scope+':'+parsed.offset))return fail(409,'CURSOR_EXPIRED','分页绑定已变化，请刷新');return parsed.offset;};
 const limitFor=(r:FastifyRequest,max:number)=>{const value=q(r).limit===undefined?max:Number(q(r).limit);if(!Number.isInteger(value)||value<1||value>max)fail(400,'INVALID_REQUEST','分页数量超限');return value;};
 app.get(base+'/deliveries/:deliveryId/attempts',r=>{const record=ownedReport(r),report=record.delivery!.report!,b=binding(report);const scope=D.canonicalDeliveryJson({projectId:record.dto.projectId,...b});const offset=decodeCursor(q(r).cursor,scope),limit=limitFor(r,100);return D.AttemptPage.parse({protocolVersion:D.DeliveryProtocolVersion,binding:b,subject:{projectId:record.dto.projectId,runId:record.dto.id,executionId:record.dto.executionId},items:report.attempts.slice(offset,offset+limit),nextCursor:offset+limit<report.attempts.length?encodeCursor(scope,offset+limit):null});});
 const evidenceFor=(r:FastifyRequest)=>{const record=ownedReport(r),evidence=record.delivery!.report!.evidence.find(e=>e.id===p(r,'evidenceId'));if(!evidence)fail(404,'NOT_FOUND','证据不存在');return {record,evidence:evidence!};};
 app.get(base+'/deliveries/:deliveryId/evidence/:evidenceId',r=>{const {record,evidence:e}=evidenceFor(r);return D.EvidenceDescriptor.parse({protocolVersion:D.DeliveryProtocolVersion,binding:binding(record.delivery!.report!),id:e.id,kind:e.kind,fileName:e.path.split('/').at(-1),sha256:e.sha256,bytes:e.bytes,mediaType:e.mediaType,attemptId:e.attemptId,evidenceSourceHash:e.sourceSnapshotHash,specHash:e.specHash,planHash:e.planHash,disposition:e.kind==='trace'?'attachment':'inline',expiresAt:null});});
 app.get(base+'/deliveries/:deliveryId/evidence/:evidenceId/content',async(r,reply)=>{const {record,evidence:e}=evidenceFor(r);const bytes=await readFile(join(record.delivery!.reportDirectory!,e.path));if(bytes.length!==e.bytes||hash(bytes)!==e.sha256)fail(409,'EVIDENCE_INVALID','证据完整性失效');return reply.header('Content-Disposition',`${e.kind==='trace'?'attachment':'inline'}; filename="${e.id}.${e.kind==='trace'?'zip':e.kind==='screenshot'?(e.mediaType==='image/png'?'png':'jpg'):e.kind==='report'?'json':'txt'}"`).type(e.mediaType).send(bytes);});
 const exportedView=(v:VersionRecord)=>{const r=origin(v);const d=r?.delivery;const common={protocolVersion:D.DeliveryProtocolVersion,projectId:v.dto.projectId,subjectVersionId:v.dto.id,provenance:provenance(v,r)};
  if(!d)return D.ExportReadView.parse({...common,status:'legacy_unverified',binding:null,manifest:null,cleanBuild:null,downloadRef:{verification:'legacy_unverified',subjectVersionId:v.dto.id,archiveId:null,archiveHash:null},error:null});
  if(!d.verified||!d.report?.exportManifest||!d.archiveFile)fail(409,'EXPORT_FAILED','当前版本缺少可信导出');
  return D.ExportReadView.parse({...common,status:'verified',binding:binding(d.report!),manifest:d.report!.exportManifest,cleanBuild:d.report!.cleanBuild,downloadRef:{verification:'verified',subjectVersionId:v.dto.id,archiveId:d.report!.exportManifest!.archive.id,archiveHash:d.report!.exportManifest!.archive.sha256},error:null});
 };
 app.get(base+'/versions/:versionId/export',r=>exportedView(h.ownVersion(p(r,'versionId'),h.authorize(r))));
 const archive=async(v:VersionRecord)=>{const r=origin(v);if(!r?.delivery)return null;exportedView(v);const bytes=await readFile(r.delivery.archiveFile!);if(hash(bytes)!==r.delivery.report!.exportManifest!.archive.sha256||bytes.length!==r.delivery.report!.exportManifest!.archive.bytes)fail(409,'EXPORT_FAILED','导出完整性失效');return bytes;};
 app.get(base+'/versions/:versionId/source.zip',async(r,reply)=>{const v=h.ownVersion(p(r,'versionId'),h.authorize(r));const bytes=await archive(v);if(!bytes){const response=await app.inject({method:'GET',url:`/api/v1/versions/${v.dto.id}/source.zip`,headers:{cookie:String(r.headers.cookie??'')}});return reply.code(response.statusCode).type('application/zip').send(response.rawPayload);}return reply.type('application/zip').header('Content-Disposition',`attachment; filename="${v.dto.id}.zip"`).send(bytes);});
 app.get(base+'/projects/:projectId/version-diff',async r=>{
  const session=h.authorize(r),project=h.ownProject(p(r,'projectId'),session),query=q(r);const head=h.ownVersion(query.headVersionId??'',session);
  const baseId=query.baseVersionId===undefined?head.dto.parentVersionId:query.baseVersionId==='null'?null:query.baseVersionId;
  const before=baseId?h.ownVersion(baseId,session):undefined;if(head.dto.projectId!==project.dto.id||before&&before.dto.projectId!==project.dto.id)fail(404,'NOT_FOUND','版本不属于该项目');
  const oldFiles=before?.manifest.files.filter(f=>f.path.startsWith('source/'))??[],newFiles=head.manifest.files.filter(f=>f.path.startsWith('source/'));pathSet(oldFiles.map(f=>f.path));pathSet(newFiles.map(f=>f.path));
  const comparison={id:'diff_'+hash(D.canonicalDeliveryJson([project.dto.id,baseId,head.dto.id,sourceHash(oldFiles),sourceHash(newFiles)])),projectId:project.dto.id,baseVersionId:baseId,headVersionId:head.dto.id,baseSourceHash:before?sourceHash(oldFiles):null,headSourceHash:sourceHash(newFiles)};
  const scope=D.canonicalDeliveryJson(comparison),offset=decodeCursor(query.cursor,scope),limit=limitFor(r,D.DELIVERY_LIMITS.diffPageSize);const paths=[...new Set([...oldFiles,...newFiles].map(f=>f.path))].sort().filter(path=>oldFiles.find(f=>f.path===path)?.sha256!==newFiles.find(f=>f.path===path)?.sha256);
  let consumed=0,lines=0,truncated=paths.length>D.DELIVERY_LIMITS.maxDiffFiles,reason=truncated?'Diff exceeds the file limit.':null;const started=Date.now();const files=[];
  for(const path of paths.slice(0,D.DELIVERY_LIMITS.maxDiffFiles)){
   const old=oldFiles.find(f=>f.path===path),next=newFiles.find(f=>f.path===path);const operation=old?(next?'modified':'deleted'):'added';
   const fp=(f:typeof old)=>f?{path:f.path,bytes:f.bytes,sha256:f.sha256,mediaType:f.mediaType}:null;
   const item:{path:string;status:string;before:ReturnType<typeof fp>;after:ReturnType<typeof fp>;kind:string;hunks:unknown[];truncated:boolean;reason:string|null}={path,status:operation,before:fp(old),after:fp(next),kind:'text',hunks:[],truncated:false,reason:null};
   if(Date.now()-started>D.DELIVERY_LIMITS.maxDiffTimeMs||Math.max(old?.bytes??0,next?.bytes??0)>D.DELIVERY_LIMITS.maxDiffSingleFileBytes||consumed+(old?.bytes??0)+(next?.bytes??0)>D.DELIVERY_LIMITS.maxDiffTextBytes){item.truncated=true;item.reason='Diff time or text byte limit reached.';truncated=true;reason=item.reason;files.push(item);continue;}
   const left=old?await readFile(join(before!.directory,path)):Buffer.alloc(0),right=next?await readFile(join(head.directory,path)):Buffer.alloc(0);if(old&&hash(left)!==old.sha256||next&&hash(right)!==next.sha256)fail(409,'EVIDENCE_INVALID','源码完整性失效');consumed+=left.length+right.length;
   let a:string[],b:string[];try{const decoder=new TextDecoder('utf-8',{fatal:true});if(left.includes(0)||right.includes(0))throw new Error('binary');a=left.length?decoder.decode(left).split('\n'):[];b=right.length?decoder.decode(right).split('\n'):[];}catch{item.kind='binary';files.push(item);continue;}
   let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
   const changes=[...a.slice(prefix,a.length-suffix).map((text,i)=>({kind:'deleted',text,oldLine:prefix+i+1,newLine:null})),...b.slice(prefix,b.length-suffix).map((text,i)=>({kind:'added',text,oldLine:null,newLine:prefix+i+1}))];
   const take=changes.slice(0,Math.max(0,D.DELIVERY_LIMITS.maxDiffLines-lines)).map(line=>({...line,text:line.text.slice(0,10000)}));lines+=take.length;if(take.length<changes.length||changes.some(l=>l.text.length>10000)){item.truncated=true;item.reason='Diff line limit reached.';truncated=true;reason=item.reason;}
   if(take.length)item.hunks=[{oldStart:prefix,newStart:prefix,lines:take}];files.push(item);
  }
  const visible=files.slice(offset,offset+limit);return D.VersionDiffPage.parse({protocolVersion:D.DeliveryProtocolVersion,comparison,files:visible,hasMore:offset+limit<files.length,nextCursor:offset+limit<files.length?encodeCursor(scope,offset+limit):null,truncated,reason});
 });
 const sanitizeFacts=(value:unknown):unknown=>typeof value==='string'?value.replace(/(?:https?:\/\/|file:\/\/)[^\s，。；）]+/gi,'[链接已隐藏]').replace(/\/(?:Users|home)\/[^\s，。；）]+/g,'[内部路径已隐藏]'):Array.isArray(value)?value.map(sanitizeFacts):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizeFacts(v)])):value;
 const facts=(request:import('@atoms/contracts/conversation').StartCoordinationRequestDto)=>D.DeliveryFacts.parse(signed(sanitizeFacts({protocolVersion:D.DeliveryProtocolVersion,projectId:request.projectId,revision:store.state.projects.find(p=>p.dto.id===request.projectId)!.dto.revision+store.state.runs.filter(r=>r.dto.projectId===request.projectId).reduce((sum,r)=>sum+r.dto.revision+(r.delivery?.report?.revision??0),0),asOf:now(),
  versions:request.context.facts.versions.map(v=>{const stored=store.state.versions.find(x=>x.dto.id===v.id)!,r=origin(stored);return {versionId:v.id,quality:r?.delivery?(r.delivery.invalid?'blocked':r.delivery.verified?r.delivery.report?.quality??'pending':'pending'):'legacy_unverified',report:r?.delivery?.report?{id:r.delivery.report.id,hash:r.delivery.report.hash}:null,sourceSnapshotHash:r?.delivery?.report?.attempts.at(-1)?.sourceBeforeHash??null,provenance:provenance(stored,r),gaps:r?.delivery?.report?.gaps??[]};}),
  runs:request.context.facts.runs.map(v=>{const r=store.state.runs.find(x=>x.dto.id===v.id)!;return {runId:v.id,quality:r.delivery?(r.delivery.invalid?'blocked':r.delivery.verified||r.delivery.report?.quality==='blocked'?r.delivery.report?.quality??'pending':'pending'):'legacy_unverified',report:r.delivery?.report?{id:r.delivery.report.id,hash:r.delivery.report.hash}:null,gaps:r.delivery?.report?.gaps??[]};}),availableActions:[]}) as Record<string,unknown>));
 return {tick,verifyCandidate,archive,view,provenance,facts,signed,request,loadReport,
  invalid(r:RunRecord){persist(()=>{const currentRecord=current(r.dto.id);currentRecord.delivery!.invalid='Evidence validation failed';if(!terminal(currentRecord.dto.status)){if(!currentRecord.delivery!.prepare||currentRecord.delivery!.runtimeStopped)h.finish(currentRecord,currentRecord.dto.status==='cancelling'?'cancelled':'failed','ARTIFACT_INVALID','交付证据未通过完整性校验，保留当前版本。');else{currentRecord.cancelCommand??={commandId:id('command')};h.updateRun(currentRecord,{status:'cancelling',pendingAttention:null,pendingAnswer:null});}}});},
  async restoreCheck(v:VersionRecord){if(!v.deliveryOriginRunId)return;const r=origin(v);if(!r?.delivery?.report?.exportManifest)throw new Error('Missing restore provenance');for(const f of r.delivery.report.exportManifest.files){const bytes=await readFile(join(v.directory,f.path));if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw new Error('Restore source changed');}}
 };
}
