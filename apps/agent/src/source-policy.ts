import path from 'node:path';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { listFiles, safeFile } from './files.js';
/** Prevent bundler resolution from embedding host files. This is an allowlist, not OS isolation. */
export async function assertControlledSource(root: string) {
  for (const name of await listFiles(root)) {
    if (!name.startsWith('src/') && name !== 'index.html') continue;
    const text = await readFile(await safeFile(root, name), 'utf8');
    const module = (specifier: string) => {
      if (['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].includes(specifier)) return;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error('Source module must stay in the controlled source tree');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier.split(/[?#]/)[0]));
      if (!target.startsWith('src/') || specifier.includes('\\') || specifier.includes('\0') || specifier.includes('?')) throw new Error('Source import escapes its controlled tree or requests raw host assets');
    };
    if (/\.(tsx?|jsx?)$/.test(name)) {
      const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
          if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('Module specifier must be literal'); module(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('Dynamic module resolution is forbidden'); module(node.arguments[0].text);
        }
        if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) throw new Error('Bundler import.meta expansion is not enabled for generated sources');
        ts.forEachChild(node, visit);
      }; visit(source);
    }
    if (name.endsWith('.css') && /@import|url\s*\(/i.test(text)) throw new Error('CSS external asset resolution is not enabled');
    if (name === 'index.html') {
      for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const src = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!src || match[2].trim() || !/^\.?\/src\/[a-zA-Z0-9_./-]+\.(tsx?|jsx?)$/.test(src)) throw new Error('HTML scripts must use a controlled source entry');
        module(src.startsWith('/src/') ? '.' + src : src);
      }
      if (/\b(?:src|href)\s*=\s*["'](?:\/(?!src\/)|https?:|file:|data:text\/html)/i.test(text)) throw new Error('HTML cannot resolve host or remote assets');
    }
  }
}
