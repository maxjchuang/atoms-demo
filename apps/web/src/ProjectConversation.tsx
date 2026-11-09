import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, Clock3, FileText, History, Layers3, LoaderCircle, MessageSquare, RefreshCw, Sparkles, Square, X } from 'lucide-react';
import type { AnswerRequestDto, ProjectEventDto, RunDto, VersionDto } from '@atoms/contracts';
import type { ChangeProposalDto, ClarificationDto, CoordinationTurnDto, ProjectMemoryViewDto, SubmitMessageRequestDto } from '@atoms/contracts/conversation';
import type { ConversationView } from './conversation-state';
import { actorLabels, turnLabels } from './conversation-state';
import { api } from './api';
import { isTerminal, statusLabels, phaseLabels } from './state';
import { RunFeedback } from './RunFeedback';
import type { ApiSync } from './activity';
import { formatDuration } from './activity';
import { HostAction } from './HostAction';
import { BudgetRecoveryCard } from './BudgetRecovery';
import { recoverySelectionKey, recoveryApi, diagnosticSummary } from './budget-recovery-api';
import { RequirementsPanel, useRequirements } from './Requirements';
import { requirementsApi } from './requirements-api';
import { HttpError } from './api';
import type { ProjectRequirementSnapshotDto } from '@atoms/contracts/requirements';

interface Props {
  view: ConversationView;
  memory: ProjectMemoryViewDto | null;
  versions: VersionDto[];
  events: ProjectEventDto[];
  sync: ApiSync;
  historyLoading: boolean;
  historyError: string;
  busy: boolean;
  onSubmit: (request: SubmitMessageRequestDto) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onRevealMessage: (id: string) => Promise<boolean>;
  onCancelTurn: (turn: CoordinationTurnDto) => Promise<void>;
  onRetryTurn: (turn: CoordinationTurnDto) => Promise<void>;
  onCancelRun: (run: RunDto) => Promise<void>;
  onAnswerRun: (run: RunDto, answer: AnswerRequestDto) => Promise<void>;
  onAccept: (proposal: ChangeProposalDto, runMode: 'build' | 'plan') => Promise<void>;
  onRefreshProposal: (proposal: ChangeProposalDto) => Promise<void>;
  onDismissProposal: (proposal: ChangeProposalDto) => Promise<void>;
  onDismissClarification: (question: ClarificationDto) => Promise<void>;
  onCorrectMemory: (text: string) => void;
  onPrepareRequirementsReview: (snapshot: ProjectRequirementSnapshotDto) => void;
  onBudgetQuota: (quota: import('zod').z.infer<typeof import('@atoms/contracts').Session>['quota']) => void;
}
const kindLabels = { consult: '项目问答', status: '状态查询', change_proposal: '修改需求', clarify: '需求澄清', control: '任务控制' };
export function ProjectConversation(props: Props) {
  const { view, memory, versions, events, busy } = props;
  const [tab, setTab] = useState<'chat' | 'activity' | 'memory'>('chat');
  const [olderLoading, setOlderLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDto | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [budgetSummary, setBudgetSummary] = useState<{runId: string; summary: string | null} | null>(null);
  const [chatBudgetSummary, setChatBudgetSummary] = useState<{runId: string; summary: string | null} | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const previousInput = useRef<string | null>(null);
  const nearBottom = useRef(true);
  const [unseenMessage, setUnseenMessage] = useState(false);
  const execution = view.workspace.execution;
  const currentRun = execution.activeRun ?? execution.latestRun;
  const requirements = useRequirements(execution.project.id, view.workspace.conversationRevision, execution.currentVersion?.id ?? null);
  async function prepareRequirementsReview() { try { const fresh = await requirementsApi.read(execution.project.id); props.onPrepareRequirementsReview(fresh.snapshot); setTab('chat'); } catch (failure) { setSourceError(failure instanceof Error ? failure.message : '当前完整需求暂不可读。'); } }
  async function acceptLegacy(proposal: ChangeProposalDto, mode: 'build' | 'plan') {
    try { await requirementsApi.summary(execution.project.id, proposal.id); requirements.reload(); setSourceError('此提案已有完整需求审阅绑定，请使用上方统一接受入口。'); }
    catch (failure) { if (failure instanceof HttpError && failure.status === 404 && failure.code === 'NOT_FOUND') await props.onAccept(proposal, mode); else setSourceError(failure instanceof Error ? failure.message : '未确认提案绑定，未执行旧接受入口。'); }
  }
  useEffect(() => {
    setChatBudgetSummary(null);
    if (currentRun?.status !== 'failed') return;
    const abort = new AbortController(); let alive = true;
    void recoveryApi.read(execution.project.id, currentRun.id, abort.signal).then(value => {
      if (alive && !abort.signal.aborted) setChatBudgetSummary({ runId: currentRun.id, summary: diagnosticSummary(value.diagnosis) });
    }).catch(() => { /* Original failure remains; no invented diagnosis on read failure. */ });
    return () => { alive = false; abort.abort(); };
  }, [execution.project.id, currentRun?.id, currentRun?.revision, currentRun?.status]);
  const latestSelected = selectedRun ? [...events].reverse().find(event => event.event.type === 'run.updated' && event.event.payload.id === selectedRun.id) : null;
  const activityRun = latestSelected?.event.type === 'run.updated' ? latestSelected.event.payload : selectedRun ?? currentRun;
  useEffect(() => { let alive = true; setSelectedRun(null); setTab('chat'); setSourceError(''); previousInput.current = null; const selected = sessionStorage.getItem(recoverySelectionKey(execution.project.id)); if (selected) void api.run(selected).then(value => { if (alive && value.projectId === execution.project.id) { setSelectedRun(value); setTab('activity'); } }).catch(() => {}); return () => { alive = false; }; }, [execution.project.id]);
  const lastInput = view.messages.filter(message => message.role === 'user' && message.coordinationTurnId !== null).at(-1)?.id ?? null;
  useEffect(() => {
    if (previousInput.current && lastInput && previousInput.current !== lastInput) {
      setTab('chat'); nearBottom.current = true; setUnseenMessage(false);
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
    }
    previousInput.current = lastInput;
  }, [lastInput]);
  const latestMessage = view.messages.at(-1);
  useLayoutEffect(() => {
    if (tab !== 'chat' || !latestMessage) return;
    if (nearBottom.current) requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
    else setUnseenMessage(true);
  }, [latestMessage?.id, latestMessage?.revision]);
  const versionLabel = (id: string | null) => {
    if (!id) return '尚无成功版本';
    const index = versions.findIndex(version => version.id === id);
    return index < 0 ? '已保存版本' : `V${versions.length - index}`;
  };
  async function openRun(id: string) {
    sessionStorage.removeItem(recoverySelectionKey(execution.project.id));
    setTab('activity'); setSourceError('');
    try { setSelectedRun(await api.run(id)); } catch { setSourceError('任务记录暂时无法读取，请刷新重试。'); }
  }
  async function older() {
    if (olderLoading) return;
    setOlderLoading(true); setSourceError('');
    const height = scroll.current?.scrollHeight ?? 0, top = scroll.current?.scrollTop ?? 0;
    try {
      await props.onLoadOlder();
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = top + scroll.current.scrollHeight - height; });
    } catch (error) { setSourceError(error instanceof Error ? error.message : '更早消息暂时不可读。'); }
    finally { setOlderLoading(false); }
  }
  async function reveal(id: string) {
    setTab('chat'); setSourceError('');
    if (!await props.onRevealMessage(id)) { setSourceError('该来源不在当前可读取的历史中。'); return; }
    requestAnimationFrame(() => document.getElementById(`conversation-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  return <>
    <div className="conversation-tabs" role="tablist" aria-label="项目协调视图">
      <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}><MessageSquare size={14}/>项目对话</button>
      <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}><Layers3 size={14}/>构建活动{execution.activeRun && <i/>}</button>
      <button role="tab" aria-selected={tab === 'memory'} onClick={() => setTab('memory')}><BookOpen size={14}/>项目约定{memory && <small>{memory.revision}</small>}</button>
    </div>
    <CompactRun run={currentRun} errorSummary={chatBudgetSummary?.runId === currentRun?.id ? chatBudgetSummary?.summary : null} processingMessage={view.workspace.pendingCoordinationTurns.length > 0} busy={busy}
      onView={() => { setSelectedRun(null); setTab('activity'); }} onCancel={() => currentRun && void props.onCancelRun(currentRun)}/>
    {tab === 'chat' && unseenMessage && <button className="jump-latest" onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; nearBottom.current = true; setUnseenMessage(false); }}>有新消息，跳至最新答复<ChevronDown size={12}/></button>}
    <div className="conversation-scroll coordination-scroll" ref={scroll} onScroll={() => {
      if (!scroll.current || tab !== 'chat') return;
      nearBottom.current = scroll.current.scrollHeight - scroll.current.clientHeight - scroll.current.scrollTop < 80;
      if (nearBottom.current) setUnseenMessage(false);
    }}>
      {sourceError && <p className="coordination-inline-error" role="alert">{sourceError}</p>}
      {tab === 'chat' ? <>
        <div className="coordination-intro"><Sparkles size={16}/><p>可以询问项目，也可以明确提出修改。<small>咨询与状态不占构建次数；明确修改会独立排队。</small></p></div>
        <div className="conversation-shortcuts"><button disabled={busy} onClick={() => void props.onSubmit({ input: { kind: 'status' }, mode: 'ask', runMode: 'build' })}><Clock3 size={13}/>查看当前进度</button><button disabled={busy} onClick={() => void props.onSubmit({ input: { kind: 'sharing_help' }, mode: 'ask', runMode: 'build' })}>如何预览与分享？</button></div>
        <RequirementsPanel view={requirements.view} loading={requirements.loading} error={requirements.error} onReload={requirements.reload} onPrepareReview={() => void prepareRequirementsReview()} onViewRun={id => void openRun(id)} onQuota={props.onBudgetQuota}/>
        {view.olderCursor && <button className="load-older" disabled={olderLoading} onClick={() => void older()}>{olderLoading ? <LoaderCircle className="spin" size={13}/> : <History size={13}/>}加载更早消息</button>}
        {view.messages.map(message => {
          const turn = message.coordinationTurnId ? view.turns.find(item => item.id === message.coordinationTurnId) : undefined;
          const result = turn?.status === 'completed' && turn.assistantMessageId === message.id ? turn.result : null;
          const question = result?.kind === 'clarify' ? view.clarifications.find(item => item.id === result.clarificationId) : null;
          const proposal = result?.kind === 'change_proposal' ? view.proposals.find(item => item.id === result.proposalId) : null;
          return <div key={message.id} id={`conversation-${message.id}`} className="conversation-item" data-message-id={message.id}>
            <div className={`message ${message.role}`}><span className={`message-avatar ${message.role}`}>{message.actor === 'user' ? '你' : message.actor === 'coordinator' ? 'M' : message.actor === 'worker' ? 'W' : '·'}</span><div><small>{actorLabels[message.actor]}{result && <span className={`outcome-badge ${result.kind}`}>{kindLabels[result.kind]}</span>}</small><p>{message.content}{message.status === 'streaming' && <span className="typing-dot"/>}</p>
              {result && (result.kind === 'consult' || result.kind === 'status') && <div className="answer-basis">基于 {versionLabel(result.contextUsed.contextVersionId)} · 截止 {new Date(result.contextUsed.asOf).toLocaleTimeString('zh-CN', { hour12: false })}<span>项目约定 revision {result.contextUsed.memoryRevision}</span></div>}
            </div></div>
            {result && (result.kind === 'consult' || result.kind === 'status') && result.references.length > 0 && <div className="answer-references">{result.references.map((reference, index) => reference.kind === 'available_action' ? <HostAction key={index} turnId={turn!.id} actionId={reference.actionId} onViewRun={id => void openRun(id)}/> : <span key={index}>{reference.kind === 'version' ? `参考 ${versionLabel(reference.versionId)}` : reference.kind === 'file' ? `源码：${reference.path}` : reference.kind === 'run' ? <button onClick={() => void openRun(reference.runId)}>查看关联任务</button> : <button onClick={() => setTab('memory')}>查看项目约定</button>}</span>)}</div>}
            {proposal && (requirements.view?.pendingSummaries.some(summary => summary.proposal.id === proposal.id) ? <div className="requirements-legacy-notice">此提案绑定完整累计需求，不能仅接受最后一句追加。<button onClick={() => document.querySelector<HTMLElement>(`.complete-requirements-summary[data-proposal-id="${proposal.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>查看完整累计方案</button></div> : <ProposalCard proposal={proposal} busy={busy || requirements.loading || !!requirements.error} runMode={turn?.runMode ?? 'build'} versionLabel={versionLabel} onAccept={mode => void acceptLegacy(proposal, mode)} onRefresh={() => void props.onRefreshProposal(proposal)} onDismiss={() => void props.onDismissProposal(proposal)} onViewRun={id => void openRun(id)}/>)}
            {question && <ClarificationCard question={question} busy={busy} onDismiss={() => void props.onDismissClarification(question)} onReply={input => props.onSubmit({ input, mode: turn?.mode ?? 'ask', runMode: turn?.runMode ?? 'build', replyTo: { clarificationId: question.id, expectedRevision: question.revision, replyToMessageId: question.questionMessageId } })}/>}
            {result?.kind === 'control' && <div className="control-receipt"><Square size={13}/><span>{result.receipt === 'cancellation_requested' ? '取消构建请求已接收，等待执行停止确认。' : result.receipt === 'already_terminal' ? '目标构建已结束，没有新增任务。' : result.reason?.message ?? '未执行取消。'}</span><button onClick={() => void openRun(result.targetRunId)}>查看目标构建</button></div>}
            {message.role === 'user' && view.turns.filter(item => item.userMessageId === message.id && item.status !== 'completed'
              && !view.turns.some(retry => retry.retryOfTurnId === item.id)).map(item => <TurnCard key={item.id} turn={item} busy={busy} onCancel={() => void props.onCancelTurn(item)} onRetry={() => void props.onRetryTurn(item)}/>)}
          </div>;
        })}
        {execution.activeRun?.pendingAttention && <RunAttention run={execution.activeRun} busy={busy} onAnswer={answer => void props.onAnswerRun(execution.activeRun!, answer)}/>}
        {execution.queuedRuns.length > 0 && <div className="queue-card"><Clock3 size={14}/>{execution.queuedRuns.length} 个修改任务排队，将在开始时使用最新成功版本。</div>}
      </> : tab === 'activity' ? <>
        <div className="activity-view-heading"><h3>构建活动</h3><p>执行任务与项目问答独立。停止回答不会停止构建。</p></div>
        {activityRun ? <><RunFeedback run={activityRun} events={events} sync={props.sync} historyLoading={props.historyLoading} historyError={props.historyError} busy={busy} errorSummary={budgetSummary?.runId === activityRun.id ? budgetSummary.summary : null} onCancel={() => void props.onCancelRun(activityRun)}/>{activityRun.status === 'failed' && <BudgetRecoveryCard key={activityRun.id} run={activityRun} onViewRun={id => void openRun(id)} onQuota={props.onBudgetQuota} onDiagnosis={(runId, summary) => setBudgetSummary({runId, summary})} onCreated={() => setSelectedRun(activityRun)} onReview={() => void prepareRequirementsReview()}/>}</> : <div className="no-run-state"><Layers3 size={24}/><p>还没有构建任务。明确的修改需求经准入后才会进入这里。</p></div>}
        {execution.activeRun?.pendingAttention && <RunAttention run={execution.activeRun} busy={busy} onAnswer={answer => void props.onAnswerRun(execution.activeRun!, answer)}/>}
        {execution.queuedRuns.map(run => <button className="queued-run-link" key={run.id} onClick={() => void openRun(run.id)}>等待中的修改任务 · {new Date(run.createdAt).toLocaleTimeString('zh-CN')}</button>)}
      </> : <>
        <div className="memory-heading"><h3>项目约定</h3><p>只保存有用户来源的目标、偏好与决定；不会由记忆扩大执行权限。</p>{memory && <span>记忆 revision {memory.revision}</span>}</div>
        {memory?.summary && <p className="memory-summary">{memory.summary}</p>}
        <label className="memory-filter"><input type="checkbox" checked={showSuperseded} onChange={event => setShowSuperseded(event.target.checked)}/>显示已被纠正的旧约定</label>
        {(!memory || !memory.decisions.length) && <p className="empty-memory">还没有已确认的项目约定。可以告诉负责人“记住我的偏好…”。</p>}
        {memory?.decisions.filter(decision => showSuperseded || decision.status === 'active').map(decision => <div className={`memory-card ${decision.status}`} key={decision.id}><div><span>{({ goal: '目标', preference: '偏好', decision: '决定' })[decision.kind]}</span><small>{decision.status === 'active' ? '当前生效' : '已被纠正'} · revision {decision.revision}</small></div><p>{decision.text}</p>{decision.supersedesDecisionId && <small>替代了此前的约定，旧来源仍保留。</small>}<div className="memory-actions">{decision.sourceMessageIds.map((id, index) => <button key={id} onClick={() => void reveal(id)}><FileText size={12}/>查看来源{decision.sourceMessageIds.length > 1 ? index + 1 : ''}</button>)}{decision.status === 'active' && <button onClick={() => props.onCorrectMemory(decision.text)}>纠正此约定</button>}</div></div>)}
      </>}
    </div>
  </>;
}

function CompactRun({ run, processingMessage, busy, onView, onCancel, errorSummary }: { run: RunDto | null; processingMessage: boolean; busy: boolean; onView: () => void; onCancel: () => void; errorSummary?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const ended = isTerminal(run);
  return <div className="current-run-strip" aria-label="当前构建状态">
    {run ? <><span className="strip-context">{ended ? '最近构建' : '当前构建'}</span><span className="run-card-top"><strong>{statusLabels[run.status]}</strong></span><button onClick={onView}>查看构建活动</button>{!ended && <button disabled={busy || run.status === 'cancelling'} onClick={onCancel}>停止构建</button>}
      <div className="strip-phase"><span>{run.phase ? phaseLabels[run.phase] : '尚未获得执行资源'}</span><span>总耗时 {formatDuration((ended ? Date.parse(run.updatedAt) : now) - Date.parse(run.createdAt))}</span></div>
      {run.error && <p className="compact-run-error">{errorSummary ?? run.error.message} · 查看构建活动中的具体诊断。</p>}
      {processingMessage && ended && <small className="strip-understanding">正在处理新消息，尚未创建新的构建。</small>}
    </> : <><span>{processingMessage ? '正在处理消息，尚未创建构建' : '当前没有构建任务'}</span><small>咨询不会创建应用版本</small></>}
  </div>;
}

function TurnCard({ turn, busy, onCancel, onRetry }: { turn: CoordinationTurnDto; busy: boolean; onCancel: () => void; onRetry: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const pending = ['queued', 'processing', 'cancelling'].includes(turn.status);
  return <div className={`coordination-turn ${turn.status}`} data-turn-id={turn.id}><div>{pending ? <LoaderCircle className="spin" size={13}/> : <Square size={12}/>}<strong>{turnLabels[turn.status]}</strong>{pending && <span>{formatDuration(now - Date.parse(turn.createdAt))}</span>}</div>
    {turn.status === 'processing' && <p>负责人仅在受控项目上下文中处理消息；尚未返回可展示的答复。</p>}
    {turn.status === 'processing' && now - Date.parse(turn.startedAt ?? turn.createdAt) > 45000 && <p>尚未收到本条消息的新答复。可以停止回答，当前构建不受影响。</p>}
    {turn.error && <p role="alert">{turn.error.message}</p>}
    {pending && <button disabled={busy || turn.status === 'cancelling'} onClick={onCancel}>停止回答</button>}
    {['failed', 'interrupted', 'cancelled'].includes(turn.status) && <button disabled={busy} onClick={onRetry}>重试本条消息</button>}
    {turn.status === 'cancelled' && <small>仅停止消息处理，已创建的构建任务需单独停止。</small>}
  </div>;
}
function ClarificationCard({ question, busy, onReply, onDismiss }: { question: ClarificationDto; busy: boolean; onReply: (input: SubmitMessageRequestDto['input']) => Promise<void>; onDismiss: () => void }) {
  const [text, setText] = useState('');
  return <div className={`message-clarification ${question.status}`} data-clarification-id={question.id}>
    <span className="card-kind"><MessageSquare size={13}/>{question.status === 'open' ? '消息级澄清 · 当前未授权构建' : '消息级澄清记录'}</span><h3>{question.question}</h3>
    {question.status === 'open' ? <><p>这条回答只绑定当前问题，不会被当作其他任务的授权。</p><div className="clarification-options">{question.options.map(option => <button key={option.id} disabled={busy} onClick={() => void onReply({ kind: 'selection', optionId: option.id })}>{option.label}</button>)}</div>{question.allowText && <form onSubmit={event => { event.preventDefault(); void onReply({ kind: 'text', content: text.trim() }); }}><label>回复此澄清<textarea aria-label="回复消息澄清" value={text} onChange={event => setText(event.target.value)} placeholder="补充这个问题的具体答案…"/></label><button className="primary-button" disabled={busy || !text.trim()}>提交澄清回答</button></form>}<button className="card-dismiss" disabled={busy} onClick={onDismiss}>暂不处理此问题</button></> : <p>{({ answered: '回答已保存，后续消息会独立处理。', dismissed: '已关闭此问题。', superseded: '问题已被新的上下文替代，请勿回答旧问题。', expired: '问题已过期，可重新说明需求。' })[question.status]}</p>}
  </div>;
}
function ProposalCard({ proposal, busy, runMode, versionLabel, onAccept, onRefresh, onDismiss, onViewRun }: {
  proposal: ChangeProposalDto; busy: boolean; runMode: 'build' | 'plan'; versionLabel: (id: string | null) => string;
  onAccept: (mode: 'build' | 'plan') => void; onRefresh: () => void; onDismiss: () => void; onViewRun: (id: string) => void;
}) {
  const [strategy, setStrategy] = useState(runMode);
  return <div className={`change-proposal ${proposal.status}`} data-proposal-id={proposal.id}>
    <span className="card-kind"><Layers3 size={13}/>{proposal.status === 'accepted' ? '修改已准入' : '修改提案 · 尚未执行'}</span><h3>{proposal.summary}</h3><strong>本提案目标</strong><p>{proposal.goal}</p>
    <div className="proposal-baseline">{proposal.basePolicy.kind === 'latest_on_dispatch' ? '将在开始构建时使用最新成功版本。' : proposal.basePolicy.expectedBaseVersionId === null ? '首个版本，尚无已发布应用；首次交付后此基线需要重新确认。' : `仅针对 ${versionLabel(proposal.basePolicy.expectedBaseVersionId)}；基线改变后需要重新确认。`}</div>
    <strong>本提案验收要求</strong><ul>{proposal.acceptance.map(item => <li key={item.id}><Check size={12}/>{item.description}</li>)}</ul>
    {proposal.lastAdmissionError && <p className="proposal-error">{proposal.lastAdmissionError.message}</p>}
    {proposal.status === 'open' && <><label className="proposal-strategy">构建策略<select aria-label="提案构建策略" value={strategy} onChange={event => setStrategy(event.target.value as 'build' | 'plan')}><option value="build">直接构建</option><option value="plan">先确认计划</option></select></label><button className="primary-button" disabled={busy} onClick={() => onAccept(strategy)}>接受提案并创建构建</button><small>仅此操作会使用一次构建额度；刷新提案不会创建构建。</small><button className="card-dismiss" disabled={busy} onClick={onDismiss}>不采用此提案</button></>}
    {['stale', 'expired'].includes(proposal.status) && <><p>当前提案不可执行。刷新只会重新评估，并产生需要再次接受的新提案。</p><button className="secondary-button" disabled={busy} onClick={onRefresh}><RefreshCw size={13}/>刷新提案（只读重评）</button></>}
    {proposal.status === 'accepted' && proposal.acceptedRunId && <button className="secondary-button" onClick={() => onViewRun(proposal.acceptedRunId!)}>查看已创建的构建任务</button>}
    {proposal.status === 'dismissed' && <p>已关闭，没有创建构建。</p>}
  </div>;
}
function RunAttention({ run, busy, onAnswer }: { run: RunDto; busy: boolean; onAnswer: (answer: AnswerRequestDto) => void }) {
  const [text, setText] = useState(''); const attention = run.pendingAttention!;
  const answer = (value: AnswerRequestDto['answer']) => onAnswer({ attentionId: attention.id, expectedRevision: attention.revision, answer: value });
  return <div className="attention-card run-attention" data-attention-id={attention.id}><span className="attention-label"><Layers3 size={13}/>{attention.kind === 'plan_confirmation' ? '构建任务的计划确认' : '执行中的问题'} · 属于已有任务</span><h3>{attention.title}</h3><p>{attention.description}</p>{attention.plan && <ol>{attention.plan.tasks.map(task => <li key={task}>{task}</li>)}</ol>}
    {run.pendingAnswer?.status === 'pending' ? <p>回答已保存，等待执行器接收。</p> : <>{attention.kind === 'plan_confirmation' && <button className="primary-button" disabled={busy} onClick={() => answer({ kind: 'approve_plan' })}>确认计划，继续本次构建</button>}{attention.options.map(option => <button className="secondary-button" key={option.id} disabled={busy} onClick={() => answer({ kind: 'select', optionId: option.id })}>{option.label}</button>)}{attention.allowText && <form onSubmit={event => { event.preventDefault(); answer({ kind: 'text', text: text.trim() }); }}><textarea aria-label="回答构建中的问题" value={text} onChange={event => setText(event.target.value)}/><button className="primary-button" disabled={busy || !text.trim()}>提交构建问题回答</button></form>}</>}
    <small>这不是新的消息级澄清；回答会恢复同一个构建任务。</small>
  </div>;
}
