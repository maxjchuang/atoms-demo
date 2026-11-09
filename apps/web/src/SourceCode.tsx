import { useMemo, type ReactNode } from 'react';
import type Prism from 'prismjs';
import { highlightSource } from './source-highlighting';
import './source-code.css';

function tokenNodes(value: Prism.TokenStream, key = 'code'): ReactNode {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item, index) => tokenNodes(item, `${key}-${index}`));
  const aliases = Array.isArray(value.alias) ? value.alias : value.alias ? [value.alias] : [];
  return <span key={key} className={['token', value.type, ...aliases].join(' ')}>{tokenNodes(value.content, `${key}-content`)}</span>;
}

export default function SourceCode({ path, source }: { path: string; source: string }) {
  const result = useMemo(() => highlightSource(path, source), [path, source]);
  const content = useMemo(() => tokenNodes(result.tokens), [result.tokens]);
  return <>
    {result.reason === 'large' && <p className="source-highlight-note">文件较长，以原文显示，避免影响浏览流畅度。</p>}
    <pre className="source-code" tabIndex={0} aria-label="源码内容" data-highlight-mode={result.mode}>
      <code data-language={result.language}>{content}</code>
    </pre>
  </>;
}
