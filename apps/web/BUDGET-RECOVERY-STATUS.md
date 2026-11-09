# Budget recovery Web 第一批独立交付

日期：2026-11-09；共享 G0 `03ad6e4`（主管冻结，root候选同patch `26f8f5e`）。当前是 Web+Mock 独立验证，不代表真实API/Agent恢复、历史3D审计、provider调用或公网验收。仅 `apps/web/**`，Git提交/合并由主管操作。

## 已落地范围

- 独立typed client，发送/验证预算恢复版本头，GET诊断与POST continue分开；request包含offer/revision/checkpoint/source/semantic/project/head精确绑定，不接受Web任意预算。
- 失败任务的预算卡与顶部主摘要：typed输入/输出/其他预算维度优先，泛型旧abort保留为历史详情。observed lower bound、next reservation与最终settled分开，未知不是0或全链总额。
- 仅API eligible时显示“消耗1次构建额度，追加预算并继续”；动作前列cost1、input65536/output24576、新段8steps/15min/repair2、保存源码继续与语义/质量不保证。先预占，实际started才结算；UI只展示API quota。
- PLAN_REVIEW_REQUIRED明确需重新审阅，不能付额继续错计划；只读返回现有项目对话，不提交消息/Run。第二requirements G0后才接具体完整汇总/typed review入口。
- 稳定本机pending key/body在发送前保存；双击即时gate；丢回应与reload先GET已有successor、同key重试，不自动换源/新授权。definitive stale冲突要求重新读取和新明确点击。
- 旧failed与原报告不改，后续Run作为新段，来源/任务链可定位。sessionStorage只存请求绑定/idem与旧任务选择，不存源码、体验码或Key；重新打开可恢复对账卡。
- 旧无typed诊断、非Token、缺源、未确认停止、无额度等均不推断可付额。历史任务若API提供真实新审计，按其typed事实展示，不预先一律legacy拒绝。
- 仅改善现有提案的“本提案目标/验收要求”与exact null基线说明，不称它已是累计完整目标；完整汇总和验收语义第二G0尚未消费，不使用关键词或应用特例。

## 第一批文件

实现：`src/budget-recovery-api.ts`、`src/BudgetRecovery.tsx`、`src/budget-recovery.css`、`src/App.tsx`、`src/ProjectConversation.tsx`、`src/RunFeedback.tsx`。

独立替身/验证：`src/mock/budget-recovery-handlers.ts`、`src/mock/browser.ts`、`test/budget-recovery.test.ts`、`e2e/budget-recovery.spec.ts`。Mock只模拟已保存源码与stop/review/诊断事实，placeholder hashes不是实际源码/停止证据，不运行用户生成源码或provider。

说明：本文、README及先前 `BUDGET-RECOVERY-DESIGN.md`。`MULTITURN-REQUIREMENTS-DESIGN.md` 是待第二G0设计，主管可以不纳入本批提交。

## 实际验证

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @atoms/contracts check` / `test` | 通过，110/110；无共享修改 |
| `pnpm --filter @atoms/web check` | 通过 |
| `pnpm --filter @atoms/web test` | 71/71通过（旧65+预算6） |
| `pnpm --filter @atoms/web build` | 通过；顶部摘要最后文案绑定补修后再最终build |
| `pnpm --filter @atoms/web exec playwright test e2e/budget-recovery.spec.ts e2e/feedback.spec.ts e2e/coordination.spec.ts` | 24/24通过，2.0分钟：预算14、原协调8、原反馈2 |
| `ATOMS_MOCK_PORT=5193 pnpm --filter @atoms/web exec playwright test e2e/budget-recovery.spec.ts --grep 'typed cause\|budget cost'` | 最后顶部typed摘要绑定后定向3/3通过，6.6秒；不是另一完整24复跑 |
| `git diff --check` | 通过 |

早一轮预算12/12（16.7秒）与新增6个单元用例均通过；后来补doubleclick、离开项目迟到回执两项，进入完整24。曾在本线5183完整回归未退出时启动定向复验，因端口已占用在测试开始前拒绝；随后显式使用独立5193通过，不把这次harness启动失败写成产品失败或全量通过。

截图在不提交的 `review-artifacts/budget-recovery/`：`offer-1440.png`、`offer-390.png`、`successor.png`。前端已目视早一轮两尺寸，保持14px正文/12px元信息，长说明内部滚动，无页面横向溢出；主管仍需review最终截图和独立复验。

## 剩余门禁与主管复跑

root独立复验建议显式 `ATOMS_MOCK_PORT=5194`（如该口仍空闲）避免与实现线Mock撞端口，绝不复用私有live5173。普通check/test/build均无需Key。实际API恢复/父链唯一性、source bytes/停止证明、host plan-review、预占结算、跨服务重启/并发由后端/Agent Fake HTTP门禁及root联调证明，不能用Web Mock替代。

本批没有读取Key、调用真实模型、执行用户3D或其他生成源码，也没有覆盖/修改旧Run、报告或live数据。追加Token不修复已知错误验收计划；PLAN_REVIEW_REQUIRED仍阻止付额续作。下一批 requirements 共享G0冻结后单独实施/验证，不能把本批标题改成完整多轮语义质量已修复。

## root初审后的限定修正

root指出第一版typed摘要只在活动页挂载后读取，默认chat仍可能显示泛型abort。现ProjectConversation在当前failed Run/project/revision变化时单独readonly GET，带abort与绑定清理，将cause和实际limit直接交给CompactRun；不做continue/stop/消息写入。活动页旧任务诊断与默认chat当前任务摘要独立，避免查看历史任务覆盖当前原因。读失败保留原错误，不编造诊断。

root同时指出408等4xx可能是传输不确定。现仅已识别的API拒绝code与400/401/403/404/409组合清pending；408、429、5xx、网络错误及未识别网关4xx保留同key/body并先对账。

限定复验：check通过；`tsx --test test/budget-recovery.test.ts`7/7；独立5193的`--grep 'default chat|gateway 408|typed cause'`3/3（6.8秒），含默认chat无需打开activity即可见typed预算与上限、408后reload对账唯一successor。上述24完整浏览器和71全单元属于修正前记录；不将本次定向结果改称完整26/72重跑。最终build与diff检查单独复跑，无模型或用户源码执行。
