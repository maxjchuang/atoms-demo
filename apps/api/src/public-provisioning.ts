import{assertPublicCodeExpiryExtensions,originalPublicCodeExpiry}from'./public-code-expiry.js';
/** Guarded offline issuance of additional public identities; never rewrites Run usage/history. */
import{mkdirSync,writeFileSync,readFileSync,lstatSync,existsSync}from'node:fs';
import{join,dirname,isAbsolute}from'node:path';import{randomBytes,createHash}from'node:crypto';
import{Id}from'@atoms/contracts';import{Store,type State,type PublicProvisionReceipt}from'./store.js';
import{acquirePublicWriter}from'./public-admin.js';import{assertPublicDataNamespace,type PublicDeployment}from'./public-profile.js';
export const PUBLIC_PROJECTS_PER_CODE=10,PUBLIC_MAX_IDENTITIES=10,PUBLIC_BASELINE_RUNS=3;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const operation=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(value);
const stamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function assertProvisionedPublicState(state:State,deployment:PublicDeployment){
 assertPublicCodeExpiryExtensions(state,deployment);
 const receipts=state.publicProvisions??[];ensure(Array.isArray(receipts),'Public provisioning audit must be an array');
 ensure(state.codes.length<=PUBLIC_MAX_IDENTITIES&&state.codes.length<=(receipts.length?receipts.length+1:1),'Public identities require guarded issuance receipts');
 ensure(new Set(state.codes.map(c=>c.id)).size===state.codes.length&&new Set(state.codes.map(c=>c.hash)).size===state.codes.length,'Public identity IDs and hashes must be unique');
 if(receipts.length)ensure(state.codes.length===receipts.length+1,'Public receipt chain differs from issued identities');
 const operations=new Set<string>();
 for(let i=0;i<receipts.length;i++){
  const r=receipts[i],code=state.codes[i+1];
  ensure(r&&typeof r==='object'&&r.kind==='new-public-identity'&&operation(r.operationId)&&!operations.has(r.operationId),'Public provisioning receipt is invalid or duplicated');operations.add(r.operationId);
  ensure(r.dataNamespaceId===deployment.dataNamespaceId&&r.codeId===code.id&&r.projectLimit===10&&r.runLimit===3&&r.maxIdentities===10&&r.issuedAt===code.publicIssuedAt&&r.expiresAt===originalPublicCodeExpiry(state,code),'Public provisioning receipt identity/limits mismatch');
  ensure(JSON.stringify(r.previousCodeIds)===JSON.stringify(state.codes.slice(0,i+1).map(c=>c.id)),'Public provisioning audit chain mismatch');
  ensure(Array.isArray(r.projectLimitChanges)&&r.projectLimitChanges.length===i+1&&r.projectLimitChanges.every((c,j)=>c.codeId===r.previousCodeIds[j]&&[1,10].includes(c.from)&&c.to===10),'Public project-limit audit invalid');
  ensure(r.preserved&&Object.values(r.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)&&/^[a-f0-9]{64}$/.test(r.historySha256),'Public history preservation audit invalid');
 }
 for(const code of state.codes){
  Id.parse(code.id);ensure(/^[a-f0-9]{64}$/.test(code.hash)&&typeof code.revoked==='boolean'&&stamp(code.publicIssuedAt)&&stamp(code.expiresAt),'Public identity was not provisioned');
  const ttl=Date.parse(originalPublicCodeExpiry(state,code))-Date.parse(code.publicIssuedAt!);
  ensure(ttl>0&&ttl<=86400000&&code.runLimit===3&&code.projectLimit===(receipts.length?10:1),'Public identity baseline limits/TTL invalid');
  ensure(state.projects.filter(p=>p.codeId===code.id).length<=code.projectLimit,'Public per-identity project cap exceeded');
 }
 const owners=new Map(state.projects.map(p=>[p.dto.id,p.codeId]));ensure(state.projects.every(p=>state.codes.some(c=>c.id===p.codeId)),'Public project has unknown owner');
 ensure(state.runs.every(r=>owners.get(r.dto.projectId)===r.codeId)&&state.coordination.turns.every(t=>owners.get(t.dto.projectId)===t.codeId),'Public business history has cross-owner attribution');
}
export interface PublicProvisionRequest{kind:'provision-public-identity';operationId:string;projectLimit:10;runLimit:3;ttlSeconds:number}
export function parsePublicProvisionRequest(input:unknown):PublicProvisionRequest{
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'Explicit public provisioning request required');const r=input as PublicProvisionRequest;
 ensure(Object.keys(r).sort().join(',')===['kind','operationId','projectLimit','runLimit','ttlSeconds'].sort().join(','),'Unknown public provisioning request fields');
 ensure(r.kind==='provision-public-identity'&&operation(r.operationId)&&r.projectLimit===10&&r.runLimit===3&&Number.isInteger(r.ttlSeconds)&&r.ttlSeconds>=1&&r.ttlSeconds<=86400,'Only explicit new identity with ten projects, three Runs and bounded TTL supported');return r;
}
function privateCode(file:string){const s=lstatSync(file);ensure(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600&&(!process.getuid||s.uid===process.getuid()),'Private code file must be current-owner regular0600');const code=readFileSync(file,'utf8').trim();ensure(/^[A-Za-z0-9_-]{43}$/.test(code),'Private code file format invalid');return code;}
export function offlineProvisionPublicCode(dataDir:string,deployment:PublicDeployment,input:unknown,codeFile:string,authorized=false){
 ensure(authorized,'Separate public provisioning authorization guard required');const request=parsePublicProvisionRequest(input);ensure(isAbsolute(codeFile),'Absolute private output filename required');assertPublicDataNamespace(dataDir,deployment);
 const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{
  store=new Store(join(dataDir,'api.sqlite'));assertProvisionedPublicState(store.state,deployment);
  ensure(store.state.runs.every(r=>['succeeded','failed','cancelled','interrupted'].includes(r.dto.status))&&store.state.coordination.turns.every(t=>['completed','failed','cancelled','interrupted'].includes(t.dto.status)),'Offline provisioning requires drained Run/Turn work');
  const existing=store.state.publicProvisions?.find(r=>r.operationId===request.operationId);
  if(existing){const code=store.state.codes.find(c=>c.id===existing.codeId)!;ensure(Date.parse(existing.expiresAt)-Date.parse(existing.issuedAt)===request.ttlSeconds*1000,'Provisioning operation already exists with another request');ensure(existsSync(codeFile)&&sha(privateCode(codeFile))===code.hash,'Existing operation output is missing/different; refusing another plaintext issuance');return{created:false,receipt:existing,usage:publicCodeUsage(store.state,existing.codeId)};}
  ensure(store.state.codes.length>=1&&store.state.codes.length<PUBLIC_MAX_IDENTITIES,'Provisioning requires an existing public namespace and at most ten lifetime identities');
  ensure(!existsSync(codeFile),'Refusing to overwrite existing private code file');mkdirSync(dirname(codeFile),{recursive:true,mode:0o700});const parent=lstatSync(dirname(codeFile));ensure(parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o777)===0o700&&(!process.getuid||parent.uid===process.getuid()),'Code parent must be current-owner0700, not symlink');
  const code=randomBytes(32).toString('base64url'),issuedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(issuedAt)+request.ttlSeconds*1000).toISOString(),codeId='code_'+randomBytes(10).toString('hex');
  const {codes,sessions,publicProvisions,idempotency,...history}=store.state;
  const receipt:PublicProvisionReceipt={kind:'new-public-identity',operationId:request.operationId,dataNamespaceId:deployment.dataNamespaceId,codeId,projectLimit:10,runLimit:3,maxIdentities:10,issuedAt,expiresAt,previousCodeIds:codes.map(c=>c.id),projectLimitChanges:codes.map(c=>({codeId:c.id,from:c.projectLimit,to:10})),preserved:{projects:history.projects.length,runs:history.runs.length,versions:history.versions.length,messages:history.messages.length,events:history.events.length,started:history.runs.filter(r=>r.started).length},historySha256:sha(JSON.stringify(history))};
  writeFileSync(codeFile,code+'\n',{mode:0o600,flag:'wx'});
  store.transaction(()=>{for(const old of store!.state.codes)old.projectLimit=10;store!.state.codes.push({id:codeId,hash:sha(code),expiresAt,projectLimit:10,runLimit:3,revoked:false,publicIssuedAt:issuedAt});(store!.state.publicProvisions??=[]).push(receipt);assertProvisionedPublicState(store!.state,deployment);});
  return{created:true,receipt,usage:publicCodeUsage(store.state,receipt.codeId)};
 }finally{store?.close();release();}
}

export function inspectPublicProvision(dataDir:string,deployment:PublicDeployment,operationId:string){
 ensure(operation(operationId),'Explicit valid provisioning operation ID required');assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{store=new Store(join(dataDir,'api.sqlite'));assertProvisionedPublicState(store.state,deployment);return store.state.publicProvisions?.find(r=>r.operationId===operationId)??null;}finally{store?.close();release();}
}

function publicCodeUsage(state:State,codeId:string){const runs=state.runs.filter(r=>r.codeId===codeId);return{runsUsed:runs.filter(r=>r.started).length,runsReserved:runs.filter(r=>!r.started&&!['succeeded','failed','cancelled','interrupted'].includes(r.dto.status)).length,projectsUsed:state.projects.filter(p=>p.codeId===codeId).length};}
export function verifyPublicProvisionOutput(dataDir:string,deployment:PublicDeployment,input:unknown,rawCode:string){
 const request=parsePublicProvisionRequest(input);ensure(/^[A-Za-z0-9_-]{43}$/.test(rawCode),'Private issued-code verification input invalid');assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{store=new Store(join(dataDir,'api.sqlite'));assertProvisionedPublicState(store.state,deployment);const receipt=store.state.publicProvisions?.find(r=>r.operationId===request.operationId);ensure(receipt,'Provisioning receipt not committed; orphan plaintext is not an issued identity');ensure(Date.parse(receipt.expiresAt)-Date.parse(receipt.issuedAt)===request.ttlSeconds*1000,'Provisioning request differs from receipt');const code=store.state.codes.find(c=>c.id===receipt.codeId)!;ensure(code.hash===sha(rawCode),'Protected output does not match the committed identity');return{replayed:true,receipt,usage:publicCodeUsage(store.state,code.id)};}finally{store?.close();release();}
}
