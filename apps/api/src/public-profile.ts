import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Id,Timestamp} from '@atoms/contracts';
import {IsolationCapabilities,IsolationProtocolVersion,IsolationCapabilitiesPath,type IsolationCapabilitiesDto} from '@atoms/contracts/isolation';
export type IsolationBinding=Pick<IsolationCapabilitiesDto,'toolchainId'|'imageDigest'|'policyHash'|'cacheHash'|'probeRevision'|'platform'>;
export interface PublicDeployment {
 deploymentInstanceId:string;dataNamespaceId:string;ready:boolean;workbenchOrigin:string|null;workbenchAliases?:string[];previewOrigin:string|null;
 expectedIsolation:IsolationBinding|null;verification:{deploymentInstanceId:string;subjectVersionId:string;verifiedAt:string}|null;
}
export interface PublicProfile {deployment:()=>PublicDeployment;previewTtlSeconds?:number;sessionTtlSeconds?:number}
const keys=(value:object,names:string[])=>{if(Object.keys(value).some(k=>!names.includes(k)))throw new Error('Unknown public deployment field');};
export function httpsOrigin(value:unknown):string {
 if(typeof value!=='string'||!/^https:\/\//.test(value)||/[\s\\?#]/.test(value))throw new Error('Exact public HTTPS origin required');
 const url=new URL(value);if(url.hostname.includes('*')||url.username||url.password||value.includes('@')||url.pathname!=='/'||url.search||url.hash||url.origin!==value)throw new Error('Canonical origin only; no paths or credentials');return url.origin;
}
export function parsePublicDeployment(value:unknown):PublicDeployment {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Public deployment object required');const v=value as PublicDeployment;
 keys(v,['deploymentInstanceId','dataNamespaceId','ready','workbenchOrigin','workbenchAliases','previewOrigin','expectedIsolation','verification']);Id.parse(v.deploymentInstanceId);Id.parse(v.dataNamespaceId);if(typeof v.ready!=='boolean')throw new Error('Deployment ready must be boolean');
 for(const field of ['workbenchOrigin','previewOrigin'] as const)if(v[field]!==null)httpsOrigin(v[field]);
 if(v.workbenchOrigin&&v.workbenchOrigin===v.previewOrigin)throw new Error('Workbench and preview require different origins');
 const aliases=v.workbenchAliases===undefined?[]:v.workbenchAliases;if(!Array.isArray(aliases)||aliases.length>4)throw new Error('At most four explicit workbench aliases allowed');for(const alias of aliases)httpsOrigin(alias);if(new Set(aliases).size!==aliases.length||aliases.some(a=>a===v.workbenchOrigin||a===v.previewOrigin)||aliases.length&&!v.workbenchOrigin)throw new Error('Workbench aliases must be unique and separate from canonical/preview origins');
 const hosts=[v.workbenchOrigin,...aliases,v.previewOrigin].filter((origin):origin is string=>origin!==null).map(origin=>new URL(origin).hostname);if(new Set(hosts).size!==hosts.length)throw new Error('Workbench and preview hostnames must be distinct, including aliases and ports');
 if(v.expectedIsolation!==null){const parsed=IsolationCapabilities.parse({protocolVersion:IsolationProtocolVersion,backend:'docker_linux',ready:true,reasonCodes:[],...v.expectedIsolation});keys(v.expectedIsolation,['toolchainId','imageDigest','policyHash','cacheHash','probeRevision','platform']);if(parsed.toolchainId===null)throw new Error('Expected isolation binding missing');}
 if(v.ready&&(!v.workbenchOrigin||!v.previewOrigin||!v.expectedIsolation))throw new Error('Ready deployment needs both origins and reviewed isolation binding');
 if(v.verification!==null){keys(v.verification,['deploymentInstanceId','subjectVersionId','verifiedAt']);Id.parse(v.verification.deploymentInstanceId);Id.parse(v.verification.subjectVersionId);Timestamp.parse(v.verification.verifiedAt);if(v.verification.deploymentInstanceId!==v.deploymentInstanceId)throw new Error('External receipt belongs to another deployment');}
 return structuredClone(v);
}
/** Select an exact configured origin from the actual Host, never forwarding headers. */
export function publicWorkbenchOrigin(deployment:PublicDeployment,host:unknown):string|null {
 if(typeof host!=='string')return null;
 return [deployment.workbenchOrigin,...deployment.workbenchAliases??[]].find((origin):origin is string=>origin!==null&&new URL(origin).host===host)??null;
}
export function updatedPublicOrigins(old:PublicDeployment,payload:{workbenchOrigin:string;workbenchAliases?:string[];previewOrigin:string;expectedIsolation:IsolationBinding},nextInstanceId:string):PublicDeployment {
 keys(payload,['workbenchOrigin','workbenchAliases','previewOrigin','expectedIsolation']);
 const candidate=parsePublicDeployment({...old,ready:true,workbenchOrigin:payload.workbenchOrigin,workbenchAliases:payload.workbenchAliases===undefined?old.workbenchAliases??[]:payload.workbenchAliases,previewOrigin:payload.previewOrigin,expectedIsolation:payload.expectedIsolation});
 const changed=old.workbenchOrigin!==candidate.workbenchOrigin||old.previewOrigin!==candidate.previewOrigin||JSON.stringify([...(old.workbenchAliases??[])].sort())!==JSON.stringify([...(candidate.workbenchAliases??[])].sort());
 return parsePublicDeployment({...candidate,deploymentInstanceId:changed?nextInstanceId:old.deploymentInstanceId,verification:changed?null:old.verification});
}
export function readPublicDeployment(filename:string):PublicDeployment{return parsePublicDeployment(JSON.parse(readFileSync(filename,'utf8')));}
export function assertPublicDataNamespace(dataDir:string,deployment:PublicDeployment){
 const path=resolve(dataDir);if(/(?:^|[\/\\])review-real(?:[\/\\]|$)/.test(path))throw new Error('Private review-real data cannot be public');
 const file=join(path,'public-namespace.json');if(!existsSync(file))throw new Error('Fresh public namespace marker required before opening SQLite');const marker=JSON.parse(readFileSync(file,'utf8'));if(marker.kind!=='atoms-m3-public'||marker.dataNamespaceId!==deployment.dataNamespaceId)throw new Error('Public data namespace mismatch');
}
export async function publicIsolationReady(agentUrl:string,token:string,profile:PublicProfile):Promise<boolean>{
 const deployment=profile.deployment();if(!deployment.ready||!deployment.expectedIsolation)return false;
 try{const response=await fetch(agentUrl.replace(/\/$/,'')+IsolationCapabilitiesPath,{headers:{authorization:`Bearer ${token}`,'X-Atoms-Isolation-Version':IsolationProtocolVersion},signal:AbortSignal.timeout(3000)});if(!response.ok||response.headers.get('x-atoms-isolation-version')!==IsolationProtocolVersion)return false;const actual=IsolationCapabilities.parse(await response.json());if(!actual.ready)return false;
  return (Object.keys(deployment.expectedIsolation) as (keyof IsolationBinding)[]).every(k=>actual[k]===deployment.expectedIsolation![k]);
 }catch{return false;}
}
