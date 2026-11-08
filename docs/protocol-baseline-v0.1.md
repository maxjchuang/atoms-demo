# Atoms Demo 首版协议基线 v0.1.0

| 项目 | 内容 |
| --- | --- |
| 状态 | 已冻结为首版并行开发基线；实际服务待实现与联调 |
| 日期 | 2026-11-08 |
| Agent 底座 | DeepSeek Harness（DSH），独立 DeepSeek API 凭证 |
| 协议版本 | `0.1.0` |
| 验证范围 | 类型检查、27 项契约测试、前后端边界交叉审查 |
| 未完成验证 | DSH 真实接入、隔离执行、三服务联调、外网部署 |

本文是三条开发线共同遵循的 Markdown 基线入口。HTTP 端点和边界规则由下列专题文档补充，可执行 DTO 与 Schema 在共享契约包中维护。两者发生冲突时先修正并协调版本，不允许消费者各自解释。

## 1. 协议文档清单

| 文档 | 用途 |
| --- | --- |
| [架构与职责](architecture.md) | 技术选择、所有权、状态机、发布与隔离 |
| [公共 HTTP 协议](public-api.md) | 前端与后端的完整端点、认证、轮询、输入与预览规则 |
| [Agent 内部协议](agent-protocol.md) | 后端与 Runtime 的启动、事件、取消、输入和产物协议 |
| [并行开发计划](parallel-plan.md) | 分工、文件所有权、独立测试、合并顺序和门禁 |
| [验收与 Mock 场景](acceptance.md) | 三套替身、共享场景矩阵、真实端到端验收 |
| [共享 Schema 与 DTO](../packages/contracts/src/index.ts) | 运行时校验及 TypeScript 类型的唯一来源 |
| [共享场景样例](../packages/contracts/src/fixtures.ts) | 11 条合成时间线和 7 类错误响应 |

## 2. 三方边界

```text
前端 apps/web
    │ /api/v1 · Cookie · JSON · 增量轮询
    ▼
后端 apps/api
    │ /internal/v1 · 服务令牌 · JSON · 可重放事件
    ▼
Agent apps/agent
    └── DSH Router / Worker / 受控工具 / 隔离项目执行
```

前端与 Agent 不存在直接调用关系。模型密钥、DSH 原生事件、内部服务令牌和宿主机路径均不得进入公共接口。

| 开发线 | 拥有的责任 | 不拥有的责任 | 独立测试替身 |
| --- | --- | --- | --- |
| 前端 | 页面、API client、事件渲染、计划/问题卡片、代码与预览 | 任务权威状态、项目权限、DSH 细节 | Mock API |
| 后端 | 身份、配额、业务队列、项目锁、状态投影、版本发布/回滚 | 模型执行、DSH 会话管理 | Fake Runtime |
| Agent | DSH、Router/Worker、计算槽、验证修复、候选产物 | 用户身份、额度扣减、公开发布 | Fake DSH 与输入产物服务 |

前端采用独立 React/Vite 工程，后端采用独立 Node/Fastify 服务，避免共享应用路由目录造成并行编辑冲突。DSH 仅存在于 Agent 内部适配层。

## 3. 公共协议摘要：前端 ↔ 后端

基础路径：`/api/v1`。Cookie：`atoms_session`，HttpOnly、host-only、SameSite=Lax，生产启用 Secure。

所有 POST/DELETE 使用 `Idempotency-Key`。相同身份、方法、路径、键和请求体重试不重复产生业务副作用；同键异体返回 409。每个资源接口独立校验项目归属。

| 能力 | 接口 |
| --- | --- |
| 体验码与会话 | `POST /sessions`、`GET /session`、`DELETE /session` |
| 项目 | `GET /projects`、`POST /projects` |
| 工作区恢复 | `GET /projects/:projectId/workspace` |
| 历史消息 | `GET /projects/:projectId/messages` |
| 新建生成/修改任务 | `POST /projects/:projectId/runs` |
| 项目增量事件 | `GET /projects/:projectId/events?after=<seq>&limit=100` |
| 任务查询 | `GET /runs/:runId` |
| 计划确认/问题回答 | `POST /runs/:runId/answers` |
| 请求取消 | `POST /runs/:runId/cancel` |
| 版本列表与回滚 | `GET /projects/:projectId/versions`、`POST /projects/:projectId/restore` |
| 文件与源码下载 | `GET /versions/:versionId/files`、`GET /versions/:versionId/file`、`GET /versions/:versionId/source.zip` |
| 验证证据 | `GET /versions/:versionId/evidence`、`GET /versions/:versionId/evidence/:evidenceId` |

任务创建示例：

```http
POST /api/v1/projects/project_demo/runs
Content-Type: application/json
Idempotency-Key: create-run-example-001

{
  "prompt": "构建一个支持拖拽和刷新保存的便签墙",
  "mode": "build"
}
```

响应为 `202 {"run": Run}`。`mode=plan` 在规划后等待确认；`mode=build` 默认直接执行，必要歧义仍可产生结构化问题。

工作区快照同时返回 `project`、`activeRun`、`queuedRuns`、`latestRun`、`currentVersion`、`messages`、`olderMessagesCursor` 和 `eventCursor`。前端先应用快照，再从该游标增量读取；刷新后可以恢复任务失败、待回答和答案待投递状态。

## 4. 内部协议摘要：后端 ↔ Agent

基础路径：`/internal/v1`。使用服务令牌和 `X-Atoms-Protocol-Version: 0.1.0`，不向公网发布端口。

| 能力 | 接口 |
| --- | --- |
| 健康与能力 | `GET /health` |
| 幂等创建执行 | `PUT /executions/:executionId` |
| 执行查询 | `GET /executions/:executionId` |
| 源事件回放 | `GET /executions/:executionId/events?after=<sourceSeq>&limit=100` |
| 回答投递 | `POST /executions/:executionId/inputs` |
| 请求取消 | `POST /executions/:executionId/cancel` |
| 候选产物 | `GET /executions/:executionId/artifacts/:artifactId/manifest`、`GET .../file` |

Agent 读取后端已发布输入快照的反向接口：`GET /internal/v1/input-artifacts/:artifactId/manifest` 与 `GET .../file`。只传受控 artifact ID 和 manifest hash，不传任意宿主机路径或下载地址。

启动输入 `StartExecutionRequest` 至少包含：协议版本、executionId、runId、projectId、attempt、prompt、mode、baseVersionId、input、mandate、budget。

首版 mandate 固定为 React 前端范围，禁止修改依赖集合、自动公网部署和外部消息发送。budget 明确执行时间、等待用户时间、模型步数、输入/输出 token、修复轮次和产物大小。

## 5. 共享数据和状态

| 对象 | 关键字段与语义 |
| --- | --- |
| Project | `id`、`revision`、`currentVersionId`、`activeRunId` |
| Run | `status`、`phase`、`baseVersionId`、`executionId`、`pendingAttention`、`pendingAnswer`、`resultVersionId` |
| Attention | 问题 ID、revision、类型、选项、是否允许文本回答、可选计划 |
| Version | 父版本、恢复来源、检查结果、`previewUrl`、`previewExpiresAt` |
| Message | 用户/助手、完整 content、streaming/complete 状态 |
| ProjectEvent | 后端分配项目级连续 `seq`，前端消费 |
| AgentEvent | Agent 分配执行级连续 `sourceSeq`，后端去重投影 |
| ArtifactManifest | 文件相对路径、大小、sha256、checks、证据 ID 到文件的映射 |

Run 状态固定为：

```text
queued → running → waiting_input → queued → running
running → succeeded | failed
queued / running / waiting_input → cancelling → cancelled
运行中断且旧执行已清理或隔离 → interrupted
```

阶段独立为 `planning / generating / verifying / repairing / publishing`。只有后端可设置 publishing，并在版本发布事务完成后设置 succeeded。

Runtime `accepted` 映射公开 queued；Runtime succeeded 只表示候选产物完成，不等于公开成功。`execution.started` 仅首次实际开始时出现，回答后恢复不会再次扣额度。

## 6. 必须共同遵守的一致性规则

1. 后端是业务状态唯一权威；Agent 自有执行账本，不直接写业务表。
2. 后端管理业务队列和项目写锁；Agent 管理实际计算槽和 accepted FIFO。
3. 同项目只有一个写入者。新需求创建新任务，在派发时绑定最新成功版本。
4. 等待用户释放计算槽，但保留项目锁；回答需核对 Attention ID 和 revision。
5. 取消请求接受不等于已停止；收到真实停止确认后才取消终态并释放锁。
6. 取消意图与发布事务先提交者获胜；迟到产物不能覆盖已取消任务或新版本。
7. 启动应答丢失，查询或重发同 executionId，不能另起重复执行。
8. 公开事件与源事件使用不同序号。消息在后端合并，前端只消费完整 message.updated。
9. required 类型、构建、运行 smoke 检查通过且证据可解析，才允许候选交付。
10. 后端校验 manifest、文件 hash/路径/大小、执行归属和版本基线后原子发布。
11. 回滚创建新版本，旧历史不覆写；失败、取消和中断保留上一成功预览。
12. 重启后通过执行 ID 和事件账本对账；无法证明旧执行停止时不得释放锁导致双写。

## 7. 预览、访问与凭证

- 访客使用体验码和匿名会话，配额绑定体验码；模型 Key 不分发给访客。
- 工作台和预览使用独立主机。预览采用短期签名路径，不依赖第三方 Cookie。
- Vite 使用相对 base，首版使用 hash 路由；预览签名 URL 有效期内复用，临近到期续签。
- 代码、截图、日志按资源类型安全展示，模型输出不能在工作台执行。
- 模型凭证仅供模型调用进程使用，shell/browser 与生成应用不继承；不挂载宿主机 home 或 Docker socket。
- Cloudflare Quick Tunnel 不支持 SSE，首版使用约一秒增量轮询；工作台与预览各用一个隧道。

## 8. 独立开发、验证和合并

| 门禁 | 组合 | 目标 |
| --- | --- | --- |
| G0 | 共享协议、fixture、契约测试 | 统一基线，当前已通过 |
| G1 | Web+Mock、API+Fake Runtime、Agent+Fake DSH | 各自独立构建、测试与验收 |
| G2 | Web+API+Fake Runtime | 业务 HTTP、会话、队列、预览与交互 |
| G3 | API+Agent+Fake DSH | 执行、事件、输入、取消与产物一致性 |
| G4 | 三服务+真实 DeepSeek API | 真实生成、修改、验证与回滚后修改 |
| G5 | Docker+Cloudflare 隧道 | 公网访问、Cookie/Origin、预览隔离、下载和恢复 |

合并顺序：共享基线 → 后端及 Fake → 前端 → Agent → 部署与跨服务测试。开发可并行，合并前各方向必须先通过独立验收。

共享契约和根配置由集成人维护；三方只修改自己目录。破坏性协议变更须先修改 Markdown、Schema、fixture 和版本，再同步消费者。

## 9. 本基线的校验与限制

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

这些命令无需模型 Key、DSH、Docker 或数据库。27 项测试验证协议和合成场景，不能替代服务实现、真实模型效果或隔离能力验收。后续各应用的开发、Mock、独立测试命令仍需由对应方向实现。
