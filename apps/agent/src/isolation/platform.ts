import {IsolationPlatform,type IsolationPlatformDto} from '@atoms/contracts/isolation';

// Official registry child manifests, not mutable architecture tags or emulated images.
const pins = {
 'linux/arm64': {
  nodeBase:'docker.io/library/node@sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67',
  playwrightBase:'mcr.microsoft.com/playwright@sha256:0dbd754198e27995355163ddb7e4e0d727eb841eade98df3432cd4daea772e91',
 },
 'linux/amd64': {
  nodeBase:'docker.io/library/node@sha256:607728e8751f69809c871e2cfa65d645f51ffacb5a0e9fc60f4cb7404ee5c16a',
  playwrightBase:'mcr.microsoft.com/playwright@sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2',
 },
} as const satisfies Record<IsolationPlatformDto,{nodeBase:string;playwrightBase:string}>;
export function dockerPlatform(info:{OSType?:string;Architecture?:string}):IsolationPlatformDto {
 const arch=info.Architecture==='x86_64'?'amd64':info.Architecture==='aarch64'?'arm64':info.Architecture;
 return IsolationPlatform.parse(info.OSType+'/'+arch);
}
export function nodePlatform(value:{os?:string;arch?:string}):IsolationPlatformDto {
 return IsolationPlatform.parse(value.os+'/'+(value.arch==='x64'?'amd64':value.arch));
}
export function nativeImageInputs(info:{OSType?:string;Architecture?:string}) {
 const platform=dockerPlatform(info);return {platform,...pins[platform]};
}
export function assertNativeImagePlatform(daemon:{OSType?:string;Architecture?:string},image:{Os?:string;Architecture?:string}) {
 const platform=dockerPlatform(daemon);
 if(dockerPlatform({OSType:image.Os,Architecture:image.Architecture})!==platform)throw new Error('Image differs from native Docker platform; emulation is not accepted');
 return platform;
}
export function assertNativeImageMetadata(daemon:{OSType?:string;Architecture?:string},image:{Os?:string;Architecture?:string},value:{os?:string;arch?:string;nodeVersion?:string;pnpmVersion?:string}) {
 const platform=assertNativeImagePlatform(daemon,image);
 if(nodePlatform(value)!==platform||value.nodeVersion!=='26.5.0'||value.pnpmVersion!=='10.33.0')throw new Error('Actual image/toolchain differs from native Docker platform; emulation is not accepted');
 return platform;
}
export function isolatedToolchainId(imageId:string,policyHash:string,platform:IsolationPlatformDto) {
 if(!/^sha256:[a-f0-9]{64}$/.test(imageId)||! /^[a-f0-9]{64}$/.test(policyHash))throw new Error('Immutable image and policy required');
 return 'toolchain_'+IsolationPlatform.parse(platform).replace('/','_')+'_'+imageId.slice(7,23)+'_'+policyHash.slice(0,8);
}
export function assertJobPlatform(value:{os?:string;arch?:string;nodeVersion?:string},platform:IsolationPlatformDto) {
 if(nodePlatform(value)!==platform||value.nodeVersion!=='26.5.0')throw new Error('Measured job platform differs from certified image');
 return value;
}
