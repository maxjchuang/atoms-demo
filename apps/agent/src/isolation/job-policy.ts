import{fileURLToPath}from'node:url';import path from'node:path';import{readFileSync}from'node:fs';
import{sha256}from'../files.js';
export type JobPhase='build'|'browser'|'clean';
export const BROWSER_SECCOMP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../docker/seccomp.browser.json');
export const JOB_POLICY={browserSeccompHash:sha256(readFileSync(BROWSER_SECCOMP)),watchdogSourceHash:sha256(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../docker/watchdog.c'))),revision:'atoms_v03_linux_v2',network:'none',ipc:'private',readOnly:true,uid:10001,gid:10001,watchdogUid:10002,watchdogGid:10002,logDriver:'none',maxJobs:1,
 builder:{exec:true,cpus:'1.5',memory:'2g',pids:'128',jobBytes:1073741824},browser:{exec:false,cpus:'1',memory:'1536m',pids:'256',jobBytes:134217728},tmpBytes:134217728,shm:'256m'} as const;
export const POLICY_HASH=sha256(JSON.stringify(JOB_POLICY));
export function jobCreateArgs(name:string,image:string,phase:JobPhase,lease:string,deadlineAt=Date.now()+(phase==='browser'?90000:180000)){
 if(!/^atoms-v03-job-[a-f0-9]{32}$/.test(name)||!/^sha256:[a-f0-9]{64}$/.test(image)||!/^lease_[a-f0-9]{32}$/.test(lease))throw new Error('Invalid immutable job identity');
 if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=0||deadlineAt>Date.now()+180000)throw new Error('Invalid immutable absolute job deadline');
 const role=phase==='browser'?JOB_POLICY.browser:JOB_POLICY.builder;
 return['create','--name',name,'--label','atoms.owner=atoms-v03','--label',`atoms.lease=${lease}`,'--label',`atoms.phase=${phase}`,'--label',`atoms.deadline-at=${deadlineAt}`,'--env',`ATOMS_JOB_DEADLINE_AT=${deadlineAt}`,'--network','none','--ipc','private','--shm-size','256m','--read-only','--user','10002:10002','--cap-drop','ALL','--security-opt','no-new-privileges:true',...(phase==='browser'?['--security-opt','seccomp='+BROWSER_SECCOMP]:[]),'--cpus',role.cpus,'--memory',role.memory,'--memory-swap',role.memory,'--pids-limit',role.pids,'--ulimit','nofile=2048:2048','--log-driver','none','--tmpfs',`/job:rw,nosuid,nodev,${phase==='browser'?'noexec,':'exec,'}size=${role.jobBytes},nr_inodes=65536,uid=10001,gid=10001`,'--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=134217728,nr_inodes=16384,uid=10001,gid=10001',image];
}

export function assertActualJobPolicy(info:any,phase:JobPhase,imageId:string,expectedDeadlineAt?:number){
 const deadline=Number(info.Config.Env?.find((e:string)=>e.startsWith('ATOMS_JOB_DEADLINE_AT='))?.split('=')[1]);if(!Number.isSafeInteger(deadline)||deadline<=0||(expectedDeadlineAt!==undefined&&deadline!==expectedDeadlineAt)||info.Config.Labels?.['atoms.deadline-at']!==String(deadline)||JSON.stringify(info.Config.Entrypoint)!==JSON.stringify(['/opt/runner/watchdog']))throw new Error('Independent watchdog/deadline missing');
 const c=info.HostConfig,p=phase==='browser'?JOB_POLICY.browser:JOB_POLICY.builder;const memory=phase==='browser'?1610612736:2147483648;
 if(info.Image!==imageId||info.Config.User!=='10002:10002'||!c.ReadonlyRootfs||c.NetworkMode!=='none'||c.IpcMode!=='private'||c.LogConfig?.Type!=='none'||c.Memory!==memory||c.MemorySwap!==memory||c.PidsLimit!==Number(p.pids)||c.NanoCpus!==(phase==='browser'?1000000000:1500000000)||c.Binds?.length||c.VolumesFrom?.length||c.Privileged||c.PidMode==='host'||c.CapAdd?.length||!c.CapDrop?.includes('ALL')||!c.SecurityOpt?.some((s:string)=>s.startsWith('no-new-privileges'))||Object.keys(c.PortBindings||{}).length)throw new Error('Actual Docker job security configuration mismatch');
 const job=c.Tmpfs?.['/job']||'';if(!job.includes(phase==='browser'?'noexec':'exec')||!job.includes('size='+p.jobBytes)||!job.includes('nr_inodes=65536')||!job.includes('nosuid')||!job.includes('nodev'))throw new Error('Actual job tmpfs policy mismatch');
 if(phase==='browser'&&!c.SecurityOpt.some((s:string)=>s.startsWith('seccomp=')))throw new Error('Browser seccomp missing');
 return{deadlineAt:deadline,watchdogSourceHash:JOB_POLICY.watchdogSourceHash,imageDigest:imageId,policyHash:POLICY_HASH,network:c.NetworkMode,logDriver:c.LogConfig.Type,uid:'10001:10001',watchdogUid:info.Config.User,readOnly:c.ReadonlyRootfs,cpuNano:c.NanoCpus,memory:c.Memory,swap:c.MemorySwap,pids:c.PidsLimit,tmpfs:c.Tmpfs,ipc:c.IpcMode,capDrop:c.CapDrop,noNewPrivileges:true,browserSeccompHash:phase==='browser'?JOB_POLICY.browserSeccompHash:null};
}

export function assertActualRunnerIdentity(value:{uid:number;gid:number;watchdogUid:number}){
 if(value.uid!==JOB_POLICY.uid||value.gid!==JOB_POLICY.gid||value.watchdogUid!==JOB_POLICY.watchdogUid)throw new Error('Actual fixed runner/watchdog identity mismatch');
 return{runnerUid:value.uid,runnerGid:value.gid,watchdogUid:value.watchdogUid};
}
