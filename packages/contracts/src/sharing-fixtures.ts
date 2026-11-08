/** Synthetic wire examples only: no active tunnel, real capability, code or provider credential. */
import {SharingProtocolVersion,SharingDescriptor,ResolveSharingRequest,ResolvedSharing,SharingApiError} from './sharing.js';
const asOf='2026-11-09T03:00:00.000Z';
const identity={protocolVersion:SharingProtocolVersion,projectId:'project_public_demo',subjectVersionId:'version_published_demo',deploymentInstanceId:'deployment_demo_epoch',asOf};
const unverified={status:'unverified' as const,verifiedAt:null,subjectVersionId:null};
export const configured=SharingDescriptor.parse({...identity,scope:'public_temporary',temporary:true,
 appPreview:{available:true,reasonCode:null,audience:'anyone_with_link',capabilityTtlSeconds:900},
 buildEntry:{available:true,reasonCode:null,audience:'experience_code_required',requiresExperienceCode:true},externalVerification:unverified});
export const externallyVerified=SharingDescriptor.parse({...configured,externalVerification:{status:'verified',verifiedAt:asOf,subjectVersionId:configured.subjectVersionId}});
export const noPublishedVersion=SharingDescriptor.parse({...configured,subjectVersionId:null,
 appPreview:{...configured.appPreview,available:false,reasonCode:'NO_PUBLISHED_VERSION',capabilityTtlSeconds:null}});
export const localOnly=SharingDescriptor.parse({...configured,scope:'local_only',temporary:false,
 appPreview:{...configured.appPreview,available:false,reasonCode:'LOCAL_ONLY',capabilityTtlSeconds:null},
 buildEntry:{...configured.buildEntry,available:false,reasonCode:'LOCAL_ONLY'}});
export const unavailable=SharingDescriptor.parse({...configured,scope:'unavailable',temporary:false,
 appPreview:{...configured.appPreview,available:false,reasonCode:'DEPLOYMENT_UNAVAILABLE',capabilityTtlSeconds:null},
 buildEntry:{...configured.buildEntry,available:false,reasonCode:'DEPLOYMENT_UNAVAILABLE'}});
export const previewRequest=ResolveSharingRequest.parse({kind:'app_preview',versionId:configured.subjectVersionId,expectedDeploymentInstanceId:configured.deploymentInstanceId});
export const buildEntryRequest=ResolveSharingRequest.parse({kind:'build_entry',expectedDeploymentInstanceId:configured.deploymentInstanceId});
export const preview=ResolvedSharing.parse({protocolVersion:SharingProtocolVersion,kind:'app_preview',projectId:configured.projectId,
 subjectVersionId:configured.subjectVersionId,deploymentInstanceId:configured.deploymentInstanceId,scope:'public_temporary',temporary:true,
 audience:'anyone_with_link',issuedAt:asOf,url:'https://preview-demo.example.test/p/fixture_payload.fixture_signature/index.html',expiresAt:'2026-11-09T03:15:00.000Z'});
export const buildEntry=ResolvedSharing.parse({protocolVersion:SharingProtocolVersion,kind:'build_entry',projectId:configured.projectId,
 deploymentInstanceId:configured.deploymentInstanceId,scope:'public_temporary',temporary:true,audience:'experience_code_required',requiresExperienceCode:true,
 issuedAt:asOf,url:'https://workbench-demo.example.test/',expiresAt:null});
export const staleEpoch=SharingApiError.parse({error:{code:'CONFLICT',message:'Deployment instance changed; refresh the descriptor before resolving.',retryable:false,requestId:'request_stale_epoch'}});
