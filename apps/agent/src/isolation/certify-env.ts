import path from'node:path';
// Administrator-selected nonsecret probe settings; never forward arbitrary process env.
export function probeEnvironment(env:NodeJS.ProcessEnv,imageDigest:string,tmpdir:string):NodeJS.ProcessEnv{
 if(!/^sha256:[a-f0-9]{64}$/.test(imageDigest)||!path.isAbsolute(tmpdir))throw new Error('Probe requires pinned image digest and absolute private scratch');
 return{...Object.fromEntries(Object.entries(env).filter(([k])=>['PATH','HOME','DOCKER_HOST','DOCKER_CONTEXT'].includes(k))),JOB_IMAGE:imageDigest,TMPDIR:tmpdir};
}
