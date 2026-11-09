import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react';
import type { BudgetRecoveryReadViewDto } from '@atoms/contracts/budget-recovery';
import type { Session, RunDto } from '@atoms/contracts';
import type { z } from 'zod';
import { HttpError } from './api';
import { recoveryApi, retainPending, readPending, clearPending, diagnosticSummary, continuationRejectionIsDefinitive, type PendingContinuation } from './budget-recovery-api';
import './budget-recovery.css';

type Quota = z.infer<typeof Session>['quota'];
const reasons: Record<NonNullable<BudgetRecoveryReadViewDto['reason']>, string> = {
  DIAGNOSIS_UNAVAILABLE: '尚无可信的预算细分诊断；保留原失败原因，不推断为 Token 用尽。', NOT_TOKEN_BUDGET: '这不是可追加 Token 的中止类型，增加 Token 不能解除该限制。', CHECKPOINT_MISSING: '没有可恢复的已保存源码，不能承诺从中断处继续。', CHECKPOINT_INVALID: '已保存源码未通过完整性检查，不能付额继续。', STOP_UNCONFIRMED: '旧执行尚未确认停止，暂不能创建可能同时写入的后续任务。', REPORT_NOT_FINAL: '原任务报告尚未最终确定，请稍后重新读取。', PUBLICATION_NOT_FENCED: '原任务发布边界尚未确认，暂不能续作。', BACKEND_UNSUPPORTED: '当前执行后端暂不支持已保存源码续作，不会回退到绕过隔离的方式。', RUNTIME_UNAVAILABLE: '执行服务暂不可达，目前不能确认恢复条件。', QUOTA_EXHAUSTED: '可用构建额度不足1次，不能创建后续任务。', PROJECT_BUSY: '项目仍有执行任务，请等待它结束后重新读取。', TARGET_NOT_LATEST: '这已不是任务链的最新中止任务，请查看后续任务。', SCOPE_CHANGED: '当前完整目标或冻结范围已变化，不能沿旧目标直接续作。', HEAD_CHANGED: '项目代码基线已变化，不能静默更换源码后继续。', ALREADY_CONTINUED: '该中止任务已创建过后续任务，不会再次扣额或创建。', PLAN_REVIEW_REQUIRED: '验收计划需要重新审阅：存在已知语义缺陷或尚未完成审阅，不能付额继续原计划。',
};
const number = (value: number | null) => value === null ? '未知' : value.toLocaleString('zh-CN');
const dimension = { input_tokens: '输入 Token（含缓存计量）', output_tokens: '输出 Token', model_steps: '模型步骤', active_ms: '执行时长（毫秒）', repair_rounds: '修复轮数', tool_time_ms: '工具时限（毫秒）', unknown: '预算维度未记录' };
export function BudgetRecoveryCard({ run, onViewRun, onReview, onQuota, onDiagnosis, onCreated }: {
  run: RunDto; onViewRun: (id: string) => void; onReview: () => void; onQuota: (value: Quota) => void; onDiagnosis: (runId: string, summary: string | null) => void; onCreated: () => void;
}) {
  const [view, setView] = useState<BudgetRecoveryReadViewDto | null>(null), [error, setError] = useState('');
  const [pending, setPending] = useState<PendingContinuation | null>(() => readPending(sessionStorage, run.projectId, run.id));
  const [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false), [unknown, setUnknown] = useState(!!pending), [now, setNow] = useState(Date.now());
  const generation = useRef(0), operation = useRef<AbortController | null>(null), gate = useRef(false);
  const callbacks = useRef({ onQuota, onDiagnosis }); callbacks.current = { onQuota, onDiagnosis };
  const subject = `${run.projectId}:${run.id}`, subjectRef = useRef(subject); subjectRef.current = subject;
  async function read() {
    const epoch = ++generation.current, currentSubject = subject; operation.current?.abort(); const abort = new AbortController(); operation.current = abort;
    setLoading(true); setError('');
    try {
      const value = await recoveryApi.read(run.projectId, run.id, abort.signal);
      if (epoch !== generation.current || subjectRef.current !== currentSubject || abort.signal.aborted) return null;
      setView(value); callbacks.current.onQuota(value.quota); callbacks.current.onDiagnosis(run.id, diagnosticSummary(value.diagnosis));
      if (value.lineage.successorRun) { clearPending(sessionStorage, run.projectId, run.id); setPending(null); setUnknown(false); }
      return value;
    } catch (failure) { if (!abort.signal.aborted && epoch === generation.current) setError(failure instanceof Error ? failure.message : '预算恢复信息暂不可读。'); return null; }
    finally { if (epoch === generation.current) setLoading(false); }
  }
  useEffect(() => {
    setView(null); setError(''); setPending(readPending(sessionStorage, run.projectId, run.id)); setUnknown(!!readPending(sessionStorage, run.projectId, run.id));
    void read(); const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { ++generation.current; operation.current?.abort(); clearInterval(timer); };
  }, [subject]);
  const expiry = view?.offer ? Date.parse(view.offer.expiresAt) <= now : false;
  const successor = view?.lineage.successorRun;
  useEffect(() => {
    if (submitting || !view || !unknown && (!successor || ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(successor.status))) return;
    const timer = setTimeout(() => void read(), 2000);
    return () => clearTimeout(timer);
  }, [view, unknown, submitting, subject]);
  async function submit(retrySame = false) {
    if (gate.current || !view || successor || !retrySame && (!view.eligible || !view.offer || expiry || pending)) return;
    gate.current = true; setSubmitting(true); setError('');
    const epoch = ++generation.current, currentSubject = subject; const abort = new AbortController(); operation.current?.abort(); operation.current = abort;
    const current = () => epoch === generation.current && subjectRef.current === currentSubject && !abort.signal.aborted;
    let saved: PendingContinuation | null = pending;
    try {
      // Persist before dispatch. Storage failure means no request, never an untracked spend.
      saved ??= retainPending(sessionStorage, view); setPending(saved);
      const receipt = await recoveryApi.continue(view, saved, abort.signal);
      if (!current()) return;
      callbacks.current.onQuota(receipt.quota); setUnknown(false);
      clearPending(sessionStorage, run.projectId, run.id); setPending(null);
      setView({ ...view, eligible: false, reason: 'ALREADY_CONTINUED', offer: null, lineage: { ...view.lineage, successorRun: receipt.run }, quota: receipt.quota });
      onCreated();
      dispatchEvent(new Event('atoms-coordination-wake'));
    } catch (failure) {
      if (!current()) return;
      const definitive = continuationRejectionIsDefinitive(failure);
      if (definitive) { clearPending(sessionStorage, run.projectId, run.id); setPending(null); setUnknown(false); setView(null); }
      else if (saved) setUnknown(true);
      setError(failure instanceof Error ? failure.message : '提交结果未确认，请先核对。');
    } finally { if (current()) setSubmitting(false); gate.current = false; }
  }
  const diagnosis = view?.diagnosis;
  return <section className="budget-recovery" data-testid="budget-recovery" data-run-id={run.id}>
    <header><h3>预算诊断与续作</h3><button disabled={loading || submitting} onClick={() => void read()}><RefreshCw size={13}/>{unknown ? '核对提交结果' : '重新读取预算状态'}</button></header>
    {loading && <p role="status"><LoaderCircle size={14} className="spin"/>正在读取权威诊断与余量…</p>}
    {submitting && <p role="status">正在确认后续任务，请勿重复提交…</p>}
    {error && <p role="alert" className="budget-error">{error}</p>}
    {view && <>
      {diagnosis && diagnosis.classification !== 'unknown' ? <div className="budget-diagnostic"><strong>{dimension[diagnosis.dimension]}</strong><p>本段上限：{number(diagnosis.limit)}；已观察下界：{diagnosis.observedLowerBound === null ? '未知' : `至少 ${number(diagnosis.observedLowerBound)}`}；最终已结算：{number(diagnosis.settledTotal)}。</p>
        {diagnosis.trigger === 'request_reservation_rejected' && <p>下一请求需预留 {number(diagnosis.nextRequestReservation)}，超过本段剩余预算；预留不等于这些 Token 已被消费。</p>}
        <p>{diagnosis.summary}</p><small>截至 {new Date(diagnosis.asOf).toLocaleString('zh-CN')}。历史输入 {number(diagnosis.historicalUsage.inputTokens)} / 输出 {number(diagnosis.historicalUsage.outputTokens)}；未知不作为0或整条任务链总额。</small></div>
        : <p>未记录可信的细分预算诊断；原任务失败原因与报告保留，不推断为可追加 Token。</p>}
      <p className="budget-quota">可用构建额度 {Math.max(0, view.quota.runLimit - view.quota.runsUsed - view.quota.runsReserved)} 次 · 已预占 {view.quota.runsReserved} · 已结算 {view.quota.runsUsed}</p>
      {view.reason && <p className="budget-reason">{reasons[view.reason]}</p>}
      {view.reason === 'PLAN_REVIEW_REQUIRED' && <><p>追加预算不会修正错误的验收语义。请先重新汇总需求并审阅修正方案；旧报告不会被改写。</p><button className="secondary-button" onClick={onReview}>返回项目对话审阅需求（不创建任务）</button></>}
      {view.offer && <><div className="budget-offer"><strong>为后续任务预占1次构建额度，实际开始后结算</strong><p>追加输入 {number(view.offer.budget.maxInputTokens)} / 输出 {number(view.offer.budget.maxOutputTokens)} Token。从已保存源码继续，不从头生成。新段最多 {view.offer.budget.maxModelSteps} 个模型步骤、{view.offer.budget.maxWallTimeMs / 60000} 分钟、{view.offer.budget.maxRepairRounds} 轮修复。</p><p>沿原冻结目标与验收计划继续；追加预算不会自动修正验收语义，也不保证生成或修复质量。</p>
        <details><summary>核对保留的完整目标与验收</summary><p>{view.offer.frozenScope.goal}</p><ul>{view.offer.frozenScope.criteria.map(item => <li key={item.id}>{item.required ? '必需' : '可选'} · {item.description}</li>)}</ul><small>恢复源码指纹 {view.offer.sourceSnapshotHash}；方案到期 {new Date(view.offer.expiresAt).toLocaleTimeString('zh-CN')}。</small></details></div>
        {!pending && <button className="primary-button budget-continue" disabled={loading || submitting || !view.eligible || expiry} onClick={() => void submit()}>{submitting ? <LoaderCircle size={15} className="spin"/> : null}消耗1次构建额度，追加预算并继续</button>}
        {expiry && !pending && <p>报价已到期。请重新读取，核对后再明确点击；不会自动续作。</p>}
      </>}
      {successor && <div className="budget-successor"><strong>后续任务已建立，原任务仍为失败记录</strong><p>{successor.status === 'queued' && !successor.executionId ? '已预占额度，尚未实际开始；不是永久已扣。' : '当前状态与结算以API记录为准。'}从保存源码继续，不重跑原任务。</p><button onClick={() => onViewRun(successor.id)}>查看后续任务<ArrowRight size={14}/></button></div>}
      {view.lineage.parentRunId && <button className="budget-lineage" onClick={() => onViewRun(view.lineage.parentRunId!)}>查看原中止任务</button>}
      <small className="budget-lineage">任务链起点：{view.lineage.rootRunId} · 当前段 {view.lineage.segment + 1}；历史报告保持原样。</small>
    </>}
    {unknown && pending && <div className="budget-uncertain" role="status"><p>提交结果尚未确认。先核对已有后续任务，刷新也不会换新请求重复扣额。</p><button disabled={loading || submitting || !view} onClick={() => void submit(true)}>使用同一请求重试（不创建第二个任务）</button></div>}
  </section>;
}
