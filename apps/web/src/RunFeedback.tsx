import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, Clock3, FileCode2, LoaderCircle, MessageSquare, Square, Wifi, WifiOff } from 'lucide-react';
import type { ProjectEventDto, RunDto } from '@atoms/contracts';
import { isTerminal, phaseLabels, statusLabels } from './state';
import { feedbackTiming, formatDuration, phasePresentation, stageState, summarizeActivity, type ApiSync } from './activity';
import { useDelivery } from './Delivery';
import { cleanFailureSummary, verificationCounts } from './delivery-presentation';

export function RunFeedback({ run, events, sync, historyLoading, historyError, busy, onCancel, errorSummary, hasPublishedVersion = false, acceptedGoal }: {
  run: RunDto; events: ProjectEventDto[]; sync: ApiSync; historyLoading: boolean; historyError: string;
  busy: boolean; onCancel: () => void; errorSummary?: string | null; hasPublishedVersion?: boolean; acceptedGoal?: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const activity = useMemo(() => summarizeActivity(run, events), [run, events]);
  const terminal = isTerminal(run);
  const timing = feedbackTiming(run, activity.phaseStartedAt, activity.lastActivityAt, now);
  const idle = timing.idle;
  const longWait = run.status === 'running' && idle >= 45000;
  const presentation = phasePresentation(run, hasPublishedVersion);
  const delivery = useDelivery({ kind: 'runs', id: run.id, projectId: run.projectId });
  const read = delivery.view;
  const report = read?.state === 'available' && read.apiVerification !== 'invalid' ? read.report : null;
  const recordedAttempt = report?.attempts.at(-1), candidate = recordedAttempt ? verificationCounts(recordedAttempt.caseResults, report?.bundle?.plan.cases.length) : null;
  const clean = report?.cleanBuild ? verificationCounts(report.cleanBuild.caseResults, report.bundle?.plan.cases.length) : null;
  const explanation = activity.entries.filter(item => item.kind === 'message').at(-1);
  const cleanFailure = cleanFailureSummary(report);
  const reportStage = read?.state === 'pending' ? ({ preparing: '整理目标与验收约定', freezing: '冻结本轮计划', executing: '生成应用源码', verifying: '工作目录验证', clean_export: '独立源码 ZIP 复验', publishing: '宿主核验与发布' })[read.phase] : null;
  const goal = report?.seed.goal ?? acceptedGoal;
  const recent = activity.entries.slice(-200);
  return <div className={`run-card feedback-card ${run.status}`} aria-label="任务过程反馈">
    <div className="run-card-top"><span className="run-status-icon">{run.status === 'succeeded' ? <CheckCircle2 size={17}/> : terminal ? <Square size={15}/> : run.status === 'waiting_input' ? <MessageSquare size={16}/> : <LoaderCircle className="spin" size={16}/>}</span><strong>{statusLabels[run.status]}</strong>{!terminal && <button disabled={busy || run.status === 'cancelling'} onClick={onCancel}>{run.status === 'cancelling' ? '等待停止确认' : '停止构建'}</button>}</div>
    <div className="phase-steps">{(['planning', 'generating', 'verifying', 'publishing'] as const).map((phase, index) => {
      const state = stageState(run, phase);
      return <span data-phase={phase} key={phase} className={state}><i>{state === 'done' ? <Check size={9}/> : index + 1}</i>{phaseLabels[phase]}</span>;
    })}</div>
    <div className="current-activity"><strong>{!terminal && reportStage ? reportStage : presentation.title}</strong><p>{presentation.description}</p></div>
    <div className="execution-times"><span><Clock3 size={11}/>总耗时 {formatDuration(timing.total)}</span><span>{terminal ? '结束阶段' : '本阶段'} {formatDuration(timing.phase)}</span></div>
    <div className="last-activity"><span>最后执行活动</span><strong>{activity.lastActivityAt ? `${formatDuration(idle)}前` : '尚未收到'}</strong></div>
    <div className={`api-sync ${sync.status}`} aria-label="API同步状态">{sync.status === 'interrupted' ? <WifiOff size={11}/> : <Wifi size={11}/>}<span>{sync.status === 'ok' ? 'API 状态同步正常' : sync.status === 'interrupted' ? 'API 状态同步中断，正在重试' : '正在同步 API 状态'}</span>{sync.lastSuccessAt && <small>{formatDuration(now - sync.lastSuccessAt)}前同步</small>}</div>
    {longWait && <div className="long-wait" role="status"><Clock3 size={14}/><p>已超过 45 秒尚未收到新的执行结果。你可以继续等待或停止任务；关闭页面不会取消任务。<span>状态同步成功不代表模型或工具已完成。</span></p></div>}
    {run.error && (errorSummary ? <div className="run-error"><strong>{errorSummary}</strong><details><summary>原执行错误（历史记录）</summary><p>{run.error.message}</p></details></div> : <p className="run-error">{run.error.message}</p>)}
    <section className="repair-observation" aria-label="本轮验证修复进展"><strong>本轮目标与验证进展</strong><p>{goal ? goal.length > 160 ? `${goal.slice(0, 160)}…` : goal : '本轮完整目标尚未提供，不以最后一条消息替代。'}</p>{goal && goal.length > 160 && <details><summary>查看本轮完整目标</summary><p>{goal}</p></details>}
      {!report && acceptedGoal && <small>目标来自此任务明确绑定的已接受提案；完整执行约定待报告提供。</small>}
      {delivery.error && <p>报告读取中断；不推断验证通过或任务已停止。</p>}
      <p>{candidate ? `候选应用自动用例 ${candidate.passed}/${candidate.expected} 通过，${candidate.failed} 项失败${candidate.missing ? `，${candidate.missing} 项结果未返回` : ''}；只代表该尝试。` : '候选应用验证结果尚未提供。'}{report && !report.attempts.length ? '尚无编码尝试。' : ''}</p>
      <p>{clean ? `独立源码 ZIP 自动用例 ${clean.passed}/${clean.expected} 通过，${clean.failed} 项失败${clean.missing ? `，${clean.missing} 项结果未返回` : ''}。` : '独立源码 ZIP 复验结果尚未提供，不由候选通过推断。'}</p>
      {cleanFailure && <p className="run-error">{cleanFailure}</p>}
      <small>最新报告已记录修复轮次：{recordedAttempt ? `${recordedAttempt.repairRound}（0为初始生成）` : '未提供'}。剩余预算暂未提供，不从阶段次数推算。</small>
      {explanation ? <div className="reported-next-step"><strong>项目团队最近说明（不替代验收结论）</strong><p>{explanation.detail ?? explanation.title}</p><small>记录时间：{new Date(explanation.occurredAt).toLocaleTimeString('zh-CN')}</small></div> : <p>项目团队尚未提供后续安排；界面不会自行触发或承诺自动修复。</p>}
      {terminal && run.status !== 'succeeded' && <p>本任务已停止：{run.error?.message ?? report?.failure?.message ?? '未提供细分停止原因'}。历史报告保留。</p>}
      <small>候选生成通过、独立复验通过与实际发布是不同门禁。{read?.publication.status === 'published' ? '宿主已记录发布；质量及未覆盖项仍以交付报告为准。' : '当前读取的报告尚未记录发布。'}</small>
    </section>
    <div className="checks-overview"><strong>必要检查已完成 {activity.completedChecks}/3</strong><span>仅统计实际返回的结果</span></div>
    <div className="core-checks">{activity.coreChecks.map(({ kind, name, check }) => <span key={kind} className={check?.status === 'passed' ? 'passed' : check?.status === 'failed' ? 'failed' : ''}>{check?.status === 'passed' ? <Check size={11}/> : <span className="check-dot"/>}{name}<small>{check?.status === 'passed' ? '通过' : check?.status === 'failed' ? '失败' : check?.status === 'skipped' ? '跳过' : check?.status === 'not_run' ? '未验证' : '待结果'}</small></span>)}</div>
    {activity.files.length > 0 && <div className="file-summary"><FileCode2 size={13}/><span><strong>{activity.files.length} 个文件有变更记录</strong><small>{activity.files.slice(0, 2).map(([path]) => path).join(' · ')}{activity.files.length > 2 ? ` 等 ${activity.files.length} 个` : ''}</small></span></div>}
    <details className="activity-details"><summary><span>执行时间线 {activity.entries.length > 0 ? `· ${activity.entries.length} 条` : ''}</span><ChevronDown size={12}/></summary>
      {historyLoading && <p className="timeline-placeholder">正在恢复执行历史…</p>}{historyError && <p className="timeline-placeholder">{historyError}</p>}
      {!historyLoading && !activity.entries.length && <p className="timeline-placeholder">尚未收到可展示的执行活动。</p>}
      {activity.entries.length > 200 && <p className="timeline-placeholder">展示最近 200 条活动，阶段计时保留完整任务历史。</p>}
      <ol className="execution-timeline">{recent.map((entry, index) => <li key={`${entry.seq}-${index}`} className={entry.kind}><time>{new Date(entry.occurredAt).toLocaleTimeString('zh-CN', { hour12: false })}</time><div><strong>{entry.title}</strong>{entry.detail && <p>{entry.detail}</p>}</div></li>)}</ol>
    </details>
  </div>;
}
