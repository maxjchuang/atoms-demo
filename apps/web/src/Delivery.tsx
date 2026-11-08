import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { ExportReadView, VersionDiffPage, EvidenceDescriptor, type DeliveryReadViewDto, type DeliveryReportDto } from '@atoms/contracts/delivery';
import { deliveryApi, assertReportBinding, criterionResult, shouldPollDelivery, verifiedBytes, saveBlob, type DeliverySubject } from './delivery-api';
import './delivery.css';
const failure = (error: unknown) => error instanceof Error ? error.message : '暂时无法读取交付信息。';
const quality = { pending: '正在核验', complete: '约定验收完成', partial: '部分交付', blocked: '交付受阻', legacy_unverified: '历史版本 · 未验证' };
const result = { passed: '通过', failed: '失败', not_run: '未运行', skipped: '已跳过', invalid: '无效', cancelled: '已取消', interrupted: '已中断', incomplete: '未完成' };
const phaseLabel = { preparing: '整理目标与验收约定，尚未写入应用', freezing: '锁定本轮约定与测试计划', executing: '实现应用', verifying: '验证声明行为', clean_export: '从源码 ZIP 干净安装并复验', publishing: '宿主核验并发布' };
const admissionLabel = { direct_request: '直接提交的构建需求', auto_explicit_request: '明确需求自动准入', explicit_proposal_acceptance: '已接受修改提案', confirmed_plan: '已确认原计划' };
const apiVerificationLabel = { pending: '报告待核验', verified: '报告已核验', invalid: '报告未通过可信核验' };
const reasonLabel = (reason: string) => ({ 'Frozen automatic verification has an unresolved failure.': '冻结计划的自动验证仍有未解除的失败。', 'This criterion lacks a current passing application and clean-export result.': '本项尚无应用与干净导出复验的一致通过结果。' })[reason] ?? reason;
const coverageLabel = { automated: '自动验证', manual: '需人工判断', unsupported: '当前无法验证' };
export function useDelivery(subject: DeliverySubject | null) {
  const [state, setState] = useState<{ key: string; view: DeliveryReadViewDto | null; error: string; loading: boolean }>({ key: '', view: null, error: '', loading: false });
  const [retry, setRetry] = useState(0);
  const key = subject ? `${subject.projectId}:${subject.kind}:${subject.id}` : '';
  const identity = useRef(''); identity.current = key;
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>; const controller = new AbortController();
    setState({ key, view: null, error: '', loading: !!subject });
    if (!subject) return;
    async function read() {
      try {
        const view = await deliveryApi.read(subject!, controller.signal);
        if (!alive || identity.current !== key) return;
        setState(previous => previous.view && previous.view.revision > view.revision ? previous : { key, view, error: '', loading: false });
        if (shouldPollDelivery(view)) timer = setTimeout(read, 1500);
      } catch (error) { if (alive && identity.current === key) { setState(previous => ({ ...previous, error: failure(error), loading: false })); timer = setTimeout(read, 5000); } }
    }
    void read(); return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [key, retry]);
  return { ...(state.key === key ? state : { key, view: null, error: '', loading: !!subject }), reload: () => setRetry(value => value + 1) };
}
function Gaps({ view }: { view: DeliveryReadViewDto }) {
  if (view.state !== 'available' || !view.gaps.length) return null;
  return <ul className="delivery-gaps">{view.gaps.map(gap => <li key={gap.criterionId}><strong>{gap.required ? '必需' : '可选'} · {coverageLabel[gap.coverage]} · {result[gap.result]}</strong><span>{gap.description}</span><small>{reasonLabel(gap.reason)}</small>{reasonLabel(gap.reason) !== gap.reason && <details><summary>原始缺口说明</summary><small>{gap.reason}</small></details>}</li>)}</ul>;
}
export function DeliveryBadge({ subject, onOpen, context, previewLabel }: { subject: DeliverySubject; onOpen?: () => void; context?: string; previewLabel?: string }) {
  const { view, error, loading, reload } = useDelivery(subject);
  const label = view?.state === 'pending' ? '准备验收约定中' : view?.state === 'legacy' ? subject.kind === 'runs' ? '历史任务 · 未记录新验收' : quality.legacy_unverified : view ? quality[view.quality] : '正在读取交付报告';
  return <div className={`delivery-summary ${view?.state === 'available' ? view.quality : ''}`} data-testid="delivery-summary">
    <div><strong>{error ? '交付报告暂不可读' : subject.kind === 'runs' && view?.state === 'available' && view.quality === 'blocked' ? `本次交付受阻${previewLabel ? `，当前仍显示 ${previewLabel}` : ''}` : context ? `${context} · ${label}` : label}</strong>{onOpen && <button onClick={onOpen}>查看交付报告</button>}</div>
    {error ? <p role="alert">{error} <button onClick={reload}>重试读取</button></p> : loading ? <p>读取期间不推断验收结果。</p> : view?.state === 'available' ? <><p>{view.publication.status === 'published' ? '此版本已发布' : '尚未发布；报告完成不代表版本已发布'}{view.apiVerification === 'pending' ? ' · API 正在核验报告' : view.apiVerification === 'invalid' ? ' · 证据未通过可信核验' : ''}</p><Gaps view={view}/>{previewLabel && <p>当前仍显示 {previewLabel} · 上次成功交付的应用。</p>}{view.error && <p role="alert">{view.error.message}</p>}{view.provenance.evidenceReuse === 'restored_unchanged_source' && <p>恢复版本复用原约定证据，未重跑；不代表新目标已验收。</p>}</> : view?.state === 'legacy' ? <p>未记录声明行为与干净导出复验，保留原访问能力。</p> : view?.state === 'pending' ? <p>当前交付阶段：{phaseLabel[view.phase]}；尚无最终验收结论。</p> : null}
  </div>;
}
function Evidence({ report, evidenceId, binding }: { report: DeliveryReportDto; evidenceId: string; binding: Extract<DeliveryReadViewDto, { state: 'available' }>['binding'] }) {
  const [value, setValue] = useState<{ descriptor: z.infer<typeof EvidenceDescriptor>; text?: string; url?: string } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const sequence = useRef(0); const objectUrl = useRef<string | null>(null);
  useEffect(() => () => { sequence.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, [report.hash, report.revision]);
  async function load() {
    const request = ++sequence.current; setBusy(true); setError(''); setValue(null);
    try {
      const descriptor = await deliveryApi.evidence(report.id, evidenceId); assertReportBinding(binding, descriptor.binding);
      const expected = report.evidence.find(item => item.id === evidenceId);
      if (!expected || descriptor.id !== evidenceId || descriptor.sha256 !== expected.sha256 || descriptor.bytes !== expected.bytes || descriptor.evidenceSourceHash !== expected.sourceSnapshotHash || descriptor.attemptId !== expected.attemptId || descriptor.specHash !== expected.specHash || descriptor.planHash !== expected.planHash) throw new Error('证据与选中尝试不一致，已拒绝显示。');
      if (descriptor.expiresAt && Date.parse(descriptor.expiresAt) <= Date.now()) throw new Error('证据授权已过期，请重试获取。');
      const blob = await verifiedBytes(`/deliveries/${encodeURIComponent(report.id)}/evidence/${encodeURIComponent(evidenceId)}/content`, descriptor.sha256, descriptor.bytes, descriptor.mediaType);
      if (request !== sequence.current) return;
      if (descriptor.disposition === 'attachment') saveBlob(blob, descriptor.fileName);
      else if (descriptor.kind === 'screenshot') { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); const url = URL.createObjectURL(blob); objectUrl.current = url; setValue({ descriptor, url }); }
      else setValue({ descriptor, text: await blob.text() });
    } catch (error) { if (request === sequence.current) setError(failure(error)); } finally { if (request === sequence.current) setBusy(false); }
  }
  return <div className="delivery-evidence"><button disabled={busy} onClick={() => void load()}>{busy ? '核对证据…' : `查看${report.evidence.find(item => item.id === evidenceId)?.kind === 'screenshot' ? '截图' : '证据'}`}</button>{error && <p role="alert">{error}</p>}{value?.url && <img src={value.url} alt="当前所选尝试的验证截图"/>}{value?.text && <pre>{value.text}</pre>}</div>;
}
function Report({ view }: { view: Extract<DeliveryReadViewDto, { state: 'available' }> }) {
  const report = view.report;
  if (!report) return <p>报告原文未被 API 信任，不能作为验收证据。{view.error?.message}</p>;
  const spec = report.bundle?.spec; const plan = report.bundle?.plan;
  return <>
    <section><h3>本次约定与覆盖</h3><p className="delivery-goal">{report.seed.goal}</p><p>来源：{admissionLabel[report.seed.source.admission]} · {report.seed.source.messageIds.length} 条原始消息 · {spec?.origin === 'model_proposed' ? '模型细化约定，宿主冻结；不等于语义覆盖已被证明' : spec ? '预置验收计划' : '尚未冻结约定'}</p>
      {spec?.criteria.map(criterion => { const coverage = plan!.coverage.find(item => item.criterionId === criterion.id)!; return <article className="criterion-row" key={criterion.id}><strong>{criterion.description}</strong><div><span>{criterion.required ? '必需' : '可选'}</span><span>{coverageLabel[coverage.method]}</span><span>{result[criterionResult(report, criterion.id)]}</span></div>{coverage.reason && <p>{reasonLabel(coverage.reason)}</p>}<details><summary>核对来源约定项</summary><small>{criterion.seedItemIds.join('、')}</small></details></article>; })}
      <details><summary>核对原目标来源与冻结绑定</summary><p>消息：{report.seed.source.messageIds.join('、')}</p><pre>{JSON.stringify({ revision: spec?.revision, specHash: spec?.hash, planHash: plan?.hash, bindingHash: report.bundle?.binding.hash, frozenAt: report.bundle?.binding.frozenAt, source: view.binding.sourceSnapshotHash }, null, 2)}</pre></details>
    </section>
    <section><h3>尝试与修复记录</h3>{report.attempts.some(attempt => attempt.sourceProvenance?.kind === "controlled_regression") && <aside>此报告包含受控回归，用于验证失败与修复链；不代表模型自然产生该错误。</aside>}{!report.attempts.length && <p>尚无执行尝试；规划失败不伪造源码和验证记录。</p>}{report.attempts.map((attempt, index) => <article className="delivery-attempt" key={attempt.id}><h4>尝试 {index + 1} · {result[attempt.status]} {attempt.id === report.finalAttemptId ? '· 当前源码尝试' : '· 历史尝试'}</h4><p>{attempt.sourceProvenance?.kind === 'controlled_regression' ? '受控回归注入，非模型自然错误' : attempt.sourceProvenance?.kind === 'synthetic_fixture' ? '合成 Mock 证据，非真实执行' : attempt.sourceProvenance?.kind === 'model_output' ? attempt.sourceProvenance.adapterMode === 'dsh' ? 'DSH 模型产物；失败原因以证据为准' : 'Fake 模型产物，非真实模型' : '来源未记录，不能推断为模型自然错误'} · 修复轮次 {attempt.repairRound}</p><div className="delivery-checks">{Object.entries(attempt.checks).map(([name, check]) => <span key={name}>{name} · {result[check.status]}</span>)}</div><details><summary>基础检查详情与日志</summary>{Object.entries(attempt.checks).map(([name, check]) => <p key={name}>{name} · {result[check.status]}{check.reason ? ` · ${check.reason}` : ""}</p>)}{[...new Set(Object.values(attempt.checks).flatMap(check => check.evidenceIds))].map(id => <Evidence key={`${report.hash}:${report.revision}:${view.binding.sourceSnapshotHash}:base:${id}`} report={report} evidenceId={id} binding={view.binding}/>)}</details>{attempt.caseResults.map(item => <div className="case-result" key={item.caseId}><strong>{plan?.cases.find(test => test.id === item.caseId)?.name ?? item.caseId} · {result[item.status]}</strong>{item.reason && <p>{item.reason}</p>}{item.failure && <p className="delivery-error">失败断言：{item.failure.message}<br/>预期：{item.failure.expected ?? "未记录"}；实际：{item.failure.actual ?? "未记录"}</p>}{item.evidenceIds.map(id => <Evidence key={`${report.hash}:${report.revision}:${view.binding.sourceSnapshotHash}:${id}`} report={report} evidenceId={id} binding={view.binding}/>)}</div>)}{attempt.sourceProvenance?.kind === "controlled_regression" && <Evidence key={`${report.hash}:${report.revision}:${view.binding.sourceSnapshotHash}:patch`} report={report} evidenceId={attempt.sourceProvenance.patchEvidenceId} binding={view.binding}/>}<details><summary>查看尝试来源和指纹</summary><pre>{JSON.stringify({ sourceBefore: attempt.sourceBeforeHash, sourceAfter: attempt.sourceAfterHash, sourceProvenance: attempt.sourceProvenance ?? null, plan: attempt.planHash, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt }, null, 2)}</pre></details></article>)}</section>
    {report.failure && <p role="alert" className="delivery-error">{report.failure.code} · {report.failure.message}</p>}
  </>;
}
export function DeliveryReport({ subject, versionId }: { subject: DeliverySubject | null; versionId?: string }) {
  const { view, error, loading, reload } = useDelivery(subject);
  return <div className="delivery-panel" data-testid="delivery-report" data-subject-id={subject?.id}><header><h2>交付报告</h2><button onClick={reload}>重新读取</button></header>{!subject ? <p>暂无任务或版本，暂无验收结果。</p> : error ? <p role="alert">{error} 读取错误不等于历史未验证。</p> : loading ? <p>正在读取绑定当前任务或版本的报告…</p> : view?.state === 'pending' ? <p>阶段：{phaseLabel[view.phase]}；报告尚未生成，不推断通过。</p> : view?.state === 'legacy' ? <><h3>历史版本 · 未验证</h3><p>未记录 M2 行为与干净导出报告，不补造历史验收。</p></> : view ? <><h3 className={`quality-title ${view.quality}`}>{quality[view.quality]}</h3><p>{view.publication.status === 'published' ? '此版本已发布' : '尚未发布'} · {view.reportFinal ? '最终报告' : '过程报告'} · {apiVerificationLabel[view.apiVerification]}</p><Gaps view={view}/>{view.provenance.evidenceReuse === 'restored_unchanged_source' && <aside>复用原约定证据，未重跑；不代表新目标已验收。<details><summary>查看恢复与原验证来源</summary>当前恢复版：{view.subjectVersionId}<br/>直接恢复来源：{view.provenance.restoredFromVersionId}<br/>最初验证版本：{view.provenance.originVersionId}</details></aside>}<Report view={view}/></> : null}{versionId && <ExportCard key={versionId} versionId={versionId}/>}</div>;
}
export function ExportCard({ versionId }: { versionId: string }) {
  const [view, setView] = useState<z.infer<typeof ExportReadView> | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => { let alive = true; let timer: ReturnType<typeof setTimeout>; setView(null); setError(''); async function read() { try { const value = await deliveryApi.export(versionId); if (value.subjectVersionId !== versionId) throw new Error('导出版本不一致'); if (alive) { setView(value); setError(''); if (value.status === 'pending') timer = setTimeout(read, 2000); } } catch (error) { if (alive) setError(failure(error)); } } void read(); return () => { alive = false; clearTimeout(timer); }; }, [versionId, retry]);
  async function download() {
    setBusy(true); setError('');
    try { const current = await deliveryApi.export(versionId); if (current.subjectVersionId !== versionId || !current.downloadRef) throw new Error('当前版本暂无授权下载。'); const ref = current.downloadRef;
      if (ref.verification === 'verified') { const blob = await verifiedBytes(`/versions/${encodeURIComponent(ref.subjectVersionId)}/source.zip`, ref.archiveHash, current.manifest!.archive.bytes, 'application/zip'); saveBlob(blob, `source-${versionId}.zip`); }
      else { const a = document.createElement('a'); a.href = `/api/delivery/v1/versions/${encodeURIComponent(ref.subjectVersionId)}/source.zip`; a.download = `legacy-unverified-${versionId}.zip`; a.click(); }
      setView(current);
    } catch (error) { setError(failure(error)); } finally { setBusy(false); }
  }
  const platform = view?.cleanBuild?.verifiedPlatform;
  return <section className="export-card"><h3>源码与可复现交付</h3><button onClick={() => setRetry(value => value + 1)}>重新读取导出</button>{error && <p role="alert">{error}</p>}{view ? <><p>{view.status === 'verified' ? '精确 ZIP 已完成干净安装与复验' : view.status === 'legacy_unverified' ? '历史源码 · 未验证 lockfile 与干净复现' : view.status === 'failed' ? '导出复验失败，不能宣称可复现' : '导出复验尚未完成'}</p>{platform && <p>实际平台：{platform.os} / {platform.arch} · Node {platform.nodeVersion} · pnpm {platform.pnpmVersion}。未声明其他平台通过。</p>}{view.cleanBuild && <div className="delivery-checks">{Object.entries(view.cleanBuild.stages).map(([name, check]) => <span key={name}>{name} · {result[check.status]}</span>)}</div>}{view.manifest && <details><summary>核对独立 lockfile、源码与 archive</summary><pre>{JSON.stringify({ subject: view.subjectVersionId, source: view.manifest.sourceSnapshotHash, lock: view.manifest.lockfileHash, archive: view.manifest.archive.sha256, registry: view.cleanBuild?.registry, frozenLockfile: view.cleanBuild?.frozenLockfile, lifecycleScripts: view.cleanBuild?.lifecycleScripts }, null, 2)}</pre><p>ZIP 内 README 提供受信运行说明；下载不创建任务、不调用模型。</p></details>}{view.error && <p role="alert">{view.error.message}</p>}<button disabled={!view.downloadRef || busy} onClick={() => void download()}>{busy ? '核对下载内容…' : view.status === 'legacy_unverified' ? '下载历史源码（未验证）' : '下载已核对源码 ZIP'}</button></> : !error && <p>正在读取导出说明…</p>}</section>;
}
export function VersionDiff({ projectId, versions, headId }: { projectId: string; versions: { id: string; parentVersionId: string | null; summary: string }[]; headId?: string }) {
  const [head, setHead] = useState(headId ?? ''); const [base, setBase] = useState(''); const [pages, setPages] = useState<z.infer<typeof VersionDiffPage>[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const generation = useRef(0);
  useEffect(() => { setHead(headId ?? ''); setBase(''); }, [projectId, headId]);
  useEffect(() => { let alive = true; const epoch = ++generation.current; setPages([]); setError(''); if (!head) return; setBusy(true); void deliveryApi.diff(projectId, head, base || undefined).then(page => { if (page.comparison.projectId !== projectId || page.comparison.headVersionId !== head || base && page.comparison.baseVersionId !== base) throw new Error('差异比较与当前选择不一致'); if (alive && epoch === generation.current) setPages([page]); }).catch(error => { if (alive) setError(failure(error)); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, [projectId, head, base]);
  async function more() { const epoch = generation.current; const previous = pages.at(-1); if (!previous?.nextCursor) return; setBusy(true); try { const next = await deliveryApi.diff(projectId, head, base || undefined, previous.nextCursor); if (JSON.stringify(next.comparison) !== JSON.stringify(previous.comparison)) throw new Error('差异游标已变更，请重新选择版本。'); if (generation.current === epoch) setPages(value => [...value, next]); } catch (error) { if (generation.current === epoch) setError(failure(error)); } finally { if (generation.current === epoch) setBusy(false); } }
  return <div className="delivery-panel diff-panel" data-testid="version-diff"><h2>版本改动</h2><div className="diff-selectors"><label>目标版本<select value={head} onChange={event => { setHead(event.target.value); setBase(''); }}>{versions.map((version, i) => <option key={version.id} value={version.id}>V{versions.length - i} · {version.summary}</option>)}</select></label><label>比较基线<select value={base} onChange={event => setBase(event.target.value)}><option value="">父版本（首版与空快照）</option>{versions.filter(item => item.id !== head).map((version, i) => <option key={version.id} value={version.id}>{version.summary} · {i + 1}</option>)}</select></label></div>{!head && <p>尚无已发布版本；失败候选差异首轮未提供，请查看失败报告。</p>}{error && <p role="alert">{error}</p>}{pages[0] && <p>{pages[0].comparison.baseVersionId ? '与选定/父版本比较' : '首次交付，与空快照比较'} · 仅比较受控源码，HTML/SVG 仅作文本展示。</p>}{pages.map((page, index) => <div key={index}>{page.truncated && <aside>差异已截断：{page.reason}；未显示不代表没有变化。</aside>}{page.files.map(file => <article className="diff-file" key={file.path}><h3>{({ added: '新增', modified: '修改', deleted: '删除' })[file.status]} · {file.path}</h3>{file.kind === 'binary' ? <p>二进制文件，仅显示大小与指纹。</p> : <pre>{file.hunks.map((hunk, h) => <span className="diff-hunk" key={h}>{`@@ ${hunk.oldStart} → ${hunk.newStart} @@\n`}{hunk.lines.map((line, l) => <span className={`diff-line ${line.kind}`} key={l}>{`${line.oldLine ?? '–'} ${line.newLine ?? '–'} ${line.kind === 'added' ? '+' : line.kind === 'deleted' ? '-' : ' '} ${line.text}\n`}</span>)}</span>)}</pre>}{file.truncated && <p>文件差异已截断：{file.reason}</p>}<small>之前：{file.before?.bytes ?? 0} 字节 · 之后：{file.after?.bytes ?? 0} 字节</small><details><summary>文件指纹</summary><pre>{JSON.stringify({ before: file.before?.sha256, after: file.after?.sha256 }, null, 2)}</pre></details></article>)}</div>)}{busy && <p>正在读取固定版本的差异…</p>}{pages.at(-1)?.hasMore && <button disabled={busy} onClick={() => void more()}>加载更多改动</button>}{pages.length > 0 && !pages.some(page => page.files.length) && <p>本页没有可展示改动；请同时查看截断提示。</p>}</div>;
}
