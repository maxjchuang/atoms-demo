/** Official download/build only. No tunnel, credential ingress or host policy changes. */
import{mkdtemp,readFile,writeFile,copyFile,mkdir,rm}from'node:fs/promises';
import{join,resolve}from'node:path';import{tmpdir,homedir}from'node:os';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
import{parseM3Options,privateDirectory,run}from'./m3-lib.mjs';
import{CONNECTOR_VERSION,dockerNativePlatform,platformAssets,assertImagePlatform}from'./m3-platform.mjs';
import{fetchOfficialRelease,verifyReleaseMetadata,verifyConnectorBytes}from'./m3-connector-release.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),options=parseM3Options(process.argv.slice(2),root);
if(options.real)throw new Error('Connector build never takes a provider credential');
await privateDirectory(options.directory);
const platform=await dockerNativePlatform(run,root,process.argv.slice(2)),asset=platformAssets(platform);
const tools=join(homedir(),'.atoms-m3','tools','cloudflared-'+CONNECTOR_VERSION,platform.slice(6));await privateDirectory(tools);
const releaseFile=join(tools,'release.json');let release;
try{release=JSON.parse(await readFile(releaseFile,'utf8'));verifyReleaseMetadata(release,platform);}catch(error){if(error.code!=='ENOENT')throw error;release=await fetchOfficialRelease(platform);await writeFile(releaseFile,JSON.stringify(release,null,2),{mode:0o600,flag:'wx'});}
let bytes;const binary=join(tools,asset.connectorName);
try{bytes=await readFile(binary);}catch(error){if(error.code!=='ENOENT')throw error;let response;for(let n=0;n<3;n++){try{response=await fetch(asset.connectorUrl,{signal:AbortSignal.timeout(120000)});if(response.ok){bytes=Buffer.from(await response.arrayBuffer());break;}}catch{if(n===2)throw new Error('Official connector download failed; no image built');}}if(!bytes)throw new Error('Official connector download failed; no image built');}
verifyConnectorBytes(bytes,platform);await writeFile(binary,bytes,{mode:0o600});
const context=await mkdtemp(join(tmpdir(),'atoms-m3-connector-build-'));
try{
 const dockerfile=await readFile(join(root,'deploy/m3/Dockerfile.connector'));await writeFile(join(context,'Dockerfile'),dockerfile);await copyFile(binary,join(context,'cloudflared-linux'));
 const contextHash=createHash('sha256').update(dockerfile).update(asset.nodeBase).update(platform).update(bytes).digest('hex'),tag='atoms-v03-cloudflared:'+CONNECTOR_VERSION+'-'+asset.connectorSha.slice(0,12);
 await run('docker',['buildx','build','--load','--platform',platform,'--build-arg','NODE_BASE='+asset.nodeBase,'--build-arg','CONNECTOR_SHA='+asset.connectorSha,'--build-arg','SOURCE_CONTEXT='+contextHash,'--tag',tag,context],{cwd:root,capture:false});
 const actual=JSON.parse((await run('docker',['image','inspect','--format','{{json .}}',tag],{cwd:root})).stdout);assertImagePlatform(actual,platform);
 const image=actual.Id,version=(await run('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','65532:65532','--memory','134217728','--cpus','0.5','--pids-limit','64','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',image,'--version'],{cwd:root})).stdout.trim();
 if(!version.includes(CONNECTOR_VERSION))throw new Error('Built connector version mismatch');
 const manifest={version:CONNECTOR_VERSION,source:'https://github.com/cloudflare/cloudflared/tree/'+CONNECTOR_VERSION,release:release.html_url,releaseVerificationSource:release.verificationSource??'saved official release API metadata',url:asset.connectorUrl,binarySha256:asset.connectorSha,binaryBytes:asset.connectorBytes,architecture:platform,nodeBase:asset.nodeBase,tag,imageId:image,contextHash,localVersionOutput:version,sourceState:'working-tree-context',providerCalls:0,tunnelsStarted:0};
 await writeFile(join(options.directory,'connector-image.json'),JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify(manifest));
}finally{await rm(context,{recursive:true,force:true});}
