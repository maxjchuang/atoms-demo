import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,cp,utimes,symlink,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RESUME_TARGET as t,QUALITY_ASK,reviewReceipt,receiptHash,assertExecutionGuards,assertResumeState,assertNoActiveState,
 privateJson,resumeSecrets,childEnvironment,verifyBackup,immutableEvidence,submitWithReconciliation,logRedactor,canonical,treeMetadata} from './delivery-resume-helpers.mjs';

function synthetic(directory){
 const first='version_1e80ef9242bc941ab31e',second='version_e494864c4b20e3dbcca9';
 return {projects:[{dto:{id:t.projectId,currentVersionId:t.baseVersionId,activeRunId:null}}],
  runs:t.originalRunIds.map((id,index)=>({dto:{id,status:'succeeded',baseVersionId:index?first:null,resultVersionId:index?second:first}})),
  versions:[first,second,t.baseVersionId].map((id,index)=>({dto:{id,parentVersionId:index===0?null:index===1?first:second,restoredFromVersionId:index===2?first:null,runId:index<2?t.originalRunIds[index]:null,previewUrl:'http://old.invalid/capability',previewExpiresAt:'2030-01-01T00:00:00.000Z'},
   directory:path.join(directory,'api/versions',id),manifest:{files:[{path:'source/App.tsx'}]},manifestRaw:'synthetic manifest'})),
  coordination:{proposals:[{id:t.proposalId,revision:1,projectId:t.projectId,origin:'explicit_request',status:'open',acceptedRunId:null,goal:'Add short Chinese guidance and preserve six behaviors.',acceptance:[{id:'a1',description:'Preserve six behaviors.'}],
   originatingTurnId:'turn_original',sourceMessageIds:[t.sourceMessageId],basePolicy:{kind:'exact_version',expectedBaseVersionId:t.baseVersionId},expiresAt:'2030-01-01T00:00:00.000Z'}],
   turns:[{dto:{id:'turn_original',status:'completed',result:{admission:'proposed'}}}],messages:[{id:t.sourceMessageId,projectId:t.projectId,role:'user',content:'Original explicit request.'}]}};
}
async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'atoms-resume-test-')),state=synthetic(directory);
 await mkdir(path.join(directory,'api'),{recursive:true});
 for(const version of state.versions){await mkdir(path.join(version.directory,'source'),{recursive:true});await writeFile(path.join(version.directory,'source/App.tsx'),'Synthetic immutable source.');}
 const db=new DatabaseSync(path.join(directory,'api/api.sqlite'));db.exec('CREATE TABLE app_state(id INTEGER PRIMARY KEY, document TEXT NOT NULL)');db.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify(state));db.close();
 return {directory,state,receipt:reviewReceipt(state,directory),async close(){await rm(directory,{recursive:true,force:true});}};
}

test('review receipt resolves model alias to actual restored V3, binds complete exact action and rejects unsafe starting state',async()=>{
 const f=await fixture();try{
  assert.equal(f.receipt.base.actualVersionNumber,3);assert.equal(f.receipt.base.versionId,t.baseVersionId);assert.equal(f.receipt.base.restoredFromVersionId,t.restoredFromVersionId);
  assert.equal(f.receipt.originalCounts.runs,2);assert.match(f.receipt.originalRunnerOutcome,/failed/);
  for(const change of [s=>s.coordination.proposals[0].revision++,s=>s.coordination.proposals[0].basePolicy.kind='latest_on_dispatch',s=>s.projects[0].dto.currentVersionId='version_other',s=>s.runs[0].dto.status='running',s=>s.versions.pop(),s=>s.coordination.proposals[0].expiresAt='2020-01-01T00:00:00.000Z']){
   const state=structuredClone(f.state);change(state);assert.throws(()=>reviewReceipt(state,f.directory));
  }
  assert.equal(receiptHash(f.receipt),receiptHash(structuredClone(f.receipt)));assert.notEqual(receiptHash({...f.receipt,directory:'/other'}),receiptHash(f.receipt));
 }finally{await f.close();}
});

test('execution requires explicit flags, all three guards and matching reviewed receipt hash',async()=>{
 const f=await fixture();try{
  const env={ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION:'1',ATOMS_ALLOW_REAL_DELIVERY_ROUTER:'1',ATOMS_ALLOW_REAL_DELIVERY_RESUME:'1'};
  const input={execute:true,real:true,env,approvedHash:receiptHash(f.receipt),receipt:f.receipt};assertExecutionGuards(input);
  assert.throws(()=>assertExecutionGuards({...input,execute:false}));assert.throws(()=>assertExecutionGuards({...input,real:false}));assert.throws(()=>assertExecutionGuards({...input,approvedHash:'not-reviewed'}));
  for(const key of Object.keys(env))assert.throws(()=>assertExecutionGuards({...input,env:{...env,[key]:'0'}}));
 }finally{await f.close();}
});

test('resumption reconciles the sole accepted Run and read-only ask but rejects a fourth Code, third Turn or scope changes',async()=>{
 const f=await fixture();try{
  assert.equal(assertResumeState(f.state,f.receipt).run,null);
  const state=structuredClone(f.state),proposal=state.coordination.proposals[0];proposal.status='accepted';proposal.revision++;proposal.acceptedRunId='run_third';
  state.runs.push({dto:{id:'run_third',status:'succeeded'},proposalId:proposal.id,exactBaseVersionId:t.baseVersionId});
  state.coordination.turns.push({dto:{id:'turn_quality',mode:'ask',status:'completed'},operation:{kind:'message',input:{kind:'text',content:QUALITY_ASK}}});
  assert.equal(assertResumeState(state,f.receipt).run.dto.id,'run_third');assertNoActiveState(state);
  const fourth=structuredClone(state);fourth.runs.push({dto:{id:'run_fourth',status:'queued'}});assert.throws(()=>assertResumeState(fourth,f.receipt));
  const third=structuredClone(state);third.coordination.turns.push({dto:{id:'turn_third'}});assert.throws(()=>assertResumeState(third,f.receipt));
  const changed=structuredClone(state);changed.coordination.proposals[0].goal+=' changed';assert.throws(()=>assertResumeState(changed,f.receipt));
  state.runs[2].dto.status='running';assert.throws(()=>assertNoActiveState(state));
 }finally{await f.close();}
});

test('transport response loss reconciles accepted ID or repeats only the same idempotent submission, never a replacement',async()=>{
 let calls=0,rows=new Map();const key='same-reviewed-key';
 const submit=async()=>{calls++;if(!rows.has(key))rows.set(key,{runId:'run_third'});if(calls===1)throw Object.assign(new Error('response lost'),{transport:true});return rows.get(key);};
 const known=await submitWithReconciliation(submit,async()=>rows.get(key));assert.equal(known.runId,'run_third');assert.equal(calls,1);assert.equal(rows.size,1);
 calls=0;rows=new Map();const retried=await submitWithReconciliation(submit,async()=>null);assert.equal(retried.runId,'run_third');assert.equal(calls,2);assert.equal(rows.size,1);
 let retries=0;await assert.rejects(submitWithReconciliation(async()=>{throw new Error('policy rejected');},async()=>{retries++;}));assert.equal(retries,0);
});

test('resume credentials are owner-only, reused exactly, exclude provider keys and refuse public/symlink files',async()=>{
 const f=await fixture();try{
  const file=path.join(f.directory,'private/resume-local-secrets.json'),first=await resumeSecrets(file),again=await resumeSecrets(file);assert.deepEqual(again,first);
  assert.equal((await lstat(file)).mode&0o777,0o600);assert.equal((await lstat(path.dirname(file))).mode&0o777,0o700);
  assert.deepEqual(Object.keys(first).sort(),['acceptKey','askKey','previewSecret','serviceToken']);assert.ok(!(await readFile(file,'utf8')).includes('DEEPSEEK_API_KEY'));
  const insecure=path.join(f.directory,'insecure.json');await writeFile(insecure,JSON.stringify(first),{mode:0o644});await assert.rejects(resumeSecrets(insecure),/owner-only/);
  const link=path.join(f.directory,'linked.json');await symlink(file,link);await assert.rejects(resumeSecrets(link),/owner-only/);
  await assert.rejects(privateJson(path.join(f.directory,'api/review.json'),{}),/owner-only/);
 }finally{await f.close();}
});

test('child environments pass the model key only to Agent and omit inherited credentials/options from API/Web',()=>{
 const parentEnv={PATH:'/bin',HOME:'/home/test',DEEPSEEK_API_KEY:'fake-provider-secret',OPENAI_API_KEY:'fake-other-secret',ATOMS_SERVICE_TOKEN:'fake-parent-token',PREVIEW_SECRET:'fake-parent-preview',NODE_OPTIONS:'untrusted'};
 const secrets={serviceToken:'fake-new-service-token',previewSecret:'fake-new-preview-secret'},settings={NODE_ENV:'test',API_PORT:'1'};
 for(const kind of ['agent','api','web']){
  const env=childEnvironment(kind,{parentEnv,settings,secrets,modelKey:'fake-provider-secret'});
  assert.equal(env.DEEPSEEK_API_KEY,kind==='agent'?'fake-provider-secret':undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  assert.equal(env.ATOMS_SERVICE_TOKEN,kind==='web'?undefined:secrets.serviceToken);assert.equal(env.PREVIEW_SECRET,kind==='api'?secrets.previewSecret:undefined);
 }
});

test('private logs redact provider and runtime secrets even when a secret crosses chunk boundaries',()=>{
 const secret='synthetic-secret-for-log-test',text=`before ${secret} after`;
 for(let split=1;split<text.length;split++){const redactor=logRedactor([secret]);const result=redactor.write(text.slice(0,split))+redactor.write(text.slice(split))+redactor.end();assert.equal(result,'before [REDACTED] after');}
});

test('full backup checks metadata and opaque bytes without following links; original evidence permits only URL cache changes',async()=>{
 const f=await fixture(),backup=await mkdtemp(path.join(tmpdir(),'atoms-resume-backup-'));try{
  await writeFile(path.join(f.directory,'native-opaque.bin'),Buffer.from([0,255,128,1]));await symlink('missing-relative-target',path.join(f.directory,'relative-link'));
  // Node cp round-trips timestamps through Date; use exact synthetic timestamps for this fixture.
  for(const entry of await treeMetadata(f.directory))if(entry.type==='file')await utimes(path.join(f.directory,entry.path),1700000000,1700000000);
  await cp(f.directory,backup,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
  const checked=await verifyBackup(f.directory,backup);assert.equal(checked.opaqueFilesMatched,true);assert.ok(checked.regularFileCount>=5);assert.ok(checked.totalBytes>0);
  const stat=await lstat(path.join(backup,'native-opaque.bin'));await writeFile(path.join(backup,'native-opaque.bin'),Buffer.from([0,254,128,1]));await utimes(path.join(backup,'native-opaque.bin'),stat.atime,stat.mtime);
  await assert.rejects(verifyBackup(f.directory,backup),/Opaque backup bytes differ/);
  const before=await immutableEvidence(f.state,f.directory,f.receipt);f.state.versions[0].dto.previewUrl='https://new.test/token';f.state.versions[0].dto.previewExpiresAt='2031-01-01T00:00:00.000Z';
  assert.equal(canonical(await immutableEvidence(f.state,f.directory,f.receipt)),canonical(before));
  await writeFile(path.join(f.state.versions[0].directory,'source/App.tsx'),'Changed original source.');assert.notEqual(canonical(await immutableEvidence(f.state,f.directory,f.receipt)),canonical(before));
 }finally{await f.close();await rm(backup,{recursive:true,force:true});}
});

test('actual CLI dry-run is read-only and missing execute guards fail before secrets, services or .env loading',async()=>{
 const f=await fixture();try{
  const cwd=fileURLToPath(new URL('../../packages/contracts/',import.meta.url)),runner=fileURLToPath(new URL('./delivery-resume.mjs',import.meta.url));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,DEEPSEEK_API_KEY:'fake-must-not-be-used'};
  const before=canonical(await treeMetadata(f.directory));
  const dry=spawnSync(process.execPath,['--import','tsx',runner,'--directory',f.directory],{cwd,env,encoding:'utf8',timeout:10000});
  assert.equal(dry.status,0,dry.stderr);const output=JSON.parse(dry.stdout);assert.equal(output.receipt.base.actualVersionNumber,3);assert.equal(output.receiptHash,receiptHash(f.receipt));assert.match(output.mode,/no services/);
  assert.equal(canonical(await treeMetadata(f.directory)),before);assert.ok(!(await readdir(f.directory)).includes('resume-control'));assert.ok(!dry.stdout.includes(env.DEEPSEEK_API_KEY));
  const blocked=spawnSync(process.execPath,['--import','tsx',runner,'--directory',f.directory,'--execute','--real','--receipt-hash',output.receiptHash],{cwd,env,encoding:'utf8',timeout:10000});
  assert.equal(blocked.status,1);assert.match(blocked.stderr,/ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION/);assert.equal(canonical(await treeMetadata(f.directory)),before);
 }finally{await f.close();}
});
