import{randomUUID}from'node:crypto';
import{sha256}from'../files.js';
import type{JobPhase}from'./job-policy.js';
import{IsolationCapabilities,IsolationProtocolVersion,type IsolationCapabilitiesDto}from'@atoms/contracts/isolation';
export const hostLocalCapabilities=():IsolationCapabilitiesDto=>IsolationCapabilities.parse({protocolVersion:IsolationProtocolVersion,backend:'host_local',ready:false,reasonCodes:['HOST_BACKEND_UNSAFE'],toolchainId:null,imageDigest:null,policyHash:null,cacheHash:null,probeRevision:null,platform:null});
export class BrokerClient{
 constructor(readonly url:string,private token:string){const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('Invalid trusted broker URL');if(token.length<16)throw new Error('Broker token missing');}
 async request(route:string,method='GET',body?:unknown,lease?:string){const response=await fetch(this.url+route,{method,headers:{authorization:'Bearer '+this.token,'x-atoms-isolation-version':IsolationProtocolVersion,'content-type':'application/json',...(lease?{'x-atoms-job-lease':lease}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Broker request failed HTTP'+response.status);return await response.json();}
 async run(input:{phase:JobPhase;files:unknown[];plan?:unknown},context:{executionId:string;bindingHash:string;attemptId:string;generation:string;remainingMs:number;imageDigest:string;onLease?:(value:unknown)=>void},signal?:AbortSignal){
  const id='job_'+randomUUID().replaceAll('-','');const route='/internal/jobs/'+id;const body={executionId:context.executionId,expectedImageDigest:context.imageDigest,phase:input.phase,inputHash:sha256(JSON.stringify(input)),deadlineMs:Math.max(1,Math.min(context.remainingMs,input.phase==='browser'?90000:180000)),bindingHash:context.bindingHash,attemptId:context.attemptId,generation:context.generation};
  let job:any;context.onLease?.({id,body,stage:'create_pending'});
  try{job=await this.request(route,'PUT',body);}catch{job=await this.request(route,'PUT',body);}
  const lease=job.lease;if(typeof lease!=='string')throw new Error('Broker lease missing');context.onLease?.({id,body,lease,stage:'accepted'});
  let cancelled=false;let cancelPromise:Promise<unknown>|undefined;const stop=()=>{cancelled=true;cancelPromise=this.request(route+'/cancel','POST',{},lease);cancelPromise.catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
  try{
   if(signal?.aborted)stop();else{await this.request(route+'/input','PUT',input,lease);if(!cancelled)await this.request(route+'/start','POST',{},lease);}
   while(true){job=await this.request(route,'GET',undefined,lease);if(job.lease!==lease||job.bindingHash!==context.bindingHash||job.generation!==context.generation)throw new Error('Stale broker generation');
    if(['succeeded','failed','cancelled','interrupted','disposed'].includes(job.status)){if(!job.stopConfirmed)throw new Error('Broker terminal without stop proof');break;}await new Promise(r=>setTimeout(r,100));}
   context.onLease?.({id,body,lease,stage:'stopped',status:job.status});if(cancelled||job.status!=='succeeded')throw new Error('Isolated phase '+job.status);
   const output:any=await this.request(route+'/output','GET',undefined,lease);if(output.version!==1||output.phase!==input.phase)throw new Error('Isolated output does not match fixed phase');return output;
  }catch(error){
   try{const stopped:any=await this.request(route+'/cancel','POST',{},lease);if(!stopped.stopConfirmed){for(let n=0;n<30;n++){const state:any=await this.request(route,'GET',undefined,lease);if(state.stopConfirmed){context.onLease?.({id,body,lease,stage:'stopped',status:state.status});throw error;}await new Promise(r=>setTimeout(r,100));}throw new StopUnconfirmedError();}}
   catch(stopError){if(stopError===error)throw error;if(stopError instanceof StopUnconfirmedError)throw stopError;throw new StopUnconfirmedError();}throw error;
  }finally{signal?.removeEventListener('abort',stop);await cancelPromise?.catch(()=>{});if(job?.stopConfirmed)await this.request(route+'/dispose','POST',{},lease).catch(()=>{});}
 }
 async capabilities(){try{return IsolationCapabilities.parse(await this.request('/internal/isolation/v1/capabilities'));}catch{return IsolationCapabilities.parse({protocolVersion:IsolationProtocolVersion,backend:'docker_linux',ready:false,reasonCodes:['DOCKER_UNAVAILABLE'],toolchainId:null,imageDigest:null,policyHash:null,cacheHash:null,probeRevision:null,platform:null});}}
}

export class StopUnconfirmedError extends Error{constructor(){super('Isolation job stopping is not confirmed; retain cancelling and the execution fence');}}
