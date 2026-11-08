import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUp, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock3, Code2, ExternalLink, FileCode2, Folder, FolderOpen, Home, Layers3, LoaderCircle,
  MessageSquare, Monitor, Plus, RefreshCw, Search, ShieldCheck, Smartphone,
  Sparkles, Square, WandSparkles, X, Zap } from 'lucide-react';
import { Session, type ProjectDto, type WorkspaceSnapshotDto, type VersionDto, type ProjectEventDto, type RunDto, type AnswerRequestDto } from '@atoms/contracts';
import type { z } from 'zod';
import { api, HttpError } from './api';
import { applyEvents, isTerminal, phaseLabels, statusLabels } from './state';
import { mergeActivityEvents, readActivityHistory, type ApiSync } from './activity';
import { RunFeedback } from './RunFeedback';

type SessionDto = z.infer<typeof Session>;
type View = 'home' | 'projects';
const agents = [{ letter: 'M', name: '项目负责人', color: '#ffd6a2' }, { letter: 'E', name: '产品规划', color: '#ffd4dd' },
  { letter: 'A', name: '应用工程师', color: '#c4d7ff' }, { letter: 'V', name: '验证与交付', color: '#c7e9df' }];
const examples = [
  { title: '灵感便签墙', text: '做一个暖色风格的便签墙，支持新增、编辑、删除和拖拽便签，刷新后保留内容。', tag: '效率工具', className: 'notes', icon: '✦' },
  { title: '个人任务看板', text: '做一个任务看板，支持待办、进行中、已完成三列，能够新增任务和切换任务状态。', tag: '工作管理', className: 'kanban', icon: '▦' },
  { title: '习惯打卡', text: '构建一个简洁的习惯打卡应用，支持添加习惯、每日打卡和查看完成进度。', tag: '日常生活', className: 'habits', icon: '◒' },
];
const currentProjectId = () => /^#\/projects\/([a-z0-9_-]+)$/.exec(location.hash)?.[1] ?? null;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试。';
const shortDate = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function App() {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState(currentProjectId);
  const [view, setView] = useState<View>('home');
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotDto | null>(null);
  const workspaceRef = useRef<WorkspaceSnapshotDto | null>(null);
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'build' | 'plan'>('build');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [activityEvents, setActivityEvents] = useState<ProjectEventDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sync, setSync] = useState<ApiSync>({ status: 'syncing', lastSuccessAt: null });
  const [login, setLogin] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ prompt: string; mode: 'build' | 'plan'; projectId: string | null } | null>(null);
  const [tab, setTab] = useState<'preview' | 'code' | 'versions'>('preview');
  const [mobilePreview, setMobilePreview] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const generation = useRef(0);
  const mock = import.meta.env.MODE === 'mock';
  const updateWorkspace = useCallback((next: WorkspaceSnapshotDto | null) => {
    const previous = workspaceRef.current;
    if (next && previous?.project.id === next.project.id && previous.eventCursor > next.eventCursor) return;
    workspaceRef.current = next; setWorkspace(next);
  }, []);
  const recordActivity = useCallback((id: string, events: ProjectEventDto[]) => {
    setActivityEvents((previous) => mergeActivityEvents(previous, events, id));
  }, []);
  const hydrateActivity = useCallback(async (id: string, through: number, context: number) => {
    setHistoryLoading(true);
    try {
      const history = await readActivityHistory(id, through, api.events);
      if (generation.current !== context || currentProjectId() !== id) return;
      recordActivity(id, history); setHistoryError('');
    } catch (e) {
      if (generation.current === context && currentProjectId() === id) setHistoryError(errorMessage(e));
    } finally {
      if (generation.current === context && currentProjectId() === id) setHistoryLoading(false);
    }
  }, [recordActivity]);
  const refreshProjects = useCallback(async () => { const result = await api.projects(); setProjects(result.items); }, []);
  useEffect(() => {
    let alive = true;
    void api.session().then(async (value) => {
      if (!alive) return; setSession(value); await refreshProjects();
    }).catch((e) => { if (alive && !(e instanceof HttpError && e.status === 401)) setError(errorMessage(e)); });
    const listener = () => { setProjectId(currentProjectId()); setError(''); setConnection(''); };
    addEventListener('hashchange', listener);
    return () => { alive = false; removeEventListener('hashchange', listener); };
  }, [refreshProjects]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); location.hash = ''; setProjectId(null); setView('home'); setDraft('');
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
      }
    };
    addEventListener('keydown', shortcut);
    return () => removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    const ownGeneration = ++generation.current;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    updateWorkspace(null); setVersions([]); setTab('preview'); setActivityEvents([]);
    setHistoryError(''); setHistoryLoading(false); setSync({ status: 'syncing', lastSuccessAt: null });
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    const isCurrent = () => alive && generation.current === ownGeneration;
    async function snapshot() {
      const [next, history] = await Promise.all([api.workspace(projectId!), api.versions(projectId!)]);
      if (!isCurrent()) return;
      updateWorkspace(next); setVersions(history.items); setLoading(false);
      setSync({ status: 'ok', lastSuccessAt: Date.now() }); setConnection('');
      await hydrateActivity(projectId!, next.eventCursor, ownGeneration);
    }
    async function poll() {
      if (!isCurrent()) return;
      try {
        const current = workspaceRef.current;
        if (!current || current.project.id !== projectId) { await snapshot(); }
        else {
          const shouldPoll = !!current.activeRun || current.queuedRuns.length > 0 || (current.latestRun && !isTerminal(current.latestRun));
          const expires = current.currentVersion && Date.parse(current.currentVersion.previewExpiresAt) < Date.now() + 60000;
          if (shouldPoll) {
            let after = current.eventCursor;
            let more = true;
            while (more && isCurrent()) {
              const page = await api.events(projectId!, after);
              if (!isCurrent()) return;
              setSync({ status: 'ok', lastSuccessAt: Date.now() });
              recordActivity(projectId!, page.items);
              const before = workspaceRef.current!;
              const next = applyEvents(before, page.items);
              updateWorkspace(next); after = page.nextCursor; more = page.hasMore;
              if (page.items.some((item) => item.event.type === 'version.published' || (item.event.type === 'run.updated' && isTerminal(item.event.payload)))) {
                await snapshot(); await refreshProjects();
                const value = await api.session(); if (isCurrent()) setSession(value);
              }
            }
          } else if (expires) await snapshot();
        }
        failures = 0; if (isCurrent()) setConnection('');
      } catch (e) {
        if (!isCurrent()) return;
        failures++;
        setSync((previous) => ({ ...previous, status: 'interrupted' }));
        if (e instanceof HttpError && e.status === 401) { setSession(null); setLogin(true); }
        else if (e instanceof HttpError && e.status === 404) { setError(errorMessage(e)); setLoading(false); return; }
        else {
          setConnection(errorMessage(e));
          try { await snapshot(); } catch { /* Retain last usable preview while offline. */ }
        }
      }
      if (isCurrent()) timer = setTimeout(poll, Math.min(10000, (document.hidden ? 3000 : 1000) * 2 ** Math.min(failures, 3)));
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [projectId, updateWorkspace, refreshProjects, hydrateActivity, recordActivity]);

  const currentVersion = workspace?.currentVersion;
  useEffect(() => {
    let alive = true; setFiles([]); setSelectedFile(''); setSource('');
    if (!currentVersion) return;
    void api.files(currentVersion.id).then((value) => {
      if (!alive) return;
      const paths = value.files.map((file) => file.path).filter((path) => path.startsWith('source/'));
      setFiles(paths); setSelectedFile(paths.find((path) => path.endsWith('/App.tsx')) ?? paths[0] ?? '');
    }).catch((e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [currentVersion?.id]);
  useEffect(() => {
    let alive = true;
    if (!selectedFile || !currentVersion) return;
    setSource('正在读取源码…');
    void api.file(currentVersion.id, selectedFile).then((value) => { if (alive) setSource(value); })
      .catch((e) => { if (alive) setSource(errorMessage(e)); });
    return () => { alive = false; };
  }, [selectedFile, currentVersion?.id]);

  const home = (next: View = 'home') => { location.hash = ''; setProjectId(null); setView(next); setDraft(''); setError(''); };
  const open = (id: string) => { location.hash = `/projects/${id}`; setProjectId(id); };
  async function loadCurrent(id = projectId) {
    if (!id) return;
    const [next, history] = await Promise.all([api.workspace(id), api.versions(id)]);
    if (currentProjectId() !== id) return;
    updateWorkspace(next); setVersions(history.items);
    setSync({ status: 'ok', lastSuccessAt: Date.now() });
    await hydrateActivity(id, next.eventCursor, generation.current); await refreshProjects();
  }
  async function submitPrompt(prompt: string, requestedMode = mode) {
    if (!prompt.trim() || busy) return;
    if (!session) { setPending({ prompt, mode: requestedMode, projectId }); setLogin(true); return; }
    setBusy(true); setError('');
    try {
      let id = projectId;
      if (!id) { const project = await api.createProject(prompt.trim().slice(0, 32)); id = project.id; open(id); }
      await api.createRun(id, prompt.trim(), requestedMode);
      setDraft(''); await refreshProjects();
      open(id); await loadCurrent(id);
    } catch (e) { setError(errorMessage(e)); if (e instanceof HttpError && e.status === 401) { setSession(null); setLogin(true); } }
    finally { setBusy(false); }
  }
  async function redeem(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const value = await api.redeem(code.trim()); setSession(value); setLogin(false); setCode(''); await refreshProjects();
      if (pending) {
        const request = pending; setPending(null);
        const id = request.projectId ?? (await api.createProject(request.prompt.trim().slice(0, 32))).id;
        open(id); await api.createRun(id, request.prompt, request.mode); setDraft(''); await refreshProjects(); await loadCurrent(id);
      } else if (projectId) await loadCurrent();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function action(operation: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); await loadCurrent(); } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const activeRun = workspace?.activeRun ?? workspace?.latestRun;
  const displayRun = workspace?.activeRun ?? workspace?.latestRun;
  const filteredProjects = projects.filter((project) => project.title.toLowerCase().includes(query.toLowerCase()));

  return <div className={`app-shell ${projectId ? 'in-workspace' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => home()} aria-label="Atoms Demo 首页"><span className="brand-mark"><i/><i/><i/></span><strong>Atoms<span>demo</span></strong></button>
      <div className="workspace-switch"><span className="user-avatar">A</span><span>我的创作空间</span><ChevronDown size={14}/></div>
      <button className="new-project" onClick={() => home()}><Plus size={17}/>开始新项目<span>⌘ K</span></button>
      <nav aria-label="主导航">
        <button className={!projectId && view === 'home' ? 'nav-item selected' : 'nav-item'} onClick={() => home()}><Home size={18}/>首页</button>
        <button className={!projectId && view === 'projects' ? 'nav-item selected' : 'nav-item'} onClick={() => home('projects')}><FolderOpen size={18}/>我的项目<span className="nav-count">{projects.length}</span></button>
      </nav>
      <div className="sidebar-section"><span>最近项目</span><button aria-label="刷新项目" onClick={() => { if (session) void refreshProjects().catch((e) => setError(errorMessage(e))); }}><RefreshCw size={13}/></button></div>
      <div className="recent-list">{projects.slice(0, 8).map((project) => <button key={project.id} className={projectId === project.id ? 'recent active' : 'recent'} onClick={() => open(project.id)}><MessageSquare size={15}/><span>{project.title}</span></button>)}
        {!projects.length && <p className="recent-empty">你的下一个作品，<br/>从一个想法开始。</p>}</div>
      <div className="sidebar-bottom">
        <div className="build-note"><span className="tiny-spark"><Sparkles size={17}/></span><strong>小想法，大可能</strong><p>描述你的想法，让 Agent<br/>为你构建、验证与交付。</p></div>
        <button className="account" onClick={() => setLogin(true)}><span className="user-avatar">{session ? '访' : 'A'}</span><span>{session ? '访客体验空间' : '开启体验'}<small>{session ? `剩余 ${Math.max(0, session.quota.runLimit - session.quota.runsUsed - session.quota.runsReserved)} 次构建` : '输入体验码，开始创作'}</small></span><ChevronRight size={15}/></button>
      </div>
    </aside>

    <main className="main">
      {mock && <div className="mock-banner"><ShieldCheck size={13}/> 独立 Mock 模式 · 所有生成与验证记录均为模拟数据</div>}
      {!mock && import.meta.env.VITE_RUNTIME_MODE === 'fake' && <div className="mock-banner"><ShieldCheck size={13}/> 演示执行 · Fake DSH 生成，构建与验证实际执行</div>}
      <header className="topbar"><div className="breadcrumb">{projectId ? <><button onClick={() => home('projects')}>我的项目</button><ChevronRight size={14}/><span>{workspace?.project.title ?? '加载项目'}</span></> : <span>把想法变成可以使用的作品</span>}</div>
        <div className="top-actions"><span className="engine-badge"><span/>DeepSeek Harness</span>{session && <span className="credits"><Zap size={14}/>{Math.max(0, session.quota.runLimit - session.quota.runsUsed - session.quota.runsReserved)}<span>次构建</span></span>}</div></header>
      {(error || connection) && <div role="alert" className={`notice ${connection && !error ? 'connection' : ''}`}><span>{error || connection}</span><button aria-label="关闭提示" onClick={() => { setError(''); setConnection(''); }}><X size={15}/></button></div>}

      {!projectId ? <div className="dashboard">
        {view === 'home' && <section className="hero">
          <div className="hero-pill"><Sparkles size={13}/>从灵感，到你的下一个产品</div>
          <div className="agent-stack">{agents.map((agent) => <div key={agent.letter} title={agent.name} className="agent-orb" style={{ background: agent.color }}>{agent.letter}<span/></div>)}</div>
          <h1>你来想象，<em>我们来构建。</em></h1><p className="hero-description">把想法告诉你的 AI 团队，让它成为一个真正可用的应用。</p>
          <Composer value={draft} setValue={setDraft} mode={mode} setMode={setMode} busy={busy} onSubmit={() => void submitPrompt(draft)} placeholder="描述你想构建的应用，例如：一个可以拖拽的灵感便签墙…"/>
          <div className="hero-footnote"><ShieldCheck size={13}/>规划、编写、验证，每一步都看得见<span>·</span>支持持续修改与版本回滚</div>
          <div className="suggestions"><span>试试这些灵感</span>{['便签墙', '任务看板', '习惯打卡'].map((label, index) => <button key={label} onClick={() => setDraft(examples[index].text)}>{label}<ArrowRight size={12}/></button>)}</div>
        </section>}
        <section className="projects-section">
          <div className="section-heading"><div><h2>{view === 'projects' ? '我的项目' : '你的创作，从这里继续'}</h2><p>{view === 'projects' ? '每一个想法，都有持续生长的空间。' : '打开一个项目，或者从一个新灵感开始。'}</p></div>
            <div className="project-tools"><label className="search-box"><Search size={15}/><input aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)}/></label>{view === 'home' && <button className="text-button" onClick={() => setView('projects')}>全部项目<ArrowRight size={15}/></button>}</div></div>
          {filteredProjects.length ? <div className="project-grid">{filteredProjects.map((project, index) => <button className="project-card" key={project.id} onClick={() => open(project.id)}><div className={`project-cover ${examples[index % 3].className}`}><ProjectIllustration kind={index % 3}/><span className="project-cover-tag">{project.currentVersionId ? '已有可用版本' : '新的想法'}</span></div><div className="project-info"><span className="project-icon"><Folder size={17}/></span><div><h3>{project.title}</h3><p>{shortDate(project.updatedAt)} 更新</p></div><ChevronRight size={16}/></div></button>)}</div> : <div className="empty-projects"><span><FolderOpen size={24}/></span><div><h3>{query ? '没有找到相关项目' : '这里等待你的第一个作品'}</h3><p>{query ? '换一个关键词试试。' : '在上方描述需求，Agent 会为你创建并保存项目。'}</p></div>{!query && <button className="text-button" onClick={() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus()}>开始创作<ArrowRight size={15}/></button>}</div>}
        </section>
        {view === 'home' && <section className="inspiration"><div className="section-heading"><div><h2>一个想法，无限可能</h2><p>选一个起点，再加入属于你的想法。</p></div><span className="small-label">创作灵感</span></div><div className="example-grid">{examples.map((example, index) => <button key={example.title} className="example-card" onClick={() => { setDraft(example.text); window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}><div className={`example-cover ${example.className}`}><ProjectIllustration kind={index}/></div><div className="example-info"><span>{example.tag}</span><h3>{example.title}<ArrowRight size={16}/></h3></div></button>)}</div></section>}
        <footer className="dashboard-footer"><span className="mini-logo">✦</span>让每一个好想法，都有机会成为现实。</footer>
      </div> : <div className="workspace-content">
        {loading && !workspace ? <div className="loading-state"><LoaderCircle className="spin"/>正在恢复你的项目…</div> : workspace && <>
          <section className="conversation-panel"><div className="conversation-heading"><div><span className="agent-avatar-small">M</span><div><strong>项目负责人</strong><small>规划 · 协调 · 交付</small></div></div><span className="online-dot">任务协调</span></div>
            <div className="conversation-scroll">
              <div className="conversation-intro"><Sparkles size={18}/><p>一起把这个想法做出来。<br/><span>我会协调构建过程，并在需要你时提出具体问题。</span></p></div>
              {workspace.messages.map((message) => <div key={message.id} className={`message ${message.role}`}><span className={`message-avatar ${message.role}`}>{message.role === 'user' ? '你' : 'M'}</span><div><small>{message.role === 'user' ? '你' : '项目负责人'}</small><p>{message.content}{message.status === 'streaming' && <span className="typing-dot"/>}</p></div></div>)}
              {displayRun && <RunFeedback run={displayRun} events={activityEvents} sync={sync} historyLoading={historyLoading} historyError={historyError} busy={busy} onCancel={() => void action(() => api.cancel(displayRun.id))}/>}
              {workspace.activeRun?.pendingAttention && <AttentionCard run={workspace.activeRun} busy={busy} onAnswer={(answer) => void action(() => api.answer(workspace.activeRun!.id, answer))}/>}
              {workspace.queuedRuns.length > 0 && <div className="queue-card"><Clock3 size={15}/>{workspace.queuedRuns.length} 个需求等待当前任务完成后执行</div>}
            </div>
            <div className="workspace-composer"><Composer compact value={draft} setValue={setDraft} mode={mode} setMode={setMode} busy={busy} onSubmit={() => void submitPrompt(draft)} placeholder={workspace.activeRun ? '补充新需求，将在当前任务后排队执行…' : '描述你想继续修改的地方…'}/><small>新需求会保存为独立任务，不会覆盖当前执行。</small></div>
          </section>
          <section className="output-panel"><div className="output-toolbar"><div className="output-tabs">{([{ id: 'preview', label: '预览', Icon: Monitor }, { id: 'code', label: '代码', Icon: Code2 }, { id: 'versions', label: '版本', Icon: Layers3 }] as const).map(({ id, label, Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15}/>{label}</button>)}</div><div className="output-actions">{tab === 'preview' && <><button title="桌面预览" aria-label="桌面预览" className={!mobilePreview ? 'active' : ''} onClick={() => setMobilePreview(false)}><Monitor size={16}/></button><button title="手机预览" aria-label="手机预览" className={mobilePreview ? 'active' : ''} onClick={() => setMobilePreview(true)}><Smartphone size={16}/></button></>}{currentVersion && <><a title="下载源码" aria-label="下载源码" href={`/api/v1/versions/${currentVersion.id}/source.zip`}><ArrowDownToLine size={16}/></a><a title="在新窗口打开" aria-label="在新窗口打开预览" href={currentVersion.previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a></>}</div></div>
            {tab === 'preview' ? <div className={`preview-area ${mobilePreview ? 'mobile' : ''}`}>{currentVersion ? <><div className="preview-address"><span className="browser-dots"><i/><i/><i/></span><span><ShieldCheck size={12}/>应用预览</span><span className="version-badge">{currentVersion.restoredFromVersionId ? '恢复版本' : `版本 ${versions.findIndex((v) => v.id === currentVersion.id) >= 0 ? versions.length - versions.findIndex((v) => v.id === currentVersion.id) : versions.length}`}</span></div><iframe key={currentVersion.previewUrl} title="应用预览" src={currentVersion.previewUrl} sandbox={mock ? 'allow-scripts' : 'allow-scripts allow-same-origin'}/></> : <div className="preview-empty"><div className="preview-symbol"><WandSparkles size={35}/><span>✦</span></div><h2>{activeRun && !isTerminal(activeRun) ? '你的想法，正在成形' : '应用将在这里呈现'}</h2><p>{activeRun?.status === 'waiting_input' ? '确认左侧计划后，Agent 将继续构建。' : activeRun?.error ? '本次未能交付，可修改需求后重新尝试。' : '代码完成并通过验证后，便可在这里直接体验。'}</p>{activeRun && !isTerminal(activeRun) && <div className="preview-progress"><LoaderCircle className="spin" size={14}/>{activeRun.phase ? phaseLabels[activeRun.phase] : statusLabels[activeRun.status]}</div>}</div>}</div>
            : tab === 'code' ? <div className="code-area">{currentVersion ? <><div className="file-tree"><h4>项目文件</h4>{files.map((path) => <button key={path} className={selectedFile === path ? 'active' : ''} onClick={() => setSelectedFile(path)}><FileCode2 size={14}/>{path.replace(/^source\//, '')}</button>)}</div><div className="source-view"><div><FileCode2 size={14}/>{selectedFile.replace(/^source\//, '')}<span>已发布版本 · 只读</span></div><pre>{source}</pre></div></> : <div className="panel-empty"><Code2 size={28}/><h3>等待首个成功版本</h3><p>成功交付后，可以查看完整的 React 多文件源码。</p></div>}</div>
            : <div className="versions-area"><div className="version-heading"><h3>每一步创作，都有迹可循</h3><p>成功交付的版本会被保留，你可以随时恢复。</p></div>{!versions.length && <div className="panel-empty"><Layers3 size={28}/><p>尚无成功版本。</p></div>}{versions.map((version, index) => <div className="version-card" key={version.id}><div className="version-title"><span className="version-number">V{versions.length - index}</span><strong>{version.summary}</strong>{version.id === currentVersion?.id && <span className="current-tag">当前版本</span>}</div><small>{shortDate(version.createdAt)}{version.restoredFromVersionId ? ' · 从历史版本恢复' : ''}</small><div className="check-list">{version.checks.map((check) => <span className={check.status === 'passed' ? 'passed' : 'unchecked'} key={check.id}>{check.status === 'passed' ? <Check size={12}/> : <Clock3 size={12}/>} {check.name} · {check.status === 'passed' ? '通过' : check.status === 'not_run' ? '未验证' : check.status === 'skipped' ? '已跳过' : '失败'}</span>)}</div>{version.id !== currentVersion?.id && <button className="secondary-button" disabled={busy || !!workspace.activeRun} title={workspace.activeRun ? '请等待当前任务结束再恢复版本' : undefined} onClick={() => void action(() => api.restore(workspace.project.id, version.id, workspace.project.revision))}><RefreshCw size={13}/>恢复此版本</button>}</div>)}</div>}
            <div className="output-footer"><span><span className={`status-dot ${displayRun?.status === 'running' ? 'working' : ''}`}/>{currentVersion ? workspace.activeRun ? '新版本正在处理，当前仍展示上一成功版本' : '当前展示最近一次成功交付的应用' : '等待可交付版本'}</span><span>React · TypeScript · Vite</span></div>
          </section>
        </>}
      </div>}
    </main>

    {login && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setLogin(false); }}><section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="modal-close" aria-label="关闭体验码窗口" onClick={() => setLogin(false)}><X size={18}/></button><div className="modal-symbol"><Sparkles size={24}/></div><span className="eyebrow">WELCOME TO ATOMS DEMO</span><h2 id="login-title">让想法开始生长</h2><p>输入体验码，开启你的 AI 创作空间。<br/>无需注册，项目与版本会自动保存。</p><form onSubmit={redeem}><label htmlFor="access-code">体验码</label><input autoFocus id="access-code" autoComplete="off" placeholder="请输入你的体验码" value={code} onChange={(event) => setCode(event.target.value)}/><button className="primary-button" disabled={busy || code.trim().length < 8}>{busy ? <LoaderCircle className="spin" size={17}/> : <>进入创作空间<ArrowRight size={17}/></>}</button></form>{error && <p role="alert" className="login-error">{error}</p>}{mock && <small className="mock-hint">Mock 体验码：atoms-demo-2026</small>}<div className="login-foot"><ShieldCheck size={13}/>体验额度由服务端管理，密钥不会传到浏览器。</div></section></div>}
  </div>;
}

function Composer({ value, setValue, mode, setMode, busy, onSubmit, placeholder, compact = false }: {
  value: string; setValue: (value: string) => void; mode: 'build' | 'plan'; setMode: (value: 'build' | 'plan') => void;
  busy: boolean; onSubmit: () => void; placeholder: string; compact?: boolean;
}) {
  return <form className={`composer ${compact ? 'compact' : ''}`} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <textarea aria-label={compact ? '修改需求' : '应用需求'} maxLength={20000} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit(); } }}/>
    <div className="composer-bottom"><span className="composer-caption"><Sparkles size={14}/>{compact ? '与你的 Agent 继续创作' : '从一句话开始，剩下的交给 Agent'}</span><div><label className="mode-select"><span>{mode === 'build' ? <WandSparkles size={14}/> : <Layers3 size={14}/>}</span><select aria-label="构建模式" value={mode} onChange={(event) => setMode(event.target.value as 'build' | 'plan')}><option value="build">直接构建</option><option value="plan">先做计划</option></select><ChevronDown size={12}/></label><button className="send-button" type="submit" disabled={busy || !value.trim()} aria-label={compact ? '提交修改' : '开始构建'}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowUp size={20}/>}</button></div></div>
  </form>;
}

function AttentionCard({ run, busy, onAnswer }: { run: RunDto; busy: boolean; onAnswer: (answer: AnswerRequestDto) => void }) {
  const [text, setText] = useState('');
  const attention = run.pendingAttention!;
  const submitted = run.pendingAnswer?.status === 'pending';
  const answer = (value: AnswerRequestDto['answer']) => onAnswer({ attentionId: attention.id, expectedRevision: attention.revision, answer: value });
  return <div className="attention-card"><span className="attention-label"><MessageSquare size={13}/>需要你处理</span><h3>{attention.title}</h3><p>{attention.description}</p>{attention.plan && <><ol>{attention.plan.tasks.map((task) => <li key={task}>{task}</li>)}</ol><div className="acceptance-items"><strong>交付时将检查</strong>{attention.plan.acceptance.map((item) => <span key={item.id}><Check size={12}/>{item.description}</span>)}</div></>}
    {submitted ? <div className="answer-pending"><LoaderCircle className="spin" size={14}/>回答已提交，等待恢复执行</div> : <>{attention.kind === 'plan_confirmation' && <button className="primary-button" disabled={busy} onClick={() => answer({ kind: 'approve_plan' })}>确认计划，开始构建<ArrowRight size={15}/></button>}{attention.options.map((option) => <button className="secondary-button" key={option.id} disabled={busy} onClick={() => answer({ kind: 'select', optionId: option.id })}>{option.label}</button>)}{attention.allowText && <form onSubmit={(event) => { event.preventDefault(); answer({ kind: 'text', text }); }}><textarea aria-label="回答问题" placeholder="补充你的想法…" value={text} onChange={(event) => setText(event.target.value)}/><button className="primary-button" disabled={busy || !text.trim()}>提交回答<ArrowRight size={14}/></button></form>}</>}
  </div>;
}

function ProjectIllustration({ kind }: { kind: number }) {
  if (kind === 0) return <div className="illustration note-illustration"><div className="note yellow"><span/><span/><span/></div><div className="note pink"><span/><span/></div><div className="note mint"><span/><span/><span/></div><span className="ill-star">✦</span></div>;
  if (kind === 1) return <div className="illustration kanban-illustration">{[0, 1, 2].map((column) => <div className="kanban-column" key={column}><i/>{Array.from({ length: column === 1 ? 2 : 3 }, (_, row) => <div key={row}><span/><span/><b/></div>)}</div>)}</div>;
  return <div className="illustration habit-illustration"><div className="habit-chart"><span>Keep going.</span><strong>7<span>days</span></strong><div>{[2, 4, 3, 6, 5, 7, 5].map((height, index) => <i style={{ height: height * 7 }} key={index}/>)}</div></div><div className="habit-check"><Check size={23}/></div></div>;
}
