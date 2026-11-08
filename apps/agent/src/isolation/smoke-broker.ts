// Trusted test harness only. Never loads .env or provider credentials.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {createBroker} from './broker.js';import {BrokerClient} from './client.js';import {sha256} from '../files.js';import {docker} from './docker-command.js';
const root=await mkdtemp(path.join(os.tmpdir(),'atoms-v03-broker-gates-'));const token='broker-test-canary-'+randomUUID();
const input={phase:'browser',files:[{path:'dist/index.html',base64:Buffer.from('<h1>canary</h1><script>while(true){}</script>').toString('base64'),bytes:57,sha256:''}]};const bytes=Buffer.from(input.files[0].base64,'base64');input.files[0].bytes=bytes.length;input.files[0].sha256=sha256(bytes);
const image=JSON.parse((await docker(['image','inspect','atoms-v03-job:linux-v1'])).stdout)[0].Id;const body={expectedImageDigest:image,executionId:'execution_broker_probe',phase:'browser',inputHash:sha256(JSON.stringify(input)),deadlineMs:30000,bindingHash:'a'.repeat(64),attemptId:'attempt_broker_probe',generation:'b'.repeat(32)};
const start=async()=>{const b=createBroker({dataDir:root,token});await new Promise<void>(r=>b.server.listen(0,'127.0.0.1',r));const a=b.server.address();assert.ok(a&&typeof a!=='string');return{b,c:new BrokerClient('http://127.0.0.1:'+a.port,token)};};
const first=await start();let second:Awaited<ReturnType<typeof start>>|undefined;
try{
 const id='job_pending_probe',route='/internal/jobs/'+id;const j=await first.c.request(route,'PUT',body);assert.deepEqual(await first.c.request(route,'PUT',body),j);await assert.rejects(()=>first.c.request(route,'PUT',{...body,bindingHash:'c'.repeat(64)}));await assert.rejects(()=>first.c.request(route,'GET',undefined,'lease_wrong'));
 await assert.rejects(()=>first.c.request('/internal/jobs/job_second_probe','PUT',body));const stopped=await first.c.request(route+'/cancel','POST',{},j.lease);assert.equal(stopped.stopConfirmed,true);assert.equal(stopped.status,'cancelled');await first.b.close();
 // Real child process is SIGKILLed while a Docker browser job exists. Recovery must kill the old container, not resume it.
 const log=await import('node:fs').then(fs=>fs.openSync(path.join(root,'broker-child.log'),'w'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','DOCKER_HOST','DOCKER_CONTEXT'].includes(k))) as Record<string,string>;
 const child=spawn(process.execPath,['--import','tsx','src/isolation/broker.ts'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...env,AGENT_BROKER_TOKEN:token,BROKER_DATA_DIR:root,BROKER_HOST:'127.0.0.1',BROKER_PORT:'14319'},stdio:['ignore',log,log]});
 const client=new BrokerClient('http://127.0.0.1:14319',token);let available=false;for(let n=0;n<100;n++){try{await client.request('/internal/isolation/v1/capabilities');available=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(available,'child broker starts');
 const r='/internal/jobs/job_crash_probe';const running=await client.request(r,'PUT',body);await client.request(r+'/input','PUT',input,running.lease);await client.request(r+'/start','POST',{},running.lease);let observed=false;for(let n=0;n<100;n++){const s=await client.request(r,'GET',undefined,running.lease);if(s.status==='running'){observed=true;break;}await new Promise(r=>setTimeout(r,50));}assert.ok(observed,'actual container running before crash');child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
 second=await start();const recovered=await second.c.request(r,'GET',undefined,running.lease);assert.equal(recovered.status,'interrupted');assert.equal(recovered.stopConfirmed,true);await assert.rejects(()=>second!.c.request(r+'/output','GET',undefined,running.lease));
 const ledger=JSON.parse(await readFile(path.join(root,'jobs.json'),'utf8'));for(const job of ledger){const inspect=await docker(['inspect',job.name]);assert.notEqual(inspect.code,0,'no surviving leased job');}
 await writeFile(path.join(root,'proof.json'),JSON.stringify({passed:true,gates:['immutable_request','stale_lease','serial_capacity','pending_cancel','actual_running_crash','restart_reap','late_output_rejected'],jobs:ledger.map((j:any)=>({id:j.id,status:j.status,stopConfirmed:j.stopConfirmed}))},null,2));console.log(JSON.stringify({passed:true,root}));
}finally{await second?.b.close();await first.b.close().catch(()=>{});}
