import test from 'node:test';
import assert from 'node:assert/strict';
import { run, version } from '@atoms/contracts/fixtures';
import { completedBuildCount } from '../src/run-history';
import { assistantText } from '../src/product-language';

test('successful build count excludes failed/active work, foreign projects and restored copies', () => {
  const success = { ...run, status: 'succeeded' as const };
  assert.equal(completedBuildCount(run.projectId, [success, success,
    { ...run, id: 'run_failed', status: 'failed' }, { ...run, id: 'run_active', status: 'running' },
    { ...success, id: 'run_foreign', projectId: 'project_other' }], [
    { ...version, runId: success.id },
    { ...version, id: 'version_restored', runId: 'run_restore', restoredFromVersionId: version.id },
    { ...version, id: 'version_second', runId: 'run_second' },
    { ...version, id: 'version_foreign', projectId: 'project_other', runId: 'run_elsewhere' },
  ]), 2);
  assert.equal(completedBuildCount(run.projectId, [{ ...run, status: 'failed' }], []), 0);
});

test('assistant progress uses product roles and leaves unrelated words intact', () => {
  assert.equal(assistantText('Worker 正在实现 React 多文件应用。'), '程序员 正在实现 多文件网页应用。');
  assert.equal(assistantText('正在准备受控 React 模板。'), '正在准备应用模板。');
  assert.equal(assistantText('Router 与 Agent 正在处理。'), '项目负责人 与 Atoms 正在处理。');
  assert.equal(assistantText('Reactant MyWorker file.tsx'), 'Reactant MyWorker file.tsx');
});
