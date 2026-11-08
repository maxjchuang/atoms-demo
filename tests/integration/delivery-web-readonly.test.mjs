import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {deliveryWebReadonlyEnabled,webReadonlyInvocation} from './delivery-web-readonly.mjs';

test('readonly Web is optional and conflicts are rejected before any model or credential setup',()=>{
 assert.equal(deliveryWebReadonlyEnabled([]),false);assert.equal(deliveryWebReadonlyEnabled(['--verify-web-readonly']),true);
 assert.throws(()=>deliveryWebReadonlyEnabled(['--real','--no-web','--verify-web-readonly']),/requires Web.*No credentials or model services/);
});
test('readonly child uses node CLI and an allowlisted public environment with mutually exclusive mode',()=>{
 const parentEnv={PATH:process.env.PATH,HOME:process.env.HOME,DEEPSEEK_API_KEY:'must-be-omitted',ATOMS_SERVICE_TOKEN:'must-be-omitted',INTERNAL_SERVICE_TOKEN:'must-be-omitted',PREVIEW_SECRET:'must-be-omitted',OPENAI_API_KEY:'must-be-omitted',NODE_OPTIONS:'must-be-omitted',ATOMS_FAKE_SERVICES:'1',ATOMS_READONLY_REAL_SERVICES:'1'};
 for(const real of [false,true]){const invocation=webReadonlyInvocation({root:'/isolated/repo',webUrl:'http://localhost:5185',projectId:'project_existing',demoCode:'public-review-code',real,parentEnv});
  assert.deepEqual(invocation.args,['--import','tsx','scripts/check-delivery-services.mjs']);assert.equal(invocation.cwd,'/isolated/repo/apps/web');assert.equal(invocation.env.ATOMS_DEMO_CODE,'public-review-code');
  assert.equal(invocation.env[real?'ATOMS_READONLY_REAL_SERVICES':'ATOMS_FAKE_SERVICES'],'1');assert.equal(invocation.env[real?'ATOMS_FAKE_SERVICES':'ATOMS_READONLY_REAL_SERVICES'],undefined);
  for(const key of ['DEEPSEEK_API_KEY','ATOMS_SERVICE_TOKEN','INTERNAL_SERVICE_TOKEN','PREVIEW_SECRET','OPENAI_API_KEY','NODE_OPTIONS'])assert.equal(invocation.env[key],undefined,key+' must not reach the read-only child');
  // Execute only a tiny CLI probe; it does not launch services, a browser, or a model.
  const probe=spawnSync(invocation.command,['--input-type=module','-e',"if(process.env.DEEPSEEK_API_KEY||process.env.ATOMS_SERVICE_TOKEN||process.env.PREVIEW_SECRET)process.exit(2);if(!process.env.ATOMS_DELIVERY_PROJECT)process.exit(3);"],{env:invocation.env,encoding:'utf8'});assert.equal(probe.status,0);
 }
});

test('actual runner CLI rejects conflicting flags before real guard, env-file loading or service startup',()=>{
 const cwd=fileURLToPath(new URL('../../packages/contracts/',import.meta.url)),runner=fileURLToPath(new URL('./delivery-loop.mjs',import.meta.url));
 const invocation=webReadonlyInvocation({root:'/unused',webUrl:'http://localhost:5185',projectId:'project_existing',demoCode:'public-test-code',real:false});
 const result=spawnSync(process.execPath,['--import','tsx',runner,'--real','--no-web','--verify-web-readonly'],{cwd,env:invocation.env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.match(result.stderr,/--verify-web-readonly requires Web/);assert.match(result.stderr,/No credentials or model services have been loaded/);assert.doesNotMatch(result.stderr,/Real delivery needs local DEEPSEEK_API_KEY|Explicit ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION/);
});
