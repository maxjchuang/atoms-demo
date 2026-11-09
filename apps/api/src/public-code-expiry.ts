/** Private expiry provenance. Issuance and quota receipts remain immutable. */
import type{State,Code}from'./store.js';import type{PublicDeployment}from'./public-profile.js';
function ensure(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
const stamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function originalPublicCodeExpiry(state:State,code:Code):string{return state.publicCodeExpiryExtensions?.find(r=>r.codeId===code.id)?.previousExpiresAt??code.expiresAt;}
export function assertPublicCodeExpiryExtensions(state:State,deployment:PublicDeployment){
 const entries=state.publicCodeExpiryExtensions===undefined?[]:state.publicCodeExpiryExtensions;ensure(Array.isArray(entries),'Public expiry extension ledger must be an array');const operations=new Set<string>(),previous=new Map<string,string>(),times=new Map<string,number>();
 for(const r of entries){
  ensure(r&&typeof r==='object'&&Object.keys(r).sort().join(',')===['kind','operationId','dataNamespaceId','codeId','issuedAt','previousExpiresAt','expiresAt','authorizedAt','preserved','historySha256'].sort().join(','),'Unexpected public expiry extension receipt fields');
  const code=state.codes.find(c=>c.id===r.codeId);ensure(code&&r.kind==='public-code-expiry-extension'&&typeof r.operationId==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(r.operationId)&&!operations.has(r.operationId)&&r.dataNamespaceId===deployment.dataNamespaceId&&r.issuedAt===code.publicIssuedAt,'Public expiry extension owner/namespace/operation mismatch');operations.add(r.operationId);
  ensure(![...(state.publicProvisions??[]),...(state.publicQuotaAuthorizations??[]),...(state.publicQuotaResets??[])].some(a=>a.operationId===r.operationId),'Public expiry operation already belongs to another audit ledger');
  ensure(stamp(r.issuedAt)&&stamp(r.previousExpiresAt)&&stamp(r.expiresAt)&&stamp(r.authorizedAt),'Public expiry extension timestamps invalid');
  const issued=Date.parse(r.issuedAt),old=Date.parse(r.previousExpiresAt),until=Date.parse(r.expiresAt),at=Date.parse(r.authorizedAt);
  ensure(until>old&&until<=issued+7*86400000&&at>=issued&&at<old&&at>=(times.get(code.id)??issued),'Public expiry extension bounds/authorization invalid');
  ensure(previous.has(code.id)?r.previousExpiresAt===previous.get(code.id):old>issued&&old-issued<=86400000,'Public expiry extension audit chain invalid');previous.set(code.id,r.expiresAt);times.set(code.id,at);
  ensure(r.preserved&&Object.keys(r.preserved).sort().join(',')===['projects','runs','versions','messages','events','started'].sort().join(',')&&Object.values(r.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)&&/^[a-f0-9]{64}$/.test(r.historySha256),'Public expiry history audit invalid');
 }
 for(const code of state.codes)if(previous.has(code.id))ensure(code.expiresAt===previous.get(code.id),'Public code expiry differs from extension audit chain');
}
/** Exact historical deadline and its authorization window, inclusive for same-ms serial commits. */
export function matchesPublicCodeAuditExpiry(state:State,code:Code,expiresAt:string,authorizedAt:string):boolean{
 let current=originalPublicCodeExpiry(state,code),from=Date.parse(code.publicIssuedAt!),at=Date.parse(authorizedAt);
 for(const r of state.publicCodeExpiryExtensions??[]){if(r.codeId!==code.id)continue;const until=Date.parse(r.authorizedAt);if(current===expiresAt&&at>=from&&at<=until)return true;current=r.expiresAt;from=until;}
 return current===expiresAt&&at>=from;
}
