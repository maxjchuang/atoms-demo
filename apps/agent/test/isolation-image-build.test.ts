import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url));

// Read the actual context assembly without importing its Docker build entrypoint.
async function packagedVerifierFiles(){
  const source=ts.createSourceFile('build-job-image.ts',await readFile(path.join(root,'src/isolation/build-job-image.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  let declaration:ts.VariableDeclaration|undefined;
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='verifierFiles')declaration=node;ts.forEachChild(node,visit);}
  visit(source);
  const initializer=declaration?.initializer;
  assert.ok(initializer&&ts.isArrayLiteralExpression(initializer),'Build context must declare its explicit verifier source list');
  return initializer.elements.map(element=>{assert.ok(ts.isStringLiteral(element));return element.text;});
}

async function missingVerifierDependencies(packaged:string[]){
  const included=new Set(packaged),seen=new Set<string>(),missing=new Set<string>();
  const job=await readFile(path.join(root,'docker/job.ts'),'utf8');
  const entries=ts.preProcessFile(job,true,true).importedFiles.map(file=>file.fileName).filter(file=>file.startsWith('/opt/verifier/')).map(file=>file.slice('/opt/verifier/'.length));
  assert.ok(entries.length>0,'Check actual job verifier entrypoints');
  async function visit(file:string){
    if(!included.has(file)){missing.add(file);return;}
    if(seen.has(file))return;seen.add(file);
    const source=await readFile(path.join(root,'src',file),'utf8');
    for(const imported of ts.preProcessFile(source,true,true).importedFiles){
      if(!imported.fileName.startsWith('.'))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(file),imported.fileName)).replace(/\.js$/,'.ts');
      assert.ok(!dependency.startsWith('../'),'Verifier local imports must remain in its packaged source root');
      await visit(dependency);
    }
  }
  for(const entry of entries)await visit(entry);
  // Also inspect listed helper files even when their callers change.
  for(const file of packaged)await visit(file);
  return [...missing].sort();
}

test('job image verifier context contains the transitive local dependencies of actual runner entrypoints',async()=>{
  const files=await packagedVerifierFiles();
  assert.equal(new Set(files).size,files.length,'No duplicate context entries');
  assert.deepEqual(await missingVerifierDependencies(files),[]);
});

test('dependency closure detects the geometry helper omitted by the previous image manifest',async()=>{
  const files=(await packagedVerifierFiles()).filter(file=>file!=='geometry-contract.ts');
  assert.deepEqual(await missingVerifierDependencies(files),['geometry-contract.ts']);
});
