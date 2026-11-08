import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, Clock3, FileCode2, LoaderCircle, MessageSquare, Square, Wifi, WifiOff } from 'lucide-react';
import type { ProjectEventDto, RunDto } from '@atoms/contracts';
import { isTerminal, phaseLabels, statusLabels } from './state';
import { feedbackTiming, formatDuration, phasePresentation, stageState, summarizeActivity, type ApiSync } from './activity';

export function RunFeedback({ run, events, sync, historyLoading, historyError, busy, onCancel }: {
  run: RunDto; events: ProjectEventDto[]; sync: ApiSync; historyLoading: boolean; historyError: string;
  busy: boolean; onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const activity = useMemo(() => summarizeActivity(run, events), [run, events]);
  const terminal = isTerminal(run);
  const timing = feedbackTiming(run, activity.phaseStartedAt, activity.lastActivityAt, now);
  const idle = timing.idle;
  const longWait = run.status === 'running' && idle >= 45000;
  const presentation = phasePresentation(run);
  const recent = activity.entries.slice(-200);
  return <div className={`run-card feedback-card ${run.status}`} aria-label="任务过程反馈">
    <div className="run-card-top"><span className="run-status-icon">{run.status === 'succeeded' ? <CheckCircle2 size={17}/> : terminal ? <Square size={15}/> : run.status === 'waiting_input' ? <MessageSquare size={16}/> : <LoaderCircle className="spin" size={16}/>}</span><strong>{statusLabels[run.status]}</strong>{!terminal && <button disabled={busy || run.status === 'cancelling'} onClick={onCancel}>{run.status === 'cancelling' ? '等待停止确认' : '停止构建'}</button>}</div>
    <div className="phase-steps">{(['planning', 'generating', 'verifying', 'publishing'] as const).map((phase, index) => {
      const state = stageState(run, phase);
      return <span data-phase={phase} key={phase} className={state}><i>{state === 'done' ? <Check size={9}/> : index + 1}</i>{phaseLabels[phase]}</span>;
    })}</div>
    <div className="current-activity"><strong>{presentation.title}{run.phase === 'repairing' && activity.repairRounds > 0 ? ` · 第 ${activity.repairRounds} 轮` : ''}</strong><p>{presentation.description}</p></div>
    <div className="execution-times"><span><Clock3 size={11}/>总耗时 {formatDuration(timing.total)}</span><span>{terminal ? '结束阶段' : '本阶段'} {formatDuration(timing.phase)}</span></div>
    <div className="last-activity"><span>最后执行活动</span><strong>{activity.lastActivityAt ? `${formatDuration(idle)}前` : '尚未收到'}</strong></div>
    <div className={`api-sync ${sync.status}`} aria-label="API同步状态">{sync.status === 'interrupted' ? <WifiOff size={11}/> : <Wifi size={11}/>}<span>{sync.status === 'ok' ? 'API 状态同步正常' : sync.status === 'interrupted' ? 'API 状态同步中断，正在重试' : '正在同步 API 状态'}</span>{sync.lastSuccessAt && <small>{formatDuration(now - sync.lastSuccessAt)}前同步</small>}</div>
    {longWait && <div className="long-wait" role="status"><Clock3 size={14}/><p>已超过 45 秒尚未收到新的执行结果。你可以继续等待或停止任务；关闭页面不会取消任务。<span>状态同步成功不代表模型或工具已完成。</span></p></div>}
    {run.error && <p className="run-error">{run.error.message}</p>}
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
