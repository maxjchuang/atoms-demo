# M1 项目协调实施记录

日期：2026-11-08。协议基线：`docs/protocol-v0.2.md`；执行侧仍为 v0.1.0。本文只记录已经运行的验证，不把三方向独立测试等同于已完成整产品联调。

## 当前状态

| 范围 | 实施/验证 |
| --- | --- |
| API v2 | 独立 coordination 模块、全部冻结端点、任务/消息分离、API 权威记忆、双事件序列、历史合并与旧数据库迁移已实现 |
| API G1 | `check`/`build` 通过；`test:contract` 30/30（旧 v1 10 项 + 新协调 20 项）已由主代理复验，包含取消未决 outbox 与提案记忆授权修正 |
| 全仓节点验证 | 主代理在隔离集成 worktree 运行 check 与 142 项节点测试通过：contracts 42 / API 30 / Agent 28 / Web 42；下述缓存计量修正后的最终回归另行补充 |
| M1 Fake HTTP 集成 | 主代理复跑 `pnpm test:coordination --no-web` 及包含 Web HTTP 的默认入口，6 组断言通过；真实 API/Agent v2 HTTP + 显式 FakeRouter/FakeDSH + 真实 React 构建/生成应用浏览器 smoke；Web HTTP 就绪不等于 Web 浏览器交互验收 |
| M1 真实 Router | 主代理显式启动的六轮自然中文样例全部通过：真实 DSH/DeepSeek Router + Fake Worker；不是完整真实代码 G4，不代表任意自然语言准确率 |
| M1 Web 浏览器 | 前端正用独立 5185 和真实 HTTP 服务验收，结果待主代理确认；不提前标通过 |
| 输入预算计量 | 真实样例发现缓存读取未纳入有效输入预算；Agent 正修 Worker/Router 计量并做独立测试，未为此重复调用模型；修复未验收前明确保留该缺口 |
| M2/M3 | 不属于本轮实现；可信交付、完整 G4、隔离公网 G5 仍按能力路线图待完成 |

## API 独立测试覆盖

测试使用实际 FakeCoordinator/FakeRuntime HTTP、临时 SQLite 和临时版本文件，不依赖前端或模型 Key。Fake 协调结果由测试显式提供，不是临时关键词分类器，也不是自然语言准确率证明。

- 分享咨询、状态/分享快捷操作不创建 Run，不消耗生成次数。
- auto 明确修改自动准入；ask 修改只提案；build 不将咨询强制改成写入。
- 原用户消息在准入成 Run 后沿用 ID/historySeq，不重复显示或扣额。
- 消息级选项和文字回答有精确问题/revision 绑定，原问题离开 recent/pending 历史仍携带完整可信快照。
- 项目记忆记录来源、纠正与 supersedes；同项目下一协调请求只在前次结果/记忆事务提交后绑定上下文。
- 未接受的提案记忆更新仅保留为非权威建议，inferred/dismissed/blocked/cancelled 不污染 ProjectDecision。显式 accept 只记录实际确认的目标 scope 一次，以 sourceProposalId、原消息和真实 API 确认回执溯源，不伪造用户自然语言；正常明确偏好/纠正的咨询记忆仍可保存。
- 首次 dispatch 的请求/facts/hash 持久化，丢失响应和 API 重启不重算异体或重复推理。
- latest 队列在 Worker 出队时使用最新成功版；exact 提案过期阻止执行，刷新只建立新只读提案。
- 协调取消先提交时迟到结果不派生 Run；已经派发返回真实回执，不误取消 Worker。
- 仅固化未发送的 outbox 取消不 PUT、不启动推理、不扣 used；未决 PUT/网络不确定不伪称停止，晚到 started 仍正确结算。
- 受限 cancel_run 复用既有取消，ask 控制不自动执行。
- 状态回复由当前 API Run 事实格式化；模型虚构公网能力/链接不能变成宿主分享事实。
- 权限、证据、状态观察、记忆来源及 action 范围校验；Opaque action 解析不执行取消/创建任务，签名 URL 仅面向浏览器。
- 55 条消息稳定分页、事件回放、v1 消息镜像；旧数据库迁移保留会话、额度、Run、版本和对话，不自动重跑历史。

跨服务 canonical 固定向量：共享 `conversation-fixtures.startCoordination.context` 去掉顶层 hash，递归对象键 localeCompare 排序、数组保序、UTF-8，1534 bytes，SHA256 `36b235ad27e086821bdcd8646b01ee834df106c83bafbe3fdbeffacdf80c65ed`。API 与 Agent 分别验证同一值，不互相导入实现代码。

## 可运行命令

```bash
pnpm --filter @atoms/api check
pnpm --filter @atoms/api test:contract
# 默认真实服务 HTTP + 显式 FakeRouter/FakeDSH；全部临时端口和数据
pnpm test:coordination --no-web
# 三方向合并后也启动 Web（实际浏览器交互仍另做 E2E）
pnpm test:coordination
```

M1 runner 检查咨询、记忆、auto 建 Run、真实 React 构建/发布、ask 提案、宿主状态/action、消息级澄清、普通 Run question、exact 冲突、API/Agent 重启和双事件回放。主代理已运行的 `--no-web` 仅包含 API/Runtime 链路，不等于 Web 浏览器验收；它只跳过 Web HTTP 启动，不降低真实编译/生成应用浏览器 smoke 检查。

真实 NLP 模式不自动启用，需根 `.env` 的本地 Key 和显式授权：

```bash
ATOMS_ALLOW_REAL_COORDINATION_INTEGRATION=1 ATOMS_KEEP_TEST_DATA=1 pnpm test:coordination:real --no-web
```

该命令消耗模型额度，主代理授权前不得执行。Key 只传 Agent，API/Web 不继承；失败保留临时目录便于诊断。

当前 real 分支明确为 **真实 Router（DSH + DeepSeek）+ Fake Worker**：`COORDINATOR_MODE=dsh`、`AGENT_MODE=fake`。它只启动隔离 API/Agent，不启动 Web；Fake Worker 仍真实执行 React 类型检查、Vite 构建和生成应用浏览器 smoke，但源码来自确定性样例，因此绝不称为真实代码生成 G4。

真实分支只提交六轮自然中文 Router 消息，不依赖 Fake 专用 marker 或固定选项/回复文案：

1. “如何分享这个应用给别人？”→ 咨询，零 Run、生成额度不变。
2. 明确要求只记住暖色偏好 → 验证 API canonical decision 的实际来源消息。
3. 明确把该偏好纠正为深色、旧偏好作废 → 验证 supersedes、旧项 superseded、新 active、revision 增长，零 Run。
4. 明确创建便签墙 → auto 唯一准入，重复幂等请求不重复 Run；Worker 是 Fake，不把样例源码当真实模型代码。
5. ask 中只讨论未来搜索 → 不创建 Run、不扣生成次数、不确认推断记忆。
6. 重启 API 和 Agent，再询问当前已确认偏好 → 重启前后 canonical memory 完全保留，回复与深色偏好一致，不只凭回复文字判断记住。

每轮沿用冻结预算：最多 3 个可观察模型步骤、有效推理 90 秒、输入 32,768 / 总输出 8,192 tokens、最多 1 次结构化重试且计入总预算；六轮配置总额为最多 18 个可观察步骤和 49,152 输出 token 预算。SDK/提供商在途请求和实际用量观察存在边界，不能称绝对货币硬限或保证精确 HTTP 调用次数。Worker 模型调用为 0；真实 Run question、异常竞态、精确提案和选项固定样例继续由默认 Fake/独立测试覆盖。

主代理已显式启动并验收上述六轮真实 Router 样例，证据保留在本机临时目录：

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m1-integration-Ty23Ah
```

六轮各 1 个可观察 modelStep，总计 6；SDK 非缓存输入 9,094 tokens，缓存读取 16,640 tokens，**有效输入 25,734**，输出 1,401，总用量 27,135。不能把 9,094 当作本次全部输入或完整成本依据。

本次 review 同时发现原 Worker/Router 输入预算计量漏掉缓存读取，Agent 正修正归一化与预算测试。已有六轮功能证据保留，但不把它扩张为“计量已正确”；修复结果与最终回归待主代理补充，不为了修统计再执行同一批付费样例。

本轮真实只验证消息 Router，Worker 明确为 Fake；普通 Run question、异常竞态和完整真实代码 G4 不能据此补标通过。没有 Fake 回退掩盖真实 Router 结果。

## 本地独立启动

新工作树不要抢占原 live v1 端口。可用：

```bash
WEB_PORT=5184 API_PORT=3101 PREVIEW_PORT=3102 AGENT_PORT=4200 ATOMS_DATA_ROOT=data/m1-review pnpm dev:demo
```

这只用于所有三方向已合并的开发目录；原用户数据不删除、不重置。生产隔离、公网隧道和任意生成应用行为验收不由这些本机测试证明。
