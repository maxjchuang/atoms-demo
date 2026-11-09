import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fixedNgrokOrigin,ngrokArguments,ngrokStarted,ngrokIdentityMatches,startNgrok,ngrokRunning,stopNgrok,readNgrokToken,processFingerprint} from './m3-ngrok.mjs';
const origin='https://fixture.ngrok-free.dev';
test('ngrok only uses explicit fixed HTTPS account domain and reviewed workbench targets',()=>{
 assert.equal(fixedNgrokOrigin(origin),origin);
 for(const invalid of ['http://fixture.ngrok-free.dev',origin+'/',origin+'?key=secret','https://user:pass@fixture.ngrok-free.dev','https://evil.test','https://fixture.ngrok-free.dev:444','https://ngrok-free.dev.evil.test'])assert.throws(()=>fixedNgrokOrigin(invalid));
 assert.throws(()=>ngrokArguments({origin,port:3001,configFile:'/private/config.yml'}));
 const args=ngrokArguments({origin,port:18080,configFile:'/private/config.yml'});assert.ok(args.includes('http://127.0.0.1:18080'));assert.ok(args.includes('--config=/private/config.yml'));assert.ok(!args.some(v=>v.includes('authtoken')));
});
test('registration must bind both exact HTTPS origin and reviewed target, not merely any logged URL',()=>{
 const log=v=>JSON.stringify({msg:'started tunnel',url:origin,addr:'http://127.0.0.1:5181',...v});
 assert.equal(ngrokStarted(log({}),origin,5181),true);
 for(const v of [{url:'https://other.ngrok-free.dev'},{addr:'http://api:3001'},{msg:'starting tunnel'}])assert.equal(ngrokStarted(log(v),origin,5181),false);
});
test('ngrok3.39 structured Go URL registration accepts only the exact safe loopback target',()=>{
 // Sanitized actual3.39.13 log shape: synthetic hostname only, no account/token.
 const addr={Scheme:'http',Opaque:'',User:null,Host:'127.0.0.1:5181',Path:'',Fragment:'',RawQuery:'',RawPath:'',RawFragment:'',ForceQuery:false,OmitHost:false};
 const event={lvl:'info',msg:'started tunnel',obj:'tunnels',name:'command_line',url:origin,addr};
 const log=address=>JSON.stringify({...event,addr:address});
 assert.equal(ngrokStarted(log(addr),origin,5181),true);
 assert.equal(ngrokStarted(log({...addr,Host:'127.0.0.1:18080'}),origin,18080),true);
 for(const mutation of [{Scheme:'https'},{Opaque:'http://api:3001'},{User:{Username:'fixture'}},{Host:'localhost:5181'},{Host:'127.0.0.1:3001'},{Host:'api:3001'},{Path:'/'},{Path:'/internal'},{RawPath:'%2finternal'},{RawQuery:'credential=fixture'},{Fragment:'fixture'},{RawFragment:'fixture'},{ForceQuery:true},{OmitHost:true},{ForceQuery:'false'},{Extra:'unexpected'}])assert.equal(ngrokStarted(log({...addr,...mutation}),origin,5181),false,JSON.stringify(mutation));
 for(const value of [null,[],{},'http://127.0.0.1:5181/','http://fixture@127.0.0.1:5181'])assert.equal(ngrokStarted(log(value),origin,5181),false);
 const missing={...addr};delete missing.User;assert.equal(ngrokStarted(log(missing),origin,5181),false);
 assert.equal(ngrokStarted(JSON.stringify({...event,url:'https://other.ngrok-free.dev'}),origin,5181),false);
 assert.equal(ngrokStarted(log({...addr,Host:'127.0.0.1:3001'}),origin,3001),false);
});
test('private raw token denies symlinks, broad permissions and malformed content',async t=>{
 const root=await mkdtemp(join(tmpdir(),'atoms-ngrok-token-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'token');await writeFile(file,'synthetic_ngrok_token_123456\n',{mode:0o600});assert.equal(await readNgrokToken(file),'synthetic_ngrok_token_123456');await symlink(file,join(root,'link'));await assert.rejects(readNgrokToken(join(root,'link')));await chmod(file,0o644);await assert.rejects(readNgrokToken(file),/0600/);await chmod(file,0o600);await writeFile(file,'token\nnext');await assert.rejects(readNgrokToken(file),/Invalid raw/);
});
test('native connector lifecycle keeps token out of argv/env/log and refuses changed process identity',async t=>{
 const root=await mkdtemp(join(tmpdir(),'atoms-ngrok-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));const token='synthetic_ngrok_private_123456',tokenFile=join(root,'token'),binary=join(root,'ngrok');await writeFile(tokenFile,token,{mode:0o600});
 await writeFile(binary,`#!/bin/sh
printf '%s\\n' '{"msg":"started tunnel","url":"https://fixture.ngrok-free.dev","addr":"http://127.0.0.1:5181"}'
while :; do sleep 1; done
`,{mode:0o700});
 let journal;const saved=await startNgrok({origin,port:5181,tokenFile,binary,directory:join(root,'state'),onStarted:async v=>journal=v});
 t.after(async()=>{if(await ngrokRunning(saved))await stopNgrok(saved);});
 assert.equal(journal.pid,saved.pid);assert.equal(await ngrokRunning(saved),true);assert.ok((await readFile(saved.configFile,'utf8')).includes(token));assert.ok(!(await readFile(saved.logFile,'utf8')).includes(token));assert.ok(!saved.fingerprint.includes(token));assert.equal(ngrokIdentityMatches({...saved,port:18080},saved.fingerprint),false);await assert.rejects(stopNgrok({...saved,fingerprint:'wrong'}),/identity changed/);await stopNgrok(saved);assert.equal(await ngrokRunning(saved),false);
});
test('failed registration retains owned journal and stops the process',async t=>{
 const root=await mkdtemp(join(tmpdir(),'atoms-ngrok-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));const tokenFile=join(root,'token'),binary=join(root,'ngrok');await writeFile(tokenFile,'synthetic_ngrok_private_123456',{mode:0o600});await writeFile(binary,'#!/bin/sh\nwhile :; do sleep 1; done\n',{mode:0o700});let saved;await assert.rejects(startNgrok({origin,port:5181,tokenFile,binary,directory:join(root,'state'),timeoutMs:100,onStarted:async v=>saved=v}),/timed out/);assert.ok(saved.pid);assert.equal(await ngrokRunning(saved),false);
});

test('identity capture failure terminates the exact spawned child without an orphan journal',async t=>{
 const root=await mkdtemp(join(tmpdir(),'atoms-ngrok-capture-'));t.after(()=>rm(root,{recursive:true,force:true}));const tokenFile=join(root,'token'),binary=join(root,'ngrok'),pidFile=join(root,'pid');await writeFile(tokenFile,'synthetic_ngrok_private_123456',{mode:0o600});await writeFile(binary,`#!/bin/sh
echo $$ > '${pidFile}'
while :; do sleep 1; done
`,{mode:0o700});let journaled=false;await assert.rejects(startNgrok({origin,port:5181,tokenFile,binary,directory:join(root,'state'),fingerprintOf:()=>'',onStarted:async()=>journaled=true}),/identity/);assert.equal(journaled,false);const pid=Number((await readFile(pidFile,'utf8')).trim());assert.equal(processFingerprint(pid),'');
});
