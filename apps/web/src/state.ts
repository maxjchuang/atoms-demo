import type { ProjectEventDto, WorkspaceSnapshotDto, RunDto } from '@atoms/contracts';

export const terminalStatuses = new Set<RunDto['status']>(['succeeded', 'failed', 'cancelled', 'interrupted']);
export const isTerminal = (run: RunDto | null | undefined) => !!run && terminalStatuses.has(run.status);
export class EventGap extends Error {}
export function applyEvents(snapshot: WorkspaceSnapshotDto, events: ProjectEventDto[]): WorkspaceSnapshotDto {
  let state = structuredClone(snapshot);
  for (const item of events) {
    if (item.projectId !== state.project.id || item.seq <= state.eventCursor) continue;
    if (item.seq !== state.eventCursor + 1) throw new EventGap('Event cursor gap');
    const event = item.event;
    if (event.type === 'run.updated') {
      const next = event.payload;
      if (!state.latestRun || state.latestRun.id === next.id || next.createdAt >= state.latestRun.createdAt) state.latestRun = next;
      const terminal = isTerminal(next);
      if (state.activeRun?.id === next.id || (!state.activeRun && next.executionId && !terminal)) {
        state.activeRun = terminal ? null : next;
        state.project.activeRunId = terminal ? null : next.id;
      }
      state.queuedRuns = state.queuedRuns.filter((run) => run.id !== next.id);
      if (!terminal && next.status === 'queued' && !next.executionId) state.queuedRuns.push(next);
    } else if (event.type === 'version.published') {
      state.project = event.payload.project;
      state.currentVersion = event.payload.version;
    } else if (event.type === 'message.updated') {
      const index = state.messages.findIndex((message) => message.id === event.payload.id);
      if (index < 0) state.messages.push(event.payload);
      else state.messages[index] = event.payload;
    }
    state.eventCursor = item.seq;
  }
  return state;
}
export const statusLabels: Record<RunDto['status'], string> = {
  queued: '等待执行', running: '正在构建', waiting_input: '需要你的确认', cancelling: '正在停止',
  succeeded: '已交付', failed: '未能完成', cancelled: '已取消', interrupted: '执行中断',
};
export const phaseLabels = { planning: '梳理需求', generating: '编写代码', verifying: '验证应用', repairing: '修复问题', publishing: '准备预览' };
