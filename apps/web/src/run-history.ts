import type { RunDto, WorkspaceSnapshotDto, ProjectEventDto } from '@atoms/contracts';

/** Display-only history: never apply old events to the current workspace/preview. */
export function collectRunHistory(workspace: WorkspaceSnapshotDto, events: ProjectEventDto[]): RunDto[] {
  const runs = new Map<string, RunDto>();
  const include = (run: RunDto | null) => { if (!run || run.projectId !== workspace.project.id) return; const previous = runs.get(run.id); if (!previous || previous.revision <= run.revision) runs.set(run.id, run); };
  for (const item of events) if (item.projectId === workspace.project.id && item.event.type === 'run.updated' && item.runId === item.event.payload.id) include(item.event.payload);
  // At equal revision the actual workspace projection wins over display history.
  for (const run of [...workspace.queuedRuns, workspace.latestRun, workspace.activeRun]) include(run);
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
