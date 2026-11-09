import test from'node:test';import assert from'node:assert/strict';
import{nativePlatform,platformAssets,assertImagePlatform,dockerNativePlatform}from'./m3-platform.mjs';
import{RELEASE_API,RELEASE_PAGE,verifyReleaseMetadata,releaseFromOfficialPage,fetchOfficialRelease,verifyConnectorBytes}from'./m3-connector-release.mjs';
test('native Docker daemon determines platform; unsupported OS/arch and emulation requests fail closed',async()=>{
 assert.equal(nativePlatform({OSType:'linux',Architecture:'x86_64'}),'linux/amd64');assert.equal(nativePlatform({OSType:'linux',Architecture:'aarch64'}),'linux/arm64');
 for(const v of [{OSType:'darwin',Architecture:'arm64'},{OSType:'linux',Architecture:'ppc64le'}])assert.throws(()=>nativePlatform(v));
 assert.throws(()=>nativePlatform({OSType:'linux',Architecture:'x86_64'},'linux/arm64'),/emulation/);assert.throws(()=>assertImagePlatform({Os:'linux',Architecture:'arm64'},'linux/amd64'));
 const queried=[];assert.equal(await dockerNativePlatform(async(cmd,args)=>{queried.push([cmd,args]);return{stdout:JSON.stringify({OSType:'linux',Architecture:'x86_64'})};},'/repo',['--platform','linux/amd64']),'linux/amd64');assert.equal(queried[0][0],'docker');
});
test('per-platform official assets bind independent Node child manifest, executable hash/size and ELF machine',()=>{
 const amd=platformAssets('linux/amd64'),arm=platformAssets('linux/arm64');assert.notEqual(amd.nodeBase,arm.nodeBase);assert.equal(amd.elfMachine,62);assert.equal(arm.elfMachine,183);assert.equal(amd.connectorBytes,40274445);assert.equal(arm.connectorBytes,37667293);assert.match(amd.nodeDigest,/^sha256:[0-9a-f]{64}$/);assert.match(amd.connectorUrl,/\/2026\.10\.7\/cloudflared-linux-amd64$/);assert.throws(()=>platformAssets('linux/386'));assert.throws(()=>verifyConnectorBytes(Buffer.alloc(16),'linux/amd64'),/mismatch/);
});
test('fresh official release bootstrap verifies API metadata and falls back to official HTML only with pinned checksum',async()=>{
 const a=platformAssets('linux/amd64'),html='<pre>cloudflared-linux-amd64: '+a.connectorSha+'</pre>',fromHtml=releaseFromOfficialPage(html,'linux/amd64');assert.equal(verifyReleaseMetadata(fromHtml,'linux/amd64').size,a.connectorBytes);assert.equal(fromHtml.verificationSource,RELEASE_PAGE);
 const requested=[];const r=await fetchOfficialRelease('linux/amd64',async url=>{requested.push(url);return url===RELEASE_API?{ok:false,status:403}:{ok:true,text:async()=>html};});assert.equal(r.verificationSource,RELEASE_PAGE);assert.deepEqual(requested,[RELEASE_API,RELEASE_PAGE]);
 const api=await fetchOfficialRelease('linux/amd64',async url=>{assert.equal(url,RELEASE_API);return{ok:true,json:async()=>({...fromHtml,verificationSource:undefined})};});assert.equal(api.verificationSource,RELEASE_API);
 await assert.rejects(fetchOfficialRelease('linux/amd64',async()=>({ok:false})),/official connector release metadata/);
 for(const mutation of [{tag_name:'latest'},{html_url:'https://evil.test'},{assets:[{...fromHtml.assets[0],digest:'sha256:'+'0'.repeat(64)}]},{assets:[{...fromHtml.assets[0],size:1}]},{verificationSource:'https://evil.test'}])assert.throws(()=>verifyReleaseMetadata({...fromHtml,...mutation},'linux/amd64'));
 assert.throws(()=>releaseFromOfficialPage(html.replace(a.connectorSha,'0'.repeat(64)),'linux/amd64'));assert.throws(()=>verifyReleaseMetadata(fromHtml,'linux/arm64'));
});
