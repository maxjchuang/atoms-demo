#!/usr/bin/env node
/** Standalone Node22+ public monitor. Built-ins only; never controls the deployment. */
import http from 'node:http';
import https from 'node:https';
import {open,lstat,mkdir,rename,unlink,writeFile,readFile,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const packageDirectory=dirname(fileURLToPath(import.meta.url));
const labels={primary:'Cloudflare workbench',backup:'ngrok workbench',preview:'Preview gateway boundary'};
const failure=code=>Object.assign(Error(code),{safeCode:code});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const within=(path,parent)=>path===parent||path.startsWith(parent+'/')||path.startsWith(parent+'\\');
export function validateConfig(value,base=process.cwd()){
 if(!exact(value,['version','targets','intervalSeconds','timeoutMs','failureThreshold','recoveryThreshold','stateDirectory','maxLogBytes','notifications'])||value.version!==1)throw failure('config_invalid');
 const targets=value.targets;
 if(!exact(targets,['primary','backup','preview'])||Object.keys(targets).length!==3)throw failure('targets_invalid');
 for(const [key,origin] of Object.entries(targets)){
  if(typeof origin!=='string')throw failure('target_origin_invalid');
  let u;try{u=new URL(origin);}catch{throw failure('target_origin_invalid');}
  const known=key==='backup'?/^[a-z0-9-]+\.(?:ngrok-free\.dev|ngrok-free\.app|ngrok\.app|ngrok\.dev)$/:/^[a-z0-9-]+\.trycloudflare\.com$/;
  if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||u.port||!known.test(u.hostname))throw failure('target_origin_invalid');
 }
 if(new Set(Object.values(targets)).size!==3)throw failure('targets_must_differ');
 const config={version:1,targets:{...targets},intervalSeconds:600,timeoutMs:8000,failureThreshold:3,recoveryThreshold:2,maxLogBytes:1048576,...value};
 for(const [key,min,max] of [['intervalSeconds',1,3600],['timeoutMs',100,30000],['failureThreshold',1,100],['recoveryThreshold',1,100],['maxLogBytes',512,10485760]])if(!Number.isInteger(config[key])||config[key]<min||config[key]>max)throw failure('config_bounds_invalid');
 if(config.stateDirectory!==undefined&&(typeof config.stateDirectory!=='string'||!config.stateDirectory||config.stateDirectory.includes('\0')))throw failure('state_directory_invalid');
 config.stateDirectory=resolve(base,config.stateDirectory??'state');
 const n=value.notifications??{enabled:false};
 if(!exact(n,['enabled','provider','channel','tokenEnv','tokenFile'])||typeof n.enabled!=='boolean'||n.provider!==undefined&&n.provider!=='pushplus'||n.channel!==undefined&&n.channel!=='clawbot'||n.token!==undefined)throw failure('notification_config_invalid');
 if(n.tokenEnv!==undefined&&n.tokenEnv!==null&&(typeof n.tokenEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n.tokenEnv)))throw failure('notification_token_source_invalid');
 if(n.tokenFile!==undefined&&n.tokenFile!==null&&(typeof n.tokenFile!=='string'||!isAbsolute(n.tokenFile)||within(resolve(n.tokenFile),packageDirectory)))throw failure('notification_token_file_must_be_external');
 if(n.tokenFile&&n.tokenEnv)throw failure('notification_token_source_ambiguous');
 config.notifications={enabled:n.enabled,provider:'pushplus',channel:'clawbot',tokenEnv:n.tokenFile?null:n.tokenEnv??'ATOMS_MONITOR_PUSHPLUS_TOKEN',tokenFile:n.tokenFile??null};
 return config;
}
export async function loadConfig(file){try{const path=resolve(file),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw failure('config_file_invalid');return validateConfig(JSON.parse(await readFile(path,'utf8')),dirname(path));}catch(e){throw e.safeCode?e:failure('config_read_failed');}}
/** Hard wall deadline, bounded body, no redirects, no cookies or arbitrary forwarding headers. */
export function requestBounded(url,{method='GET',headers={},body,timeoutMs=8000,maxBytes=262144,signal}={}){
 return new Promise(resolve=>{let req,done=false,size=0;const chunks=[];
  const finish=result=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(result);};
  const abort=()=>{req?.destroy();finish({ok:false,reason:signal?.aborted?'aborted':'timeout'});};
  const timer=setTimeout(abort,timeoutMs);if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
  try{req=(url.startsWith('https:')?https:http).request(url,{method,headers:{'user-agent':'Atoms-Portable-Monitor/1.0',...headers}},res=>{
   res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy();finish({ok:false,reason:'body_limit'});}else chunks.push(chunk);});
   res.on('end',()=>finish({ok:true,status:res.statusCode,headers:{contentType:String(res.headers['content-type']??''),nosniff:res.headers['x-content-type-options']==='nosniff',noStore:String(res.headers['cache-control']??'').includes('no-store')},body:Buffer.concat(chunks).toString('utf8')}));
   res.on('error',()=>finish({ok:false,reason:'connection_error'}));
  });req.on('error',error=>finish({ok:false,reason:['ENOTFOUND','EAI_AGAIN'].includes(error.code)?'dns_error':/^ERR_TLS_|^CERT_|^DEPTH_|^UNABLE_TO_/.test(error.code??'')?'tls_error':'connection_error'}));req.end(body);}catch{finish({ok:false,reason:'connection_error'});}
 });
}
export function evaluateResponse(response,kind){
 if(!response?.ok)return{healthy:false,reason:['timeout','body_limit','dns_error','tls_error','connection_error','aborted'].includes(response?.reason)?response.reason:'connection_error'};
 const {status,body='',headers={}}=response;let healthy=false;
 if(kind==='html')healthy=status===200&&headers.contentType?.includes('text/html')&&/<title>Atoms Demo(?:\s|[<—-])/.test(body)&&/<div\s+id=["']root["']/.test(body)&&/<script[^>]+type=["']module["']/.test(body)&&!/ERR_NGROK|ngrok-skip-browser-warning|You are about to visit|ngrok.*(?:browser warning|interstitial)/i.test(body);
 if(kind==='anonymous'){try{healthy=status===401&&headers.contentType?.includes('application/json')&&JSON.parse(body).error?.code==='UNAUTHENTICATED';}catch{}}
 if(kind==='preview')healthy=status===404&&body==='Not found'&&headers.nosniff===true&&headers.noStore===true;
 return{healthy,reason:healthy?'ok':status>=300&&status<400?'redirect_rejected':'unexpected_response',status};
}
export async function check(config,{transport=requestBounded,signal,now=Date.now}={}){
 // Revalidate before any outgoing request, even for callers using this module directly.
 const c=validateConfig(config,process.cwd()),components=await Promise.all(['primary','backup','preview'].map(async id=>{
  const paths=id==='preview'?[['/api/v1/projects','preview'],['/internal/v1/health','preview']]:[['/','html'],['/api/v1/projects','anonymous']];
  const results=await Promise.all(paths.map(async([path,kind])=>{try{return evaluateResponse(await transport(c.targets[id]+path,{timeoutMs:c.timeoutMs,signal,headers:id==='backup'?{'ngrok-skip-browser-warning':'true'}:{}}),kind);}catch{return{healthy:false,reason:'connection_error'};}}));
  const bad=results.find(r=>!r.healthy);return{id,label:labels[id],healthy:!bad,reason:bad?.reason??'ok',statuses:results.map(r=>r.status??null)};
 }));
 return{observedAt:new Date(now()).toISOString(),overallHealthy:components.every(c=>c.healthy),urls:{...c.targets},components,scope:'public_http_from_this_computer',localProcessHealth:'unavailable',notificationMode:c.notifications.enabled?'enabled_event_delivery_logged':'not_configured'};
}
export function advance(previous,snapshot,{failureThreshold=3,recoveryThreshold=2}={}){
 const state={...previous},events=[];
 for(const component of snapshot.components){const a={failures:0,recoveries:0,alerting:false,...state[component.id]};
  if(component.healthy){a.failures=0;a.recoveries=Math.min(a.recoveries+1,recoveryThreshold);if(a.alerting&&a.recoveries>=recoveryThreshold){a.alerting=false;events.push({type:'recovery',observedAt:snapshot.observedAt,components:[{id:component.id,reason:'healthy_again'}]});}}
  else{a.recoveries=0;a.failures=Math.min(a.failures+1,failureThreshold);if(!a.alerting&&a.failures>=failureThreshold){a.alerting=true;events.push({type:'failure',observedAt:snapshot.observedAt,components:[{id:component.id,reason:component.reason}]});}}
  state[component.id]=a;
 }
 return{state,events};
}

async function protectedStat(file,{directory=false}={}){try{const s=await lstat(file);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile()))throw failure('state_permissions_invalid');if(process.platform!=='win32'&&((s.mode&0o777)!==(directory?0o700:0o600)||process.getuid&&s.uid!==process.getuid()))throw failure('state_permissions_invalid');return s;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function prepareState(directory){await mkdir(directory,{recursive:true,mode:0o700});await protectedStat(directory,{directory:true});}
export async function saveState(config,snapshot,state,events){
 const dir=config.stateDirectory;await prepareState(dir);const latest=join(dir,'latest.json');await protectedStat(latest);const temp=latest+'.'+randomUUID();try{await writeFile(temp,JSON.stringify({...snapshot,alerts:state},null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,latest);}finally{await unlink(temp).catch(()=>{});}
 const file=join(dir,'events.ndjson'),rotated=file+'.1';if(!events.length){await protectedStat(file);const handle=await open(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);await handle.close();}
 for(const event of events){const line=JSON.stringify(event)+'\n';if(Buffer.byteLength(line)>config.maxLogBytes)throw failure('event_too_large');const s=await protectedStat(file);if(s&&s.size+Buffer.byteLength(line)>config.maxLogBytes){await protectedStat(rotated);await unlink(rotated).catch(e=>{if(e.code!=='ENOENT')throw e;});await rename(file,rotated);}const handle=await open(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(line);}finally{await handle.close();}}
}
export async function readNotificationToken(config,env=process.env){
 const n=config.notifications;if(!n.enabled)return null;let token;
 if(n.tokenFile){if(within((await realpath(n.tokenFile)).toLowerCase(),(await realpath(packageDirectory)).toLowerCase()))throw failure('notification_token_file_must_be_external');await protectedStat(n.tokenFile);const fd=await open(n.tokenFile,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await fd.stat();if(!s.isFile()||s.size>4096||process.platform!=='win32'&&((s.mode&0o777)!==0o600||process.getuid&&s.uid!==process.getuid()))throw failure('notification_token_file_invalid');token=(await fd.readFile('utf8')).trim();}finally{await fd.close();}}
 else token=env[n.tokenEnv];
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{16,512}$/.test(token))throw failure('notification_token_unavailable');return token;
}
export function notificationText(event){
 const type=event.type==='recovery'?'recovery':'failure',at=Number.isFinite(Date.parse(event.observedAt))?new Date(event.observedAt).toISOString():'unknown';
 const affected=(event.components??[]).filter(c=>Object.hasOwn(labels,c.id)).map(c=>labels[c.id]);
 return{title:type==='recovery'?'Atoms public monitor recovered':'Atoms public monitor alert',content:`${type==='recovery'?'Public checks recovered.':'Public checks failed.'}\n${affected.join(', ')}\nObserved: ${at}\nObserver network or configured domains may be responsible; inspect local monitor logs.`,channel:'clawbot',template:'txt'};
}
export async function notifyPushPlus(config,event,{transport=requestBounded,env=process.env,sleep=ms=>new Promise(r=>setTimeout(r,ms)),signal}={}){
 if(!config.notifications.enabled)return{status:'not_configured',attempts:0};
 try{const token=await readNotificationToken(config,env),payload=JSON.stringify({token,...notificationText(event)});let attempts=0;
  while(attempts<2&&!signal?.aborted){attempts++;const r=await transport('https://www.pushplus.plus/send',{method:'POST',headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))},body:payload,timeoutMs:config.timeoutMs,maxBytes:16384,signal});
   if(r.ok&&r.status===200){try{if(JSON.parse(r.body).code===200)return{status:'accepted_by_provider',attempts};}catch{}}
   // Retry only explicit server unavailability; timeout outcome may already have delivered a message.
   if(!(r.ok&&[502,503,504].includes(r.status))||attempts===2)return{status:'notification_failed',attempts};await sleep(1000);
  }return{status:'notification_failed',attempts};
 }catch{return{status:'notification_failed',attempts:0};}
}
const wait=(ms,signal)=>new Promise(resolve=>{if(signal?.aborted)return resolve();let timer;const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});});
export async function run(config,{signal,transport=requestBounded,notify=notifyPushPlus,sleep=wait,now=Date.now,onSnapshot=()=>{}}={}){
 const c=validateConfig(config,process.cwd());await prepareState(c.stateDirectory);const lock=join(c.stateDirectory,'run.lock');let fd;try{fd=await open(lock,'wx',0o600);await fd.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()})+'\n');}catch{throw failure('monitor_already_running_or_lock_stale');}
 let state;
 try{while(!signal?.aborted){const snapshot=await check(c,{transport,signal,now});if(signal?.aborted)break;const transition=advance(state,snapshot,c);state=transition.state;await saveState(c,snapshot,state,transition.events);onSnapshot(snapshot);for(const event of transition.events){const result=await notify(c,event,{transport,signal});if(result.status!=='not_configured')await saveState(c,snapshot,state,[{type:'notification',status:['accepted_by_provider','notification_failed'].includes(result.status)?result.status:'notification_failed',observedAt:snapshot.observedAt}]);}await sleep(c.intervalSeconds*1000,signal);}}finally{await fd.close();await unlink(lock);}
 return{stopped:true};
}
export async function main(args,{stdout=console.log,stderr=console.error}={}){
 if(args.length===0||args[0]==='--help'||args[0]==='help'){stdout('Node22+ portable public monitor\nnode monitor.mjs check --config ./config.json\nnode monitor.mjs run --config ./config.json\nNo local process checks; no deployment control. Notifications default off.');return 0;}
 const [command,flag,file,...extra]=args;if(!['check','run'].includes(command)||flag!=='--config'||!file||extra.length){stderr('monitor_error: invalid_arguments');return 1;}
 try{const config=await loadConfig(file);if(command==='check'){const snapshot=await check(config);stdout(JSON.stringify(snapshot,null,2));return snapshot.overallHealthy?0:2;}const ac=new AbortController(),stop=()=>ac.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);try{await run(config,{signal:ac.signal});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}return 0;}catch(e){stderr('monitor_error: '+(['config_invalid','targets_invalid','target_origin_invalid','targets_must_differ','config_bounds_invalid','state_directory_invalid','notification_config_invalid','notification_token_source_invalid','notification_token_file_must_be_external','notification_token_source_ambiguous','config_file_invalid','config_read_failed','state_permissions_invalid','monitor_already_running_or_lock_stale'].includes(e.safeCode)?e.safeCode:'operation_failed'));return 1;}
}
if(process.argv[1]&&(await realpath(process.argv[1]).catch(()=>null))===(await realpath(fileURLToPath(import.meta.url))))process.exitCode=await main(process.argv.slice(2));
