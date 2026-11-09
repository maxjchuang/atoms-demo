/** Explicit adapter for the existing main-branch readonly stack; never starts M3 generation. */
import {readFile,writeFile,lstat,rename,open,unlink} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {run,privateDirectory} from './m3-lib.mjs';
import {startNgrok,fixedNgrokOrigin,ngrokRunning,stopNgrok} from './m3-ngrok.mjs';
export function currentOptions(args){
 const get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
 const action=args[0]??'plan';if(!['plan','start','status','stop'].includes(action))throw new Error('Use plan/start/status/stop; preview renewal remains with the main deployment');
 if(action==='plan')return{action};
 const root=get('--deployment-root'),directory=get('--state-dir');if(!root||!directory||!isAbsolute(root)||!isAbsolute(directory))throw new Error('Explicit absolute deployment root and private state directory required');
 const result={action,root:resolve(root),directory:resolve(directory),origin:get('--ngrok-origin'),tokenFile:get('--ngrok-token-file'),binary:get('--ngrok-binary')};
 if(result.directory===result.root||result.directory.startsWith(result.root+'/'))throw new Error('Ngrok state must be outside the repository');
 if(action==='start'){fixedNgrokOrigin(result.origin);if(!result.tokenFile||!result.binary)throw new Error('Ngrok token file and executable required');}
 return result;
}
export async function acquireCurrentLock(directory,name='current-readonly.lock'){
 const file=join(directory,name);let handle;
 try{handle=await open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Operation lock exists; inspect the owned process/journal before manually removing stale lock: '+file);throw e;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}catch(e){await handle.close();await unlink(file);throw e;}
 return async()=>{await handle.close();await unlink(file);};
}
export async function assertReadonlyGateway({root,compose,docker=args=>run('docker',args,{cwd:root}),request=fetch}){
 const id=(await compose(['ps','--quiet','gateway'])).stdout.trim();if(!id)throw new Error('Existing main gateway must be running');
 const actual=JSON.parse((await docker(['inspect','--format','{{json .}}',id])).stdout);
 if(actual.Config?.Labels?.['com.docker.compose.project']!=='atoms-demo'||actual.Config?.Labels?.['com.docker.compose.service']!=='gateway'||!actual.State?.Running)throw new Error('Not the owned main deployment gateway');
 const bindings=actual.NetworkSettings?.Ports?.['8081/tcp'];if(bindings?.length!==1||bindings[0].HostIp!=='127.0.0.1'||bindings[0].HostPort!=='5181')throw new Error('Readonly main gateway must be exactly loopback5181');
 const config=(await compose(['exec','-T','gateway','cat','/etc/nginx/conf.d/default.conf'])).stdout,source=await readFile(join(root,'deploy/nginx.conf'),'utf8');
 if(config!==source||!config.includes('public-read-only')||!config.includes('limit_except GET { deny all; }'))throw new Error('Running readonly gateway differs from reviewed main configuration');
 const denied=await request('http://127.0.0.1:5181/api/v1/projects',{method:'POST',headers:{'content-type':'application/json'},body:'{"title":"readonly-boundary-probe"}',signal:AbortSignal.timeout(5000)});
 if(denied.status!==403)throw new Error('Public write denial probe failed');
 return{gatewayId:id,gatewayImageId:actual.Image};
}
async function ensureDrained(root){
 const codeFile=join(root,'data/public-deploy/access-code'),s=await lstat(codeFile);if(s.isSymbolicLink()||(s.mode&0o777)!==0o600||process.getuid&&s.uid!==process.getuid())throw new Error('Private access-code file permissions invalid');
 const login=await fetch('http://127.0.0.1:5180/api/v1/sessions',{method:'POST',headers:{origin:'http://localhost:5180','content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({code:(await readFile(codeFile,'utf8')).trim()}),signal:AbortSignal.timeout(5000)});
 if(login.status!==201)throw new Error('Cannot verify local active work; API origin update refused');
 const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('Local session cookie missing');
 const request=async(path,version='v1')=>{const r=await fetch('http://127.0.0.1:5180/api/'+version+path,{headers:{cookie},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Cannot verify drained local workspace');return r.json();};
 let cursor=null;do{const page=await request('/projects?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));for(const p of page.items){const w=await request('/projects/'+p.id+'/workspace','v2');if(w.execution?.activeRun||w.execution?.queuedRuns?.length||w.pendingCoordinationTurns?.length)throw new Error('Local work is active; finish/cancel it before API restart');}cursor=page.nextCursor;}while(cursor);
}
async function main(args){
 const o=currentOptions(args);if(o.action==='plan'){console.log(JSON.stringify({operation:'fixed ngrok workbench on existing readonly main gateway5181',preview:'reuse existing Cloudflare preview',m3Readiness:false,publicGeneration:false,providerCalls:0}));return;}
 await privateDirectory(o.directory);
 let release,releaseShared;
 if(o.action!=='status'){
  releaseShared=await acquireCurrentLock(join(o.root,'data/public-deploy'),'ngrok-operation.lock');
  try{release=await acquireCurrentLock(o.directory);}catch(e){await releaseShared();throw e;}
 }
 try{
 const journal=join(o.directory,'current-readonly.json');
 const saveJournal=async value=>{const temporary=journal+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(temporary,journal);};
 const compose=args=>run('docker',['compose','--project-directory',o.root,'-f',join(o.root,'compose.yaml'),...args],{cwd:o.root});
 let saved;try{saved=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(saved&&saved.deploymentRoot!==o.root)throw new Error('Owned journal belongs to another deployment root');
 if(o.action==='status'){console.log(JSON.stringify({origin:saved?.ngrok?.origin??null,running:saved?.ngrok?await ngrokRunning(saved.ngrok):false,publicGeneration:false}));return;}
 if(o.action==='stop'){
  if(saved?.ngrok)await stopNgrok(saved.ngrok);
  if(saved?.ownedUrls){const urlFile=join(o.root,'data/public-deploy/urls.txt');try{if(await readFile(urlFile,'utf8')===saved.ownedUrls)await writeFile(urlFile,'Workspace: (ngrok stopped; run start to reconnect)\nPreview: '+saved.previewOrigin+'\n',{mode:0o600});}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(saved)await saveJournal({...saved,stopped:true,stoppedAt:new Date().toISOString()});
  console.log('Owned ngrok stopped; URL file marked offline where still owned; Cloudflare and application state retained.');return;
 }
 if(saved?.ngrok&&await ngrokRunning(saved.ngrok))throw new Error('Owned ngrok already running; use status or stop first');
 const identity=await assertReadonlyGateway({root:o.root,compose});await ensureDrained(o.root);
 const file=join(o.root,'data/public-deploy/runtime.env'),stat=await lstat(file);if(stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||process.getuid&&stat.uid!==process.getuid())throw new Error('Local runtime.env permissions invalid');
 const original=await readFile(file,'utf8'),values=Object.fromEntries(original.split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
 const previewId=(await compose(['ps','--quiet','tunnel-preview'])).stdout.trim();if(!previewId)throw new Error('Owned Cloudflare preview must be running');
 const previewContainer=JSON.parse((await run('docker',['inspect','--format','{{json .}}',previewId],{cwd:o.root})).stdout);
 if(previewContainer.Config?.Labels?.['com.docker.compose.project']!=='atoms-demo'||previewContainer.Config?.Labels?.['com.docker.compose.service']!=='tunnel-preview'||!previewContainer.State?.Running||previewContainer.Config?.Image!=='cloudflare/cloudflared:2026.10.7'||JSON.stringify(previewContainer.Config?.Cmd)!==JSON.stringify(['tunnel','--no-autoupdate','--protocol','http2','--url','http://gateway:8082']))throw new Error('Cloudflare preview identity/target differs from current reviewed deployment');
 const logs=await compose(['logs','--no-color','--since',previewContainer.State.StartedAt,'tunnel-preview']),text=logs.stdout+logs.stderr;
 const preview=[...text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)].at(-1)?.[0];
 if(!preview||!text.includes('Registered tunnel connection')||(values.PREVIEW_ORIGIN??values.PREVIEW_PUBLIC_URL)!==preview)throw new Error('Existing registered Cloudflare preview and configured origin must match');
 const persist=async ngrok=>{saved={deploymentRoot:o.root,...identity,ngrok,previewOrigin:preview,readonly:true};await saveJournal(saved);};
 const urls=join(o.root,'data/public-deploy/urls.txt');let originalUrls;try{originalUrls=await readFile(urls,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 let replacement,ownUrls,changed=false,urlsChanged=false;
 const ngrok=await startNgrok({origin:o.origin,port:5181,tokenFile:o.tokenFile,binary:o.binary,directory:join(o.directory,'ngrok'),onStarted:persist});await persist(ngrok);
 try{
  await ensureDrained(o.root);
  const backup=join(o.directory,'runtime-before-'+Date.now()+'.env');await writeFile(backup,original,{mode:0o600,flag:'wx'});
  const allowed=new Set((values.ALLOWED_ORIGINS??'').split(',').filter(Boolean));allowed.add(o.origin);
  replacement=original.split('\n').filter(l=>!l.startsWith('ALLOWED_ORIGINS=')).join('\n').trimEnd()+'\nALLOWED_ORIGINS='+[...allowed].join(',')+'\n';
  if(await readFile(file,'utf8')!==original)throw new Error('runtime.env changed during startup; refusing overwrite');
  const temporary=file+'.ngrok-'+randomUUID();await writeFile(temporary,replacement,{mode:0o600,flag:'wx'});await rename(temporary,file);changed=true;
  await compose(['up','-d','--no-deps','api']);await compose(['exec','-T','gateway','nginx','-s','reload']);
  ownUrls='Workspace: '+o.origin+'\nPreview: '+preview+'\n';await writeFile(urls,ownUrls,{mode:0o600});urlsChanged=true;
  saved={...saved,ownedUrls:ownUrls,active:true};await saveJournal(saved);
  console.log(JSON.stringify({workbenchOrigin:o.origin,previewOrigin:preview,readonly:true,publicGeneration:false,externalVerification:'required',providerCalls:0}));
 }catch(e){
  let rollbackError;
  try{
   if(changed){if(await readFile(file,'utf8')!==replacement)throw new Error('Concurrent runtime.env edit; automatic rollback refused, private backup retained');const temporary=file+'.rollback-'+randomUUID();await writeFile(temporary,original,{mode:0o600,flag:'wx'});await rename(temporary,file);await compose(['up','-d','--no-deps','api']);await compose(['exec','-T','gateway','nginx','-s','reload']);}
   if(urlsChanged){if(await readFile(urls,'utf8')!==ownUrls)throw new Error('Concurrent urls.txt edit; automatic rollback refused');if(originalUrls===undefined)await unlink(urls);else await writeFile(urls,originalUrls,{mode:0o600});}
  }catch(error){rollbackError=error;}
  await stopNgrok(ngrok);await saveJournal({...saved,failed:true,rollbackComplete:!rollbackError,failure:e.message,rollbackFailure:rollbackError?.message});
  if(rollbackError)throw new AggregateError([e,rollbackError],'Ngrok activation failed and rollback needs review; inspect private journal');throw e;
 }
 }finally{try{if(release)await release();}finally{if(releaseShared)await releaseShared();}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
