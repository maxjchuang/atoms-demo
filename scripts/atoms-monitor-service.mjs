/** Host-only monitor lifecycle. Never starts/stops an application or repairs a tunnel. */
import * as filesystem from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {publicOutput,validateSettings} from './atoms-ops-lib.mjs';

export const MONITOR_LABEL='com.atoms-demo.tunnel-monitor';
export const SERVICE_SCRIPT=fileURLToPath(import.meta.url);
export const NOTIFICATION_SCRIPT='on run argv\n display notification (item 1 of argv) with title "Atoms tunnel monitor"\nend run';
export function monitorOptions(input={}){
  const defaults={intervalSeconds:30,failureThreshold:3,recoveryThreshold:2,timeoutMs:8000,notify:false};
  for(const k of Object.keys(input))if(!Object.hasOwn(defaults,k))throw Error('Unknown monitor setting');
  const o={...defaults,...input};
  for(const [k,min,max]of [['intervalSeconds',5,3600],['failureThreshold',1,100],['recoveryThreshold',1,100],['timeoutMs',100,60000]])if(!Number.isInteger(o[k])||o[k]<min||o[k]>max)throw Error('Invalid monitor '+k);
  if(typeof o.notify!=='boolean')throw Error('Invalid monitor notify');return o;
}
function execute(command,args,{env}={}){return new Promise((ok,no)=>{const p=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{p.kill('SIGKILL');no(Error('Monitor host command deadline exceeded'));},10000);p.stdout.on('data',b=>stdout=(stdout+b).slice(-65536));p.stderr.on('data',b=>stderr=(stderr+b).slice(-4096));p.on('error',()=>{clearTimeout(timer);no(Error('Monitor host command unavailable'));});p.on('close',code=>{clearTimeout(timer);ok({code,stdout,stderr});});});}
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function launchAgentPlist({nodeBin,configFile,home,dockerContext,logs}){
  const args=[nodeBin,SERVICE_SCRIPT,'run','--service-config',configFile];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'+`<key>Label</key><string>${MONITOR_LABEL}</string><key>ProgramArguments</key><array>${args.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>DOCKER_CONTEXT</key><string>${xml(dockerContext)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer><key>StandardOutPath</key><string>${xml(logs.stdout)}</string><key>StandardErrorPath</key><string>${xml(logs.stderr)}</string>`+'</dict></plist>\n';
}
export function createMonitorService(settings,deps={}){
  const fs=deps.fs??filesystem,command=deps.command??execute,uid=deps.uid??process.getuid(),home=deps.home??homedir(),platform=deps.platform??process.platform,nodeBin=deps.nodeBin??process.execPath,now=deps.now??Date.now,signals=deps.signals??process;
  const dir=join(settings.privateDir,'monitor'),configFile=join(dir,'service-config.json'),lock=join(dir,'instance.lock'),plistFile=join(home,'Library','LaunchAgents',MONITOR_LABEL+'.plist'),domain='gui/'+uid,target=domain+'/'+MONITOR_LABEL;
  const logs={stdout:join(dir,'stdout.log'),stderr:join(dir,'stderr.log'),events:join(dir,'events.ndjson'),notifications:join(dir,'notifications.ndjson')};
  const env={HOME:home,PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',DOCKER_CONTEXT:settings.dockerContext};
  async function owned(file,{directory=false,optional=false,mode=directory?0o700:0o600}={}){try{const s=await fs.lstat(file);if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile())||s.uid!==uid||(s.mode&0o777)!==mode)throw Error('Unsafe monitor file identity or permissions');return s;}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
  async function ensureDir(){await fs.mkdir(settings.privateDir,{recursive:true,mode:0o700});await owned(settings.privateDir,{directory:true});await fs.mkdir(dir,{recursive:true,mode:0o700});await owned(dir,{directory:true});}
  async function json(file,optional=false){if(!await owned(file,{optional}))return null;return JSON.parse(await fs.readFile(file,'utf8'));}
  async function atomic(file,value){await owned(file,{optional:true});const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}
  async function core(){return deps.core??await import('./m3-tunnel-monitor.mjs');}
  async function launchctl(args){const r=await command('/bin/launchctl',args,{env});return r;}
  async function inspectLaunchd(expectedPlist){const r=await launchctl(['print',target]);if(r.code===113||r.code===3)return{loaded:false};if(r.code!==0)throw Error('Cannot establish monitor launchd identity');
    if(!expectedPlist)throw Error('Refuse unknown launchd service without owned plist');
    const block=r.stdout.match(/\barguments\s*=\s*\{([\s\S]*?)\}/)?.[1];
    const args=block?.trim().split('\n').map(s=>s.trim());
    if(!r.stdout.includes('path = '+plistFile)||!r.stdout.includes('program = '+nodeBin)||JSON.stringify(args)!==JSON.stringify([nodeBin,SERVICE_SCRIPT,'run','--service-config',configFile]))throw Error('Refuse unknown launchd program identity');
    const pid=Number(r.stdout.match(/\bpid\s*=\s*(\d+)/)?.[1])||null;return{loaded:true,pid};
  }
  async function savedConfiguration(){const c=await json(configFile,true);if(!c)return null;if(c.version!==1||c.settings?.root!==settings.root||JSON.stringify(validateSettings(Object.fromEntries(Object.entries(c.settings).filter(([k])=>k!=='root')),settings.root))!==JSON.stringify(settings))throw Error('Monitor settings identity differs');return{...c,options:monitorOptions(c.options)};}
  async function checkedPlist(){if(!await owned(plistFile,{optional:true}))return null;const text=await fs.readFile(plistFile,'utf8');if(text!==launchAgentPlist({nodeBin,configFile,home,dockerContext:settings.dockerContext,logs}))throw Error('Refuse unknown LaunchAgent plist');return text;}
  async function pidIdentity(owner){if(!owner||!Number.isInteger(owner.pid)||owner.pid<=0||owner.label!==MONITOR_LABEL||owner.root!==settings.root||owner.privateDir!==settings.privateDir)return false;const r=await command('/bin/ps',['-p',String(owner.pid),'-o','command='],{env});return r.code===0&&(r.stdout.includes(SERVICE_SCRIPT+' run --service-config '+configFile)||r.stdout.includes(join(settings.root,'scripts/atoms-ops.mjs')+' monitor run'));}
  async function status(){await owned(dir,{directory:true,optional:true});const plist=await checkedPlist(),launchd=platform==='darwin'?await inspectLaunchd(plist):{loaded:false};const conf=await savedConfiguration(),lockExists=await owned(lock,{directory:true,optional:true}),owner=lockExists?await json(join(lock,'owner.json'),true):null,latest=await json(join(dir,'latest.json'),true);const running=await pidIdentity(owner),options=monitorOptions(conf?.options??owner?.options??{}),ageMs=latest?.observedAt?now()-Date.parse(latest.observedAt):Infinity,stale=!Number.isFinite(ageMs)||ageMs<0||ageMs>Math.max(options.intervalSeconds*3000,options.timeoutMs+options.intervalSeconds*1000+10000);
    return publicOutput({label:MONITOR_LABEL,installed:!!plist,launchdLoaded:launchd.loaded,launchdPid:launchd.pid??null,pid:running?owner.pid:null,running,stale,healthy:running&&!stale&&latest?.overallHealthy===true,lastCheckedAt:latest?.observedAt??null,overallHealthy:latest?.overallHealthy??null,maintenance:latest?.maintenance??null,urls:latest?.urls??null,lockPresent:!!lockExists,staleLock:!!lockExists&&!running,logs,latestFile:join(dir,'latest.json')});}
  async function check(options={}){const o=monitorOptions(options);return publicOutput(await(await core()).collectSnapshot(settings,{timeoutMs:o.timeoutMs}));}
  async function reclaimDeadInstance(){
    const before=await owned(lock,{directory:true,optional:true});if(!before)return false;
    const file=join(lock,'owner.json'),fileBefore=await owned(file),owner=await json(file);
    if(!owner||owner.label!==MONITOR_LABEL||owner.root!==settings.root||owner.privateDir!==settings.privateDir||!Number.isInteger(owner.pid)||owner.pid<2||typeof owner.nonce!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner.nonce)||!Number.isFinite(Date.parse(owner.startedAt))||!owner.options||typeof owner.options!=='object'||Array.isArray(owner.options))throw Error('Malformed monitor lock; manual review required');
    monitorOptions(owner.options);
    const proof=await command('/bin/ps',['-p',String(owner.pid),'-o','command='],{env});
    if(proof.code!==1||String(proof.stdout??'').trim()||String(proof.stderr??'').trim())throw Error('Monitor owner live or death unconfirmed; manual review required. No process killed.');
    const after=await owned(lock,{directory:true}),fileAfter=await owned(file),again=await json(file);
    if(before.ino!==after.ino||before.dev!==after.dev||fileBefore.ino!==fileAfter.ino||fileBefore.dev!==fileAfter.dev||JSON.stringify(owner)!==JSON.stringify(again))throw Error('Monitor lock changed during death verification');
    await fs.unlink(file);await fs.rmdir(lock);return true;
  }
  async function rotateNotification(line){
    const file=logs.notifications,old=file+'.1',stat=await owned(file,{optional:true});
    if(stat&&stat.size+Buffer.byteLength(line)>1048576){await owned(old,{optional:true});await fs.unlink(old).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rename(file,old);}
    await fs.appendFile(file,line,{mode:0o600});
  }
  async function boundDaemonLogs(){for(const file of [logs.stdout,logs.stderr]){const stat=await owned(file,{optional:true});if(stat&&stat.size>1048576)await fs.truncate(file,0);}}
  async function notify(event){if(!['failure','recovery','topology_changed'].includes(event.type))return;let delivered=false;try{const r=await command('/usr/bin/osascript',['-e',NOTIFICATION_SCRIPT,event.type==='failure'?'Tunnel monitor detected a sustained health failure. Run ./atoms monitor status.':event.type==='topology_changed'?'Tunnel topology or public domain changed. Run ./atoms monitor status.':'Tunnel monitor detected sustained recovery.'],{env});delivered=r.code===0;}catch{}
    await rotateNotification(JSON.stringify({observedAt:new Date(now()).toISOString(),type:event.type,delivered,...(!delivered?{errorCode:'NOTIFICATION_FAILED'}:{})})+'\n');}
  async function run(options={}){const o=monitorOptions(options);await ensureDir();await boundDaemonLogs();await lifecycle(async()=>{await reclaimDeadInstance();try{await fs.mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('Monitor instance lock exists; inspect status and manually verify stale owner. No process killed.');throw e;}});
    const nonce=randomUUID(),controller=new AbortController(),stop=()=>controller.abort();signals.on('SIGTERM',stop);signals.on('SIGINT',stop);
    try{await fs.writeFile(join(lock,'owner.json'),JSON.stringify({label:MONITOR_LABEL,root:settings.root,privateDir:settings.privateDir,pid:process.pid,nonce,startedAt:new Date(now()).toISOString(),options:o}),{mode:0o600,flag:'wx'});return await(await core()).runMonitor(settings,{...o,notify:o.notify?notify:async()=>{},signal:controller.signal});}
    finally{signals.off('SIGTERM',stop);signals.off('SIGINT',stop);const owner=await json(join(lock,'owner.json'),true);if(owner?.nonce===nonce){await fs.unlink(join(lock,'owner.json'));await fs.rmdir(lock);}}
  }
  async function start(options={}){if(platform!=='darwin')throw Error('LaunchAgent start requires macOS');const o=monitorOptions(options);await ensureDir();const oldPlist=await checkedPlist(),loaded=await inspectLaunchd(oldPlist),saved=await savedConfiguration();if(saved&&JSON.stringify(saved.options)!==JSON.stringify(o))throw Error('Monitor options changed; stop the owned monitor before starting new options');if(loaded.loaded)return{...await status(),alreadyStarted:true};await reclaimDeadInstance();
    await fs.mkdir(join(home,'Library','LaunchAgents'),{recursive:true,mode:0o700});const parent=await fs.lstat(join(home,'Library','LaunchAgents'));if(parent.isSymbolicLink()||!parent.isDirectory()||parent.uid!==uid||(parent.mode&0o022))throw Error('Unsafe LaunchAgents directory');
    for(const file of [logs.stdout,logs.stderr]){await owned(file,{optional:true});const handle=await fs.open(file,'a',0o600);await handle.close();}
    await atomic(configFile,{version:1,settings,options:o});const plist=launchAgentPlist({nodeBin,configFile,home,dockerContext:settings.dockerContext,logs});if(!oldPlist)await fs.writeFile(plistFile,plist,{mode:0o600,flag:'wx'});
    const enabled=await launchctl(['enable',target]);if(enabled.code!==0)throw Error('Cannot enable owned monitor');const boot=await launchctl(['bootstrap',domain,plistFile]);if(boot.code!==0)throw Error('Cannot bootstrap owned monitor; inspect monitor status');return{...await status(),started:true};}
  async function stop(){if(platform!=='darwin')throw Error('LaunchAgent stop requires macOS');const plist=await checkedPlist(),loaded=await inspectLaunchd(plist);if(plist)await savedConfiguration();if(loaded.loaded){const r=await launchctl(['bootout',target]);if(r.code!==0)throw Error('Owned monitor bootout failed');}if(plist){const r=await launchctl(['disable',target]);if(r.code!==0)throw Error('Cannot disable owned monitor login startup');await fs.unlink(plistFile);}try{await reclaimDeadInstance();}catch{}return{stopped:true,loginStartupRemoved:!!plist,logsRetained:true,businessServicesChanged:false,tunnelsChanged:false};}
  async function lifecycle(fn){await ensureDir();const guard=join(dir,'lifecycle.lock');try{await fs.mkdir(guard,{mode:0o700});}catch{throw Error('Monitor lifecycle lock exists; no takeover performed');}try{return await fn();}finally{await fs.rmdir(guard);}}
  return{check,run,start:(options)=>lifecycle(()=>start(options)),status,stop:()=>lifecycle(stop)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv[2]!=='run'||process.argv[3]!=='--service-config'||!process.argv[4]||process.argv.length!==5)throw Error('Explicit owned service configuration required');const file=resolve(process.argv[4]),s=await filesystem.lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==0o600||s.uid!==process.getuid())throw Error('Unsafe service configuration');const c=JSON.parse(await filesystem.readFile(file,'utf8')),root=resolve(fileURLToPath(new URL('../',import.meta.url))),settings=validateSettings(Object.fromEntries(Object.entries(c.settings).filter(([k])=>k!=='root')),root);if(c.version!==1||c.settings.root!==root||file!==join(settings.privateDir,'monitor','service-config.json'))throw Error('Service configuration identity mismatch');await createMonitorService(settings).run(c.options);}catch{console.error(JSON.stringify({errorCode:'MONITOR_SERVICE_FAILED',hint:'Inspect ./atoms monitor status and private monitor logs.'}));process.exitCode=1;}
}
