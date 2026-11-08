/** Test-runner policy only. No App/Agent implementation imports and no model calls. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,lstat,mkdir,readdir,readlink,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createReadStream} from 'node:fs';
import path from 'node:path';

export const RESUME_TARGET=Object.freeze({proposalId:'proposal_91e10bb774cd2b59b217',projectId:'project_ad7a08e8a7b7b839befc',
 proposalRevision:1,baseVersionId:'version_86330d74e662946d74e9',restoredFromVersionId:'version_1e80ef9242bc941ab31e',
 sourceMessageId:'message_b8a32af530dace95322b',originalRunIds:['run_3576e8b55490b4d6761e','run_91970bfc4d0882843eb9']});
export const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const receiptHash=receipt=>sha(canonical(receipt));
export const QUALITY_ASK='请根据当前版本的交付事实，说明本次验证质量和仍未覆盖的验收项。只回答，不修改应用。';
const terminal=status=>['succeeded','failed','cancelled','interrupted','completed'].includes(status);

export function readApiState(directory){
 const db=new DatabaseSync(path.join(directory,'api/api.sqlite'),{readOnly:true});
 try{return JSON.parse(db.prepare('SELECT document FROM app_state WHERE id=1').get().document);}finally{db.close();}
}
export function reviewReceipt(state,directory,now=Date.now()){
 const t=RESUME_TARGET,proposal=state.coordination.proposals.find(p=>p.id===t.proposalId),project=state.projects.find(p=>p.dto.id===t.projectId)?.dto;
 assert.ok(proposal&&project,'Approved proposal/project not found.');
 assert.equal(proposal.revision,t.proposalRevision);assert.equal(proposal.projectId,t.projectId);assert.equal(proposal.origin,'explicit_request');
 assert.equal(proposal.status,'open');assert.equal(proposal.acceptedRunId,null);assert.deepEqual(proposal.sourceMessageIds,[t.sourceMessageId]);
 assert.deepEqual(proposal.basePolicy,{kind:'exact_version',expectedBaseVersionId:t.baseVersionId});assert.equal(project.currentVersionId,t.baseVersionId);assert.equal(project.activeRunId,null);
 assert.ok(Date.parse(proposal.expiresAt)>now,'Approved proposal has expired; no refresh/new Router is permitted.');
 assert.equal(state.runs.length,2);assert.equal(state.versions.length,3);assert.equal(state.coordination.turns.length,1);
 assert.ok(state.runs.every(r=>t.originalRunIds.includes(r.dto.id)&&r.dto.status==='succeeded'),'Original two Code Runs must remain succeeded.');
 assert.ok(state.coordination.turns.every(r=>terminal(r.dto.status)),'All coordination must be terminal.');
 const restored=state.versions.find(v=>v.dto.id===t.baseVersionId)?.dto;assert.ok(restored);assert.equal(restored.restoredFromVersionId,t.restoredFromVersionId);assert.equal(restored.runId,null);
 assert.equal(state.versions.findIndex(v=>v.dto.id===restored.id)+1,3);
 const originTurn=state.coordination.turns.find(turn=>turn.dto.id===proposal.originatingTurnId);assert.equal(originTurn?.dto.result?.admission,'proposed');
 const source=state.coordination.messages.find(m=>m.id===t.sourceMessageId);assert.equal(source?.role,'user');assert.equal(source?.projectId,t.projectId);
 return {kind:'reviewed-exact-accept-v1',directory:path.resolve(directory),proposal:{id:proposal.id,revision:proposal.revision,projectId:proposal.projectId,goal:proposal.goal,
  acceptance:proposal.acceptance,origin:proposal.origin,sourceMessageIds:proposal.sourceMessageIds,sourceText:source.content,basePolicy:proposal.basePolicy,expiresAt:proposal.expiresAt,originatingTurnId:proposal.originatingTurnId},
  base:{versionId:restored.id,actualVersionNumber:3,restoredFromVersionId:restored.restoredFromVersionId,
   note:'The model goal/context alias v2 resolves to this exact ID. Actual displayed base is restored V3; original goal/history is not rewritten.'},
  originalRuns:state.runs.map(r=>({id:r.dto.id,status:r.dto.status,baseVersionId:r.dto.baseVersionId,resultVersionId:r.dto.resultVersionId})),
  originalVersionIds:state.versions.map(v=>v.dto.id),originalTurnIds:state.coordination.turns.map(r=>r.dto.id),
  originalCounts:{runs:2,versions:3,coordinationTurns:1},remaining:{codeRuns:1,coordinationTurns:1},
  originalRunnerOutcome:'strict auto-admission assertion failed; preserved, not converted to auto success'};
}
export function assertExecutionGuards({execute,real,env,approvedHash,receipt}){
 assert.equal(execute,true,'Execution is opt-in.');assert.equal(real,true,'Explicit --real is required.');
 for(const key of ['ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION','ATOMS_ALLOW_REAL_DELIVERY_ROUTER','ATOMS_ALLOW_REAL_DELIVERY_RESUME'])assert.equal(env[key],'1',`Explicit ${key}=1 is required.`);
 assert.equal(approvedHash,receiptHash(receipt),'The supplied receipt hash does not match the reviewed exact action.');
}
export function assertResumeState(state,receipt){
 const p=state.coordination.proposals.find(p=>p.id===receipt.proposal.id);assert.ok(p,'Reviewed proposal disappeared.');
 for(const key of ['id','projectId','goal','origin','expiresAt','originatingTurnId'])assert.equal(p[key],receipt.proposal[key],`Reviewed proposal changed: ${key}`);
 for(const key of ['acceptance','sourceMessageIds','basePolicy'])assert.equal(canonical(p[key]),canonical(receipt.proposal[key]),`Reviewed proposal changed: ${key}`);
 const extraRuns=state.runs.filter(r=>!receipt.originalRuns.some(old=>old.id===r.dto.id));assert.ok(extraRuns.length<=1,'A fourth Code Run is forbidden.');
 const extraTurns=state.coordination.turns.filter(r=>!receipt.originalTurnIds.includes(r.dto.id));assert.ok(extraTurns.length<=1,'A third coordination Turn is forbidden.');
 if(extraTurns[0]){
  assert.equal(extraTurns[0].dto.mode,'ask');assert.equal(extraTurns[0].operation.kind,'message');
  assert.deepEqual(extraTurns[0].operation.input,{kind:'text',content:QUALITY_ASK});
 }
 if(p.acceptedRunId){
  assert.equal(p.status,'accepted');assert.equal(p.revision,receipt.proposal.revision+1);assert.equal(extraRuns.length,1);assert.equal(extraRuns[0].dto.id,p.acceptedRunId);
  assert.equal(extraRuns[0].proposalId,p.id);assert.equal(extraRuns[0].exactBaseVersionId,receipt.base.versionId);
 }else{
  assert.equal(p.status,'open');assert.equal(p.revision,receipt.proposal.revision);assert.equal(extraRuns.length,0);
  assert.equal(state.projects.find(v=>v.dto.id===p.projectId).dto.currentVersionId,receipt.base.versionId);
 }
 return {proposal:p,run:extraRuns[0]??null,qualityTurn:extraTurns[0]??null};
}
export function assertNoActiveState(state){
 assert.ok(state.runs.every(r=>terminal(r.dto.status)),'Stop: a nonterminal Run exists; do not recreate or automatically retry it.');
 assert.ok(state.coordination.turns.every(t=>terminal(t.dto.status)),'Stop: a nonterminal coordination Turn exists.');
 assert.ok(state.projects.every(p=>p.dto.activeRunId===null),'Stop: project writer lock remains.');
}
/** Retry only delivery of the same idempotent operation, never a new model task. */
export async function submitWithReconciliation(submit,reconcile){
 try{return await submit();}catch(error){if(error.transport!==true)throw error;const known=await reconcile();return known??await submit();}
}
export async function privateJson(file,value){
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const parent=await lstat(path.dirname(file));assert.ok(parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o077)===0,'Private control directory must be owner-only.');
 const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
}
export async function resumeSecrets(file){
 let value;
 try{const stat=await lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'Resume secrets must be an owner-only regular file.');value=JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;value={serviceToken:randomUUID(),previewSecret:randomUUID(),acceptKey:randomUUID(),askKey:randomUUID()};await privateJson(file,value);}
 assert.deepEqual(Object.keys(value).sort(),['acceptKey','askKey','previewSecret','serviceToken']);
 assert.ok(Object.values(value).every(v=>typeof v==='string'&&v.length>=16),'Invalid private resume credentials.');return value;
}
/** Keep enough tail to redact secrets split across stdout/stderr chunks before writing logs. */
export function logRedactor(values){
 const secrets=values.filter(value=>typeof value==='string'&&value.length),hold=Math.max(1,...secrets.map(value=>value.length))-1;let pending='';
 const clean=text=>secrets.reduce((result,secret)=>result.split(secret).join('[REDACTED]'),text);
 return {write(bytes){pending=clean(pending+String(bytes));const length=Math.max(0,pending.length-hold),out=pending.slice(0,length);pending=pending.slice(length);return out;},
  end(){const out=clean(pending);pending='';return out;}};
}
/** Explicit allowlist; no provider/internal credentials in API, Web or browser child environments. */
export function childEnvironment(kind,{parentEnv,settings,secrets,modelKey}){
 const result={};for(const key of ['PATH','HOME','USER','LOGNAME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TERM','SystemRoot','COMSPEC','PATHEXT','DISPLAY','XDG_CACHE_HOME','PLAYWRIGHT_BROWSERS_PATH','PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH','CI'])if(parentEnv[key]!==undefined)result[key]=parentEnv[key];
 Object.assign(result,settings);
 if(kind==='agent'||kind==='api')Object.assign(result,{ATOMS_SERVICE_TOKEN:secrets.serviceToken,INTERNAL_SERVICE_TOKEN:secrets.serviceToken});
 if(kind==='api')result.PREVIEW_SECRET=secrets.previewSecret;
 if(kind==='agent')result.DEEPSEEK_API_KEY=modelKey;
 return result;
}
export async function treeMetadata(directory){
 const entries=[];
 async function walk(relative=''){
  for(const item of (await readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=path.join(relative,item.name),absolute=path.join(directory,name),stat=await lstat(absolute);
   if(item.isSymbolicLink())entries.push({path:name,type:'symlink',target:await readlink(absolute)});
   else if(item.isDirectory()){entries.push({path:name,type:'directory'});await walk(name);}
   else if(item.isFile())entries.push({path:name,type:'file',bytes:stat.size,mtime:Math.floor(stat.mtimeMs)});
   else throw new Error('Unsupported backup entry type.');
  }
 }await walk();return entries;
}
export async function verifyBackup(directory,backup){
 const source=await realpath(directory),copy=await realpath(backup);assert.ok(source!==copy&&!copy.startsWith(source+path.sep)&&!source.startsWith(copy+path.sep),'Backup must be a separate full directory.');
 const entries=await treeMetadata(source);
 assert.ok(canonical(entries)===canonical(await treeMetadata(copy)),'Full backup paths, types, sizes, timestamps and symlink targets must match before any service starts.');
 const opaqueHash=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
 let regularFileCount=0,totalBytes=0;
 for(const entry of entries)if(entry.type==='file'){
  // Raw Buffer hashing only: never decode/parse/output native traces, credentials or individual hashes.
  assert.ok(await opaqueHash(path.join(source,entry.path))===await opaqueHash(path.join(copy,entry.path)),'Opaque backup bytes differ.');regularFileCount++;totalBytes+=entry.bytes;
 }
 return {directory:copy,metadataMatched:true,opaqueFilesMatched:true,regularFileCount,totalBytes,checkedAt:new Date().toISOString()};
}
export async function immutableEvidence(state,directory,receipt){
 const root=await realpath(path.join(directory,'api')),files={};
 const oldRuns=state.runs.filter(r=>receipt.originalRuns.some(old=>old.id===r.dto.id)),oldVersions=state.versions.filter(v=>receipt.originalVersionIds.includes(v.dto.id));
 assert.equal(oldRuns.length,2);assert.equal(oldVersions.length,3);
 const fingerprint=async(file)=>{const resolved=await realpath(file);assert.ok(resolved.startsWith(root+path.sep),'Evidence escaped original API data directory.');files[path.relative(root,resolved)]=sha(await readFile(resolved));};
 for(const version of oldVersions)for(const file of version.manifest.files)await fingerprint(path.join(version.directory,file.path));
 for(const run of oldRuns)if(run.delivery?.reportDirectory){await fingerprint(path.join(run.delivery.reportDirectory,'report.json'));if(run.delivery.archiveFile)await fingerprint(run.delivery.archiveFile);}
 const versions=oldVersions.map(v=>{const {previewUrl:_url,previewExpiresAt:_expiry,...dto}=v.dto;return {...v,dto};});
 let originalRunnerFailureHash=null;try{originalRunnerFailureHash=sha(await readFile(path.join(directory,'runner-error.log')));}catch(error){if(error.code!=='ENOENT')throw error;}
 return {recordsHash:sha(canonical({runs:oldRuns,versions})),files,originalRunnerFailureHash};
}
