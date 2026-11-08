import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectSessionFence } from '../src/project-session-fence.js';

test('dirty native sessions are not reused by another turn and committed sessions survive restart', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'atoms-router-fence-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fence = new ProjectSessionFence(home);
  assert.equal(fence.begin('turn_uncommitted'), 1);
  assert.equal(fence.begin('turn_uncommitted'), 1, 'same-turn read/retry can reuse its uncommitted history');
  fence.invalidate();
  assert.equal(fence.commit('turn_uncommitted'), false, 'a late commit cannot win cancellation');
  assert.equal(new ProjectSessionFence(home).begin('turn_next'), 2, 'next turn rebuilds from API canonical context');
  assert.equal(fence.commit('turn_next'), true);
  const restarted = new ProjectSessionFence(home);
  assert.equal(restarted.begin('turn_after_restart'), 2, 'clean committed session generation is reusable');
  assert.equal(new ProjectSessionFence(home).begin('turn_after_crash'), 3, 'uncertain in-flight state creates a new generation');
});
