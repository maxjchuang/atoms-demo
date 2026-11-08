import {
  PROTOCOL_VERSION,
  type RunDto, type ProjectDto, type VersionDto, type WorkspaceSnapshotDto,
  type ProjectEventDto, type StartExecutionDto, type ArtifactManifestDto,
  type AgentEventDto,
} from './index.js';

export const time = '2026-11-08T08:00:00.000Z';
export const checks = (['typecheck', 'build', 'smoke'] as const).map((kind) => ({
  id: `check_${kind}`, kind, name: kind, required: true,
  status: 'passed' as const, summary: 'Fixture evidence, not a real execution', evidenceIds: [`evidence_${kind}`],
}));
export const project: ProjectDto = {
  id: 'project_demo', title: '便签墙', revision: 1,
  currentVersionId: null, activeRunId: null, createdAt: time, updatedAt: time,
};
export const run: RunDto = {
  id: 'run_demo', projectId: project.id, revision: 1,
  status: 'queued', phase: null, mode: 'build', baseVersionId: null,
  resultVersionId: null, executionId: null, pendingAttention: null,
  pendingAnswer: null,
  checks: [], createdAt: time, updatedAt: time, error: null,
};
export const version: VersionDto = {
  id: 'version_demo', projectId: project.id, parentVersionId: null,
  restoredFromVersionId: null, runId: run.id, summary: '可交互的便签墙', checks,
  previewUrl: 'https://preview.example.test/p/fixture_token/index.html',
  previewExpiresAt: '2026-11-08T10:00:00.000Z', createdAt: time,
};
export const attention = {
  id: 'attention_plan', runId: run.id, revision: 1,
  kind: 'plan_confirmation' as const, title: '确认便签墙实现计划',
  description: '支持增删、拖拽和刷新保存。', options: [], allowText: false,
  plan: { summary: '构建便签墙', tasks: ['实现便签交互', '验证持久化'],
    acceptance: [{ id: 'acceptance_refresh', description: '刷新后保留便签' }] },
  createdAt: time,
};
const snapshot = (activeRun: RunDto | null, currentVersion: VersionDto | null = null,
  eventCursor = 0): WorkspaceSnapshotDto => ({
  protocolVersion: PROTOCOL_VERSION,
  project: { ...project, revision: currentVersion?.id === version.id ? 2 : 1,
    currentVersionId: currentVersion?.id ?? null,
    activeRunId: activeRun && !terminal.has(activeRun.status) ? activeRun.id : null },
  activeRun: activeRun && !terminal.has(activeRun.status) ? activeRun : null,
  latestRun: activeRun,
  queuedRuns: [], currentVersion, messages: [], olderMessagesCursor: null, eventCursor,
});
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const event = (seq: number, body: ProjectEventDto['event']): ProjectEventDto => ({
  protocolVersion: PROTOCOL_VERSION, projectId: project.id, runId: run.id,
  seq, occurredAt: time, event: body,
});
const running: RunDto = { ...run, revision: 2, status: 'running', phase: 'generating', executionId: 'execution_demo' };
const verifying: RunDto = { ...running, revision: 3, phase: 'verifying' };
const publishing: RunDto = { ...verifying, revision: 4, phase: 'publishing', checks };
const succeeded: RunDto = { ...publishing, revision: 5, status: 'succeeded', resultVersionId: version.id };
const publishEvent = event(4, { type: 'version.published', payload: {
  project: { ...project, revision: 2, activeRunId: null, currentVersionId: version.id }, version,
} });

export interface Scenario {
  name: string;
  description: string;
  initial: WorkspaceSnapshotDto;
  events: ProjectEventDto[];
  final: WorkspaceSnapshotDto;
  finalRun: RunDto;
}
export const scenarios: Scenario[] = [
  {
    name: 'success', description: '首次生成并发布版本', initial: snapshot(run),
    events: [event(1, { type: 'run.updated', payload: running }),
      event(2, { type: 'run.updated', payload: verifying }),
      event(3, { type: 'run.updated', payload: publishing }), publishEvent,
      event(5, { type: 'run.updated', payload: succeeded })],
    final: snapshot(succeeded, version, 5), finalRun: succeeded,
  },
  {
    name: 'waiting-plan', description: '等待计划确认，刷新后仍有待处理卡片', initial: snapshot({ ...run, mode: 'plan' }),
    events: [event(1, { type: 'run.updated', payload: {
      ...running, mode: 'plan', status: 'waiting_input', phase: 'planning', pendingAttention: attention,
    } })],
    final: snapshot({ ...running, mode: 'plan', status: 'waiting_input', phase: 'planning', pendingAttention: attention }, null, 1),
    finalRun: { ...running, mode: 'plan', status: 'waiting_input', phase: 'planning', pendingAttention: attention },
  },
  {
    name: 'repair-success', description: '构建失败后进入修复，再次检查通过', initial: snapshot(run),
    events: [event(1, { type: 'run.updated', payload: running }),
      event(2, { type: 'activity.recorded', payload: { type: 'check.completed', payload: {
        ...checks[1], status: 'failed', summary: 'Fixture: unresolved import',
      } } }),
      event(3, { type: 'run.updated', payload: { ...running, revision: 3, phase: 'repairing' } }),
      event(4, { type: 'run.updated', payload: { ...verifying, revision: 4 } }),
      event(5, { type: 'version.published', payload: publishEvent.event.type === 'version.published' ? publishEvent.event.payload : { project, version } }),
      event(6, { type: 'run.updated', payload: { ...succeeded, revision: 5 } })],
    final: snapshot(succeeded, version, 6), finalRun: succeeded,
  },
  ...(['failed', 'cancelled', 'interrupted'] as const).map((status): Scenario => {
    const previousVersion = { ...version, id: 'version_previous' };
    const finalRun: RunDto = { ...running, revision: 4, status, baseVersionId: previousVersion.id,
      error: status === 'cancelled' ? null : {
        code: status === 'failed' ? 'BUDGET_EXCEEDED' : 'EXECUTION_INTERRUPTED',
        message: `Fixture: ${status}`,
      } };
    return {
      name: status, description: `${status} 时保留上一成功版本`,
      initial: snapshot({ ...run, baseVersionId: previousVersion.id }, previousVersion),
      events: [event(1, { type: 'run.updated', payload: {
        ...running, baseVersionId: previousVersion.id,
      } }), ...(status === 'cancelled' ? [event(2, { type: 'run.updated', payload: {
        ...running, revision: 3, status: 'cancelling', baseVersionId: previousVersion.id,
      } })] : []), event(status === 'cancelled' ? 3 : 2, { type: 'run.updated', payload: finalRun })],
      final: snapshot(finalRun, previousVersion, status === 'cancelled' ? 3 : 2), finalRun,
    };
  }),
];

const question = { ...attention, id: 'attention_question', kind: 'question' as const,
  title: '便签的保存范围是什么？', description: '请选择本地浏览器保存方式。',
  options: [{ id: 'option_local', label: '保存在当前浏览器' }], allowText: true, plan: undefined };
const waiting: RunDto = { ...running, revision: 3, status: 'waiting_input', phase: 'planning', pendingAttention: question };
const answerPending: RunDto = { ...waiting, revision: 4,
  pendingAnswer: { attentionId: question.id, status: 'pending', submittedAt: time } };
const answerAccepted: RunDto = { ...answerPending, revision: 5, status: 'queued', pendingAttention: null,
  pendingAnswer: { attentionId: question.id, status: 'accepted', submittedAt: time } };
const resumed: RunDto = { ...answerAccepted, revision: 6, status: 'running', phase: 'generating' };
const queuedRun: RunDto = { ...run, id: 'run_queued', createdAt: '2026-11-08T08:01:00.000Z' };
const restoredVersion: VersionDto = { ...version, id: 'version_restored',
  parentVersionId: version.id, restoredFromVersionId: version.id, runId: null,
  summary: '从历史版本恢复，保留版本历史' };
scenarios.push(
  {
    name: 'question', description: '普通问题和可选答案，等待状态可刷新恢复',
    initial: snapshot(running), events: [event(1, { type: 'run.updated', payload: waiting })],
    final: snapshot(waiting, null, 1), finalRun: waiting,
  },
  {
    name: 'answer-resume', description: '回答可靠入队，确认后等待计算槽，再恢复运行',
    initial: snapshot(waiting), events: [event(1, { type: 'run.updated', payload: answerPending }),
      event(2, { type: 'run.updated', payload: answerAccepted }),
      event(3, { type: 'run.updated', payload: resumed })],
    final: snapshot(resumed, null, 3), finalRun: resumed,
  },
  {
    name: 'project-queue', description: '活动任务保留项目锁，新修改等待',
    initial: { ...snapshot(running), queuedRuns: [queuedRun], latestRun: queuedRun },
    events: [], final: { ...snapshot(running), queuedRuns: [queuedRun], latestRun: queuedRun }, finalRun: running,
  },
  {
    name: 'message-upsert', description: '公开消息为完整 upsert，前端不拼接原生 delta',
    initial: snapshot(running),
    events: [event(1, { type: 'message.updated', payload: {
      id: 'message_demo', projectId: project.id, runId: run.id,
      role: 'assistant', status: 'streaming', content: '正在', createdAt: time,
    } }), event(2, { type: 'message.updated', payload: {
      id: 'message_demo', projectId: project.id, runId: run.id,
      role: 'assistant', status: 'complete', content: '正在构建便签墙。', createdAt: time,
    } })],
    final: { ...snapshot(running, null, 2), messages: [{
      id: 'message_demo', projectId: project.id, runId: run.id,
      role: 'assistant', status: 'complete', content: '正在构建便签墙。', createdAt: time,
    }] }, finalRun: running,
  },
  {
    name: 'restore', description: '恢复创建新版本而非覆写历史，后续任务使用新基线',
    initial: snapshot(succeeded, version), events: [{ ...event(1, { type: 'version.published', payload: {
      project: { ...project, revision: 3, currentVersionId: restoredVersion.id }, version: restoredVersion,
    } }), runId: null }],
    final: { ...snapshot(succeeded, restoredVersion, 1),
      project: { ...project, revision: 3, currentVersionId: restoredVersion.id } }, finalRun: succeeded,
  },
);

export const errorFixtures = [
  { status: 401, code: 'UNAUTHENTICATED', message: '会话已过期', retryable: false },
  { status: 403, code: 'QUOTA_EXCEEDED', message: '体验额度已用完', retryable: false },
  { status: 404, code: 'NOT_FOUND', message: '项目不存在或不可访问', retryable: false },
  { status: 409, code: 'STALE_REVISION', message: '问题已更新，请刷新', retryable: false },
  { status: 410, code: 'CURSOR_EXPIRED', message: '请重新获取快照', retryable: false },
  { status: 429, code: 'RATE_LIMITED', message: '请求过于频繁', retryable: true },
  { status: 503, code: 'RUNTIME_UNAVAILABLE', message: '执行服务暂不可用', retryable: true },
].map(({ status, ...error }) => ({ status, body: { error: { ...error, requestId: 'request_demo' } } }));

export const startExecution: StartExecutionDto = {
  protocolVersion: PROTOCOL_VERSION, executionId: 'execution_demo', runId: run.id, projectId: project.id,
  attempt: 1, prompt: '构建一个可以拖拽并保存便签的便签墙', mode: 'build', baseVersionId: null,
  input: { kind: 'template', templateId: 'react-vite-v1' },
  mandate: { scope: 'react_frontend', allowDependencyChanges: false, allowPublicDeployment: false,
    allowExternalMessaging: false, projectMemory: '用户希望暖色风格。' },
  budget: { maxWallTimeMs: 600000, maxWaitingInputMs: 86400000,
    maxRepairRounds: 2, maxModelSteps: 30,
    maxInputTokens: 100000, maxOutputTokens: 30000, maxArtifactBytes: 20971520 },
};
export const artifact: ArtifactManifestDto = {
  protocolVersion: PROTOCOL_VERSION, id: 'artifact_demo', executionId: startExecution.executionId,
  runId: run.id, baseVersionId: null, summary: 'Fixture artifact only; hashes are placeholders.',
  files: ['source/package.json', 'source/src/App.tsx', 'dist/index.html',
    ...checks.map((check) => `evidence/${check.id}.log`)].map((path) => ({
    path, bytes: 100, sha256: 'a'.repeat(64), mediaType: path.endsWith('.html') ? 'text/html' : 'text/plain',
  })), checks,
  evidence: checks.map((check) => ({ id: check.evidenceIds[0], path: `evidence/${check.id}.log`, kind: 'log' })),
  createdAt: time,
};
export const agentEvents: AgentEventDto[] = [
  { type: 'execution.started', payload: {} },
  { type: 'phase.changed', payload: { phase: 'generating' } },
  { type: 'file.changed', payload: { path: 'src/App.tsx', operation: 'modified' } },
  { type: 'artifact.ready', payload: { artifactId: artifact.id, manifestSha256: 'b'.repeat(64) } },
  { type: 'execution.completed', payload: { artifactId: artifact.id } },
].map((body, index) => ({ protocolVersion: PROTOCOL_VERSION, executionId: startExecution.executionId,
  runId: run.id, sourceSeq: index + 1, occurredAt: time,
  event: body as AgentEventDto['event'],
}));
