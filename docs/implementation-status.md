# 最小闭环实施与验证记录

更新日期：2026-11-09。原执行协议基线为 [v0.1.0](protocol-baseline-v0.1.md)，M2 独立 delivery 协议与实际证据见 [M2 状态](m2-delivery-status.md)。本文保留各阶段真实执行记录，不把旧阶段计数当当前包总数，也不把 fixture 当浏览器/模型证据。

完整运行要求 **Node.js 24.9.0+、pnpm 10.33.0**；目前在 macOS arm64 / Node.js 26.5.0 验证。Node 22 只能覆盖部分基础能力，不满足当前固定 DSH 版本要求。

最新增量为 M2 隔离实现：主管 contracts 86、API 55、Web 56；Agent 作者报告 71，主管此前完整 61 与新 18 focused 分开记录；编排工具 22 另列。完整 Fake `Vd1rPn`、第四真实空间 `ryZwrG` 的生成/修改/恢复后 reviewed-exact 修改、真实只读 UI 与严格重启已通过。三次真实质量均 partial，均 attempt_0/repairRound0；另一次独立真实受控故障修复与同计划/clean ZIP 复验通过（1 模型步骤、9,931 有效输入、4,842 输出），不冒充自然生成失败。原 auto/exact 严格断言失败保留，不能称第三次 auto 准入成功。M2 App 未升级 live，主仓当前仅共享 `a1c7c23`；M3 未开始。

M1 应用及本机 live 安全升级已完成，历史 148 项（42 / 30 / 34 / 42）、六轮真实 Router + Fake Worker、分段浏览器与缓存计量修正记录保留于 [M1 状态](m1-coordination-status.md)。此前 79 项与旧 G3/UI 同样保留，不与 M2 新计数混算。

原设计复核范围见 [能力路线图](capability-roadmap.md) 和 [v0.2 消息协调协议](protocol-v0.2.md)。原 v1 strict 契约保持兼容。下文 M0 两次真实代码历史仍仅为当时的 G4 子集；新增 M2 才补充恢复后真实修改证据，不回写旧 manifest 或以 M1 Fake Worker 冒充真实代码。M2 已实现并隔离验收，应用合并/live 升级另行安排；M3/G5 尚未实施。

### 最新 M2 证据与限制

| 范围 | 当前实际结果 |
| --- | --- |
| Fake 全链路 | `atoms-m2-delivery-Vd1rPn` exit 0，实际 Runtime/Fake Model + 编译/DSL/干净 ZIP，3 Code/2 Router/只读 UI/严格重启；质量 complete/complete/partial |
| 真实代码链 | `atoms-m2-delivery-ryZwrG` 前两真实 Code 成功；恢复 V3 后 exact 提案保持 proposed，使原 runner exit 1；主管审阅并显式接受后第三 Code 发布 V4，独立 resume exit 0 |
| 真实交付质量 | 三次均 partial；自动 cases 7/8/8 和 clean ZIP 同计划均 passed；manual leaf/父汇总缺口保留；均 repairRound0，业务 Run 无失败；独立受控真实修复已验收 |
| 授权与次数 | 第三 Seed=explicit_proposal_acceptance，base/parent=恢复 V3；总3 Code/4 Version/2 Router。原 auto Turn 仍 proposed；最后 ask/consult 只读，不增第四 Run |
| 原证据与恢复 | 原2 Run/3 Version（除 URL 缓存）、110证据文件及原失败日志不变；真实只读 UI 与 API/Runtime sealed 严格重启通过，证据详见 M2 状态/最终 ledger |
| 历史失败 | 前三真实 Preparation 失败 `PMMN5g/epad1z/HaEXjt`、第四次原 auto 断言失败和首次 resume 备份拒绝均保留，未复活/抹账 |
| 部署 | M2 App 未升级用户 live；主仓当前仅共享 a1c7c23。M3 Docker/系统隔离/双隧道/外部分享未开始 |

### 已有 M1 证据与 live 边界（历史）

| 项目 | 当前结果 | 来源 |
| --- | --- | --- |
| 节点测试 | M1 当时各包合计 148：42 / 30 / 34 / 42 均有主管独立通过记录；此前全仓 142 项及补修 Agent check + 34/34，含新增 6 计量用例 | 主管亲自复验，保留分段来源；全仓 check/build 此前通过 |
| Fake HTTP 链路 | 六组通过，包含 Web HTTP 服务；实际 API/Agent v2 + FakeRouter/FakeDSH + 真实构建/smoke | 主代理亲自运行；不等于 Web 浏览器 E2E |
| 六轮真实消息 Router | 全部通过，真实 DSH/DeepSeek Router + Fake Worker；记忆纠正和 API/Agent 重启 canonical memory 保留 | 主代理显式启动并验收，证据 `atoms-m1-integration-Ty23Ah` |
| 本次用量 | 非缓存输入 9,094 + 缓存读取 16,640 = 有效输入 25,734；输出 1,401；总量 27,135；6 modelSteps | 本次真实样例计量复核，非绝对费用保证 |
| 计量修正 | 原 Worker/Router 漏缓存读已修；cache read/write 算有效输入、settled 去重，原生六轮向量等 6 新回归通过 | 主管复验 Agent check + 34/34；不重跑模型、不回写旧 ledger |
| Web 分段验收 | 首轮咨询零 Run/计划确认刷新/Fake 构建与 iframe 交互持久化/ask 不建 Run和接受 V2；复用轮稳定咨询 UI+暖色记忆刷新；source-only exit 0，精确来源可见且 0 消息/0 Run，revision/latestRunID/quota 不变 | 主管已视觉 review；中间两次 first()/重复文案测试假设失败已修，无对应产品故障 |

真实样例目录：`/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m1-integration-Ty23Ah`。有效输入 25,734 / 输出 1,401 / 总量 27,135 保留原生向量核对口径，旧 ledger 不回写。本机截图位于隔离集成目录 `apps/web/review-artifacts/m1-services/{consult,memory-and-preview,memory-source}.png`，不把分段证据称为一条无中断脚本。

主管已实际升级本机 live：停服前后 drain=0，完整目录备份至 `data/backups/review-real-pre-m1-20261108` 且备份当时 diff -qr 一致；main ff 到 `732695e`、offline frozen 安装通过，真实 DSH 服务已重启。Web 5173 / API 3001 health 均 200。升级后仍为项目 2、Run 5、版本 5、消息 55、非终态 0；主管核对 legacy `codes/sessions/projects/runs/versions/messages/events/sourceEvents` 与备份 JSON 字节一致。协调字段增量迁移，无自动新 Run/重跑，数据和额度保留，密钥未入 diff。最后文档推送待主管；不将本机升级称为 M3 公网交付。

## 1. 当前实现

| 方向 | 已落地 | 验证边界 |
| --- | --- | --- |
| 前端 `apps/web` | React/Vite 工作台、delivery 质量/缺口/来源、证据/diff/导出和旧交互 | 主管56项；Fake及真实既有应用的只读服务浏览器门禁通过 |
| 后端 `apps/api` | 原身份/配额/队列/发布 + delivery Seed/冻结/预算、证据/精确ZIP/diff、来源恢复、签名缓存轮换 | 主管55项；Fake与真实exact续跑、严格重启通过；单进程取舍保留 |
| Agent `apps/agent` | DSH Router/Worker、Prepare/derived提议、受控DSL、验证/有限修复、干净ZIP复验与候选报告 | 作者71；主管此前完整61+最新focused18分别记录；三真实交付round0通过，真实失败修复未遇到 |
| 集成 | Fake/真实启动器、受控exact resume、只读Web、sealed重启与完整备份门禁 | Fake Vd1rPn及真实ryZwrG reviewed-exact续跑通过，原auto失败不改写 |

## 2. 历史 v1 已执行检查（不代表当前 M2 包计数）

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

上述计数对应当时 v1 阶段，当前 M2 分项来源见本文开头及 M2 状态。Node 26 下 tsx 的 module.register 弃用提示不影响这些测试结果。

以上旧生成链路证据来自每 Run Planner + Worker 阶段。M1 新增项目级消息 Router、API 权威目标/偏好/决定、纠正来源和持久恢复，已通过上述有限真实 Router 样例；通用工具型 Worker、任意场景行为验收和公网隔离仍未完成。源码编辑继续受宿主路径/协议约束，不能称为无限制 shell 编码代理或完整通用 Super-agent。

## 3. 历史 M0 真实模型子集与问题（原证据不回写）

最初真实整链路在计划确认后的生成阶段出现结构化 JSON 解析失败（Unexpected end of JSON input）。Agent 方向改进结构化输出处理，并固定适合该受控源码生成流程的低 reasoning 配置，最终整链路通过；任务预算没有放宽。

最终真实验证保留目录（本机临时证据，不提交源码仓库）：

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-integration-zoIGjh
```

主代理审查两份 manifest：每版 15 个文件，required typecheck/build/smoke 均 passed，behavior 明确为 not_run；第二版 baseVersionId 对应第一版。实际第二版截图包含搜索框。两个 Run 的记录输出分别为 8,751 和 10,616 tokens，均 2 steps；本轮没有结构化重试或验证修复。这是一次样例，不代表任意任务的成本、性能或成功率保证。

这里已验证的范围是实际模型经 HTTP 产品链路完成两次交付、恢复及持久化，不包含恢复后的第三次真实模型修改；因此只算原 G4 的最小子集，不是完整门禁通过。主代理随后使用 `apps/web/scripts/check-artifact.mjs` 对真实第二版 dist 做只读浏览器验收：新增、编辑、搜索匹配、搜索空结果、清空搜索、刷新持久化和无页面错误全部通过；该验收没有调用模型（modelCalls=0），没有修改生成文件（modifiedGeneratedFiles=false）。

这是追加的独立样例行为证据，不回写或篡改原始 manifest；自动 manifest 中 behavior 仍为 not_run。拖拽等未由本次样例检查覆盖的行为不得标记通过，也不能将这个样例推广为任意应用的行为保证。

## 4. 历史 v1 G3 集成证明的内容

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

以上旧脚本当时的真实范围为生成、修改、发布、恢复和 API 重启；恢复后真实修改的新增证据来自 M2 reviewed-exact 续跑，而非从这些旧 Fake 结果推断。

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

- M2 已补充恢复后真实修改、同计划行为/clean ZIP、真实只读 UI与严格重启；原 auto runner exact/proposed 断言仍失败，后续是显式接受。真实三Run均partial、首attempt/round0，独立受控故障已完成真实修复及同计划/clean ZIP 复验；不把静态审阅/fixture当动态或通用语义保证。
- G2 浏览器与真实 API/Runtime（显式 Fake DSH）主流程已由主代理亲自复验通过，Mock 浏览器 3 项已通过；不代表真实模型的 G4 或任意行为覆盖。
- G5 Docker 操作系统隔离、两个 Cloudflare 临时隧道、公网 Cookie/Origin 和预览资源验收尚未完成。
- 本机验证不等于容器沙箱已安全隔离。不得开放公网生成或向用户宣称生产就绪。
- 独立预览主机上的不同项目仍共享浏览器 origin 存储，需要项目命名空间；没有严格多租户存储隔离。
- 临时域名受进程、网络和电脑休眠影响，无持续可用性保证。
- DSH 底座版本固定；扩展点和模型能力需以兼容性记录及真实测试为依据。
- M1 live 已升级；M2 App仍未合并升级用户live，主仓当前仅共享a1c7c23；安全drain/停服/完整备份与升级需主管另行安排。有限Router和本次exact续跑不保证所有表达分类正确，不代表通用Super-agent或M3完成。

各阶段检查、Fake、历史真实子集及新增 M2 reviewed-exact 真实链路分别保留来源。后续变更按影响范围重验；M2 App安全升级与M3/G5仍作为明确后续工作。
