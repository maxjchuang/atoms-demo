/** One reviewed exact-proposal continuation. Default is read-only; never rebuilds the first two Runs. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,lstat,unlink} from 'node:fs/promises';
import {existsSync,createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {canonical,receiptHash,reviewReceipt,readApiState,assertExecutionGuards,assertResumeState,assertNoActiveState,
 privateJson,resumeSecrets,childEnvironment,verifyBackup,immutableEvidence,submitWithReconciliation,logRedactor,sha,QUALITY_ASK} from './delivery-resume-helpers.mjs';
import {deliveryRestartCheckpoint,auditCoordinationUsage} from './delivery-audit.mjs';
import {webReadonlyInvocation} from './delivery-web-readonly.mjs';
import {awaitOneShot,assertOneShotSucceeded,unexpectedServiceExit} from './delivery-process.mjs';
import {DeliveryReadView,ExportReadView,VersionDiffPage,EvidenceDescriptor,DeliveryCoordinationSnapshot} from '../../packages/contracts/src/delivery.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2),help=argv.includes('--help');
const value=flag=>{const index=argv.indexOf(flag);return index<0?null:argv[index+1];};
if(help||!value('--directory')){
 console.log('Dry-run: delivery-resume.mjs --directory ORIGINAL_DATA\nExecute: delivery-resume.mjs --directory ORIGINAL_DATA --backup VERIFIED_FULL_COPY --receipt-hash REVIEWED_HASH --execute --real\nExecute additionally requires all three ATOMS_ALLOW_REAL_DELIVERY_{INTEGRATION,ROUTER,RESUME}=1 guards and DEEPSEEK_API_KEY in the parent environment. No .env is loaded.');
 if(!help)process.exitCode=1;
}else{
 const directory=path.resolve(value('--directory')),control=path.join(directory,'resume-control'),reviewFile=path.join(control,'review.json');
 const state=readApiState(directory),saved=existsSync(reviewFile)?JSON.parse(await readFile(reviewFile,'utf8')):null;
 const receipt=saved?.receipt??reviewReceipt(state,directory);assert.equal(receipt.directory,directory);
 const hash=receiptHash(receipt),execute=argv.includes('--execute');
 if(!execute){
  const status=assertResumeState(state,receipt);
  console.log(JSON.stringify({mode:'dry-run; no services, credentials, writes or model calls',receipt,receiptHash:hash,
   current:{runCount:state.runs.length,versionCount:state.versions.length,coordinationTurnCount:state.coordination.turns.length,proposalStatus:status.proposal.status,acceptedRunId:status.proposal.acceptedRunId},
   backupRequired:true,execution:'reviewed exact accept; original strict auto failure remains failed'},null,2));
 }else{
  assertExecutionGuards({execute,real:argv.includes('--real'),env:process.env,approvedHash:value('--receipt-hash'),receipt});
  assert.ok(value('--backup'),'An existing full stopped-service backup is required.');assert.ok(process.env.DEEPSEEK_API_KEY,'Provide DEEPSEEK_API_KEY only via the parent environment; no fallback.');
  assertNoActiveState(state);assertResumeState(state,receipt);
  function stoppedProcesses(){
   // Do not print process arguments/environment. Exclude this read-only runner's PID.
   let listing;try{listing=execFileSync('lsof',['-Fpn','-d','cwd'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch(error){if(error.code==='ENOENT')throw new Error('lsof is required for the stopped-service gate.');if(error.status===1)listing='';else throw new Error('Could not prove services are stopped.');}
   const owned=new Set();let pid=null;
   for(const line of listing.split('\n')){if(line[0]==='p')pid=Number(line.slice(1));if(line[0]==='n'&&pid!==process.pid){const cwd=line.slice(1);if(cwd===directory||cwd.startsWith(directory+path.sep)||['api','agent','web'].some(name=>cwd===path.join(root,'apps',name)))owned.add(pid);}}
   try{for(const line of execFileSync('lsof',['-t',path.join(directory,'api/api.sqlite')],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\n'))if(Number(line)&&Number(line)!==process.pid)owned.add(Number(line));}catch(error){if(error.code==='ENOENT'||error.status!==1)throw new Error('Could not prove the API database is closed.');}
   assert.ok(!owned.size,`Original/integration services must be stopped first; blocking PID count=${owned.size}.`);
  }
  stoppedProcesses();const backup=await verifyBackup(directory,path.resolve(value('--backup')));
  const initialEvidence=await immutableEvidence(state,directory,receipt);
  if(saved)assert.equal(canonical(initialEvidence),canonical(saved.immutableEvidence),'Original two successful deliveries changed before continuation.');
  else await privateJson(reviewFile,{receipt,receiptHash:hash,immutableEvidence:initialEvidence,backup});
  const lockFile=path.join(control,'execution.lock');await privateJson(lockFile,{pid:process.pid});
  const children=[];let cookie='',failed=true;
  const secrets=await resumeSecrets(path.join(control,'resume-local-secrets.json')),modelKey=process.env.DEEPSEEK_API_KEY;
  const redact=value=>[modelKey,...Object.values(secrets)].reduce((text,secret)=>text.split(secret).join('[REDACTED]'),String(value));
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
  const [apiPort,previewPort,agentPort,webPort]=await Promise.all([freePort(),freePort(),freePort(),freePort()]);
  const origin=`http://localhost:${apiPort}`,agentOrigin=`http://127.0.0.1:${agentPort}`;
  const settings={NODE_ENV:'test',API_PORT:String(apiPort),PREVIEW_PORT:String(previewPort),AGENT_PORT:String(agentPort),WEB_PORT:String(webPort),
   API_DATA_DIR:path.join(directory,'api'),AGENT_DATA_DIR:path.join(directory,'agent'),AGENT_URL:agentOrigin,API_INTERNAL_URL:`http://127.0.0.1:${apiPort}`,
   PREVIEW_PUBLIC_URL:`http://127.0.0.1:${previewPort}`,ATOMS_ALLOWED_ORIGINS:`${origin},http://localhost:${webPort}`,
   ATOMS_ENABLE_DEMO:'true',ATOMS_DEMO_CODE:'m2-delivery-2026',AGENT_MODE:'dsh',ATOMS_AGENT_MODE:'dsh',COORDINATOR_MODE:'dsh',
   M2_TOOLCHAIN_ID:'toolchain_react_v1',M2_MAX_MODEL_STEPS:'8',M2_MAX_INPUT_TOKENS:'65536',M2_MAX_OUTPUT_TOKENS:'24576',M2_MAX_ACTIVE_MS:'900000',
   VITE_API_PROXY_TARGET:`http://127.0.0.1:${apiPort}`,VITE_RUNTIME_MODE:'dsh',VITE_COORDINATOR_MODE:'dsh'};
  function alive(){const dead=unexpectedServiceExit(children);assert.ok(!dead,'A resumed service exited; no automatic new Run/retry is allowed.');}
  function start(kind){const name=`@atoms/${kind}`,args=['--filter',name,kind==='web'?'dev':'start'];if(kind==='web')args.push('--port',String(webPort));
   const child=spawn('pnpm',args,{cwd:root,env:childEnvironment(kind,{parentEnv:process.env,settings,secrets,modelKey}),detached:true,stdio:['ignore','pipe','pipe']});
   child.name=name;child.lifecycle='service';const log=createWriteStream(path.join(control,`${kind}-${Date.now()}.log`),{mode:0o600,flags:'wx'});child.log=log;
   for(const stream of [child.stdout,child.stderr]){const safe=logRedactor([modelKey,...Object.values(secrets)]);stream.on('data',bytes=>log.write(safe.write(bytes)));stream.on('end',()=>log.write(safe.end()));}children.push(child);return child;
  }
  async function stop(child){if(!child||child.stopping)return;child.stopping=true;if(child.exitCode===null&&child.signalCode===null){const done=once(child,'close').catch(()=>{});try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([done,delay(2000)]);if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}await done;}}if(child.log)await new Promise(resolve=>child.log.end(resolve));}
  for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{
   console.error('Resume interrupted; stopping owned children. Keep the lock for root inspection; no replacement task is permitted.');
   void Promise.all(children.map(stop)).finally(()=>process.exit(code));
  });
  async function ready(url,headers={}){const end=Date.now()+45000;while(Date.now()<end){alive();try{if((await fetch(url,{headers,signal:AbortSignal.timeout(2000)})).ok)return;}catch{}await delay(200);}throw new Error('Resumed service readiness timed out.');}
  async function request(method,url,body,key){alive();const response=await fetch(origin+url,{method,headers:{Origin:origin,Cookie:cookie,'X-Atoms-Delivery-Version':'0.1.0','X-Atoms-Coordination-Version':'0.2.0',...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)}).catch(error=>{throw Object.assign(error,{transport:true});});
   const bytes=Buffer.from(await response.arrayBuffer()),data=response.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes.toString()):null;assert.ok(response.ok,`Resume HTTP rejected: ${method} ${url} status ${response.status}.`);return {response,bytes,data};}
  async function onceReceipt(file,value){if(existsSync(file))assert.equal(canonical(JSON.parse(await readFile(file,'utf8'))),canonical(value),'A persisted operation receipt changed.');else await privateJson(file,value);}
  async function waitRun(id){const end=Date.now()+960000;while(Date.now()<end){const run=(await request('GET',`/api/v1/runs/${id}`)).data;if(run.status==='succeeded')return run;assert.ok(!['failed','cancelled','interrupted'].includes(run.status),'Reviewed continuation failed; do not create another Run.');assert.notEqual(run.status,'waiting_input','Unexpected question; stop for root review, do not auto-answer.');await delay(500);}throw new Error('Reviewed continuation deadline exceeded; no retry Run is permitted.');}
  async function waitTurn(id){const end=Date.now()+120000;while(Date.now()<end){const turn=(await request('GET',`/api/v2/coordination-turns/${id}`)).data;if(turn.status==='completed')return turn;assert.ok(!['failed','cancelled','interrupted'].includes(turn.status),'Quality consultation failed; do not create another Turn.');await delay(400);}throw new Error('Quality consultation deadline exceeded.');}
  async function sealed(versionId){let previous;const end=Date.now()+10000;while(Date.now()<end){const checkpoint=deliveryRestartCheckpoint((await request('GET',`/api/v2/projects/${receipt.proposal.projectId}/workspace`)).data,versionId);if(previous&&canonical(previous)===canonical(checkpoint))return checkpoint;previous=checkpoint;await delay(600);}throw new Error('Resumed workspace did not seal.');}
  try{
   let agent=start('agent'),api=start('api');start('web');await ready(agentOrigin+'/internal/v1/health',{Authorization:`Bearer ${secrets.serviceToken}`,'X-Atoms-Protocol-Version':'0.1.0'});await ready(origin+'/health');await ready(`http://localhost:${webPort}`);
   const login=await request('POST','/api/v1/sessions',{code:settings.ATOMS_DEMO_CODE},sha('resume-login:'+hash));cookie=login.response.headers.get('set-cookie').split(';')[0];
   const actual=(await request('GET',`/api/v2/proposals/${receipt.proposal.id}`)).data;
   for(const key of ['id','projectId','goal','origin','expiresAt'])assert.equal(actual[key],receipt.proposal[key]);
   for(const key of ['acceptance','sourceMessageIds','basePolicy'])assert.equal(canonical(actual[key]),canonical(receipt.proposal[key]));
   let current=assertResumeState(readApiState(directory),receipt);let runId=current.run?.dto.id;
   if(!runId){assert.equal(actual.revision,receipt.proposal.revision);assert.ok(Date.parse(actual.expiresAt)>Date.now());
    const accepted=await submitWithReconciliation(()=>request('POST',`/api/v2/proposals/${receipt.proposal.id}/accept`,{expectedRevision:receipt.proposal.revision,runMode:'build'},secrets.acceptKey),async()=>{
     const checked=assertResumeState(readApiState(directory),receipt);return checked.run?{data:{run:checked.run.dto}}:null;
    });runId=accepted.data.run.id;
   }
   await onceReceipt(path.join(control,'accepted-run.json'),{kind:'reviewed_exact_accept',proposalId:receipt.proposal.id,runId});
   console.log('Reviewed exact accept: continuing only the third Code Run from actual restored V3. Original auto-admission failure remains preserved.');
   const done=await waitRun(runId);assert.equal(done.baseVersionId,receipt.base.versionId);
   const currentState=readApiState(directory),record=currentState.runs.find(r=>r.dto.id===runId),version=currentState.versions.find(v=>v.dto.id===done.resultVersionId);
   assertResumeState(currentState,receipt);assert.equal(currentState.runs.length,3);assert.equal(currentState.versions.length,4);
   assert.equal(record.delivery.prepare.seed.source.admission,'explicit_proposal_acceptance');assert.equal(record.delivery.prepare.seed.source.proposalId,receipt.proposal.id);
   assert.equal(record.delivery.wrapper.bundle.binding.baseVersionId,receipt.base.versionId);assert.equal(version.dto.parentVersionId,receipt.base.versionId);
   assert.ok(!receipt.originalRuns.some(old=>currentState.runs.find(r=>r.dto.id===old.id).delivery.wrapper.bundle.binding.hash===record.delivery.wrapper.bundle.binding.hash));
   const delivery=DeliveryReadView.parse((await request('GET',`/api/delivery/v1/runs/${runId}`)).data);assert.equal(delivery.state,'available');assert.equal(delivery.reportFinal,true);assert.equal(delivery.apiVerification,'verified');assert.equal(delivery.publication.status,'published');assert.ok(['complete','partial'].includes(delivery.quality));
   const exported=ExportReadView.parse((await request('GET',`/api/delivery/v1/versions/${done.resultVersionId}/export`)).data);assert.equal(exported.status,'verified');
   const zip=await request('GET',`/api/delivery/v1/versions/${done.resultVersionId}/source.zip`),legacyZip=await request('GET',`/api/v1/versions/${done.resultVersionId}/source.zip`);assert.deepEqual(zip.bytes,legacyZip.bytes);
   assert.equal(sha(zip.bytes),exported.downloadRef.archiveHash);
   const evidence=delivery.report.evidence[0];assert.ok(evidence);const descriptor=EvidenceDescriptor.parse((await request('GET',`/api/delivery/v1/deliveries/${delivery.report.id}/evidence/${evidence.id}`)).data);
   assert.equal(sha((await request('GET',`/api/delivery/v1/deliveries/${delivery.report.id}/evidence/${evidence.id}/content`)).bytes),descriptor.sha256);
   const diff=VersionDiffPage.parse((await request('GET',`/api/delivery/v1/projects/${receipt.proposal.projectId}/version-diff?baseVersionId=${receipt.base.versionId}&headVersionId=${done.resultVersionId}`)).data);assert.ok(diff.files.length>0,'The reviewed modification must have a source diff.');
   const workspace=(await request('GET',`/api/v1/projects/${receipt.proposal.projectId}/workspace`)).data;assert.equal(workspace.currentVersion.id,done.resultVersionId);assert.equal((await fetch(workspace.currentVersion.previewUrl)).status,200);
   assert.equal(canonical(await immutableEvidence(readApiState(directory),directory,receipt)),canonical(initialEvidence),'Original source/report/evidence changed.');
   current=assertResumeState(readApiState(directory),receipt);let turnId=current.qualityTurn?.dto.id;
   if(!turnId){const asked=await submitWithReconciliation(()=>request('POST',`/api/v2/projects/${receipt.proposal.projectId}/messages`,{input:{kind:'text',content:QUALITY_ASK},mode:'ask'},secrets.askKey),async()=>{
    const checked=assertResumeState(readApiState(directory),receipt);return checked.qualityTurn?{data:{turn:checked.qualityTurn.dto}}:null;
   });turnId=asked.data.turn.id;}
   await onceReceipt(path.join(control,'quality-turn.json'),{turnId});const quality=await waitTurn(turnId);assert.ok(['consult','status'].includes(quality.result.kind),'Quality consultation must remain read-only.');
   const finalState=readApiState(directory);assertResumeState(finalState,receipt);assert.equal(finalState.coordination.turns.length,2);assert.equal(finalState.runs.length,3);
   const turnRecord=finalState.coordination.turns.find(t=>t.dto.id===turnId),coordRequest=turnRecord.deliveryRequest;assert.ok(coordRequest);assert.equal(coordRequest.coordination.context.contextVersionId,done.resultVersionId);
   for(const [key,value] of Object.entries({maxModelSteps:3,maxWallTimeMs:90000,maxInputTokens:32768,maxOutputTokens:8192}))assert.equal(coordRequest.coordination.budget[key],value);
   const response=await fetch(agentOrigin+`/internal/delivery/v1/coordination-turns/${turnId}`,{headers:{Authorization:`Bearer ${secrets.serviceToken}`,'X-Atoms-Delivery-Version':'0.1.0'}});assert.equal(response.status,200);
   const observed=DeliveryCoordinationSnapshot.parse(await response.json());
   for(const key of ['hash','revision','asOf','projectId'])assert.equal(observed.deliveryFactsUsed[key],coordRequest.deliveryFacts[key]);
   const fact=coordRequest.deliveryFacts.versions.find(v=>v.versionId===done.resultVersionId);assert.ok(fact);assert.equal(fact.quality,delivery.quality);assert.equal(canonical(fact.gaps),canonical(delivery.gaps));
   const usageAudit=auditCoordinationUsage(observed.coordination.usage,coordRequest.coordination.budget,{real:true});
   const before=await sealed(done.resultVersionId),account=(await request('GET','/api/v2/session')).data;assert.equal(account.session.quota.runsUsed,3);assert.equal(account.session.quota.runsReserved,0);
   const invocation=webReadonlyInvocation({root,webUrl:`http://localhost:${webPort}`,projectId:receipt.proposal.projectId,demoCode:settings.ATOMS_DEMO_CODE,real:true,parentEnv:process.env});
   const browser=spawn(invocation.command,invocation.args,{cwd:invocation.cwd,env:invocation.env,detached:true,stdio:['ignore','pipe','pipe']});browser.lifecycle='oneshot';children.push(browser);
   browser.log=createWriteStream(path.join(control,`readonly-web-${Date.now()}.log`),{mode:0o600,flags:'wx'});for(const stream of [browser.stdout,browser.stderr]){const safe=logRedactor([modelKey,...Object.values(secrets)]);stream.on('data',bytes=>browser.log.write(safe.write(bytes)));stream.on('end',()=>browser.log.write(safe.end()));}
   assertOneShotSucceeded(await awaitOneShot(browser));assert.deepEqual(await sealed(done.resultVersionId),before);assert.deepEqual((await request('GET','/api/v2/session')).data,account);
   await stop(api);await stop(agent);agent=start('agent');api=start('api');await ready(agentOrigin+'/internal/v1/health',{Authorization:`Bearer ${secrets.serviceToken}`,'X-Atoms-Protocol-Version':'0.1.0'});await ready(origin+'/health');
   assert.deepEqual(await sealed(done.resultVersionId),before);assert.deepEqual((await request('GET','/api/v2/session')).data,account);
   assert.equal(canonical(await immutableEvidence(readApiState(directory),directory,receipt)),canonical(initialEvidence));
   const finalCounts=assertResumeState(readApiState(directory),receipt);assert.ok(finalCounts.run&&finalCounts.qualityTurn);
   await onceReceipt(path.join(control,'resume-acceptance.json'),{kind:'reviewed_exact_accept_not_auto',receiptHash:hash,run:done,delivery,export:exported,diff,qualityTurnId:turnId,usageAudit,
    restartCheckpoint:before,originalEvidenceUnchanged:true,counts:{codeRuns:3,coordinationTurns:2,versions:4},readonlyWebPassed:true,strictRestartPassed:true});
   failed=false;console.log('Reviewed exact continuation passed: total 3 Code Runs / 2 Router Turns; original two deliveries unchanged; read-only UI and strict restart passed.');
  }catch(error){console.error(redact(error.stack??error).slice(0,4000));process.exitCode=1;}
  finally{await Promise.all(children.map(stop));await unlink(lockFile);console.log(failed?'Continuation stopped; preserve all evidence. No automatic replacement Run/Turn was submitted.':'Preserved reviewed continuation evidence.');}
 }
}
