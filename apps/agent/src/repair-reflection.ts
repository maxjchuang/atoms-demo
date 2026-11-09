export type RepairReflectionValue = { category: 'implementation'|'test'|'environment'|'unclear'; reasons: string[]; suggestion: string; question: string };
export const RepairReflection = { parse(raw: unknown): RepairReflectionValue {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid read-only reflection');
 const r=raw as Record<string,unknown>; const text=(v:unknown,n:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
 if(Object.keys(r).sort().join(',')!=='category,question,reasons,suggestion'||!['implementation','test','environment','unclear'].includes(String(r.category))||!Array.isArray(r.reasons)||r.reasons.length<1||r.reasons.length>4||!r.reasons.every(v=>text(v,600))||!text(r.suggestion,900)||!text(r.question,500))throw new Error('Invalid read-only reflection');
 return structuredClone(r) as RepairReflectionValue;
} };
export function reflectionDescription(review: RepairReflectionValue | null, reason: string) {
 return (review ? `只读复盘（${({implementation:'实现方案',test:'验收测试',environment:'运行环境',unclear:'信息不足'})[review.category]}）：\n${review.reasons.join('\n')}\n建议：${review.suggestion}\n问题：${review.category==='unclear'?review.question:'请确认是否采用上述建议重新规划，或补充你期望的实际表现'}` : `自动修复已停止：${reason}。请补充期望表现或选择重新规划。`) + '\n原源码和冻结验收未修改，不再追加原任务修复。请使用带回答重新规划；确认新方案后执行需要新的构建额度。';
}
