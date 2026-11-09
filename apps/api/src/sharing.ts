import type {FastifyInstance,FastifyRequest} from 'fastify';
import {SharingDescriptor,SharingDescriptorQuery,ResolveSharingRequest,ResolvedSharing,SharingProtocolVersion} from '@atoms/contracts/sharing';
import type {PublicProfile} from './public-profile.js';
import type {ProjectRecord,SessionRecord,VersionRecord,Store} from './store.js';
interface Host {app:FastifyInstance;store:Store;profile?:PublicProfile;authorize:(r:FastifyRequest)=>SessionRecord;ownProject:(id:string,s:SessionRecord)=>ProjectRecord;ownVersion:(id:string,s:SessionRecord)=>VersionRecord;
 fail:(status:number,code:string,message:string)=>never;freshVersion:(v:VersionRecord)=>VersionRecord['dto'];now:()=>string}
export function registerSharing(h:Host){
 const base='/api/sharing/v1',attempts=new Map<string,{since:number;count:number}>();
 const hostFacts=()=>{const deployment=h.profile?.deployment();return {scope:deployment?.ready?'public' as const: h.profile?'unavailable' as const:'local_only' as const,publicDeployment:!!deployment?.ready};};
 h.app.addHook('onRequest',async(r,reply)=>{if(r.url.startsWith(base+'/')){reply.header('X-Atoms-Sharing-Version',SharingProtocolVersion);if(r.headers['x-atoms-sharing-version']!==SharingProtocolVersion)h.fail(400,'INVALID_REQUEST','Sharing protocol header required');}});
 const owned=(r:FastifyRequest)=>{const session=h.authorize(r);const project=h.ownProject(String((r.params as {projectId:string}).projectId),session);return {session,project};};
 h.app.get(base+'/projects/:projectId',r=>{const {session,project}=owned(r),query=SharingDescriptorQuery.parse(r.query);const version=query.versionId?h.ownVersion(query.versionId,session):h.store.state.versions.find(v=>v.dto.id===project.dto.currentVersionId);if(version&&version.dto.projectId!==project.dto.id)h.fail(404,'NOT_FOUND','Version not found');
  const deployment=h.profile?.deployment(),scope=deployment?.ready?'public_temporary':h.profile?'unavailable':'local_only',isPublic=scope==='public_temporary';
  const reason=isPublic?null:scope==='local_only'?'LOCAL_ONLY':'DEPLOYMENT_UNAVAILABLE';const receipt=deployment?.verification,verified=isPublic&&version&&receipt?.subjectVersionId===version.dto.id&&receipt.deploymentInstanceId===deployment!.deploymentInstanceId;
  return SharingDescriptor.parse({protocolVersion:SharingProtocolVersion,projectId:project.dto.id,subjectVersionId:version?.dto.id??null,deploymentInstanceId:deployment?.deploymentInstanceId??'deployment_local',asOf:h.now(),scope,temporary:isPublic,
   appPreview:{available:isPublic&&!!version,reasonCode:reason??(version?null:'NO_PUBLISHED_VERSION'),audience:'anyone_with_link',capabilityTtlSeconds:isPublic&&version?(h.profile?.previewTtlSeconds??900):null},
   buildEntry:{available:isPublic,reasonCode:reason,audience:'experience_code_required',requiresExperienceCode:true},externalVerification:{status:verified?'verified':'unverified',verifiedAt:verified?receipt!.verifiedAt:null,subjectVersionId:verified?version!.dto.id:null}});
 });
 h.app.post(base+'/projects/:projectId/resolve',(r)=>{const {session,project}=owned(r),body=ResolveSharingRequest.parse(r.body),deployment=h.profile?.deployment();
  const version=body.kind==='app_preview'?h.ownVersion(body.versionId,session):undefined;if(version&&version.dto.projectId!==project.dto.id)h.fail(404,'NOT_FOUND','Version not found');
  if(body.expectedDeploymentInstanceId!==(deployment?.deploymentInstanceId??'deployment_local'))h.fail(409,'CONFLICT','部署代际已变化，请刷新后重新复制链接');
  if(!h.profile)h.fail(409,'CONFLICT','当前仅本机运行，没有公网分享入口');if(!deployment?.ready)h.fail(503,'RUNTIME_UNAVAILABLE','公开部署尚未就绪');
  const previous=attempts.get(session.codeId),stamp=Date.now();if(!previous||stamp-previous.since>=60000)attempts.set(session.codeId,{since:stamp,count:1});else if(++previous.count>30)h.fail(429,'RATE_LIMITED','链接解析过于频繁，请稍后再试');
  const common={protocolVersion:SharingProtocolVersion,kind:body.kind,projectId:project.dto.id,deploymentInstanceId:deployment!.deploymentInstanceId,scope:'public_temporary',temporary:true};
  if(body.kind==='build_entry')return ResolvedSharing.parse({...common,issuedAt:h.now(),kind:'build_entry',audience:'experience_code_required',requiresExperienceCode:true,url:deployment!.workbenchOrigin+'/',expiresAt:null});
  const dto=h.freshVersion(version!);const url=new URL(dto.previewUrl);if(url.origin!==deployment!.previewOrigin)h.fail(503,'RUNTIME_UNAVAILABLE','预览地址尚未更新');
  return ResolvedSharing.parse({...common,issuedAt:h.now(),kind:'app_preview',subjectVersionId:version!.dto.id,audience:'anyone_with_link',url:dto.previewUrl,expiresAt:dto.previewExpiresAt});
 });
 return {hostFacts};
}
