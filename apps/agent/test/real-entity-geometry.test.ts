/** Authored generic counterexample: locator geometry is not semantic entity identity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareRequest} from '@atoms/contracts/delivery-fixtures';
import {compilePlanningRecipes,RECIPE_VERSION} from '../src/planning-recipes.js';
import {mapModelPlan} from '../src/planning-format.js';
import {runBrowserPlan} from '../src/browser-dsl.js';
import {seal} from '../src/delivery-files.js';

test('authored proxy marker movement passes only the proxy oracle; the actual visible entity movement oracle fails', {timeout:20000}, async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'atoms-real-entity-'));if(process.env.ATOMS_KEEP_TEST_DATA!=='1')t.after(()=>rm(root,{recursive:true,force:true}));else t.diagnostic('Authored counterexample evidence: '+root);
 await writeFile(path.join(root,'index.html'),`<!doctype html><main aria-label="Workspace"><section data-testid="real_view" style="position:relative;width:400px;height:250px;overflow:hidden;border:1px solid"><div data-testid="functional_entity" style="position:absolute;left:60px;top:80px;width:60px;height:60px;background:blue">Entity</div></section><aside><div data-testid="proxy_marker" style="position:relative;left:0px;width:18px;height:18px;background:red">P</div></aside><button>Move</button></main><script src="app.js"></script>`);
 await writeFile(path.join(root,'app.js'),`// Authored defect: moving a separate marker leaves the visible entity stationary.\ndocument.querySelector('button').onclick=()=>{const p=document.querySelector('[data-testid="proxy_marker"]');p.style.left=(parseFloat(p.style.left)+40)+'px'};`);
 const planFor=(target:string)=>{
  const raw={formatVersion:RECIPE_VERSION,criteria:[{ref:'r0',description:'The actual entity moves in its visible functional view',sourceSeedRefs:prepareRequest.seed.items.map((_,i)=>'s'+i),verification:{method:'automated',recipes:[{kind:'geometry_delta',target:{testId:target},actions:[{action:'click',target:{role:'button',name:'Move'}}],dx:40,dy:0,tolerancePx:2}]}}]};
  const {plan}=mapModelPlan(compilePlanningRecipes(raw),prepareRequest);
  // Both are new authored test contracts, unrelated to any existing user/frozen plan.
  return seal({...plan,cases:plan.cases.map(c=>({...c,steps:c.steps.map(s=>({...s,timeoutMs:s.op==='expect_box_moved'?500:5000}))}))});
 };
 const proxy=await runBrowserPlan({dist:root,plan:planFor('proxy_marker'),evidenceDir:path.join(root,'proxy-only'),signal:new AbortController().signal});
 assert.equal(proxy.caseResults[0].status,'passed',JSON.stringify(proxy.caseResults));
 const actual=await runBrowserPlan({dist:root,plan:planFor('functional_entity'),evidenceDir:path.join(root,'real-entity'),signal:new AbortController().signal});
 assert.equal(actual.caseResults[0].status,'failed');
 const logs=await readFile(path.join(root,'real-entity',actual.files.find(f=>f.kind==='log')!.path),'utf8');
 assert.ok(logs.includes('functional_entity'));assert.ok(logs.includes('expectedDelta'));assert.equal(JSON.parse(actual.caseResults[0].failure!.actual!).delta.dx,0);
 assert.ok(proxy.files.some(f=>f.kind==='screenshot'));assert.ok(actual.files.some(f=>f.kind==='screenshot'));
});
