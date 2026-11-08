# 最小闭环实施与验证记录

记录日期：2026-11-08。协议基线为 [v0.1.0](protocol-baseline-v0.1.md)。本文记录真实执行过的验证，不把协议规划或 fixture 当作已实现功能。

完整运行要求 **Node.js 24.9.0+、pnpm 10.33.0**；目前在 macOS arm64 / Node.js 26.5.0 验证。Node 22 只能覆盖部分基础能力，不满足当前固定 DSH 版本要求。

最新增量：[过程反馈改进交付记录](progress-feedback.md)。主代理本轮复验全包 check/build、79 项测试、G3 集成和新 Mock 浏览器 5 passed / 1 条件 skip，并目视检查长等待与真实历史时间线；所有结果区分本轮与上一阶段证据。

## 1. 当前实现

| 方向 | 已落地 | 验证边界 |
| --- | --- | --- |
| 前端 `apps/web` | React/Vite 工作台、公共 API client、独立 Mock、任务/问题/版本/预览及过程反馈界面 | 本轮 30 项单测、构建、Mock 浏览器 5 passed / 1 条件 skip；上一阶段真实服务浏览器主流程 1 项通过 |
| 后端 `apps/api` | Fastify 公共 API、体验码 Cookie、配额/幂等、SQLite、任务队列/锁、事件投影、产物校验、签名预览、版本/恢复/下载 | 独立 Fake Runtime HTTP 契约与重启测试通过 |
| Agent `apps/agent` | DSH 适配层、每任务 Planner/Worker、显式 Fake DSH、内部 HTTP、事件账本、计划回答、验证修复、候选产物 | Fake 独立测试通过；真实 DSH/DeepSeek API 的 G4 最小闭环最终通过 |
| 集成 | 根真实/Fake 启动器、临时目录端到端脚本 | API + Runtime + Fake DSH HTTP 闭环通过 |

## 2. 已执行检查

| 命令/检查 | 结果 | 复验来源 |
| --- | --- | --- |
| 共享 contracts 类型检查与测试 | 27 项通过（协议基线阶段） | 主代理已复验 |
| `pnpm --filter @atoms/api check` | 通过 | 主代理及后端方向复验 |
| `pnpm --filter @atoms/api test:contract` | 本轮 10 项通过（此前 7 项） | 主代理本轮聚合复验 |
| `pnpm --filter @atoms/agent test:contract` | 本轮 12 项通过（此前 9 项），包含真实类型/构建/Chrome smoke | 主代理本轮聚合复验 |
| 前端单测 | 本轮 30 项通过（此前 20 项） | 主代理本轮聚合复验 |
| `pnpm --filter @atoms/web build` | 通过 | 主代理复验 |
| `pnpm check` | 全包通过 | 主代理最终复验 |
| `pnpm build` | 全包通过；Web dist 仅入口与 JS/CSS，无 Mock 静态资源 | 主代理最终复验 |
| `pnpm test` | 本轮 79 项通过：contracts 27 / API 10 / web 30 / Agent 12；此前 63 项亦通过 | 主代理本轮亲自复验 |
| 前端 Mock Playwright | 本轮 5 passed / 1 条件 skip，47.8 秒，独立 5181 端口，零模型调用；上一阶段 3 项通过 | 主代理本轮亲自执行 |
| 新过程反馈目视检查 | 长等待界面、真实旧任务文件/检查/未验证行为时间线清楚；本机截图 `data/review-artifacts/progress-timeline-live.png` | 主代理目视复验 |
| 真实服务浏览器 E2E（显式 Fake DSH） | 1 项通过：前端方向首次 17.8 秒；主代理复验 16.8 秒（生成阶段 14.9 秒），覆盖计划确认/刷新恢复、iframe 便签交互持久化、源码、修改与回滚 | 前端方向运行，主代理亲自复验通过 |
| `pnpm test:integration` | 全流程通过，包含回滚后继续修改第四版、正确恢复基线/父版本、签名预览及重启持久化 | 主代理亲自复验最新用例；后端方向亦通过 |
| `ATOMS_KEEP_TEST_DATA=1 pnpm test:integration:real` | 最后一轮 exit 0：真实生成、计划确认、发布、签名预览、修改、不可变恢复、分页事件、API 重启恢复通过 | Agent 方向实际执行；主代理审查两版 manifest、源码关系及第二版截图 |
| `apps/web/scripts/check-artifact.mjs` 真实第二版只读验收 | add / edit / searchMatch / searchEmpty / clearSearch / refreshPersistence / noPageErrors 全部 true；modelCalls=0、modifiedGeneratedFiles=false | 主代理亲自执行 |

上述计数对应当前测试文件，后续增加测试后应同步更新。Node 26 下 tsx 的 module.register 弃用提示不影响这些测试结果。

DSH 当前每个 Run 创建独立的 Planner 和 Worker 会话，跨 Run 使用已发布源码快照与 `projectMemory`；项目级长期存活 Router、通用工具型 Worker 尚未实现。真实模式先由模型输出受 Schema 约束的源码编辑，再由宿主校验并应用；不是无限制 shell 编码代理，也不是完整 Super-agent。

## 3. G4 真实模型最终结果与历史问题

最初真实整链路在计划确认后的生成阶段出现结构化 JSON 解析失败（Unexpected end of JSON input）。Agent 方向改进结构化输出处理，并固定适合该受控源码生成流程的低 reasoning 配置，最终整链路通过；任务预算没有放宽。

最终真实验证保留目录（本机临时证据，不提交源码仓库）：

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-integration-zoIGjh
```

主代理审查两份 manifest：每版 15 个文件，required typecheck/build/smoke 均 passed，behavior 明确为 not_run；第二版 baseVersionId 对应第一版。实际第二版截图包含搜索框。两个 Run 的记录输出分别为 8,751 和 10,616 tokens，均 2 steps；本轮没有结构化重试或验证修复。这是一次样例，不代表任意任务的成本、性能或成功率保证。

这里的 G4 通过范围是实际模型经 HTTP 产品链路完成两次交付、恢复及持久化。主代理随后使用 `apps/web/scripts/check-artifact.mjs` 对真实第二版 dist 做只读浏览器验收：新增、编辑、搜索匹配、搜索空结果、清空搜索、刷新持久化和无页面错误全部通过；该验收没有调用模型（modelCalls=0），没有修改生成文件（modifiedGeneratedFiles=false）。

这是追加的独立样例行为证据，不回写或篡改原始 manifest；自动 manifest 中 behavior 仍为 not_run。拖拽等未由本次样例检查覆盖的行为不得标记通过，也不能将这个样例推广为任意应用的行为保证。

## 4. G3 集成实际证明的内容

此脚本运行真实 API 服务与真实 Runtime HTTP，模型适配明确为 Fake DSH；生成项目会实际运行 TypeScript、Vite 和浏览器 smoke。

1. 体验码换取真实 Cookie 会话，创建项目。
2. 重复提交相同幂等请求只创建一个任务。
3. 计划模式进入 waiting_input，回答后恢复执行。
4. 获得 React 多文件源码、真实构建文件与检查证据。
5. 后端核验 manifest/file hash，发布签名路径预览。
6. 第二个任务修改项目并产生父子版本关系。
7. 恢复历史版本时创建第三个新版本，不覆写历史。
8. 默认 Fake 集成额外在恢复版继续修改，检查 baseVersionId、父版本关系及第四个版本的预览。真实模型集成暂不追加这次调用，控制额外额度消耗。
9. 连续分页读取项目事件，无跳号。
10. 停止并重启 API 后，会话、项目、版本、消息及事件游标仍可恢复。

脚本没有证明真实模型能完成任意需求，也没有覆盖任意应用的所有行为验收。行为未执行项必须保持 not_run，不统一显示通过。

真实模式脚本的范围为生成、修改、发布、恢复和 API 重启持久化；回滚后再次修改目前只由默认 Fake DSH 集成和后端独立测试覆盖，不能从 Fake 结果推断真实模型该路径已通过。

## 5. 后端独立补充验证

- 幂等键异体冲突、项目/生成额度、未授权会话、跨访客 404。
- 回答持久投递、过期 revision 拒绝、恢复不重复扣额。
- Runtime 接受启动后故意丢失响应，重试仍为同一执行。
- 哈希损坏候选拒绝发布，保留上一成功预览。
- 同项目任务串行，未派发取消释放预占额度。
- 取消已提交时，迟到成功不产生公开版本。
- 活跃任务期间 API 重启，不重复执行、不重复投影源事件。

后端使用单进程 SQLite JSON 快照持久化，适合 Demo；没有声称为多副本生产队列。

## 6. 运行方式

```bash
pnpm install --frozen-lockfile
pnpm dev:demo
```

工作台使用 `http://localhost:5173`，预览使用 `http://127.0.0.1:3002`。不同端口不隔离 Cookie，因此不要把工作台也改用 127.0.0.1 并声称主机隔离。

可使用 `ATOMS_DATA_ROOT=data/review-real pnpm dev` 为真实模型演示建立独立数据空间，保留既有测试项目和待确认任务。数据空间包含 API 数据、Agent 账本和本地服务凭证；同一开发体验码在新数据库重新 seed，不改变旧数据库额度。显式 `API_DATA_DIR`/`AGENT_DATA_DIR` 仍优先。

主代理已经按该命令建立真实 DSH 演示空间，工作台 `http://localhost:5173`，体验码 `atoms-demo-2026`。过程反馈更新前的只读复查（2026-11-08 08:48:35 UTC）确认非终态 Run 为 0；随后主代理安全重启同一数据空间，确认工作台 HTTP 200、API `/health` ready=true / protocolVersion=0.1.0、Runtime 4100 dsh listening。没有触发新 Run，原数据和额度保留。实际使用会消耗额度；不承诺本机进程退出后的持续可用性。

真实模型：根 `.env` 设置 `DEEPSEEK_API_KEY` 后 `pnpm dev`。`pnpm test:integration:real` 会调用真实模型并消耗额度，使用独立临时数据目录；模型 Key 只传 Agent，不传 API/Web，不写日志。

根启动器在数据根目录的 `local-secrets.json` 持久保存开发服务令牌和预览签名密钥，以避免重启后旧预览全部失效。默认目录为 Git 忽略的 data/；自定义路径也必须保持在忽略目录。这些文件不是可提交配置。

## 7. 尚未通过的门禁与限制

- G4 真实模型最小整链路最终通过；最初的解析失败、修复简述与最终证据见上节。真实第二版的只读样例行为验收也由主代理完成，与自动 manifest 和模型集成分别记录，不宣称任意行为覆盖。
- G2 浏览器与真实 API/Runtime（显式 Fake DSH）主流程已由主代理亲自复验通过，Mock 浏览器 3 项已通过；不代表真实模型的 G4 或任意行为覆盖。
- G5 Docker 操作系统隔离、两个 Cloudflare 临时隧道、公网 Cookie/Origin 和预览资源验收尚未完成。
- 本机验证不等于容器沙箱已安全隔离。不得开放公网生成或向用户宣称生产就绪。
- 独立预览主机上的不同项目仍共享浏览器 origin 存储，需要项目命名空间；没有严格多租户存储隔离。
- 临时域名受进程、网络和电脑休眠影响，无持续可用性保证。
- DSH 底座版本固定；扩展点和模型能力需以兼容性记录及真实测试为依据。
- 只读问答/意图路由尚未实现，当前输入仍进入 build/plan 任务；过程反馈改进不等于该问题已解决，也不代表完整项目级 Router。

当前阶段 check/test/build、最新 Fake 集成、真实模型最小集成与已有真实产物的只读行为验收均有上述实际结果。后续代码变更应按影响范围重新验证，G5 仍作为单独后续阶段。
