import { useEffect, useRef, useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import type { ProjectRequirementSnapshotDto } from '@atoms/contracts/requirements';
import { requirementsApi, isCurrentSummary, type RequirementsView, type Summary } from './requirements-api';
import type { Session } from '@atoms/contracts';
import type { z } from 'zod';
import './requirements.css';

export function useRequirements(projectId: string, revision: number, baseId: string | null, changeKey = '') {
  const [view, setView] = useState<RequirementsView | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const readKey = JSON.stringify([projectId, revision, baseId, changeKey, retry]);
  const [settledKey, setSettledKey] = useState('');
  const identity = useRef(readKey); identity.current = readKey;
  useEffect(() => {
    let alive = true; const abort = new AbortController(); setLoading(true); setError('');
    void requirementsApi.read(projectId, abort.signal).then(value => { if (alive && identity.current === readKey) { setView(previous => previous?.snapshot.projectId === projectId && previous.snapshot.revision > value.snapshot.revision ? previous : value); setSettledKey(readKey); } })
      .catch(failure => { if (alive && identity.current === readKey) { setView(null); setSettledKey(readKey); setError(failure instanceof Error ? failure.message : '完整需求暂不可读。'); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; abort.abort(); };
  }, [projectId, revision, baseId, changeKey, retry]);
  return { view: settledKey === readKey && view?.snapshot.projectId === projectId ? view : null, error: settledKey === readKey ? error : '', loading: loading || settledKey !== readKey, reload: () => setRetry(value => value + 1) };
}
const authorization = { requested: '已提出 · 未授权构建', suggested: '建议 · 未确认', confirmed: '已明确确认' };
const state = { active: '当前要求', withdrawn: '已撤销（保留来源）', superseded: '已被替代（保留来源）' };
const exclusion = { explicit_user_withdrawal: '拟按用户来源撤销', explicit_user_replacement: '拟按用户来源替换', unaccepted_suggestion: '未采用的未确认建议' };
export function RequirementsPanel({ view, loading, error, onReload, onPrepareReview, onViewRun, onQuota, showSummaries = true }: {
  showSummaries?: boolean; view: RequirementsView | null; loading: boolean; error: string; onReload: () => void; onPrepareReview: () => void; onViewRun: (id: string) => void; onQuota: (quota: z.infer<typeof Session>['quota']) => void;
}) {
  return <section className="requirements-panel" data-testid="requirements-panel"><header><h3><ClipboardList size={15}/>完整需求与构建前审阅</h3><button disabled={loading} onClick={onReload}><RefreshCw size={12}/>重新读取需求</button></header>
    {loading && !view && <p role="status">正在读取权威需求快照…</p>}{error && <p role="alert">{error} 未能读取不等于需求为空；不绕过完整审阅。</p>}
    {view && <><p className="requirements-base">{view.snapshot.base.kind === 'empty_project' ? '首个版本，尚无已发布应用或源码。' : `基于已发布版本 ${view.snapshot.base.versionId}${view.snapshot.base.sourceAvailable ? '，源码可用。' : '，源码当前不可用，不能授权修改。'}`}</p>
      <small>以下为已记录的需求状态；只问项目中的提案可保留要求，但不等于已授权构建。</small>
      {showSummaries && [...view.pendingSummaries].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(summary => <CompleteSummary key={`${summary.id}:${summary.revision}`} summary={summary} snapshot={view.snapshot} disabled={loading || !!error} onReload={onReload} onViewRun={onViewRun} onQuota={onQuota}/>)}
      <strong>来源条目与当前状态</strong>
      {!view.snapshot.entries.length ? <p>尚未记录产品需求。普通咨询不会变成新要求。</p> : <div className="requirement-entries">{view.snapshot.entries.map(entry => <article key={entry.id} className={`requirement-entry ${entry.state}`}><span>{authorization[entry.authorization]} · {state[entry.state]}</span><p>{entry.text}</p><details><summary>查看原始用户来源</summary>{entry.sources.map((source, index) => <div key={`${source.messageId}:${index}`}><blockquote>{source.quote}</blockquote>{source.questionText && <p>绑定的问题：{source.questionText}</p>}<small>来源消息 {source.messageId}{source.proposalId ? ` · 提案 ${source.proposalId}` : ''}{source.decisionId ? ` · 决定 ${source.decisionId}` : ''}</small></div>)}</details></article>)}</div>}
      <button className="secondary-button" disabled={loading || !!error} onClick={onPrepareReview}>整理完整需求（填写草稿，需发送）</button><small>此按钮只填写可编辑草稿。发送后仅形成只读审阅，不自动构建。</small>
    </>}
    {!view && !loading && <button disabled={!!error} onClick={onPrepareReview}>整理完整需求</button>}
  </section>;
}
export function CompleteSummary({ summary, snapshot, disabled, onReload, onViewRun, onQuota, onRefresh }: { onRefresh?: () => void; summary: Summary; snapshot: ProjectRequirementSnapshotDto; disabled: boolean; onReload: () => void; onViewRun: (id: string) => void; onQuota: (quota: z.infer<typeof Session>['quota']) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState(summary.acceptedRunId);
  const gate = useRef(false), identity = useRef(`${summary.projectId}:${summary.id}`); identity.current = `${summary.projectId}:${summary.id}`;
  const stale = !isCurrentSummary(summary, snapshot);
  async function accept() {
    if (gate.current || disabled || stale || accepted || summary.proposal.status !== 'open') return;
    gate.current = true; setBusy(true); setError(''); const subject = `${summary.projectId}:${summary.id}`;
    try { const result = await requirementsApi.accept(summary, snapshot); if (identity.current !== subject) return; setAccepted(result.run.id); onQuota(result.quota); onReload(); dispatchEvent(new Event('atoms-coordination-wake')); }
    catch (failure) { if (identity.current === subject) { setError(failure instanceof Error ? failure.message : '接受结果尚未确认，请重新读取原方案。'); onReload(); } }
    finally { if (identity.current === subject) setBusy(false); gate.current = false; }
  }
  useEffect(() => { identity.current = `${summary.projectId}:${summary.id}`; return () => { identity.current = ''; }; }, [summary.projectId, summary.id]);
  return <article className="complete-requirements-summary requirements-panel" data-summary-id={summary.id} data-proposal-id={summary.proposal.id}>
    <h4>{accepted ? '完整方案已明确接受' : '请确认完整方案'}</h4>{accepted ? <button className="secondary-button" onClick={() => onViewRun(accepted)}>查看完整方案对应任务</button> : <details className="complete-summary-review"><summary>查看完整目标、验收要求和基线并确认</summary>{!accepted && <small>本方案仍待明确接受；已提出要求和模型建议不等于执行授权。</small>}<p className="complete-goal">{summary.draft.goal}</p>
    <p className="summary-baseline-copy">{summary.proposal.basePolicy.kind === 'latest_on_dispatch'
      ? `${summary.snapshot.base.kind === 'empty_project' ? '审阅时尚无已发布应用' : `审阅时基于已发布版本 ${summary.snapshot.base.versionId}`}；开始构建时使用届时最新成功版本，无则使用模板。`
      : summary.proposal.basePolicy.expectedBaseVersionId === null ? '精确锁定当前尚无已发布版本的状态；基线变化须重新审阅。' : `精确锁定已发布版本 ${summary.proposal.basePolicy.expectedBaseVersionId}；基线变化须重新审阅。`}</p>
    <strong>累计验收要求（尚不是通过结果）</strong><ul>{summary.draft.acceptance.map(item => <li key={item.id}><span>{item.description}</span><details><summary>查看验收来源</summary><small>对应来源要求：{summary.draft.coverage.find(mapping => mapping.acceptanceId === item.id)?.entryIds.map(id => { const entry = summary.snapshot.entries.find(value => value.id === id); return entry ? `${entry.text}（审阅时：${authorization[entry.authorization]}）` : id; }).join('；')}</small></details></li>)}</ul>
    <details><summary>核对纳入的原始要求</summary><p>纳入本次方案：{summary.draft.includedEntryIds.map(id => summary.snapshot.entries.find(entry => entry.id === id)?.text ?? id).join('；')}</p></details>
    {summary.draft.exclusions.length > 0 && <aside><strong>明确展示的撤销、替换或未采用建议</strong>{summary.draft.exclusions.map(item => <div key={item.entryId}><p>{exclusion[item.reason]}：{summary.snapshot.entries.find(entry => entry.id === item.entryId)?.text}</p>{item.source && <blockquote>{item.source.quote}</blockquote>}</div>)}<small>接受前不把这些候选变更偷偷写成已确认状态。</small></aside>}
    {stale && !accepted && <p className="requirements-error">该方案引用历史需求快照或基线，不能直接执行。请重新整理并审阅当前完整方案。{onRefresh && <button disabled={disabled || busy} onClick={onRefresh}>重新整理完整方案</button>}</p>}
    {error && <p role="alert" className="requirements-error">{error}</p>}
    {accepted ? <button className="secondary-button" onClick={() => onViewRun(accepted)}>查看完整方案对应任务</button> : <button className="primary-button" disabled={disabled || busy || stale || summary.proposal.status !== 'open'} onClick={() => void accept()}>{busy ? '正在核对完整授权…' : '接受完整方案并创建构建'}</button>}
    <small>明确接受才预占1次构建额度；实际开始后结算。类型检查通过不等于这些功能已验收。</small>
    <details><summary>核对审阅快照与精确绑定</summary><small>方案 revision {summary.revision}；提案 revision {summary.proposal.revision}；快照 revision {summary.snapshot.revision}</small><pre>{summary.snapshot.hash}</pre></details></details>}
  </article>;
}
