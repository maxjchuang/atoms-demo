import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applySourceEdit, type FileChange } from '../src/source-edits.js';

test('file feedback follows actual writes and distinguishes added, modified and unchanged', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-source-feedback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events: FileChange[] = [];
  let expected = 'first';
  const changed = (event: FileChange) => {
    assert.equal(readFileSync(path.join(root, event.path), 'utf8'), expected, 'bytes exist before event');
    events.push(event);
  };
  assert.equal(await applySourceEdit(root, 'src/App.tsx', expected, changed), true);
  assert.equal(await applySourceEdit(root, 'src/App.tsx', expected, changed), false);
  expected = 'second';
  assert.equal(await applySourceEdit(root, 'src/App.tsx', expected, changed), true);
  assert.deepEqual(events, [{ path: 'src/App.tsx', operation: 'added' }, { path: 'src/App.tsx', operation: 'modified' }]);
  assert.equal(await readFile(path.join(root, 'src/App.tsx'), 'utf8'), 'second');
  assert.ok(!events.some((event) => event.operation === 'deleted'), 'no deletion is claimed without removing a file');
});

test('rejected paths never produce a file-change event', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atoms-source-reject-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events: FileChange[] = [];
  await assert.rejects(applySourceEdit(root, '../outside.ts', 'no', (event) => events.push(event)));
  assert.equal(events.length, 0);
  await writeFile(path.join(root, 'kept.txt'), 'unchanged');
  assert.equal(await readFile(path.join(root, 'kept.txt'), 'utf8'), 'unchanged');
});
