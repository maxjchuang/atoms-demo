import { useEffect, useRef, useState } from 'react';
import type { AnswerRequestDto, RunDto, WorkspaceSnapshotDto } from '@atoms/contracts';
import { SubmitMessageRequest, type SubmitMessageRequestDto } from '@atoms/contracts/conversation';
import type { DeliveryReadViewDto } from '@atoms/contracts/delivery';
import { api, requestKey } from './api';
import { coordinationApi } from './coordination-api';
import { deliveryApi } from './delivery-api';
import { statusLabels } from './state';

export type ReplanRequest = { run: RunDto; answer: AnswerRequestDto | null };
type Saved = { projectId: string; runId: string; attentionId: string; revision: number; question: string; answer: string; body: SubmitMessageRequestDto; cancelKey: string; messageKey: string; phase: 'ready' | 'stopping' | 'stopped' | 'unknown_stop' | 'unknown_send' | 'sent'; stoppedStatus?: RunDto['status']; turnId?: string };
const storageKey = (project: string) => `atoms:run-replan-latest:${project}`;
const recordKey = (value: Saved) => `atoms:run-replan:${value.projectId}:${value.runId}:${value.attentionId}:${value.revision}`;
export function replanMessage(request: ReplanRequest, view: DeliveryReadViewDto) {
  const { run, answer } = request, attention = run.pendingAttention;
  if ((attention ? !answer || attention.kind !== 'question' || answer.attentionId !== attention.id || answer.expectedRevision !== attention.revision : run.status !== 'failed') || view.projectId !== run.projectId || view.runId !== run.id || view.state !== 'available' || view.apiVerification === 'invalid' || !view.report) throw Error('原问题或完整执行约定暂不可核对，未停止任务或发送消息。');
  const selected = answer?.answer;
  const value = !attention ? '无需技术回答；请基于原完整需求重新审阅和规划。' : selected?.kind === 'text' ? selected.text : selected?.kind === 'select' ? attention.options.find(option => option.id === selected.optionId)?.label : null;
  if (!value?.trim()) throw Error('请提供此问题的真实回答。');
  const scope = view.report.seed;
  const content = `请带此回答重新规划完整方案，先不构建、不恢复原计划、不创建执行任务。请保留原完整目标与全部要求，展示完整提案供我明确确认后再构建。\n原任务：${run.id}\n原问题：${attention?.id ?? '原失败任务，无待回答问题'}（revision ${attention?.revision ?? run.revision}）\n问题标题：${attention?.title ?? '基于原失败任务重新规划'}\n问题说明：${attention?.description ?? view.report.failure?.message ?? run.error?.message ?? '保留原失败报告'}\n我的回答：${value}\n原完整目标：${scope.goal}\n原要求：\n${scope.items.map(item => `${item.required ? '必需' : '可选'}：${item.text}`).join('\n')}`;
  const parsed = SubmitMessageRequest.safeParse({ input: { kind: 'text', content }, mode: 'ask', runMode: 'plan' });
  if (!parsed.success) throw Error('完整目标与回答超出消息协议限制，未截断目标、未停止任务或发送消息。');
  return { body: parsed.data, answer: value, question: `${attention?.title ?? '基于原失败任务重新规划'}\n${attention?.description ?? view.report.failure?.message ?? run.error?.message ?? '保留原失败报告'}` };
}
export function stoppedForReplan(run: RunDto, projectId: string, runId: string, activeRunId: string | null) {
  return run.projectId === projectId && run.id === runId && ['cancelled', 'failed', 'interrupted', 'succeeded'].includes(run.status) && activeRunId !== runId;
}
function retainedWriter(workspace: WorkspaceSnapshotDto, runId: string) { return workspace.activeRun?.id === runId || workspace.project.activeRunId === runId ? runId : null; }
function restore(projectId: string): Saved | null { try { const value = JSON.parse(sessionStorage.getItem(sessionStorage.getItem(storageKey(projectId)) ?? '') ?? 'null') as Saved | null; return value?.projectId === projectId && value.body.mode === 'ask' && value.body.runMode === 'plan' && SubmitMessageRequest.safeParse(value.body).success ? value : null; } catch { return null; } }
export function RunReplan({ projectId, request }: { projectId: string; request: ReplanRequest | null }) {
  const [saved, setSaved] = useState<Saved | null>(() => restore(projectId)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), alive = useRef(true), gate = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++epoch.current; }; }, []);
  const persist = (value: Saved) => { sessionStorage.setItem(recordKey(value), JSON.stringify(value)); sessionStorage.setItem(storageKey(projectId), recordKey(value)); setSaved(value); };
  useEffect(() => {
    if (!request || request.run.projectId !== projectId) return;
    if (saved && saved.runId === request.run.id && saved.phase !== 'ready') return;
    if (saved && ['stopping', 'unknown_stop', 'unknown_send'].includes(saved.phase)) { setError('已有停止或发送结果待核对，先处理保留的原请求，不创建新请求。'); return; }
    const own = ++epoch.current; setBusy(true); setError('');
    const abort = new AbortController();
    void deliveryApi.read({ kind: 'runs', id: request.run.id, projectId }, abort.signal).then(view => {
      if (!alive.current || own !== epoch.current || abort.signal.aborted) return;
      const message = replanMessage(request, view); persist({ projectId, runId: request.run.id, attentionId: request.answer?.attentionId ?? 'failed_run', revision: request.answer?.expectedRevision ?? request.run.revision, ...message, cancelKey: requestKey(), messageKey: requestKey(), phase: 'ready' });
    }).catch(failure => { if (alive.current && own === epoch.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '完整目标暂不可读。'); }).finally(() => { if (alive.current && own === epoch.current) setBusy(false); });
    return () => abort.abort();
  }, [request, projectId]);
  async function stop() {
    if (!saved || gate.current || saved.phase === 'sent') return;
    gate.current = true; setBusy(true); setError(''); const own = ++epoch.current, value = saved;
    const owns = () => alive.current && own === epoch.current;
    try {
      persist({ ...value, phase: 'stopping' });
      let run = await api.run(value.runId), workspace = await api.workspace(projectId);
      if (!owns()) return;
      if (workspace.project.id !== projectId || run.projectId !== projectId || run.id !== value.runId) throw Error('原任务对象不一致，未执行停止。');
      if (!stoppedForReplan(run, projectId, value.runId, retainedWriter(workspace, value.runId))) {
        if (['ready', 'stopping', 'unknown_stop'].includes(value.phase) && ['waiting_input', 'running', 'queued'].includes(run.status)) {
          if (value.attentionId !== 'failed_run' && (run.pendingAttention?.id !== value.attentionId || run.pendingAttention?.revision !== value.revision)) throw Error('原问题已变化或已经回答，请重新选择当前问题；未停止新状态。');
          try { await api.cancel(value.runId, value.cancelKey); } catch { /* Unknown cancellation is reconciled only by reads. */ }
        }
        for (let poll = 0; poll < 20 && owns(); poll++) {
          run = await api.run(value.runId); workspace = await api.workspace(projectId);
          if (workspace.project.id === projectId && stoppedForReplan(run, projectId, value.runId, retainedWriter(workspace, value.runId))) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      if (!owns()) return;
      if (!stoppedForReplan(run, projectId, value.runId, retainedWriter(workspace, value.runId))) throw Error('尚未确认原任务停止并释放写入权；未发送重新规划。请稍后核对。');
      persist({ ...value, phase: 'stopped', stoppedStatus: run.status }); dispatchEvent(new Event('atoms-coordination-wake'));
    } catch (failure) { if (owns()) { persist({ ...value, phase: 'unknown_stop' }); setError(failure instanceof Error ? failure.message : '停止结果尚未确认，尚未发送消息。'); } }
    finally { gate.current = false; if (owns()) setBusy(false); }
  }
  async function send() {
    if (!saved || gate.current || !['stopped', 'unknown_send'].includes(saved.phase)) return;
    gate.current = true; setBusy(true); setError(''); const own = ++epoch.current, value = saved;
    const owns = () => alive.current && own === epoch.current;
    try {
      const body = SubmitMessageRequest.parse(value.body);
      const run = await api.run(value.runId), workspace = await api.workspace(projectId);
      if (!owns()) return;
      if (workspace.project.id !== projectId || !stoppedForReplan(run, projectId, value.runId, retainedWriter(workspace, value.runId))) throw Error('原任务停止或写入边界尚未确认，未发送。');
      persist({ ...value, phase: 'unknown_send' });
      const receipt = await coordinationApi.submit(projectId, body, value.messageKey);
      if (!owns()) return;
      persist({ ...value, phase: 'sent', turnId: receipt.turn.id }); dispatchEvent(new Event('atoms-coordination-wake'));
    } catch (failure) { if (owns()) setError(failure instanceof Error ? failure.message : '提交结果尚未确认；保留同一请求。'); }
    finally { gate.current = false; if (owns()) setBusy(false); }
  }
  if (!request && !saved) return null;
  return <div className="attention-card run-replan" data-testid="run-replan"><strong>带回答重新规划 · 先不构建</strong><p>先确认原任务停止且不再写入，再由你明确发送只做规划的项目消息。完整提案仍需确认，不自动创建构建或追加额度。</p>{busy && <p role="status">正在核对原任务与完整约定，请勿重复操作…</p>}{error && <p role="alert">{error}</p>}{saved && <><p>原任务：{saved.runId}；问题：{saved.attentionId}</p><p>你的回答：{saved.answer}</p><details><summary>核对原问题、完整目标与实际发送内容</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{saved.body.input.kind === 'text' ? saved.body.input.content : ''}</pre></details>{saved.phase === 'sent' ? <p>重新规划消息已发送，等待完整提案；尚未授权构建。{saved.turnId}</p> : ['stopped', 'unknown_send'].includes(saved.phase) ? <><p>原任务当前为 {saved.stoppedStatus ? statusLabels[saved.stoppedStatus] : '状态待核对'}，原失败/成功事实保持不变。请核对内容后明确发送。</p><textarea aria-label="重新规划消息" disabled={busy || saved.phase === 'unknown_send'} value={saved.body.input.kind === 'text' ? saved.body.input.content : ''} onChange={event => persist({ ...saved, body: { ...saved.body, input: { kind: 'text', content: event.target.value } } })}/><button className="primary-button" disabled={busy} onClick={() => void send()}>{saved.phase === 'unknown_send' ? '使用同一请求核对并重试发送' : '发送重新规划（先不构建）'}</button></> : <button className="primary-button" disabled={busy} onClick={() => void stop()}>{saved.phase === 'ready' ? '停止并按回答重新规划' : '核对并重试原停止请求'}</button>}</>}</div>;
}
