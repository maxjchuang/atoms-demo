/** Presentation only. Original messages, source files and downloadable evidence stay unchanged. */
export function assistantText(text: string, isFinalReply = false): string {
  if (isFinalReply) return text;
  return text
    .replace(/\bWorker\b/gi, '程序员')
    .replace(/\bRouter\b/g, '项目负责人')
    .replace(/React\s*多文件(?:应用|代码|源码)/g, '多文件网页应用')
    .replace(/受控\s*React\s*模板/g, '应用模板')
    .replace(/\bReact\b/g, '网页应用')
    .replace(/\bAgent\b/g, 'Atoms');
}
