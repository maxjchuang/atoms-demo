export const templateFiles: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'atoms-generated-app', version: '0.0.0', private: true, type: 'module',
    scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', typecheck: 'tsc --noEmit' },
    dependencies: { react: '19.1.1', 'react-dom': '19.1.1' },
    devDependencies: { vite: '7.1.12', typescript: '5.9.3', '@types/react': '19.1.13', '@types/react-dom': '19.1.9' },
  }, null, 2),
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['src'] }, null, 2),
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({ base: './' });\n",
  'index.html': '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Atoms App</title></head><body><div id="root"></div><script type="module" src="./src/main.tsx"></script></body></html>',
  'src/main.tsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './style.css';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  'src/App.tsx': "export default function App() { return <main><h1>应用正在构建</h1></main>; }\n",
  'src/style.css': 'body { margin: 0; font-family: system-ui,sans-serif; }',
};

// Deterministic fixture used only by the explicitly selected Fake adapter.
export function fakeApplication(projectId: string, prompt: string, repair = false): Record<string, string> {
  const dark = /深色|dark/i.test(prompt);
  const search = /搜索|search/i.test(prompt);
  const broken = /\[fail\]/.test(prompt) || (/\[repair\]/.test(prompt) && !repair);
  return {
    'src/App.tsx': `import { useEffect, useState } from 'react';
import { NoteCard, type Note } from './components/NoteCard';
${broken ? "import { Missing } from './missing';" : ''}
const key = ${JSON.stringify(`atoms:${projectId}:notes`)};
export default function App() {
  const [notes, setNotes] = useState<Note[]>(() => { try { return JSON.parse(localStorage.getItem(key) || 'null') || [{ id: 'welcome', text: '把灵感留在这里。拖动便签，整理你的想法。', x: 30, y: 30 }]; } catch { return []; } });
  const [query, setQuery] = useState('');
  useEffect(() => localStorage.setItem(key, JSON.stringify(notes)), [notes]);
  const update = (id: string, patch: Partial<Note>) => setNotes(v => v.map(n => n.id === id ? { ...n, ...patch } : n));
  return <main><header><div><span className="eyebrow">YOUR EVERYDAY CANVAS</span><h1>灵感便签墙</h1><p>留住每个值得记下的想法。</p></div><button aria-label="新建便签" onClick={() => setNotes(v => [...v, { id: crypto.randomUUID(), text: '', x: 30 + v.length * 24, y: 30 + v.length * 24 }])}>＋ 新建便签</button></header>
  ${search ? '<input className="search" aria-label="搜索便签" placeholder="搜索你的灵感…" value={query} onChange={e => setQuery(e.target.value)} />' : ''}
  <section className="board" data-testid="note_board">{notes.filter(n => n.text.toLowerCase().includes(query.toLowerCase())).map(n => <NoteCard key={n.id} note={n} onChange={patch => update(n.id, patch)} onDelete={() => setNotes(v => v.filter(item => item.id !== n.id))} />)}</section>
  <footer>自动保存在当前浏览器 · 拖动顶栏移动便签</footer></main>;
}
`,
    'src/components/NoteCard.tsx': `import { useRef } from 'react';
export type Note = { id: string; text: string; x: number; y: number };
export function NoteCard({ note, onChange, onDelete }: { note: Note; onChange: (patch: Partial<Note>) => void; onDelete: () => void }) {
  const start = useRef({ x: 0, y: 0, left: 0, top: 0 });
  return <article className="note" data-testid="note_card" style={{ left: note.x, top: note.y }}>
    <div className="handle" aria-label="拖动便签" onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY, left: note.x, top: note.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange({ x: Math.max(0, start.current.left + e.clientX - start.current.x), y: Math.max(0, start.current.top + e.clientY - start.current.y) }); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>·····<button aria-label="删除便签" onPointerDown={e => e.stopPropagation()} onClick={onDelete}>×</button></div>
    <textarea aria-label="便签内容" value={note.text} placeholder="写下一个新想法…" onChange={e => onChange({ text: e.target.value })} />
  </article>;
}
`,
    'src/style.css': `*{box-sizing:border-box}body{margin:0;background:${dark ? '#20211e' : '#f6f4ed'};color:${dark ? '#f4f0df' : '#292d26'};font-family:system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:48px 32px}header{display:flex;justify-content:space-between;align-items:center;gap:24px}h1{font-size:36px;letter-spacing:-1px;margin:12px 0}p,footer{color:${dark ? '#bbbba8' : '#838776'}}.eyebrow{font-size:11px;letter-spacing:3px}button{border:0;border-radius:10px;padding:13px 20px;background:#d6e6a3;color:#293622;font-weight:600;cursor:pointer}.board{position:relative;min-height:520px;margin-top:28px;border:1px dashed ${dark ? '#4e5445' : '#dcded2'};border-radius:20px;background-image:radial-gradient(${dark ? '#4d5146' : '#d5d9ca'} 1px,transparent 1px);background-size:20px 20px}.note{position:absolute;width:240px;background:#f5e6a7;border-radius:5px;box-shadow:0 8px 22px #20291012;color:#393b28}.handle{height:36px;padding:3px 14px;cursor:grab;touch-action:none;font-size:22px;display:flex;justify-content:space-between;color:#b2a875}.handle button{padding:0 4px;background:transparent;font-size:20px;color:#8a825e}.note textarea{display:block;resize:none;border:0;outline:0;background:transparent;color:inherit;font:15px/1.7 system-ui;padding:10px 20px 20px;width:100%;height:160px}.search{width:100%;max-width:360px;margin-top:20px;padding:12px 16px;border:1px solid #d7dacd;border-radius:10px;background:transparent;color:inherit}footer{font-size:12px;margin-top:20px}`,
  };
}
