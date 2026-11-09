/** Reviewed native platform assets. No caller-selected image, checksum or executable URL. */
export const CONNECTOR_VERSION='2026.10.7';
export const PLATFORM_ASSETS=Object.freeze({
 'linux/arm64':Object.freeze({nodeDigest:'sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67',connectorName:'cloudflared-linux-arm64',connectorSha:'3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775',connectorBytes:37667293,elfMachine:183}),
 'linux/amd64':Object.freeze({nodeDigest:'sha256:607728e8751f69809c871e2cfa65d645f51ffacb5a0e9fc60f4cb7404ee5c16a',connectorName:'cloudflared-linux-amd64',connectorSha:'1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',connectorBytes:40274445,elfMachine:62}),
});
export function platformAssets(platform){const value=PLATFORM_ASSETS[platform];if(!value)throw new Error('Only reviewed native Linux arm64/amd64 platforms are supported');return{platform,...value,nodeBase:'docker.io/library/node:26.5.0-bookworm-slim@'+value.nodeDigest,connectorUrl:'https://github.com/cloudflare/cloudflared/releases/download/'+CONNECTOR_VERSION+'/'+value.connectorName};}
export function nativePlatform(info,requested){
 const os=info.OSType??info.Os,arch=info.Architecture;
 const architecture={aarch64:'arm64',arm64:'arm64',x86_64:'amd64',amd64:'amd64'}[arch];
 const actual=os==='linux'&&architecture?'linux/'+architecture:null;
 platformAssets(actual);if(requested&&requested!==actual)throw new Error('Requested platform differs from the native Docker daemon; emulation is not acceptance evidence');return actual;
}
export function assertImagePlatform(actual,platform){platformAssets(platform);if(actual.Os!=='linux'||actual.Architecture!==platform.slice(6))throw new Error('Actual Docker image platform differs from reviewed native platform');}
export async function dockerNativePlatform(run,root,args=[]){const i=args.indexOf('--platform');if(i>=0&&!args[i+1])throw new Error('Explicit platform argument is missing');return nativePlatform(JSON.parse((await run('docker',['info','--format','{{json .}}'],{cwd:root})).stdout),i<0?null:args[i+1]);}
