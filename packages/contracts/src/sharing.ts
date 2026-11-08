/** M3 browser-only sharing contracts. Existing execution/conversation/delivery DTOs remain unchanged. */
import {z} from 'zod';
import {ApiError,Id,Timestamp} from './index.js';

export const SharingProtocolVersion='0.1.0' as const;
export const SHARING_LIMITS=Object.freeze({maxCapabilityTtlSeconds:900,maxUrlCharacters:4096});
const Version=z.literal(SharingProtocolVersion);
export const SharingScope=z.enum(['local_only','public_temporary','unavailable']);
export const SharingReason=z.enum(['LOCAL_ONLY','NO_PUBLISHED_VERSION','DEPLOYMENT_UNAVAILABLE']);
export const SharingDescriptorQuery=z.object({versionId:Id.optional()}).strict();
const Availability={available:z.boolean(),reasonCode:SharingReason.nullable()};

/** Authority is checked against host configuration by the API, never supplied by a model. */
export const SharingHttpsUrl=z.string().min(1).max(SHARING_LIMITS.maxUrlCharacters).url().superRefine((value,ctx)=>{
 let url:URL;try{url=new URL(value);}catch{return;}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||/[?#\s\u0000-\u001f\u007f]/.test(value))ctx.addIssue({code:'custom',message:'Sharing URL requires HTTPS without userinfo, query, fragment or whitespace'});
});
export const AppPreviewSharingUrl=SharingHttpsUrl.refine(value=>{
 try{return /^\/p\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/index\.html$/.test(new URL(value).pathname);}catch{return false;}
},'App preview URL must use the fixed signed preview path');
export const BuildEntrySharingUrl=SharingHttpsUrl.refine(value=>{
 try{return new URL(value).pathname==='/';}catch{return false;}
},'Build entry URL must be the workbench root login entry');

export const SharingDescriptor=z.object({
 protocolVersion:Version,projectId:Id,subjectVersionId:Id.nullable(),deploymentInstanceId:Id,asOf:Timestamp,
 scope:SharingScope,temporary:z.boolean(),
 appPreview:z.object({...Availability,audience:z.literal('anyone_with_link'),capabilityTtlSeconds:z.number().int().min(1).max(SHARING_LIMITS.maxCapabilityTtlSeconds).nullable()}).strict(),
 buildEntry:z.object({...Availability,audience:z.literal('experience_code_required'),requiresExperienceCode:z.literal(true)}).strict(),
 externalVerification:z.object({status:z.enum(['unverified','verified']),verifiedAt:Timestamp.nullable(),subjectVersionId:Id.nullable()}).strict(),
}).strict().superRefine((descriptor,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 if(descriptor.temporary!==(descriptor.scope==='public_temporary'))issue('Temporary must exactly reflect public temporary scope');
 for(const availability of [descriptor.appPreview,descriptor.buildEntry]){
  if(availability.available!==(availability.reasonCode===null))issue('Availability must have a reason exactly when unavailable');
  if(availability.available&&descriptor.scope!=='public_temporary')issue('Sharing is only available in public temporary scope');
 }
 if(descriptor.appPreview.available){
  if(descriptor.subjectVersionId===null||descriptor.appPreview.capabilityTtlSeconds===null)issue('Available preview requires an exact published subject and bounded TTL');
 }else if(descriptor.appPreview.capabilityTtlSeconds!==null)issue('Unavailable preview must not promise a capability TTL');
 const verification=descriptor.externalVerification;
 if(verification.status==='verified'){
  if(descriptor.scope!=='public_temporary'||descriptor.subjectVersionId===null||verification.verifiedAt===null||verification.subjectVersionId!==descriptor.subjectVersionId)issue('External verification needs the current public deployment and exact version receipt');
 }else if(verification.verifiedAt!==null||verification.subjectVersionId!==null)issue('Unverified must not invent a verification time or subject');
});

export const ResolveSharingRequest=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('app_preview'),versionId:Id,expectedDeploymentInstanceId:Id}).strict(),
 z.object({kind:z.literal('build_entry'),expectedDeploymentInstanceId:Id}).strict(),
]);
const ResolvedCommon={protocolVersion:Version,projectId:Id,deploymentInstanceId:Id,
 scope:z.literal('public_temporary'),temporary:z.literal(true),issuedAt:Timestamp};
export const ResolvedSharing=z.discriminatedUnion('kind',[
 z.object({...ResolvedCommon,kind:z.literal('app_preview'),subjectVersionId:Id,audience:z.literal('anyone_with_link'),url:AppPreviewSharingUrl,expiresAt:Timestamp}).strict(),
 z.object({...ResolvedCommon,kind:z.literal('build_entry'),audience:z.literal('experience_code_required'),requiresExperienceCode:z.literal(true),url:BuildEntrySharingUrl,expiresAt:z.null()}).strict(),
]).superRefine((result,ctx)=>{
 if(result.kind==='app_preview'){
  const ttl=Date.parse(result.expiresAt)-Date.parse(result.issuedAt);
  if(ttl<=0||ttl>SHARING_LIMITS.maxCapabilityTtlSeconds*1000)ctx.addIssue({code:'custom',message:'Preview expiry must be after issue and within the fixed capability TTL'});
 }
});
/** Reuses existing error codes; does not add variants to any old strict contract. */
export const SharingApiError=ApiError;
export type SharingDescriptorQueryDto=z.infer<typeof SharingDescriptorQuery>;
export type SharingDescriptorDto=z.infer<typeof SharingDescriptor>;
export type ResolveSharingRequestDto=z.infer<typeof ResolveSharingRequest>;
export type ResolvedSharingDto=z.infer<typeof ResolvedSharing>;
