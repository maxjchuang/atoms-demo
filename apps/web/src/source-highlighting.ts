import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';

Prism.manual = true;

const extensions: Record<string, string> = {
  tsx: 'tsx', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', webmanifest: 'json',
  css: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash', bash: 'bash',
};
export const highlightLimit = 100_000;
export type SourceHighlight = { language: string; tokens: Prism.TokenStream; mode: 'highlighted' | 'plain'; reason?: 'large' | 'unsupported' | 'unavailable' };

export function sourceLanguage(path: string): string {
  return extensions[path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'plain';
}

/** Never truncate or execute source; tokenizer output is rendered as React text nodes. */
export function highlightSource(path: string, source: string): SourceHighlight {
  const language = sourceLanguage(path);
  if (source.length > highlightLimit) return { language, tokens: source, mode: 'plain', reason: 'large' };
  if (language === 'plain') return { language, tokens: source, mode: 'plain', reason: 'unsupported' };
  const grammar = Prism.languages[language];
  if (!grammar) return { language, tokens: source, mode: 'plain', reason: 'unsupported' };
  try { return { language, tokens: Prism.tokenize(source, grammar), mode: 'highlighted' }; }
  catch { return { language, tokens: source, mode: 'plain', reason: 'unavailable' }; }
}
