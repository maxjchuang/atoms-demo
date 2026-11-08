import test from 'node:test';
import assert from 'node:assert/strict';
import {PROTOCOL_VERSION,Run,Version} from '../src/index.js';
import {CoordinationProtocolVersion,ResolvedAction} from '../src/conversation.js';
import {DeliveryProtocolVersion} from '../src/delivery.js';
import {SharingProtocolVersion,SharingDescriptor,SharingDescriptorQuery,ResolveSharingRequest,ResolvedSharing,SharingHttpsUrl,SharingApiError} from '../src/sharing.js';
import * as f from '../src/sharing-fixtures.js';
import {run,version} from '../src/fixtures.js';
const clone=<T>(v:T):T=>structuredClone(v);

test('sharing is an isolated browser-only protocol and old strict contracts keep their shapes',()=>{
 assert.equal(SharingProtocolVersion,'0.1.0');assert.equal(PROTOCOL_VERSION,'0.1.0');assert.equal(CoordinationProtocolVersion,'0.2.0');assert.equal(DeliveryProtocolVersion,'0.1.0');
 Run.parse(run);Version.parse(version);assert.equal(Run.safeParse({...run,deploymentInstanceId:'deployment_demo_epoch'}).success,false);
 assert.equal(ResolvedAction.safeParse({kind:'app_preview',url:f.preview.url}).success,false);
});
test('descriptor distinguishes configured/unverified, receipt-verified, local, unavailable and no-version states',()=>{
 for(const value of [f.configured,f.externallyVerified,f.localOnly,f.unavailable,f.noPublishedVersion])SharingDescriptor.parse(value);
 assert.equal(f.configured.externalVerification.status,'unverified');assert.equal(f.noPublishedVersion.appPreview.available,false);assert.equal(f.noPublishedVersion.buildEntry.available,true);
 assert.equal(SharingDescriptorQuery.parse({}).versionId,undefined);assert.equal(SharingDescriptorQuery.safeParse({versionId:'../private'}).success,false);
});
test('temporary and availability invariants cannot turn local or unavailable services into public links',()=>{
 for(const value of [{...f.configured,temporary:false},{...f.localOnly,temporary:true},{...f.unavailable,temporary:true},
  {...f.localOnly,appPreview:f.configured.appPreview},{...f.unavailable,buildEntry:f.configured.buildEntry},
  {...f.configured,appPreview:{...f.configured.appPreview,reasonCode:'LOCAL_ONLY'}},
  {...f.localOnly,buildEntry:{...f.localOnly.buildEntry,reasonCode:null}}])assert.equal(SharingDescriptor.safeParse(value).success,false);
});
test('available preview requires an exact subject and TTL 1..900; unavailable does not promise TTL',()=>{
 assert.equal(SharingDescriptor.safeParse({...f.configured,subjectVersionId:null}).success,false);
 for(const ttl of [null,0,901,1.5])assert.equal(SharingDescriptor.safeParse({...f.configured,appPreview:{...f.configured.appPreview,capabilityTtlSeconds:ttl}}).success,false);
 assert.equal(SharingDescriptor.safeParse({...f.localOnly,appPreview:{...f.localOnly.appPreview,capabilityTtlSeconds:900}}).success,false);
 SharingDescriptor.parse({...f.configured,appPreview:{...f.configured.appPreview,capabilityTtlSeconds:1}});
});
test('configuration alone is not verification; a public receipt must match the exact nonnull subject',()=>{
 for(const value of [
  {...f.configured,externalVerification:{status:'verified',verifiedAt:null,subjectVersionId:f.configured.subjectVersionId}},
  {...f.externallyVerified,externalVerification:{...f.externallyVerified.externalVerification,subjectVersionId:'version_other'}},
  {...f.externallyVerified,subjectVersionId:null},
  {...f.localOnly,externalVerification:f.externallyVerified.externalVerification},
  {...f.configured,externalVerification:{status:'unverified',verifiedAt:f.configured.asOf,subjectVersionId:null}},
  {...f.configured,externalVerification:{status:'unverified',verifiedAt:null,subjectVersionId:f.configured.subjectVersionId}},
 ])assert.equal(SharingDescriptor.safeParse(value).success,false);
});
test('descriptor remains URL-free and does not accept codes, storage isolation claims or model navigation',()=>{
 for(const extra of [{url:f.preview.url},{experienceCode:'not-a-real-code'},{shareId:'share_unapproved'},{storageIsolation:'per_project'}])assert.equal(SharingDescriptor.safeParse({...f.configured,...extra}).success,false);
 assert.equal(JSON.stringify(f.configured).includes('https://'),false);assert.equal(SharingDescriptor.safeParse({...f.configured,appPreview:{...f.configured.appPreview,url:f.preview.url}}).success,false);
});
test('resolve request is strict, fixes preview subject and always carries expected deployment epoch',()=>{
 ResolveSharingRequest.parse(f.previewRequest);ResolveSharingRequest.parse(f.buildEntryRequest);
 for(const value of [{kind:'app_preview',expectedDeploymentInstanceId:f.configured.deploymentInstanceId},
  {kind:'app_preview',versionId:f.configured.subjectVersionId},{kind:'build_entry'},
  {...f.buildEntryRequest,versionId:f.configured.subjectVersionId},{...f.previewRequest,url:'https://evil.example/'},
  {...f.buildEntryRequest,createRun:true}])assert.equal(ResolveSharingRequest.safeParse(value).success,false);
});
test('HTTPS links cannot carry credentials, query, fragment, unsafe protocol or whitespace',()=>{
 for(const url of ['http://host.example/','javascript:alert(1)','file:///private','https://user:password@host.example/','https://host.example/?code=secret','https://host.example/#session','https://host.example/?','https://host.example/#',' https://host.example/','https://host.example/\n'])assert.equal(SharingHttpsUrl.safeParse(url).success,false,url);
});
test('preview path is exactly the existing signed capability index and expiry is bounded from issue time',()=>{
 ResolvedSharing.parse(f.preview);
 for(const path of ['/','/api/v1/session','/p/payload/index.html','/p/payload.signature/source.zip','/p/payload.signature/../index.html','/p/payload.signature/%69ndex.html'])assert.equal(ResolvedSharing.safeParse({...f.preview,url:'https://preview.example.test'+path}).success,false,path);
 for(const expiresAt of [f.preview.issuedAt,'2026-11-09T02:59:59.000Z','2026-11-09T03:15:00.001Z'])assert.equal(ResolvedSharing.safeParse({...f.preview,expiresAt}).success,false);
 assert.equal(ResolvedSharing.safeParse({...f.preview,subjectVersionId:null}).success,false);
});
test('build entry is the root login page, not an invitation credential or permission grant',()=>{
 ResolvedSharing.parse(f.buildEntry);assert.equal(f.buildEntry.expiresAt,null);assert.equal(f.buildEntry.temporary,true);
 for(const value of [{...f.buildEntry,url:'https://workbench.example.test/invite'},{...f.buildEntry,url:'https://workbench.example.test/#/projects/project_demo'},
  {...f.buildEntry,requiresExperienceCode:false},{...f.buildEntry,audience:'anyone_with_link'},
  {...f.buildEntry,expiresAt:'2026-11-09T03:15:00.000Z'},{...f.buildEntry,temporary:false},{...f.buildEntry,session:'not-a-real-session'}])assert.equal(ResolvedSharing.safeParse(value).success,false);
});
test('sharing uses existing typed error codes and epoch conflict is explicit without new status variants',()=>{
 SharingApiError.parse(f.staleEpoch);assert.equal(f.staleEpoch.error.code,'CONFLICT');assert.equal(SharingApiError.safeParse({error:{...f.staleEpoch.error,code:'NEW_SHARING_STATUS'}}).success,false);
});
