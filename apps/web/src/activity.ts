import type { ProjectEventDto, RunDto } from '@atoms/contracts';
import { isTerminal, phaseLabels, statusLabels } from './state';

export type ApiSync = { status: 'syncing' | 'ok' | 'interrupted'; lastSuccessAt: number | null };
export type Activity = {
  seq: number; occurredAt: string; kind: 'status' | 'phase' | 'file' | 'check' | 'message' | 'delivery';
  title: string; detail?: string;
};
type CheckDto = RunDto['checks'][number];
export const coreCheckNames = { typecheck: '类型检查', build: '构建检查', smoke: '页面运行' } as const;
const coreKinds = ['typecheck', 'build', 'smoke'] as const;

export function mergeActivityEvents(existing: ProjectEventDto[], incoming: ProjectEventDto[], projectId: string): ProjectEventDto[] {
  const entries = new Map<number, ProjectEventDto>();
  for (const event of [...existing, ...incoming]) {
    if (event.projectId !== projectId) continue;
    if (event.event.type === 'message.updated' && event.event.payload.status !== 'complete') continue;
    if (event.event.type === 'activity.recorded' && event.event.payload.type === 'message.delta') continue;
    entries.set(event.seq, event);
  }
  return [...entries.values()].sort((a, b) => a.seq - b.seq);
}

// Historical events hydrate display-only activity. They must never be applied to
// a newer WorkspaceSnapshot, or an old run.updated could rewind business state.
export async function readActivityHistory(projectId: string, through: number,
  fetchPage: (id: string, after: number) => Promise<{ items: ProjectEventDto[]; nextCursor: number; hasMore: boolean }>): Promise<ProjectEventDto[]> {
  let cursor = 0;
  let events: ProjectEventDto[] = [];
  while (cursor < through) {
    const page = await fetchPage(projectId, cursor);
    if (page.nextCursor <= cursor || page.items.length === 0) throw new Error('执行记录暂不完整，请稍后刷新。');
    let expected = cursor + 1;
    for (const item of page.items) {
      if (item.projectId !== projectId || item.seq !== expected++) throw new Error('执行记录存在缺口，请稍后刷新。');
    }
    events = mergeActivityEvents(events, page.items.filter((event) => event.seq <= through), projectId);
    cursor = Math.min(through, page.nextCursor);
  }
  return events;
}

export function summarizeActivity(run: RunDto, events: ProjectEventDto[]) {
  const entries: Activity[] = [];
  const files = new Map<string, 'added' | 'modified' | 'deleted'>();
  const checks = new Map<CheckDto['kind'], CheckDto>();
  const completedMessages = new Set<string>();
  let lastPhase: RunDto['phase'] = null;
  let lastStatus: RunDto['status'] | null = null;
  let phaseStartedAt = run.createdAt;
  let currentPhaseSince = run.createdAt;
  let sourcePhase: RunDto['phase'] = null;
  let sourcePhaseSince = run.createdAt;
  let lastActivityAt: string | null = null;
  let repairRounds = 0;
  const add = (event: ProjectEventDto, kind: Activity['kind'], title: string, detail?: string) => {
    entries.push({ seq: event.seq, occurredAt: event.occurredAt, kind, title, detail });
  };
  const phase = (event: ProjectEventDto, value: RunDto['phase']) => {
    if (!value || value === lastPhase) return;
    lastPhase = value; phaseStartedAt = event.occurredAt;
    if (value === run.phase) currentPhaseSince = event.occurredAt;
    if (value === 'repairing') repairRounds++;
    add(event, 'phase', value === 'repairing' ? '进入修复阶段（具体轮次以报告为准）' : `进入${phaseLabels[value]}阶段`);
  };
  const message = (event: ProjectEventDto, messageId: string, text: string) => {
    if (completedMessages.has(messageId)) return;
    completedMessages.add(messageId);
    const clean = text.trim();
    if (clean) add(event, 'message', clean.length <= 100 ? clean : 'Agent 更新了执行说明', clean.length > 100 ? clean.slice(0, 1200) : undefined);
  };
  for (const event of events) {
    if (event.runId !== run.id) continue;
    const body = event.event;
    if (body.type === 'run.updated') {
      if (body.payload.status !== lastStatus) {
        lastStatus = body.payload.status;
        add(event, 'status', statusLabels[body.payload.status]);
      }
      phase(event, body.payload.phase);
    } else if (body.type === 'version.published') {
      add(event, 'delivery', '版本已发布，可以预览', body.payload.version.summary);
    } else if (body.type === 'message.updated' && body.payload.role === 'assistant' && body.payload.status === 'complete') {
      message(event, body.payload.id, body.payload.content);
    } else if (body.type === 'activity.recorded') {
      const activity = body.payload;
      if (!['message.delta', 'execution.updated'].includes(activity.type)) {
        lastActivityAt = event.occurredAt;
      }
      if (activity.type === 'phase.changed' && sourcePhase !== activity.payload.phase) {
        sourcePhase = activity.payload.phase; sourcePhaseSince = event.occurredAt;
      }
      switch (activity.type) {
        case 'phase.changed': phase(event, activity.payload.phase); break;
        case 'file.changed': {
          files.set(activity.payload.path, activity.payload.operation);
          const operation = { added: '新增', modified: '修改', deleted: '删除' }[activity.payload.operation];
          add(event, 'file', `${operation}文件`, activity.payload.path); break;
        }
        case 'check.completed': {
          checks.set(activity.payload.kind, activity.payload);
          const result = { passed: '通过', failed: '失败', not_run: '未验证', skipped: '跳过' }[activity.payload.status];
          add(event, 'check', `${activity.payload.name}：${result}`, activity.payload.summary); break;
        }
        case 'message.completed': message(event, activity.payload.messageId, activity.payload.content); break;
        case 'execution.started': add(event, 'status', '执行资源已开始处理任务'); break;
        case 'artifact.ready': add(event, 'delivery', '候选产物已就绪，等待后端校验'); break;
        case 'execution.failed': add(event, 'status', '执行未能完成', activity.payload.message); break;
        case 'execution.cancelled': add(event, 'status', '执行已停止'); break;
        case 'execution.interrupted': add(event, 'status', '执行中断', activity.payload.reason); break;
        case 'attention.created': add(event, 'status', '等待你的回答', activity.payload.title); break;
        case 'attention.resolved': add(event, 'status', '回答已被执行服务接收'); break;
      }
    }
  }
  // The snapshot's current checks are authoritative. Event history supplies the
  // intermediate results missing from older snapshots, without changing status.
  for (const check of run.checks) checks.set(check.kind, check);
  const coreChecks = coreKinds.map((kind) => ({ kind, name: coreCheckNames[kind], check: checks.get(kind) }));
  const completedChecks = coreChecks.filter(({ check }) => check && ['passed', 'failed'].includes(check.status)).length;
  const activePhaseStart = sourcePhase === run.phase && sourcePhase !== null ? sourcePhaseSince
    : lastPhase === run.phase ? phaseStartedAt : currentPhaseSince;
  return { entries, files: [...files.entries()], coreChecks, completedChecks, repairRounds,
    lastActivityAt, phaseStartedAt: activePhaseStart,
    lastActivity: entries.at(-1) ?? null };
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
  return `${Math.floor(seconds / 3600)}小时${Math.floor(seconds % 3600 / 60)}分`;
}

export function feedbackTiming(run: RunDto, phaseStartedAt: string, lastActivityAt: string | null, now: number) {
  const end = isTerminal(run) ? Date.parse(run.updatedAt) : now;
  return {
    total: Math.max(0, end - Date.parse(run.createdAt)),
    phase: Math.max(0, end - Date.parse(phaseStartedAt)),
    // "ago" is relative to the current clock even after completion; only task
    // duration is frozen. A completed task must not say "0 seconds ago" forever.
    idle: Math.max(0, now - Date.parse(lastActivityAt ?? run.createdAt)),
  };
}

export function phasePresentation(run: RunDto, hasPublishedVersion = false) {
  if (run.status === 'queued') return { title: '任务已排队', description: '需求已保存，获得执行资源后会继续处理。' };
  if (run.status === 'waiting_input') return { title: '等待你的确认', description: '回答下方问题后，任务会排队恢复；等待期间不会持续调用模型。' };
  if (run.status === 'cancelling') return { title: '等待执行停止确认', description: '取消请求已接收，执行服务确认停止后才会显示已取消。' };
  if (isTerminal(run)) return { title: statusLabels[run.status], description: run.status === 'succeeded'
    ? '应用已保存。可以预览、继续修改或查看版本。' : hasPublishedVersion ? '本次执行已结束；上一成功版本会继续保留。' : '本次执行已结束，未发布新的应用；当前没有可预览版本。' };
  const descriptions = {
    planning: '正在梳理需求和实现计划，准备本次任务的执行范围。',
    generating: '正在生成应用代码；收到代码后会继续类型、构建与页面运行检查。',
    verifying: '正在检查类型、构建及页面运行；每项结果返回后会在下方显示。',
    repairing: '检查发现了问题，正在根据失败证据进行有限修复，随后重新验证。',
    publishing: '候选应用正在由后端校验并保存，发布完成后才会切换预览。',
  };
  return { title: run.phase ? phaseLabels[run.phase] : statusLabels[run.status],
    description: run.phase ? descriptions[run.phase] : '任务已接收，正在等待新的执行结果。' };
}

export function stageState(run: RunDto, phase: 'planning' | 'generating' | 'verifying' | 'publishing') {
  if (run.status === 'succeeded') return 'done';
  const sequence = ['planning', 'generating', 'verifying', 'publishing'];
  // Repair follows an actual verification attempt. Keep prior milestones visible
  // and show verification as active while the repair loop is in progress.
  if (run.phase === 'repairing') return phase === 'planning' || phase === 'generating' ? 'done' : phase === 'verifying' ? 'active' : '';
  const current = sequence.indexOf(run.phase ?? '');
  const index = sequence.indexOf(phase);
  return index < current ? 'done' : index === current ? 'active' : '';
}
