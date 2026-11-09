import test from 'node:test';
import assert from 'node:assert/strict';
import type Prism from 'prismjs';
import { highlightSource, highlightLimit, sourceLanguage } from '../src/source-highlighting';

function original(tokens: Prism.TokenStream): string {
  return typeof tokens === 'string' ? tokens : Array.isArray(tokens) ? tokens.map(original).join('') : original(tokens.content);
}
function types(tokens: Prism.TokenStream): string[] {
  return typeof tokens === 'string' ? [] : Array.isArray(tokens) ? tokens.flatMap(types) : [tokens.type, ...types(tokens.content)];
}

for (const [file, source, token] of [
  ['App.tsx', 'export default function App() { return <button type="button">你好</button>; }\n', 'tag'],
  ['model.ts', 'type Item = { id: number }; const value: Item = { id: 42 };\n', 'keyword'],
  ['main.js', 'const label = "你好"; // comment\n', 'string'],
  ['Card.jsx', 'const card = <section className="card" />;\n', 'tag'],
  ['style.css', '.card { color: #123456; padding: 16px; }\n', 'selector'],
  ['package.json', '{"name":"app","private":true,"count":2}\n', 'property'],
  ['index.html', '<script>window.__sourceExecuted = true;</script><img onerror="alert(1)">\n', 'tag'],
  ['icon.svg', '<svg><path d="M0 0" /></svg>\n', 'tag'],
] as const) test(`${file} has language tokens and preserves every original character`, () => {
  const result = highlightSource(`source/${file}`, source);
  assert.equal(result.mode, 'highlighted');
  assert.ok(types(result.tokens).includes(token));
  assert.equal(original(result.tokens), source);
});

test('unknown files and long files remain complete plain text without thousands of token nodes', () => {
  const source = '\t<untrusted>& keep spaces  \r\n\n';
  const unknown = highlightSource('source/data.custom', source);
  assert.equal(unknown.reason, 'unsupported'); assert.equal(unknown.tokens, source);
  const large = 'x'.repeat(highlightLimit + 1);
  const result = highlightSource('source/large.ts', large);
  assert.equal(result.reason, 'large'); assert.equal(result.mode, 'plain'); assert.equal(result.tokens, large);
  assert.equal(sourceLanguage('source/APP.TSX'), 'tsx');
  assert.equal(sourceLanguage('source/README.md'), 'markdown');
  assert.equal(sourceLanguage('source/pnpm-lock.yaml'), 'yaml');
});
