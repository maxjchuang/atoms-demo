import {mkdir,lstat,readFile,writeFile,rename,unlink,rmdir} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';

export const DEFAULT_PRIVATE_DIR=join(homedir(),'.atoms-m3','intel-public');
export function validateSettings(value,root){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Configuration must be a JSON object');
  for(const k of Object.keys(value))if(!['dockerContext','privateDir','project','ngrokBinary','ngrokTokenFile'].includes(k))throw Error('Unknown configuration field: '+k);
  const s={root:resolve(root),dockerContext:'colima-atoms-isolated',privateDir:DEFAULT_PRIVATE_DIR,project:'atoms-m3-public',...value};
  if(typeof s.dockerContext!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(s.dockerContext))throw Error('Invalid dockerContext');
  if(s.project!=='atoms-m3-public')throw Error('Only atoms-m3-public is supported');
  if(typeof s.privateDir!=='string'||!isAbsolute(s.privateDir)||s.privateDir.includes('\0'))throw Error('privateDir must be absolute');
  s.privateDir=resolve(s.privateDir);
  if(s.privateDir===s.root||s.privateDir.startsWith(s.root+'/'))throw Error('privateDir must be outside repository');
  for(const k of ['ngrokBinary','ngrokTokenFile'])if(s[k]!==undefined&&(typeof s[k]!=='string'||!isAbsolute(s[k])||s[k].includes('\0')))throw Error(k+' must be absolute');
  return Object.freeze(s);
}
export async function readSettings(file,root,{optional=false}={}){
  try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==0o600||s.uid!==process.getuid?.())throw Error('Configuration must be an owned regular 0600 file');return validateSettings(JSON.parse(await readFile(file,'utf8')),root);}
  catch(e){if(optional&&e.code==='ENOENT')return validateSettings({},root);throw e;}
}
export function fixedDockerEnvironment(settings,env=process.env){
  const clean={};for(const k of ['PATH','HOME','USER','LOGNAME','TMPDIR'])if(env[k]!==undefined)clean[k]=env[k];
  return {...clean,DOCKER_CONTEXT:settings.dockerContext};
}
export async function privateDirectory(dir){
  await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);
  if(s.isSymbolicLink()||!s.isDirectory()||(s.mode&0o777)!==0o700||s.uid!==process.getuid?.())throw Error('Private directory must be owned, non-symlink and mode 0700');
}
export async function withOpsLock(settings,fn){
  await privateDirectory(settings.privateDir);const lock=join(settings.privateDir,'atoms-ops.lock');
  try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Another atoms operation holds atoms-ops.lock; inspect it before manual recovery');throw e;}
  try{await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});return await fn();}
  finally{await unlink(join(lock,'owner.json')).catch(()=>{});await rmdir(lock);}
}
export function publicOutput(value){
  if(Array.isArray(value))return value.map(publicOutput);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:token|secret|cookie|password|authorization|signature|prompt|credential|rawcode|^code$)/i.test(k)).map(([k,v])=>[k,publicOutput(v)]));
  if(typeof value==='string'&&/^https?:\/\//i.test(value)){try{const u=new URL(value);u.username='';u.password='';u.search='';u.hash='';return u.origin;}catch{return '[invalid URL]';}}
  return value;
}
const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function operationId(value){const id=value??'ops_'+randomUUID().replaceAll('-','');if(!/^[a-zA-Z0-9_-]{8,48}$/.test(id))throw Error('operation-id must be 8..48 letters, digits, _ or -');return id;}
export async function openJournal(settings,id,parameters){
  const dir=join(settings.privateDir,'ops-journal');await privateDirectory(dir);const file=join(dir,id+'.json'),hash=createHash('sha256').update(stable(parameters)).digest('hex');let record;
  try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==0o600||s.uid!==process.getuid?.())throw Error('Unsafe journal file');record=JSON.parse(await readFile(file,'utf8'));if(record.parametersHash!==hash||stable(record.parameters)!==stable(parameters))throw Error('operation-id already belongs to different parameters');}
  catch(e){if(e.code!=='ENOENT')throw e;record={version:1,operationId:id,parameters,parametersHash:hash,steps:{},phase:'created',createdAt:new Date().toISOString()};}
  async function save(){const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}
  await save();
  return {record,save,async step(name,fn){if(Object.hasOwn(record.steps,name))return record.steps[name];record.phase=name;await save();const result=publicOutput(await fn())??null;record.steps[name]=result;await save();return result;}};
}
export function mutationPlan(command,options={}){
  return {command,...options,dryRun:true,modelCalls:0,codeRunsCreated:0,steps:command==='code new'?['drain','brokerIdle','backup','provision','reset remaining='+options.builds,'restore previously running API']:command==='code reset'?['drain','brokerIdle','backup','lookup codeId','reset remaining='+options.builds,'restore previously running API']:command==='code extend'?['drain','brokerIdle','backup','lookup codeId','extend expiresAt='+options.until,'restore previously running API','read current details']:command==='stop'?['drain','brokerIdle','stopCore',...(options.all?['stopTunnels']:[])]:command==='restart'?['drain','brokerIdle','stopCore',...(options.all?['stopTunnels']:[]),'startCoreWithoutApi','verifyIsolation','ensureTunnels','startApi']:['startCoreWithoutApi','verifyIsolation','ensureTunnels','startApi']};
}
export async function runOperation(runtime,settings,command,options={},journal){
  if(command==='status'||command==='details')return publicOutput(await runtime.status({details:command==='details'}));
  if(command==='code info')return publicOutput(await runtime.codeDetails(options.codeFile));
  if(journal?.record.completed){
    if(command==='code extend')return publicOutput({operationId:options.operationId,replayed:true,requestedExpiresAt:options.until,codeFile:options.codeFile,current:await runtime.codeDetails(options.codeFile),modelCalls:0,codeRunsCreated:0});
    if(command==='code new'||command==='code reset')return publicOutput({operationId:options.operationId,replayed:true,requestedRemaining:options.builds,codeFile:options.codeFile,current:await runtime.codeDetails(options.codeFile),modelCalls:0,codeRunsCreated:0});
    return publicOutput({operationId:options.operationId,replayed:true,originalResult:journal.record.result,current:await runtime.status({details:false})});
  }
  const before=await runtime.status({details:false});
  const step=(name,fn)=>journal?journal.step(name,fn):fn();
  const idle=async()=>{if(!await runtime.brokerIdle())throw Error('Broker still has active work; no force shutdown performed');};
  const recover=async()=>{await runtime.verifyIsolation();await runtime.startApi();};
  const start=async()=>{await runtime.startCoreWithoutApi();await runtime.verifyIsolation();await runtime.ensureTunnels({refresh:!!options.all});await runtime.startApi();};
  let result;
  if(command==='start'){if(before.healthy&&before.tunnelsRunning)result={alreadyRunning:true};else{if(!before.servicesStopped){await runtime.drain();await idle();await runtime.backup({operationId:options.operationId,kind:command});}await start();result={started:true};}}
  else if(command==='stop'||command==='restart'){
    if(!before.servicesStopped){await runtime.drain();await idle();await runtime.stopCore();}
    if(options.all)await runtime.stopTunnels();
    if(command==='restart')await start();
    result={stopped:command==='stop',restarted:command==='restart',tunnelsRetained:!options.all};
  }else if(command==='code new'||command==='code reset'||command==='code extend'||command==='backup'){
    if(journal&&!Object.hasOwn(journal.record,'apiWasRunning')){journal.record.apiWasRunning=!!before.apiRunning;await journal.save();}
    const restore=journal?journal.record.apiWasRunning:!!before.apiRunning;
    let drained=false;
    try{
      await runtime.drain();drained=true;await idle();
      const backup=await step('backup',()=>runtime.backup({operationId:options.operationId,kind:command}));
      if(command==='backup')result={backup};
      else{
        if(command==='code new')await step('provision',()=>runtime.provision({operationId:options.operationId+'_issue',file:options.codeFile,ttlSeconds:options.ttlSeconds}));
        const info=await runtime.codeDetails(options.codeFile);if(typeof info.codeId!=='string'||!info.codeId)throw Error('Code identifier unavailable');
        if(command==='code extend'){
          await step('extend',()=>runtime.extend({operationId:options.operationId+'_extend',codeId:info.codeId,file:options.codeFile,expiresAt:options.until}));
          result={operationId:options.operationId,codeFile:options.codeFile,codeId:info.codeId,requestedExpiresAt:options.until};
        }else{
          await step('reset',()=>runtime.reset({operationId:options.operationId+'_reset',codeId:info.codeId,file:options.codeFile,remaining:options.builds}));
          result={operationId:options.operationId,codeFile:options.codeFile,codeId:info.codeId,requestedRemaining:options.builds};
        }
      }
      if(restore)await recover();
      if(command==='code new'||command==='code reset'||command==='code extend')result.current=publicOutput(await runtime.codeDetails(options.codeFile));
    }catch(error){
      if(journal){journal.record.failed=true;journal.record.recoveryRequired=!!error.recoveryRequired;await journal.save();}
      if(drained&&restore&&!error.recoveryRequired)try{await recover();}catch{error.recoveryRequired=true;if(journal){journal.record.recoveryRequired=true;await journal.save();}}
      throw error;
    }
  }else throw Error('Unsupported operation');
  result=publicOutput({...result,modelCalls:0,codeRunsCreated:0});
  if(journal){journal.record.result=result;journal.record.completed=true;journal.record.phase='completed';delete journal.record.failed;delete journal.record.recoveryRequired;await journal.save();}
  return result;
}
