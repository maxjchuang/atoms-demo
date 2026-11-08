/** Cached preview capabilities may rotate; application/version evidence must not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApi,hash} from '../src/server.js';
import {createFakeDeliveryRuntime} from '../src/fake-delivery-runtime.js';
import {DeliveryProtocolVersion} from '@atoms/contracts/delivery';

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'atoms-preview-refresh-')),runtime=createFakeDeliveryRuntime();
 const address=await runtime.app.listen({host:'127.0.0.1',port:0});
 let settings={previewSecret:'first-preview-test-secret',previewOrigin:'http://127.0.0.1:3002'};
 const base={dataDir:directory,agentUrl:address,serviceToken:'delivery-test-token',autoSchedule:false,deliveryToolchain:runtime.toolchain};
 let api=await createApi({...base,...settings}),cookie='';api.seedCode('preview-demo');
 const request=async(method:'GET'|'POST',url:string,body?:object)=>{
  const response=await api.app.inject({method,url,headers:{cookie,'idempotency-key':randomUUID(),'x-atoms-delivery-version':DeliveryProtocolVersion},...(body?{payload:body}:{})});
  return {status:response.statusCode,headers:response.headers,bytes:response.rawPayload,data:response.headers['content-type']?.includes('application/json')?response.json():null};
 };
 const login=await request('POST','/api/v1/sessions',{code:'preview-demo'});assert.equal(login.status,201);cookie=String(login.headers['set-cookie']).split(';')[0];
 const project=(await request('POST','/api/v1/projects',{title:'Preview metadata fixture'})).data;
 const created=(await request('POST',`/api/v1/projects/${project.id}/runs`,{prompt:'Synthetic preview refresh fixture',mode:'build'})).data;
 for(let n=0;n<5&&api.store.state.runs[0].dto.status!=='succeeded';n++)await api.tick();
 assert.equal(api.store.state.runs[0].dto.status,'succeeded');const versionId=api.store.state.runs[0].dto.resultVersionId!;
 const workspace=async()=>{const response=await request('GET',`/api/v1/projects/${project.id}/workspace`);assert.equal(response.status,200);return response.data;};
 const invariant=async()=>{
  const versions=api.store.state.versions.map(v=>{const {previewUrl:_url,previewExpiresAt:_expiry,...dto}=v.dto;return {...v,dto};});
  const fileHashes:Record<string,string>={};for(const version of api.store.state.versions)for(const file of version.manifest.files)fileHashes[version.dto.id+':'+file.path]=hash(await readFile(join(version.directory,file.path)));
  return {business:JSON.stringify({projects:api.store.state.projects,runs:api.store.state.runs,versions,events:api.store.state.events,coordination:api.store.state.coordination}),fileHashes,
   quota:(await request('GET','/api/v1/session')).data.quota,archive:(await request('GET',`/api/delivery/v1/versions/${versionId}/source.zip`)).bytes,
   report:(await request('GET',`/api/delivery/v1/versions/${versionId}`)).data.report};
 };
 return {runtime,project,versionId,request,workspace,invariant,get api(){return api;},get settings(){return settings;},
  async restart(changes:Partial<typeof settings>={}){await api.close();settings={...settings,...changes};api=await createApi({...base,...settings});},
  async close(){await api.close();await runtime.app.close();await rm(directory,{recursive:true,force:true});}};
}

test('preview secret rotation refreshes an unexpired cached URL; old signature is rejected and source/evidence/counts stay unchanged',async()=>{
 const f=await fixture();try{
  const old=(await f.workspace()).currentVersion;assert.ok(Date.parse(old.previewExpiresAt)-Date.now()>3600000);
  const before=await f.invariant();await f.restart({previewSecret:'rotated-preview-test-secret'});
  assert.equal((await f.api.preview.inject(new URL(old.previewUrl).pathname)).statusCode,403);
  const current=(await f.workspace()).currentVersion;assert.equal(current.id,old.id);assert.notEqual(current.previewUrl,old.previewUrl);
  assert.equal(new URL(current.previewUrl).origin,f.settings.previewOrigin);
  assert.equal((await f.api.preview.inject(new URL(current.previewUrl).pathname)).statusCode,200);
  for(let n=0;n<3;n++)assert.equal((await f.workspace()).currentVersion.previewUrl,current.previewUrl);
  assert.deepEqual(await f.invariant(),before);assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);
 }finally{await f.close();}
});

test('configured origin change refreshes an unexpired URL once; ordinary polls/list/restart reuse the valid current capability',async()=>{
 const f=await fixture();try{
  const old=(await f.workspace()).currentVersion,before=await f.invariant();
  await f.restart({previewOrigin:'https://new-preview.example.test'});
  const current=(await f.workspace()).currentVersion;assert.equal(current.id,old.id);assert.notEqual(current.previewUrl,old.previewUrl);
  assert.equal(new URL(current.previewUrl).origin,'https://new-preview.example.test');assert.ok(Date.parse(current.previewExpiresAt)-Date.now()>3600000);
  assert.equal((await f.api.preview.inject(new URL(current.previewUrl).pathname)).statusCode,200);
  for(let n=0;n<3;n++){
   assert.equal((await f.workspace()).currentVersion.previewUrl,current.previewUrl);
   const listed=(await f.request('GET',`/api/v1/projects/${f.project.id}/versions`)).data.items.find((v:{id:string})=>v.id===f.versionId);
   assert.equal(listed.previewUrl,current.previewUrl);
  }
  await f.restart();assert.equal((await f.workspace()).currentVersion.previewUrl,current.previewUrl);
  assert.deepEqual(await f.invariant(),before);assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);
 }finally{await f.close();}
});

test('near-expiry valid capability refreshes once without new Run/Version/usage or source mutations',async()=>{
 const f=await fixture();try{
  const before=await f.invariant(),expiresAt=new Date(Date.now()+30000).toISOString();
  const payload=Buffer.from(JSON.stringify({versionId:f.versionId,exp:Date.parse(expiresAt)})).toString('base64url');
  const signature=createHmac('sha256',f.settings.previewSecret).update(payload).digest('base64url');
  const oldUrl=`${f.settings.previewOrigin}/p/${payload}.${signature}/index.html`;
  f.api.store.transaction(()=>{const version=f.api.store.state.versions.find(v=>v.dto.id===f.versionId)!;version.dto={...version.dto,previewExpiresAt:expiresAt,previewUrl:oldUrl};});
  assert.equal((await f.api.preview.inject(new URL(oldUrl).pathname)).statusCode,200);
  const current=(await f.workspace()).currentVersion;assert.notEqual(current.previewUrl,oldUrl);assert.ok(Date.parse(current.previewExpiresAt)-Date.now()>3600000);
  assert.equal((await f.api.preview.inject(new URL(current.previewUrl).pathname)).statusCode,200);
  assert.equal((await f.workspace()).currentVersion.previewUrl,current.previewUrl);
  assert.deepEqual(await f.invariant(),before);assert.equal(f.runtime.prepareCalls,1);assert.equal(f.runtime.executeCalls,1);
 }finally{await f.close();}
});
