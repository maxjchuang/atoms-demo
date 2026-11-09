import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {IsolationProtocolVersion} from '@atoms/contracts/isolation';
import {nativeImageInputs,dockerPlatform,nodePlatform,assertNativeImageMetadata,assertJobPlatform,isolatedToolchainId} from '../src/isolation/platform.js';
import {createBroker} from '../src/isolation/broker.js';

const amd64={OSType:'linux',Architecture:'x86_64'},arm64={OSType:'linux',Architecture:'aarch64'};
const toolchain={os:'linux',arch:'x64',nodeVersion:'26.5.0',pnpmVersion:'10.33.0'};
test('native architecture selects independently pinned official child manifests for both supported platforms',()=>{
 const amd=nativeImageInputs(amd64),arm=nativeImageInputs(arm64);
 assert.equal(amd.platform,'linux/amd64');assert.equal(arm.platform,'linux/arm64');
 assert.match(amd.nodeBase,/607728e8751f69809c871e2cfa65d645f51ffacb5a0e9fc60f4cb7404ee5c16a$/);
 assert.match(amd.playwrightBase,/42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2$/);
 assert.match(arm.nodeBase,/9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67$/);
 assert.match(arm.playwrightBase,/0dbd754198e27995355163ddb7e4e0d727eb841eade98df3432cd4daea772e91$/);
 assert.throws(()=>nativeImageInputs({OSType:'linux',Architecture:'riscv64'}));
 assert.throws(()=>nativeImageInputs({OSType:'windows',Architecture:'amd64'}));
 assert.equal(dockerPlatform({OSType:'linux',Architecture:'amd64'}),amd.platform);
 assert.equal(nodePlatform(toolchain),amd.platform);
});
test('image, daemon and measured Node must agree; emulation or version substitutions fail closed',()=>{
 assert.equal(assertNativeImageMetadata(amd64,{Os:'linux',Architecture:'amd64'},toolchain),'linux/amd64');
 assert.equal(assertNativeImageMetadata(arm64,{Os:'linux',Architecture:'arm64'},{...toolchain,arch:'arm64'}),'linux/arm64');
 for(const [daemon,image,actual]of [[amd64,{Os:'linux',Architecture:'arm64'},toolchain],[arm64,{Os:'linux',Architecture:'arm64'},toolchain],[amd64,{Os:'linux',Architecture:'amd64'},{...toolchain,nodeVersion:'22.0.0'}],[amd64,{Os:'linux',Architecture:'amd64'},{...toolchain,pnpmVersion:'10.0.0'}]] as const)assert.throws(()=>assertNativeImageMetadata(daemon,image,actual));
});
test('each isolated result is measured and bound to the certified platform, not a claimed report label',()=>{
 assert.equal(assertJobPlatform(toolchain,'linux/amd64'),toolchain);
 assert.throws(()=>assertJobPlatform({...toolchain,arch:'arm64'},'linux/amd64'));
 assert.throws(()=>assertJobPlatform({...toolchain,nodeVersion:'24.0.0'},'linux/amd64'));
 const digest='sha256:'+'a'.repeat(64),policy='b'.repeat(64);
 assert.match(isolatedToolchainId(digest,policy,'linux/amd64'),/^toolchain_linux_amd64_/);
 assert.match(isolatedToolchainId(digest,policy,'linux/arm64'),/^toolchain_linux_arm64_/);
 assert.notEqual(isolatedToolchainId(digest,policy,'linux/amd64'),isolatedToolchainId(digest,policy,'linux/arm64'));
});
test('Broker uses frozen shared isolation headers and rejects the old protocol without Docker operations',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'atoms-native-broker-version-'));const broker=createBroker({dataDir:dir,token:'synthetic-broker-test-token'});
 await new Promise<void>(r=>broker.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await broker.close();await rm(dir,{recursive:true,force:true});});
 const address=broker.server.address();assert.ok(address&&typeof address!=='string');
 const url='http://127.0.0.1:'+address.port+'/unknown';
 const request=(version:string)=>fetch(url,{headers:{authorization:'Bearer synthetic-broker-test-token','x-atoms-isolation-version':version}});
 const old=await request('0.1.0');assert.equal(old.status,400);assert.equal(old.headers.get('x-atoms-isolation-version'),IsolationProtocolVersion);
 const current=await request(IsolationProtocolVersion);assert.equal(current.status,404);assert.equal(current.headers.get('x-atoms-isolation-version'),IsolationProtocolVersion);
});
