import { useEffect, useState } from 'react';
import { Download, ExternalLink, Info, LoaderCircle } from 'lucide-react';
import type { TurnActionDescriptorDto, ResolvedActionDto } from '@atoms/contracts/conversation';
import { coordinationApi } from './coordination-api';

export function HostAction({ turnId, actionId, onViewRun }: { turnId: string; actionId: string; onViewRun: (id: string) => void }) {
  const [action, setAction] = useState<TurnActionDescriptorDto | null>(null);
  const [resolution, setResolution] = useState<ResolvedActionDto | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void coordinationApi.action(turnId, actionId).then(value => { if (alive) setAction(value); }).catch(() => { if (alive) setError('该宿主操作暂不可用。'); });
    return () => { alive = false; };
  }, [turnId, actionId]);
  async function activate() {
    if (!action?.available || busy) return;
    const preview = action.kind === 'preview' ? window.open('about:blank', '_blank') : null;
    if (preview) preview.opener = null;
    setBusy(true); setError('');
    try {
      const result = await coordinationApi.resolveAction(turnId, actionId); setResolution(result.resolution);
      const value = result.resolution;
      if (value.kind === 'preview') { if (preview) preview.location.replace(value.url); else setError('浏览器阻止了新窗口，请允许此站点弹窗后重试。'); }
      else { preview?.close();
        if (value.kind === 'source_download') {
          const response = await fetch(value.path, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('源码下载暂不可用。');
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement('a'); link.href = url; link.download = `source-${value.versionId}.zip`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else if (value.kind === 'view_run') onViewRun(value.runId);
        // A cancel reference only opens the explicitly identified task. A second
        // user action in that task's own panel is required to stop execution.
        else if (value.kind === 'cancel_run') onViewRun(value.runId);
      }
    } catch (failure) { preview?.close(); setError(failure instanceof Error ? failure.message : '操作未能完成。'); }
    finally { setBusy(false); }
  }
  return <div className="host-action"><button disabled={!action?.available || busy} title={action?.reason} onClick={() => void activate()}>
    {busy ? <LoaderCircle className="spin" size={12}/> : action?.kind === 'source_download' ? <Download size={12}/> : action?.kind === 'preview' ? <ExternalLink size={12}/> : <Info size={12}/>}
    {action?.label ?? (error ? '宿主操作不可用' : '读取宿主操作…')}
  </button>{resolution?.kind === 'deployment_help' && <p>{resolution.message}</p>}{resolution?.kind === 'cancel_run' && <p>仅定位了目标任务；请在构建活动中另行点击“停止构建”。</p>}{error && <p role="alert">{error}</p>}</div>;
}
