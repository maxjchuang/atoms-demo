# Agent 内部协议 v0.1.0

实现方：`apps/agent`。消费者：`apps/api`。这是我们定义的稳定适配协议，不是 DSH 原生 API。

## 传输与身份

内部地址由环境配置（开发默认 `http://127.0.0.1:4100`，Compose 内 `http://agent:4100`），不接受用户传来的地址。所有内部请求携带 `Authorization: Bearer <service-token>` 和 `X-Atoms-Protocol-Version: 0.1.0`。容器网络不对外发布 runtime 端口，token 不进入前端或执行目录。

公共 HTTP 的 Idempotency-Key 在此转换为稳定的 executionId/commandId。Agent 使用自己的账本，先落盘再确认接收；不能与 API 共用业务 SQLite 写表。

## 端点

| 方法与路径 | 请求 | 成功响应 | 语义 |
| --- | --- | --- | --- |
| GET `/internal/v1/health` | — | 200 `{protocolVersion,ready,capabilities}` | ready=false 不可派新任务；capabilities 含 template、cancel、attention、artifact 支持情况 |
| PUT `/internal/v1/executions/:executionId` | `StartExecutionRequest` | 首次 201、重试 200 `ExecutionSnapshot` | 同 ID 同体不重复调用模型；同 ID 不同体 409 |
| GET `/internal/v1/executions/:executionId` | — | 200 `ExecutionSnapshot` | 用于状态查询与恢复对账 |
| GET `/internal/v1/executions/:executionId/events?after=0&limit=100` | — | 200 `AgentEventPage` | 持久源事件，有序且可重放 |
| POST `/internal/v1/executions/:executionId/inputs` | `AgentInputRequest` | 202 `ExecutionSnapshot` | commandId 幂等；问题过期 409 |
| POST `/internal/v1/executions/:executionId/cancel` | `CancelExecutionRequest` | 202；已终态 200 `ExecutionSnapshot` | 只有真正停止后才能 execution.cancelled |
| GET `/internal/v1/executions/:executionId/artifacts/:artifactId/manifest` | — | 200 `ArtifactManifest` | 仅该执行拥有的不可变候选 |
| GET `/internal/v1/executions/:executionId/artifacts/:artifactId/file?path=...` | — | 200 原始文件 | 仅 manifest 白名单路径，无目录浏览 |

path executionId 必须匹配 body.executionId。health 仅表示本地依赖就绪，不暗示真实模型请求成功或有余额。错误 envelope 与公共 API 相同，但只返回脱敏信息。

## 输入快照的反向读取

首次任务 input.kind=template，Agent 自带固定 `react-vite-v1` 模板。修改任务由后端传版本和 artifact ID，不传绝对路径、压缩包 URL 或凭证。

API 提供仅内部可读端点，Agent 通过配置的 API_INTERNAL_URL + service token 获取：

| 方法与路径（由 API 实现） | 响应 |
| --- | --- |
| GET `/internal/v1/input-artifacts/:artifactId/manifest` | 已发布版本的 `ArtifactManifest` |
| GET `/internal/v1/input-artifacts/:artifactId/file?path=...` | manifest 内条目内容 |

Agent 验证 manifestSha256、文件 hash/大小，复制 source/ 到独立执行目录。发布后的 API 存储不可被 Agent 直接修改。manifestSha256 对原始 manifest HTTP UTF-8 JSON 字节计算；服务必须持久保存同一份序列化字节，不允许每次重排生成不同 hash。

源码模板允许基本交互和项目命名空间的 localStorage。固定依赖与 lockfile 不允许模型变更；工作区不得包含其他项目或服务密钥。

## DSH 接入约束

Runtime 包装 TypeScript SDK/profile，通过插件或受控工具实现 Router/Worker、验证与交付。具体 SDK API、准确版本和权限映射由接入门禁确认，不写入公共契约。

- Router 持有项目目标与必要摘要，不能直接发布、扣额或创建超出当前请求的执行。
- Worker 每 Run 一个会话和独立 workspace；工具使用受控沙箱，不依赖 cwd 形成安全边界。
- 一个 DSH turn 完成不等于工作完成；必须有类型检查、构建、运行 smoke 的实际证据。
- required behavior 检查通过才交付；未实现的行为验收标 not_run 且 required=false，并在 summary 明确说明，不得伪造通过。
- 内置验证修复只在该 Run mandate/budget 内继续；限制模型步数、输入/输出 token、壁钟、修复轮数与产物大小。token 上限按已报告用量在调用边界检查，存在单次在途超出，不能宣传为绝对费用硬限。
- maxWallTimeMs 累计实际 running 状态有效执行时间，从首次 execution.started 开始；首次/恢复 accepted 排队以及 waiting_input 不计入。maxWaitingInputMs 是每次等待输入的最长时间，默认 24 小时。超限清理进程后以 BUDGET_EXCEEDED 失败，不自动放宽预算。
- 问题必须经结构化 Attention：只允许一个未解问题。Answer 与 Attention.kind/options 对照校验；等待时停止模型循环，不持续轮询模型。

## 事件与状态

AgentEvent.sourceSeq 从 1 连续递增，按 executionId 独立；落盘成功后才对外可见。唯一键 `(executionId,sourceSeq)`。重复读取得到相同 payload；API 去重后分配自己的项目 seq，不能直接复用 sourceSeq。

分页 nextCursor 为最后返回 sourceSeq，空页不前进。limit 默认 100，范围 1–100。事件至少保留到公开任务终态后 7 天；首版可不清理。游标过期 410；不存在执行 404。

message.delta 是正常展示文字，不要求或暴露模型隐式推理。message.completed 包含完整权威文本。文件事件只含相对路径和变更类型，实时内容不在事件中；首版代码页只看成功版本源码。

事件含义：

- execution.started：实际开始使用模型/执行资源，可用于配额从 reserved 转 used。
- execution.updated：完整 ExecutionSnapshot；首次 accepted、恢复 accepted、实际 running、waiting_input、cancelling 时产生。execution.started 仅首个运行阶段发一次，不能恢复再扣额。accepted 映射公开 queued，running 映射 running，waiting_input 同名；Runtime succeeded 映射公开 running/publishing，最终成功由 API 决定。
- phase.changed：planning/generating/verifying/repairing；无 publishing。
- attention.created / resolved：待回答状态的增量信息；最终以快照为准。
- check.completed：一次真实检查结果，修复后可用同 check ID 更新最新状态，历史事件保留。
- artifact.ready：manifest 和所有文件已完整落盘且不可变，可读取。
- execution.completed：候选验收达到本次要求；必先有 artifact.ready，且 artifactId 相同。
- execution.failed / cancelled / interrupted：唯一执行终态，不得再追加模型/文件变更事件。

API 可在接收到 completed 后进入 publishing；此时公开 Run 仍为 running。仅 API 校验并提交发布事务才 succeeded。

## 重试、取消和崩溃

启动超时先 GET 同 executionId，必要时重发相同 PUT；不能另建执行。网络重试不能改变 budget 或 prompt。

commandId 重试同体返回首次结果，不同体 409。回答确认后排队继续，不在 handler 中直接抢占模型资源。

取消接受后终止模型调用、shell/browser 子进程和后台任务；不能只 abort HTTP。报告 cancelled 前确保旧执行不能继续写产物或源码。API 仍需用当前 executionId 和取消标记防迟到发布。

重启保留 ledger 与源事件。SDK resume 恢复会话不代表恢复外部进程；不能盲目继续已中断命令。清理或隔离旧进程后报告 interrupted。显式重试新建 Run，attempt=1；未来需要同 Run 重试时再升级协议。

## 候选产物

ArtifactManifest.files 使用 `source/`、`dist/`、`evidence/` 前缀，条目包含 bytes、sha256、mediaType。evidence 数组把证据 ID 映射到 files 中的 evidence/ 路径和种类；Check.evidenceIds 必须可解析，required 检查至少有一项证据。必须有 source/package.json、dist/index.html，required typecheck/build/smoke 都 passed，任何 required check 未通过不得交付。manifestSchema 的路径语法校验只是第一层；两个服务还必须做 realpath/符号链接检查、文件数与总大小限制。

后端不执行 manifest 中的命令，不请求任意 URL，不信任扩展名声明，不接受绝对路径、重复路径、路径穿越或 symlink。导出源码排除执行凭证、node_modules、DSH home、日志和环境文件。fixture hash 是占位符，真实集成必须计算并核验实际字节。
