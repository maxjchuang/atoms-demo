import{assertPublicCodeExpiryExtensions,matchesPublicCodeAuditExpiry}from'./public-code-expiry.js';
/** Private code-scoped total-limit authorization. Baselines/history remain immutable. */
import{join}from'node:path';import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';
import{Id}from'@atoms/contracts';import{Store,type State,type Code,type PublicQuotaAuthorization,type PublicQuotaReset}from'./store.js';
import{acquirePublicWriter}from'./public-admin.js';import{assertPublicDataNamespace,type PublicDeployment}from'./public-profile.js';import{assertProvisionedPublicState}from'./public-provisioning.js';import{readPublicHandoff}from'./public-handoff.js';
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const op=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(value);
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface PublicQuotaRequest{kind:'authorize-public-code-total-limit';operationId:string;codeId:string;totalLimit:10}
export function parsePublicQuotaRequest(input:unknown):PublicQuotaRequest{
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'Explicit public quota authorization request required');const v=input as PublicQuotaRequest;
 ensure(Object.keys(v).sort().join(',')===['kind','operationId','codeId','totalLimit'].sort().join(','),'Unknown public quota request fields');Id.parse(v.codeId);
 ensure(v.kind==='authorize-public-code-total-limit'&&op(v.operationId)&&v.totalLimit===10,'Only explicit existing-code total-limit10 authorization supported');return v;
}
export function assertPublicQuotaAuthorizations(state:State,deployment:PublicDeployment){
 assertPublicCodeExpiryExtensions(state,deployment);assertPublicQuotaResets(state,deployment);
 const entries=state.publicQuotaAuthorizations??[];ensure(Array.isArray(entries)&&entries.length<=state.codes.length,'Public quota audit ledger invalid');const codes=new Set<string>(),operations=new Set<string>();
 for(const r of entries){
  ensure(r&&typeof r==='object'&&Object.keys(r).sort().join(',')===['kind','operationId','dataNamespaceId','codeId','baselineRunLimit','previousEffectiveRunLimit','added','effectiveRunLimit','observedUsed','observedReserved','codeExpiresAt','authorizedAt','preserved','historySha256'].sort().join(','),'Unexpected public quota receipt fields');
  const code=state.codes.find(c=>c.id===r.codeId);ensure(code&&code.runLimit===3&&r.kind==='public-code-total-limit'&&op(r.operationId)&&!codes.has(r.codeId)&&!operations.has(r.operationId)&&r.dataNamespaceId===deployment.dataNamespaceId,'Public quota receipt owner/namespace/operation mismatch');codes.add(r.codeId);operations.add(r.operationId);
  ensure(r.baselineRunLimit===3&&r.effectiveRunLimit===10&&Number.isInteger(r.previousEffectiveRunLimit)&&r.previousEffectiveRunLimit>=3&&r.previousEffectiveRunLimit<=6&&r.added===10-r.previousEffectiveRunLimit,'Public quota total/delta out of bounds');
  ensure(Number.isInteger(r.observedUsed)&&r.observedUsed>=0&&r.observedUsed<=r.previousEffectiveRunLimit&&r.observedReserved===0&&matchesPublicCodeAuditExpiry(state,code,r.codeExpiresAt,r.authorizedAt)&&Number.isFinite(Date.parse(r.authorizedAt)),'Public quota usage/expiry audit invalid');
  ensure(r.preserved&&Object.keys(r.preserved).sort().join(',')===['projects','runs','versions','messages','events','started'].sort().join(',')&&Object.values(r.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)&&/^[a-f0-9]{64}$/.test(r.historySha256),'Public quota history audit invalid');
 }
}
export function effectivePublicRunLimit(dataDir:string,deployment:PublicDeployment,state:State,code:Code):number{
 const handoff=readPublicHandoff(dataDir,deployment,code),base=handoff?.effectiveRunLimit??code.runLimit;
 const authorization=state.publicQuotaAuthorizations?.find(r=>r.codeId===code.id);
 // Both ledgers authorize totals. They are never summed, and other owners cannot inherit them.
 return state.publicQuotaResets?.filter(r=>r.codeId===code.id).at(-1)?.effectiveRunLimit??Math.max(base,authorization?.effectiveRunLimit??base);
}
function usage(state:State,codeId:string){const runs=state.runs.filter(r=>r.codeId===codeId);return{runsUsed:runs.filter(r=>r.started).length,runsReserved:runs.filter(r=>!r.started&&!['succeeded','failed','cancelled','interrupted'].includes(r.dto.status)).length};}
export function offlineAuthorizePublicQuota(dataDir:string,deployment:PublicDeployment,input:unknown,rawCode:string,authorized=false){
 ensure(authorized,'Separate public quota authorization guard required');const request=parsePublicQuotaRequest(input);ensure(/^[A-Za-z0-9_-]{43}$/.test(rawCode),'Private target code input invalid');assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{
  store=new Store(join(dataDir,'api.sqlite'));assertProvisionedPublicState(store.state,deployment);assertPublicQuotaAuthorizations(store.state,deployment);
  ensure(store.state.runs.every(r=>['succeeded','failed','cancelled','interrupted'].includes(r.dto.status))&&store.state.coordination.turns.every(t=>['completed','failed','cancelled','interrupted'].includes(t.dto.status)),'Quota authorization requires drained Run/Turn work');
  const code=store.state.codes.find(c=>c.hash===sha(rawCode));ensure(code&&code.id===request.codeId,'Protected target code does not match the explicitly selected identity');ensure(!code.revoked&&Date.parse(code.expiresAt)>Date.now(),'Target public code must remain active');
  const entries=store.state.publicQuotaAuthorizations??[],existing=entries.find(r=>r.operationId===request.operationId),currentUsage=usage(store.state,code.id),current=effectivePublicRunLimit(dataDir,deployment,store.state,code);
  if(existing){ensure(existing.codeId===code.id,'Quota operation already belongs to another identity');return{changed:false,replayed:true,receipt:existing,currentEffectiveRunLimit:current,currentUsage};}
  ensure(!store.state.publicQuotaResets?.some(r=>r.codeId===code.id),'Remaining-reset ledger takes precedence; use an explicit remaining reset, not a new total-limit authorization');
  if(current===10)return{changed:false,replayed:false,alreadyAtLimit:true,receipt:entries.find(r=>r.codeId===code.id),currentEffectiveRunLimit:current,currentUsage};
  ensure(current>=3&&current<=6&&currentUsage.runsReserved===0&&currentUsage.runsUsed<=current,'Existing quota usage is outside the reviewed baseline/handoff envelope');
  const{codes,sessions,publicProvisions,publicQuotaAuthorizations,idempotency,...history}=store.state;
  const receipt:PublicQuotaAuthorization={kind:'public-code-total-limit',operationId:request.operationId,dataNamespaceId:deployment.dataNamespaceId,codeId:code.id,baselineRunLimit:3,previousEffectiveRunLimit:current,added:10-current,effectiveRunLimit:10,observedUsed:currentUsage.runsUsed,observedReserved:0,codeExpiresAt:code.expiresAt,authorizedAt:new Date().toISOString(),preserved:{projects:history.projects.length,runs:history.runs.length,versions:history.versions.length,messages:history.messages.length,events:history.events.length,started:history.runs.filter(r=>r.started).length},historySha256:sha(JSON.stringify(history))};
  store.transaction(()=>{(store!.state.publicQuotaAuthorizations??=[]).push(receipt);assertPublicQuotaAuthorizations(store!.state,deployment);});
  return{changed:true,replayed:false,receipt,currentEffectiveRunLimit:10,currentUsage};
 }finally{store?.close();release();}
}

export interface PublicQuotaResetRequest{kind:'reset-public-code-remaining';operationId:string;codeId:string;remaining:number}
export function parsePublicQuotaResetRequest(input:unknown):PublicQuotaResetRequest{
 ensure(input&&typeof input==='object'&&!Array.isArray(input),'Explicit remaining reset request required');const r=input as PublicQuotaResetRequest;
 ensure(Object.keys(r).sort().join(',')===['kind','operationId','codeId','remaining'].sort().join(','),'Unknown remaining reset request fields');Id.parse(r.codeId);
 ensure(r.kind==='reset-public-code-remaining'&&op(r.operationId)&&Number.isInteger(r.remaining)&&r.remaining>=1&&r.remaining<=100,'Remaining reset must be an integer1..100');return r;
}
export function assertPublicQuotaResets(state:State,deployment:PublicDeployment){
 const entries=state.publicQuotaResets===undefined?[]:state.publicQuotaResets;ensure(Array.isArray(entries),'Remaining reset ledger invalid');const operations=new Set<string>(),used=new Map<string,number>(),priorTotal=new Map<string,number>();
 for(const r of entries){
  ensure(r&&typeof r==='object'&&Object.keys(r).sort().join(',')===['kind','operationId','dataNamespaceId','codeId','requestedRemaining','previousEffectiveRunLimit','effectiveRunLimit','observedUsed','observedReserved','codeExpiresAt','authorizedAt','preserved','historySha256'].sort().join(','),'Unexpected remaining reset receipt fields');
  const code=state.codes.find(c=>c.id===r.codeId);ensure(code&&r.kind==='public-code-remaining-reset'&&op(r.operationId)&&!operations.has(r.operationId)&&!state.publicQuotaAuthorizations?.some(a=>a.operationId===r.operationId)&&r.dataNamespaceId===deployment.dataNamespaceId,'Remaining reset owner/namespace/operation mismatch');operations.add(r.operationId);
  ensure(Number.isSafeInteger(r.requestedRemaining)&&r.requestedRemaining>=1&&r.requestedRemaining<=100&&Number.isSafeInteger(r.previousEffectiveRunLimit)&&r.previousEffectiveRunLimit>=0&&Number.isSafeInteger(r.observedUsed)&&r.observedUsed>=(used.get(code.id)??0)&&r.observedUsed<=r.previousEffectiveRunLimit&&Number.isSafeInteger(r.effectiveRunLimit)&&r.effectiveRunLimit===r.observedUsed+r.requestedRemaining&&r.observedReserved===0,'Remaining reset total/usage invalid');ensure(!priorTotal.has(code.id)||r.previousEffectiveRunLimit===priorTotal.get(code.id),'Remaining reset audit chain invalid');used.set(code.id,r.observedUsed);priorTotal.set(code.id,r.effectiveRunLimit);
  ensure(matchesPublicCodeAuditExpiry(state,code,r.codeExpiresAt,r.authorizedAt)&&Number.isFinite(Date.parse(r.authorizedAt))&&r.preserved&&Object.keys(r.preserved).sort().join(',')===['projects','runs','versions','messages','events','started'].sort().join(',')&&Object.values(r.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)&&/^[a-f0-9]{64}$/.test(r.historySha256),'Remaining reset expiry/history audit invalid');
 }
}
export function publicCodeQuotaDetails(dataDir:string,deployment:PublicDeployment,state:State,rawCode:string){
 ensure(/^[A-Za-z0-9_-]{43}$/.test(rawCode),'Private target code input invalid');assertProvisionedPublicState(state,deployment);assertPublicQuotaAuthorizations(state,deployment);
 const code=state.codes.find(c=>c.hash===sha(rawCode));ensure(code,'Protected target code does not match an identity');const u=usage(state,code.id),effective=effectivePublicRunLimit(dataDir,deployment,state,code);
 return{codeId:code.id,active:!code.revoked&&Date.parse(code.expiresAt)>Date.now(),expiresAt:code.expiresAt,projectLimit:code.projectLimit,projectsUsed:state.projects.filter(p=>p.codeId===code.id).length,used:u.runsUsed,reserved:u.runsReserved,effective,remaining:Math.max(0,effective-u.runsUsed-u.runsReserved),receiptIds:{expiry:state.publicCodeExpiryExtensions?.filter(r=>r.codeId===code.id).map(r=>r.operationId)??[],provision:state.publicProvisions?.filter(r=>r.codeId===code.id).map(r=>r.operationId)??[],total:state.publicQuotaAuthorizations?.filter(r=>r.codeId===code.id).map(r=>r.operationId)??[],reset:state.publicQuotaResets?.filter(r=>r.codeId===code.id).map(r=>r.operationId)??[]}};
}
/** Read-only SQLite snapshot; safe while API owns its writer lock. Never creates a DB. */
export function inspectPublicCodeQuota(dataDir:string,deployment:PublicDeployment,rawCode:string){
 assertPublicDataNamespace(dataDir,deployment);const db=new DatabaseSync(join(dataDir,'api.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT document FROM app_state WHERE id=1').get() as {document:string}|undefined;ensure(row,'Public database state missing');return publicCodeQuotaDetails(dataDir,deployment,JSON.parse(row.document),rawCode);}finally{db.close();}
}
export function offlineResetPublicQuota(dataDir:string,deployment:PublicDeployment,input:unknown,rawCode:string,authorized=false){
 ensure(authorized,'Separate public remaining reset authorization guard required');const request=parsePublicQuotaResetRequest(input);assertPublicDataNamespace(dataDir,deployment);const release=acquirePublicWriter(dataDir);let store:Store|undefined;
 try{
  store=new Store(join(dataDir,'api.sqlite'));const details=publicCodeQuotaDetails(dataDir,deployment,store.state,rawCode);ensure(details.codeId===request.codeId,'Protected target code does not match the explicitly selected identity');ensure(details.active,'Target public code must remain active');
  ensure(store.state.runs.every(r=>['succeeded','failed','cancelled','interrupted'].includes(r.dto.status))&&store.state.coordination.turns.every(t=>['completed','failed','cancelled','interrupted'].includes(t.dto.status))&&details.reserved===0,'Remaining reset requires drained Run/Turn work');
  const existing=store.state.publicQuotaResets?.find(r=>r.operationId===request.operationId);
  if(existing){ensure(existing.codeId===request.codeId&&existing.requestedRemaining===request.remaining,'Reset operation already belongs to another target/request');return{changed:false,replayed:true,receipt:existing,details};}
  ensure(!store.state.publicQuotaAuthorizations?.some(r=>r.operationId===request.operationId),'Reset operation already belongs to total-limit authorization');
  const {codes,sessions,publicProvisions,publicQuotaAuthorizations,publicQuotaResets,idempotency,...history}=store.state;
  const receipt:PublicQuotaReset={kind:'public-code-remaining-reset',operationId:request.operationId,dataNamespaceId:deployment.dataNamespaceId,codeId:request.codeId,requestedRemaining:request.remaining,previousEffectiveRunLimit:details.effective,effectiveRunLimit:details.used+request.remaining,observedUsed:details.used,observedReserved:0,codeExpiresAt:details.expiresAt,authorizedAt:new Date().toISOString(),preserved:{projects:history.projects.length,runs:history.runs.length,versions:history.versions.length,messages:history.messages.length,events:history.events.length,started:history.runs.filter(r=>r.started).length},historySha256:sha(JSON.stringify(history))};
  store.transaction(()=>{(store!.state.publicQuotaResets??=[]).push(receipt);assertPublicQuotaAuthorizations(store!.state,deployment);});
  return{changed:true,replayed:false,receipt,details:publicCodeQuotaDetails(dataDir,deployment,store.state,rawCode)};
 }finally{store?.close();release();}
}
