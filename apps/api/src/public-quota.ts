/** Private code-scoped total-limit authorization. Baselines/history remain immutable. */
import{join}from'node:path';import{createHash}from'node:crypto';
import{Id}from'@atoms/contracts';import{Store,type State,type Code,type PublicQuotaAuthorization}from'./store.js';
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
 const entries=state.publicQuotaAuthorizations??[];ensure(Array.isArray(entries)&&entries.length<=state.codes.length,'Public quota audit ledger invalid');const codes=new Set<string>(),operations=new Set<string>();
 for(const r of entries){
  ensure(r&&typeof r==='object'&&Object.keys(r).sort().join(',')===['kind','operationId','dataNamespaceId','codeId','baselineRunLimit','previousEffectiveRunLimit','added','effectiveRunLimit','observedUsed','observedReserved','codeExpiresAt','authorizedAt','preserved','historySha256'].sort().join(','),'Unexpected public quota receipt fields');
  const code=state.codes.find(c=>c.id===r.codeId);ensure(code&&code.runLimit===3&&r.kind==='public-code-total-limit'&&op(r.operationId)&&!codes.has(r.codeId)&&!operations.has(r.operationId)&&r.dataNamespaceId===deployment.dataNamespaceId,'Public quota receipt owner/namespace/operation mismatch');codes.add(r.codeId);operations.add(r.operationId);
  ensure(r.baselineRunLimit===3&&r.effectiveRunLimit===10&&Number.isInteger(r.previousEffectiveRunLimit)&&r.previousEffectiveRunLimit>=3&&r.previousEffectiveRunLimit<=6&&r.added===10-r.previousEffectiveRunLimit,'Public quota total/delta out of bounds');
  ensure(Number.isInteger(r.observedUsed)&&r.observedUsed>=0&&r.observedUsed<=r.previousEffectiveRunLimit&&r.observedReserved===0&&r.codeExpiresAt===code.expiresAt&&Number.isFinite(Date.parse(r.authorizedAt)),'Public quota usage/expiry audit invalid');
  ensure(r.preserved&&Object.keys(r.preserved).sort().join(',')===['projects','runs','versions','messages','events','started'].sort().join(',')&&Object.values(r.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)&&/^[a-f0-9]{64}$/.test(r.historySha256),'Public quota history audit invalid');
 }
}
export function effectivePublicRunLimit(dataDir:string,deployment:PublicDeployment,state:State,code:Code):number{
 const handoff=readPublicHandoff(dataDir,deployment,code),base=handoff?.effectiveRunLimit??code.runLimit;
 const authorization=state.publicQuotaAuthorizations?.find(r=>r.codeId===code.id);
 // Both ledgers authorize totals. They are never summed, and other owners cannot inherit them.
 return Math.max(base,authorization?.effectiveRunLimit??base);
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
  if(current===10)return{changed:false,replayed:false,alreadyAtLimit:true,receipt:entries.find(r=>r.codeId===code.id),currentEffectiveRunLimit:current,currentUsage};
  ensure(current>=3&&current<=6&&currentUsage.runsReserved===0&&currentUsage.runsUsed<=current,'Existing quota usage is outside the reviewed baseline/handoff envelope');
  const{codes,sessions,publicProvisions,publicQuotaAuthorizations,idempotency,...history}=store.state;
  const receipt:PublicQuotaAuthorization={kind:'public-code-total-limit',operationId:request.operationId,dataNamespaceId:deployment.dataNamespaceId,codeId:code.id,baselineRunLimit:3,previousEffectiveRunLimit:current,added:10-current,effectiveRunLimit:10,observedUsed:currentUsage.runsUsed,observedReserved:0,codeExpiresAt:code.expiresAt,authorizedAt:new Date().toISOString(),preserved:{projects:history.projects.length,runs:history.runs.length,versions:history.versions.length,messages:history.messages.length,events:history.events.length,started:history.runs.filter(r=>r.started).length},historySha256:sha(JSON.stringify(history))};
  store.transaction(()=>{(store!.state.publicQuotaAuthorizations??=[]).push(receipt);assertPublicQuotaAuthorizations(store!.state,deployment);});
  return{changed:true,replayed:false,receipt,currentEffectiveRunLimit:10,currentUsage};
 }finally{store?.close();release();}
}
