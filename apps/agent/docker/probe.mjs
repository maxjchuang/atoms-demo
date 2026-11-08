import fs from 'node:fs';import net from'node:net';
const read=name=>{try{return fs.readFileSync(name,'utf8').trim();}catch{return null;}};
const attempt=path=>{try{fs.readFileSync(path);return 'READABLE';}catch(e){return e.code;}};
const connect=(host,port)=>new Promise(resolve=>{const s=net.connect({host,port});const done=value=>{s.destroy();resolve(value);};s.setTimeout(500,()=>done('timeout'));s.once('connect',()=>done('CONNECTED'));s.once('error',e=>done(e.code));});
let rootWrite;try{fs.writeFileSync('/root-write-test','x');rootWrite='WRITABLE';}catch(e){rootWrite=e.code;}
const status=read('/proc/self/status');
const result={uid:process.getuid(),gid:process.getgid(),platform:process.platform,arch:process.arch,node:process.versions.node,
 noNewPrivileges:status?.match(/^NoNewPrivs:\s+(\d+)/m)?.[1],capEff:status?.match(/^CapEff:\s+(\w+)/m)?.[1],rootWrite,
 dockerSocket:attempt('/var/run/docker.sock'),secret:attempt('/run/secrets/provider_key'),hostHome:attempt('/Users/bytedance/.env'),
 sensitiveEnvNames:Object.keys(process.env).filter(k=>/KEY|TOKEN|SECRET|DOCKER|DSH|AWS|OPENAI|CODEX/i.test(k)),
 cpuMax:read('/sys/fs/cgroup/cpu.max'),memoryMax:read('/sys/fs/cgroup/memory.max'),swapMax:read('/sys/fs/cgroup/memory.swap.max'),pidsMax:read('/sys/fs/cgroup/pids.max'),
 network:{metadata:await connect('169.254.169.254',80),internet:await connect('1.1.1.1',443),hostAlias:await connect('host.docker.internal',3001)}};
console.log(JSON.stringify(result));
if(result.uid!==10001||result.noNewPrivileges!=='1'||result.capEff!=='0000000000000000'||result.rootWrite!=='EROFS'||result.sensitiveEnvNames.length||Object.values(result.network).includes('CONNECTED'))process.exitCode=1;
