import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertControlledSource } from '../src/source-policy.js';
test('bundler cannot resolve host files, import.meta glob, variable imports or external CSS', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-source-policy-')); await mkdir(path.join(root, 'src')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const text of ["import secret from '/Users/example/.env?raw';", "import x from '../../outside';", "const x = import.meta.glob('/**');", "import(variablePath);", "const secret = require('node:fs');"]) {
    await writeFile(path.join(root, 'src/App.tsx'), text); await assert.rejects(assertControlledSource(root));
  }
  await writeFile(path.join(root, 'src/App.tsx'), "import {useState} from 'react'; import './style.css';"); await writeFile(path.join(root, 'src/style.css'), '@import url(file:///secret);'); await assert.rejects(assertControlledSource(root));
  await writeFile(path.join(root, 'src/style.css'), 'main {color: black}'); await assertControlledSource(root);
});
