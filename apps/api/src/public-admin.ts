import {inspectPublicHandoff,createHandoffReceipt,readPublicHandoff,handoffFile,handoffHash,type HandoffGrantRequest} from './public-handoff.js';
import {mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,lstatSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {hostname} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {Store} from './store.js';
import {assertPublicDataNamespace,type PublicDeployment} from './public-profile.js';
const terminal=(status:string)=>['succeeded','failed','cancelled','interrupted'].includes(status);
export function acquirePublicWriter(dataDir:string){
 const file=join(dataDir,'public-writer.json'),nonce=randomBytes(16).toString('hex');
 if(existsSync(file)){const owner=JSON.parse(readFileSync(file,'utf8'));let alive=true;if(owner.hostname===hostname()&&owner.pid===process.pid&&owner.processStart!==performance.timeOrigin)alive=false;else if(owner.hostname===hostname()&&Number.isSafeInteger(owner.pid)){try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;}}
  if(alive)throw new Error('Public SQLite writer is active or uncertain; stop/drain the API before offline administration');rmSync(file);
 }
 writeFileSync(file,JSON.stringify({pid:process.pid,hostname:hostname(),processStart:performance.timeOrigin,nonce}),{mode:0o600,flag:'wx'});
 return ()=>{if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).nonce===nonce)rmSync(file);};
}
export function initializePublicNamespace(dataDir:string,deployment:PublicDeployment){
 mkdirSync(dataDir,{recursive:true,mode:0o700});const existing=existsSync(join(dataDir,'public-namespace.json'));
 if(existing){assertPublicDataNamespace(dataDir,deployment);return;}
 if(readdirSync(dataDir).length)throw new Error('Refusing to mark any existing nonempty directory as public');writeFileSync(join(dataDir,'public-namespace.json'),JSON.stringify({kind:'atoms-m3-public',dataNamespaceId:deployment.dataNamespaceId}),{mode:0o600,flag:'wx'});
}
export function offlinePublicCode(dataDir:string,deployment:PublicDeployment,action:'issue'|'revoke',codeFile:string,ttlSeconds=86400){
 assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{store=new Store(join(dataDir,'api.sqlite'));if(store.state.runs.some(r=>!terminal(r.dto.status))||store.state.coordination.turns.some(t=>!['completed','failed','cancelled','interrupted'].includes(t.dto.status)))throw new Error('Offline administration requires all Run/Turn work drained');
  if(action==='issue'){
   if(store.state.codes.length||store.state.projects.length||store.state.runs.length||store.state.versions.length)throw new Error('Public issue requires an empty fresh namespace; never resets an existing identity or quota');
   if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>86400)throw new Error('Public code TTL must be 1..86400 seconds');if(existsSync(codeFile))throw new Error('Refusing to overwrite existing private code file');
   const code=randomBytes(32).toString('base64url'),stamp=new Date().toISOString();mkdirSync(dirname(codeFile),{recursive:true,mode:0o700});const parent=lstatSync(dirname(codeFile));if(parent.isSymbolicLink()||(parent.mode&0o777)!==0o700||(process.getuid&&parent.uid!==process.getuid()))throw new Error('Code parent must be current-owner 0700 and not a symlink');writeFileSync(codeFile,code+'\n',{mode:0o600,flag:'wx'});
   store.transaction(()=>store!.state.codes.push({id:'code_'+randomBytes(10).toString('hex'),hash:createHash('sha256').update(code).digest('hex'),expiresAt:new Date(Date.parse(stamp)+ttlSeconds*1000).toISOString(),projectLimit:1,runLimit:3,revoked:false,publicIssuedAt:stamp}));
   return {action,expiresAt:store.state.codes[0].expiresAt};
  }
  if(store.state.codes.length!==1)throw new Error('Expected exactly one public reviewer identity');store.transaction(()=>{store!.state.codes[0].revoked=true;});return {action,revoked:true};
 }finally{store?.close();release();}
}

/** Separately guarded host-only grant; never rewrites SQLite business history or baseline limits. */
export function offlinePublicHandoff(dataDir:string,deployment:PublicDeployment,input?:HandoffGrantRequest,authorized=false){
 assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{store=new Store(join(dataDir,'api.sqlite'));const view=inspectPublicHandoff(store.state,deployment);if(!input)return view;if(!authorized)throw Error('Independent handoff authorization guard required');const existing=readPublicHandoff(dataDir,deployment,store.state.codes[0]);if(existing){if(existing.requestHash!==handoffHash(input)||existing.stateHash!==view.stateHash||existing.deploymentInstanceId!==view.deploymentInstanceId||existing.subjectVersionId!==view.subjectVersionId)throw Error('Handoff already exists with changed state/request/epoch/subject; no added authorization');return existing;}const receipt=createHandoffReceipt(store.state,deployment,input);writeFileSync(handoffFile(dataDir),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});return receipt;
 }finally{store?.close();release();}
}
