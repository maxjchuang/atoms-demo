import type {
  CoordinationWorkspaceDto, ConversationMessageDto, CoordinationTurnDto, ConversationEventDto,
  ChangeProposalDto, ClarificationDto,
} from '@atoms/contracts/conversation';
import type { ProjectEventDto } from '@atoms/contracts';
import { applyEvents, EventGap } from './state';

export interface ConversationView {
  workspace: CoordinationWorkspaceDto;
  messages: ConversationMessageDto[];
  turns: CoordinationTurnDto[];
  proposals: ChangeProposalDto[];
  clarifications: ClarificationDto[];
  olderCursor: string | null;
  historyExpanded: boolean;
}
export function upsertRevision<T extends { id: string; revision: number }>(items: T[], incoming: T[]): T[] {
  const values = new Map(items.map(item => [item.id, item]));
  for (const item of incoming) if (!values.has(item.id) || values.get(item.id)!.revision < item.revision) values.set(item.id, item);
  return [...values.values()];
}
export function mergeMessages(items: ConversationMessageDto[], incoming: ConversationMessageDto[]) {
  return upsertRevision(items, incoming).sort((a, b) => a.historySeq - b.historySeq);
}
export function hydrateConversation(previous: ConversationView | null, snapshot: CoordinationWorkspaceDto): ConversationView {
  const existing = previous?.workspace.execution.project.id === snapshot.execution.project.id ? previous : null;
  if (existing && (existing.workspace.executionEventCursor > snapshot.executionEventCursor
    || existing.workspace.conversationEventCursor > snapshot.conversationEventCursor)) return existing;
  const turns = [...snapshot.pendingCoordinationTurns, ...(snapshot.latestCoordinationTurn ? [snapshot.latestCoordinationTurn] : [])];
  return { workspace: snapshot, messages: mergeMessages(existing?.messages ?? [], snapshot.messages),
    turns: upsertRevision(existing?.turns ?? [], turns), proposals: upsertRevision(existing?.proposals ?? [], snapshot.proposals),
    clarifications: upsertRevision(existing?.clarifications ?? [], snapshot.clarifications),
    olderCursor: existing?.historyExpanded ? existing.olderCursor : snapshot.olderMessagesCursor,
    historyExpanded: existing?.historyExpanded ?? false };
}
export function mergeOlderMessages(view: ConversationView, items: ConversationMessageDto[], nextCursor: string | null): ConversationView {
  return { ...view, messages: mergeMessages(view.messages, items), olderCursor: nextCursor, historyExpanded: true };
}
export function applyConversationEvents(current: ConversationView, events: ConversationEventDto[]): ConversationView {
  const view = structuredClone(current);
  for (const event of events) {
    if (event.projectId !== view.workspace.execution.project.id || event.seq <= view.workspace.conversationEventCursor) continue;
    if (event.seq !== view.workspace.conversationEventCursor + 1) throw new EventGap('Coordination event cursor gap');
    const body = event.event;
    if (body.type === 'message.upserted') view.messages = mergeMessages(view.messages, [body.payload]);
    if (body.type === 'turn.updated') {
      view.turns = upsertRevision(view.turns, [body.payload]);
      const latest = view.workspace.latestCoordinationTurn;
      if (!latest || latest.id === body.payload.id || body.payload.createdAt > latest.createdAt) view.workspace.latestCoordinationTurn = body.payload;
    }
    if (body.type === 'proposal.updated') view.proposals = upsertRevision(view.proposals, [body.payload]);
    if (body.type === 'clarification.updated') view.clarifications = upsertRevision(view.clarifications, [body.payload]);
    view.workspace.conversationEventCursor = event.seq;
  }
  view.workspace.pendingCoordinationTurns = view.turns.filter(turn => ['queued', 'processing', 'cancelling'].includes(turn.status));
  const latest = view.turns.reduce<CoordinationTurnDto | null>((previous, turn) => {
    if (!previous) return turn;
    const order = view.messages.find(message => message.id === turn.userMessageId)?.historySeq ?? 0;
    const priorOrder = view.messages.find(message => message.id === previous.userMessageId)?.historySeq ?? 0;
    return order > priorOrder || order === priorOrder && turn.createdAt > previous.createdAt ? turn : previous;
  }, view.workspace.latestCoordinationTurn);
  view.workspace.latestCoordinationTurn = latest;
  return view;
}
export function applyExecutionEvents(current: ConversationView, events: ProjectEventDto[]): ConversationView {
  const execution = applyEvents(current.workspace.execution, events);
  // v1 messages have neither actor metadata nor revision/historySeq. They are
  // consumed only as execution activity, never merged into v2 conversation data.
  execution.messages = current.workspace.execution.messages;
  return { ...current, workspace: { ...current.workspace, execution, executionEventCursor: execution.eventCursor } };
}
export const actorLabels: Record<ConversationMessageDto['actor'], string> = {
  user: '你', coordinator: '项目负责人', worker: '构建执行器', system: '系统状态', legacy_assistant: '历史助手',
};
export const turnLabels: Record<CoordinationTurnDto['status'], string> = {
  queued: '消息已排队', processing: '正在处理你的消息', cancelling: '正在停止回答',
  completed: '已处理', cancelled: '本次回答已停止', failed: '消息处理失败', interrupted: '消息处理中断',
};
