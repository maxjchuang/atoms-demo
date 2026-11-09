/** Native ngrok connector. Credentials stay in private files, never process args/env. */
import {spawn,execFileSync} from 'node:child_process';
import {constants,openSync,closeSync} from 'node:fs';
import {open,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomBytes} from 'node:crypto';
import {safeDockerEnvironment,privateDirectory} from './m3-lib.mjs';
export function fixedNgrokOrigin(value){
 if(typeof value!=='string'||!/^https:\/\//.test(value))throw new Error('Explicit fixed ngrok HTTPS origin required');
 const u=new URL(value);
 if(u.origin!==value||u.username||u.password||u.port||!['.ngrok-free.app','.ngrok-free.dev','.ngrok.app','.ngrok.dev'].some(s=>u.hostname.endsWith(s)))throw new Error('Fixed account-assigned ngrok origin required; no path, port or credentials');
 return u.origin;
}
export function ngrokArguments({origin,port,configFile}){
 fixedNgrokOrigin(origin);if(![18080,5181].includes(port)||!isAbsolute(configFile))throw new Error('Only reviewed workbench loopback ports and private absolute config paths allowed');
 return ['http','--url='+origin,'--config='+configFile,'--log=stdout','--log-format=json','--log-level=info','http://127.0.0.1:'+port];
}
function ngrokAddressMatches(address,port){
 if(![18080,5181].includes(port))return false;
 if(typeof address==='string')return address==='http://127.0.0.1:'+port;
 // ngrok 3.39 serializes Go net/url.URL in JSON logs. Require its exact,
 // credential-free representation rather than reconstructing a permissive URL.
 const expected={Scheme:'http',Opaque:'',User:null,Host:'127.0.0.1:'+port,Path:'',Fragment:'',RawQuery:'',RawPath:'',RawFragment:'',ForceQuery:false,OmitHost:false};
 return address!==null&&typeof address==='object'&&!Array.isArray(address)&&
  Object.keys(address).length===Object.keys(expected).length&&
  Object.entries(expected).every(([key,value])=>Object.hasOwn(address,key)&&address[key]===value);
}
export function ngrokStarted(text,origin,port){
 return text.split('\n').some(line=>{try{const v=JSON.parse(line);return v.msg==='started tunnel'&&v.url===origin&&ngrokAddressMatches(v.addr,port);}catch{return false;}});
}
export function processFingerprint(pid){try{return execFileSync('ps',['-p',String(pid),'-o','lstart=','-o','args='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}}
export function ngrokIdentityMatches(saved,current){
 if(saved.provider!=='ngrok'||saved.transport!=='native'||!Number.isInteger(saved.pid)||saved.pid<2||!saved.binary||!saved.configFile||!saved.fingerprint||current!==saved.fingerprint)return false;
 try{return ngrokArguments(saved).every(arg=>current.includes(arg))&&current.includes(saved.binary);}catch{return false;}
}
export async function ngrokRunning(saved){return ngrokIdentityMatches(saved,processFingerprint(saved.pid));}
export async function stopNgrok(saved){
 const current=processFingerprint(saved.pid);if(!current)return;
 if(!ngrokIdentityMatches(saved,current))throw new Error('Owned ngrok identity changed; refusing to signal another process');
 process.kill(-saved.pid,'SIGTERM');
 for(let n=0;n<50;n++){if(!processFingerprint(saved.pid))return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('Owned ngrok did not stop; retained journal and config for review');
}
export async function readNgrokToken(filename){
 if(!isAbsolute(filename))throw new Error('Absolute private token filename required');
 const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await handle.stat();if(!s.isFile()||(s.mode&0o777)!==0o600||process.getuid&&s.uid!==process.getuid()||s.size>8192)throw new Error('Ngrok token must be current-owner, regular 0600 file');const token=(await handle.readFile('utf8')).trim();if(!/^[A-Za-z0-9_\-]{16,4096}$/.test(token))throw new Error('Invalid raw ngrok token file');return token;}finally{await handle.close();}
}
export async function startNgrok({origin,port,tokenFile,binary='ngrok',directory,onStarted=async()=>{},timeoutMs=45000,fingerprintOf=processFingerprint}){
 origin=fixedNgrokOrigin(origin);await privateDirectory(directory);
 const token=await readNgrokToken(tokenFile),nonce=randomBytes(16).toString('hex');
 if(!isAbsolute(binary))throw new Error('Reviewed absolute ngrok executable path required');
 const executable=await lstat(binary);if(!executable.isFile()||!(executable.mode&0o111))throw new Error('Ngrok executable must be a regular executable file');
 const configFile=join(directory,'ngrok-'+nonce+'.yml'),logFile=join(directory,'ngrok-'+nonce+'.log');
 await writeFile(configFile,'version: "2"\nauthtoken: '+JSON.stringify(token)+'\nweb_addr: false\n',{mode:0o600,flag:'wx'});
 const argv=ngrokArguments({origin,port,configFile});const fd=openSync(logFile,'wx',0o600);let child,saved;
 try{
  child=spawn(binary,argv,{env:safeDockerEnvironment(),detached:true,stdio:['ignore',fd,fd]});
  await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});child.unref();
  let fingerprint='',previous='';for(let n=0;n<20;n++){fingerprint=fingerprintOf(child.pid);if(fingerprint&&fingerprint===previous)break;previous=fingerprint;await new Promise(r=>setTimeout(r,50));}
  saved={role:'workbench',provider:'ngrok',transport:'native',pid:child.pid,fingerprint,binary,configFile,logFile,origin,port};
  if(!ngrokIdentityMatches(saved,fingerprint))throw new Error('Cannot bind owned ngrok process identity');
  // Journal before waiting for remote registration so interruption remains recoverable.
  await onStarted(saved);
  if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>45000)throw new Error('Invalid bounded registration timeout');
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(!await ngrokRunning(saved))throw new Error('Ngrok exited before connection; inspect the private local log');if(ngrokStarted(await readFile(logFile,'utf8'),origin,port))return saved;await new Promise(r=>setTimeout(r,250));}
  throw new Error('Ngrok registration timed out; private log retained');
 }catch(error){if(saved&&await ngrokRunning(saved))await stopNgrok(saved);else if(child?.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1000);});}throw error;}finally{closeSync(fd);}
}
