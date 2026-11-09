import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Link2, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { SharingDescriptorDto, ResolvedSharingDto, ResolveSharingRequestDto } from '@atoms/contracts/sharing';
import { sharingApi, SharingError, assertResolution, copyLink } from './sharing-api';
import { DeliveryBadge } from './Delivery';
import type { DeliverySubject } from './delivery-api';
import './sharing.css';

export interface SharingSubject { projectId: string; versionId: string | null; label: string }
const reason = { LOCAL_ONLY: '仅当前电脑可访问，尚无可提供给他人的公网链接。', NO_PUBLISHED_VERSION: '尚无已发布版本，可先邀请体验构建。', DEPLOYMENT_UNAVAILABLE: '公网入口暂不可用，请稍后重新读取。' };
const timestamp = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZoneName: undefined }).format(new Date(value));
export function ShareDialog({ subject, latestVersionId, workbenchOrigin = location.origin, onClose, onLogin, onReport }: {
  subject: SharingSubject; latestVersionId: string | null; workbenchOrigin?: string;
  onClose: () => void; onLogin: () => void; onReport: (subject: DeliverySubject) => void;
}) {
  const [descriptor, setDescriptor] = useState<SharingDescriptorDto | null>(null);
  const [resolved, setResolved] = useState<ResolvedSharingDto | null>(null);
  const [kind, setKind] = useState<ResolveSharingRequestDto['kind']>('app_preview');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<SharingError | null>(null), [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0), [now, setNow] = useState(Date.now());
  const [retryAt, setRetryAt] = useState(0);
  const dialog = useRef<HTMLElement>(null), linkInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), operation = useRef<AbortController | null>(null);
  const scope = `${subject.projectId}:${subject.versionId ?? 'no_version'}`;
  const subjectRef = useRef(scope); subjectRef.current = scope;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { previous?.isConnected && previous.focus(); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const epoch = ++generation.current, abort = new AbortController(); operation.current?.abort(); operation.current = abort;
    setDescriptor(null); setResolved(null); setNotice(''); setError(null); setBusy(false); setLoading(true);
    void sharingApi.descriptor(subject.projectId, subject.versionId, abort.signal).then(value => {
      if (generation.current === epoch && subjectRef.current === scope) setDescriptor(value);
    }).catch(failure => { if (!abort.signal.aborted && generation.current === epoch) setError(failure instanceof SharingError ? failure : new SharingError(0, 'NETWORK_ERROR', '分享描述暂不可读，请重试。')); })
      .finally(() => { if (generation.current === epoch) setLoading(false); });
    return () => { ++generation.current; abort.abort(); };
  }, [scope, retry]);
  const active = kind === 'app_preview' ? descriptor?.appPreview : descriptor?.buildEntry;
  const canResolve = !!active?.available && (kind === 'build_entry' || subject.versionId !== null);
  const expired = resolved?.kind === 'app_preview' && Date.parse(resolved.expiresAt) <= now;
  function fail(failure: unknown) {
    const value = failure instanceof SharingError ? failure : new SharingError(0, 'NETWORK_ERROR', '链接解析未完成，请重试；未创建任务。', true);
    setError(value); setNotice(''); if (value.status === 429) setRetryAt(Date.now() + Math.max(1, value.retryAfterSeconds) * 1000);
  }
  async function activate(intent: 'copy' | 'open') {
    if (!descriptor || !canResolve || busy || retryAt > Date.now()) return;
    const popup = intent === 'open' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    const epoch = ++generation.current, startedScope = scope, abort = new AbortController(); operation.current?.abort(); operation.current = abort;
    const current = () => generation.current === epoch && subjectRef.current === startedScope && !abort.signal.aborted;
    setBusy(true); setError(null); setNotice(''); setResolved(null);
    try {
      const fresh = await sharingApi.descriptor(subject.projectId, subject.versionId, abort.signal);
      if (!current()) { popup?.close(); return; }
      setDescriptor(fresh);
      if (fresh.deploymentInstanceId !== descriptor.deploymentInstanceId) throw new SharingError(409, 'CONFLICT', '部署入口已变化，请核对更新后的状态，再点击获取链接。');
      const available = kind === 'app_preview' ? fresh.appPreview.available : fresh.buildEntry.available;
      if (!available) throw new SharingError(409, 'CONFLICT', '当前分享目标不可用，请核对最新说明。');
      if (kind === 'app_preview' && (!subject.versionId || fresh.subjectVersionId !== subject.versionId)) throw new SharingError(409, 'NO_PUBLISHED_VERSION', '尚无选定的已发布版本，不能自动改成另一版本。');
      const request: ResolveSharingRequestDto = kind === 'app_preview' ? { kind, versionId: subject.versionId!, expectedDeploymentInstanceId: fresh.deploymentInstanceId } : { kind, expectedDeploymentInstanceId: fresh.deploymentInstanceId };
      const value = assertResolution(await sharingApi.resolve(subject.projectId, request, abort.signal), fresh, kind, workbenchOrigin);
      if (!current()) { popup?.close(); return; }
      setResolved(value);
      if (intent === 'copy') {
        const result = await copyLink(value.url, navigator.clipboard);
        if (current()) setNotice(result === 'copied' ? '链接已复制。复制成功不代表外部访问已通过验收。' : '浏览器未允许自动复制，请选中下方链接手动复制。');
      } else if (popup) { popup.location.replace(value.url); setNotice('已请求打开链接；实际访问结果请在新窗口核对。'); }
      else setNotice('浏览器阻止了新窗口，请使用下方“打开已解析链接”。');
    } catch (failure) { popup?.close(); if (current()) { fail(failure); if (failure instanceof SharingError && failure.status === 409) setDescriptor(null); } }
    finally { if (current()) setBusy(false); }
  }
  function changeKind(next: typeof kind) { ++generation.current; operation.current?.abort(); setKind(next); setResolved(null); setNotice(''); setError(null); setBusy(false); }
  function trap(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length);
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }
  return <div className="modal-backdrop sharing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialog} className="sharing-dialog" role="dialog" aria-modal="true" aria-labelledby="sharing-title" onKeyDown={trap} data-testid="sharing-dialog">
    <header><div><span className="sharing-eyebrow"><Link2 size={14}/>固定版本 · 受控访问</span><h2 id="sharing-title">分享与体验</h2></div><button className="sharing-close" aria-label="关闭分享窗口" onClick={onClose}><X size={20}/></button></header>
    <p className="sharing-subject">当前选定：{subject.label}</p>
    {subject.versionId && <DeliveryBadge subject={{ kind: 'versions', projectId: subject.projectId, id: subject.versionId }} context="分享版本质量" onOpen={() => { onReport({ kind: 'versions', projectId: subject.projectId, id: subject.versionId! }); onClose(); }}/>}
    {subject.versionId && latestVersionId !== subject.versionId && <aside>项目已有更新；本窗口仍分享所选版本，不会自动换成最新版本。关闭后可重新选择。</aside>}
    <div className="sharing-tabs" role="group" aria-label="分享目标"><button aria-pressed={kind === 'app_preview'} disabled={loading} onClick={() => changeKind('app_preview')}>应用预览</button><button aria-pressed={kind === 'build_entry'} disabled={loading} onClick={() => changeKind('build_entry')}>邀请体验构建</button></div>
    <h3>{kind === 'app_preview' ? '让别人体验这个版本' : '邀请别人开始构建'}</h3>
    <p>{kind === 'app_preview' ? '有效期内，持有链接的人可以操作此应用；不能访问工作台、源码或创建新版本。' : '只分享工作台登录入口，对方仍需另行取得体验码。不会自动登录或授予当前项目权限。'}</p>
    {kind === 'build_entry' && <p className="sharing-limits">同一体验码持有者共享演示身份、项目与额度；不是独立账户邀请。此演示仅提供一个公开项目，请勿保存敏感数据。</p>}
    {loading ? <p role="status"><LoaderCircle className="spin" size={15}/>正在读取宿主分享状态…</p> : descriptor && <div className="sharing-facts" data-testid="sharing-facts"><strong>{descriptor.scope === 'public_temporary' ? '公网临时入口 · 已配置' : descriptor.scope === 'local_only' ? '仅本机可访问' : '公网入口暂不可用'}</strong>
      <p>{active?.reasonCode ? reason[active.reasonCode] : kind === 'app_preview' ? `链接最长有效 ${descriptor.appPreview.capabilityTtlSeconds} 秒，实际截止时间以解析结果为准。` : '入口没有可承诺的固定期限；停服或重建临时域名后失效。'}</p>
      <small>{descriptor.externalVerification.status === 'verified' ? `宿主已记录此版本的外部验收 · ${timestamp(descriptor.externalVerification.verifiedAt!)}` : '外部浏览器验收尚未记录；配置为公网不等于当前已验证可达。'}</small></div>}
    <p className="sharing-limits">临时域名：休眠、断网、停服或隧道更换可能使链接失效，不承诺持续托管。应用数据按浏览器本地保存，不跨设备同步；同预览域没有项目级存储隔离。</p>
    {error && <div role="alert" className="sharing-error">{error.message}{error.status === 401 && <button onClick={onLogin}>重新输入体验码</button>}</div>}
    <div className="sharing-actions"><button className="primary-button" disabled={loading || busy || !canResolve || retryAt > now} onClick={() => void activate('copy')}>{busy ? <LoaderCircle className="spin" size={16}/> : <Copy size={16}/>} {kind === 'app_preview' ? '复制应用链接' : '复制工作台入口'}</button><button className="secondary-button" disabled={loading || busy || !canResolve || retryAt > now} onClick={() => void activate('open')}><ExternalLink size={15}/>新窗口打开</button><button className="secondary-button" disabled={busy || loading || retryAt > now} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14}/>重新读取</button></div>
    {retryAt > now && <p role="status">请在 {Math.ceil((retryAt - now) / 1000)} 秒后重试。</p>}
    <p aria-live="polite" className="sharing-result">{notice}</p>
    {resolved && <div className="sharing-link"><label htmlFor="sharing-link-input">{resolved.kind === 'app_preview' ? '固定版本的临时预览链接' : '工作台入口（不含体验码）'}</label><input ref={linkInput} id="sharing-link-input" readOnly value={resolved.url} onFocus={event => event.currentTarget.select()}/><button onClick={() => { linkInput.current?.focus(); linkInput.current?.select(); setNotice('已选中链接，请使用系统复制命令。'); }}>选中链接</button><small>{resolved.expiresAt ? `截止：${timestamp(resolved.expiresAt)}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）${expired ? ' · 已到期，请重新获取' : ''}。新链接不会延长已发出的旧链接。` : '未承诺固定期限；服务停止或临时域名更换后链接可能失效。请另行提供体验码。'}</small>{!expired && <a href={resolved.url} target="_blank" rel="noreferrer noopener">打开已解析链接</a>}</div>}
  </section></div>;
}
