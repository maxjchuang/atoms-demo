# v0.2 项目消息协调协议（G0 已冻结）

| 项目 | 决策 |
| --- | --- |
| 状态 | G0 文档与 Schema 已冻结；M1 服务实现待开始 |
| 日期 | 2026-11-08 |
| 本阶段 | M1 项目协调；M2 可信交付、M3 隔离公网见 [能力路线图](capability-roadmap.md) |
| 协调协议 | 独立 `CoordinationProtocolVersion = 0.2.0` |
| 执行协议 | 保持 v0.1.0；原 `POST /api/v1/projects/:id/runs` 仍直接创建 Run |
| 默认交互 | auto；明确变更经 Router 判定和 API 准入后直接排队，不逐条重复确认 |
| 职责 | Router 属于 Agent；API 是消息、权限、额度、Run 和版本的业务权威 |

本文及独立 Schema/fixture 已由主代理完成 G0 审查：contracts 类型检查与 40/40 测试通过，原 v1 index/fixture/tests 无修改。M1 服务尚未实现，统一基线提交后再建立三个独立 worktree 开发。禁止直接把全局 v0.1 PROTOCOL_VERSION 改成 0.2，破坏旧执行与历史事件解析。

## 1. v0.1 保留什么，v0.2 增加什么

v0.1 只定义了历史 `GET messages` 与任务 `POST runs`，没有 `POST messages`，也没有完整只读对话入口。v0.2 增加消息协调生命周期，不把咨询伪装成 Run。

```text
前端消息输入 / 结构化快捷操作
      ↓
API：鉴权、幂等、保存用户消息、协调额度预占
      ↓
协调 Turn 队列 → Agent 项目 Router（只读、有界、持久上下文）
      ↓
consult / status / change_proposal / clarify / control
      ↓
API：校验结果与引用、执行准入、物化回复/提案/澄清
      ├── 咨询/状态 → 回复，不建 Run
      ├── 模糊意图/建议 → 消息级澄清或待确认提案，不建 Run
      ├── 明确变更 → 按 mode/basePolicy 检查后创建并排队 Run
      └── 明确取消目标 → 复用既有 Run 取消，不建新 Run
```

任何模型结果都不能直接修改源码、额度、项目权限、队列或版本。Worker 继续通过 v0.1 执行与产物协议工作。

## 2. 模式和意图准入

### 2.1 mode

| mode | 咨询/状态 | 清晰的显式修改 | 模糊意图或由咨询推导的建议 |
| --- | --- | --- | --- |
| `auto`（默认） | 只回答 | API 检查后自动排队；不重复问“是否开始” | 先消息级澄清/确认，不能自动写入 |
| `ask` | 只回答 | 只给提案，不直接建 Run；用户显式接受后另作授权 | 只解释或澄清，不自动写入 |
| `build` | 仍只回答，不能把明显咨询强制改成写入 | API 检查后直接排队 | 先澄清，不凭 build 模式补造需求 |

`runMode=build|plan` 只决定最终创建 Run 的执行策略：plan 仍进入原有 Run 计划确认。它不替代消息意图判定。

### 2.2 Router 判定与宿主授权

Router 返回结构化结果；修改与控制必须包含同项目用户消息引用、明确请求的文本证据及 `origin=explicit_request|confirmed_clarification|inferred_suggestion`。证据引用须能回指已保存消息，不接受模型伪造消息 ID。

API 根据 mode、结果种类、来源、权限、额度、允许操作和基线策略作准入。`inferred_suggestion` 无论 mode 为何都不能直接执行；模型的判断是准入输入，不是权限本身。不得用少量关键词替代自然语言 Router，也不能承诺任意模型分类必然正确，须通过代表性意图用例和真实样例评估。

状态/分享等结构化 UI 快捷操作可以由 API 基于可信事实直接回答、零模型调用。普通自然语言仍走 Router，不承诺所有咨询零模型。

## 3. 公共 HTTP

新增路径 `/api/v2`，使用协调版本头 `X-Atoms-Coordination-Version: 0.2.0`。旧 `/api/v1` 的请求、响应、错误、幂等和严格版本头保持不变。新接口沿用现有会话 Cookie、Origin/Fetch Metadata、归属检查及 Idempotency-Key。

| 方法与路径 | 请求/响应 | 语义 |
| --- | --- | --- |
| POST `/projects/:projectId/messages` | `SubmitMessageRequest` → 202 `{userMessage,turn}` | 保存并排队协调工作；返回不是模型完成 |
| GET `/coordination-turns/:turnId` | `CoordinationTurn` | 独立于 Run 的处理状态/结果 |
| POST `/coordination-turns/:turnId/cancel` | `{expectedRevision}` → 202/200 `CancelCoordinationResponse` | 只取消协调推理；已派发时返回明确回执，不取消 Worker |
| POST `/coordination-turns/:turnId/retry` | `{expectedRevision}` → 202 `{turn}` | 显式新 Turn，保留 retryOfTurnId 和原输入引用；不盲目重放不确定推理 |
| GET `/projects/:projectId/workspace` | `CoordinationWorkspace` | 消息协调快照，包含 v0.1 工作区的只读组合 |
| GET `/projects/:projectId/messages?before=&limit=50` | `{items:ConversationMessage[],nextCursor}` | 稳定历史分页，包含旧消息 |
| GET `/projects/:projectId/conversation-events?after=0&limit=100` | `ConversationEventPage` | 独立协调事件游标；不得混入 v0.1 seq |
| POST `/proposals/:proposalId/accept` | `{expectedRevision,runMode}` → 202/200 `{proposal,run}` | expectedRevision 是提案 revision；API 校验后最多创建一个 Run |
| POST `/proposals/:proposalId/dismiss` | `{expectedRevision}` → `{proposal}` | 撤回建议，无生成任务 |
| POST `/proposals/:proposalId/refresh` | `{expectedRevision}` → 202 `{userMessage,turn}` | 只读重评，旧提案保留，新提案另行接受 |
| POST `/clarifications/:clarificationId/dismiss` | `{expectedRevision}` → `{clarification}` | 关闭消息级问题，不取消既有 Run |
| GET `/proposals/:proposalId` | `ChangeProposal` | 历史提案引用可恢复，不依赖当前卡片仍在快照中 |
| GET `/clarifications/:clarificationId` | `Clarification` | 历史问题/答复关联可恢复 |
| GET `/projects/:projectId/memory` | `ProjectMemoryView` | 已确认目标/决定与来源的可审计视图，不返回 DSH session 或隐式推理 |
| GET `/session` | `CoordinationSession` | 原生成配额与独立消息配额并列，不往 v1 Session 塞新字段 |

快捷操作仍经过消息入口记录用户意图与回复；直接 GET Run/版本状态不触发模型或消息扣额。

### 3.1 SubmitMessageRequest

```ts
{
  input: { kind: 'text', content: string }
    | { kind: 'status', targetRunId?: ID }
    | { kind: 'sharing_help', contextVersionId?: ID }
    | { kind: 'selection', optionId: ID },
  mode: 'auto' | 'ask' | 'build', // 默认 auto
  runMode: 'build' | 'plan',     // 默认 build，仅影响可能创建的 Run
  contextVersionId?: ID | null, // 事实/代码阅读来源，不自动构成锁版承诺
  replyTo?: {
    clarificationId: ID,
    expectedRevision: positiveInteger,
    replyToMessageId: ID
  }
}
```

一般问答可基于有权限的历史成功版本，但明确变更默认针对项目执行时最新成功版。若用户要在历史版本上继续写入，应明确恢复流程或 exact_version 提案，不偷偷把历史选择转换成当前版本修改。

有 replyTo 时，API 先校验问题归属、revision、状态、过期时间及 replyToMessageId，原子保存回答和新 Turn、将 Clarification 标为 answered 并绑定 answerMessageId/continuationTurnId。过期/冲突返回 409，不退化为新的修改任务。模型完成与用户回答已保存是两件事。

selection 分支必须有 replyTo，text 可带 replyTo 作为文字回答；status/sharing_help 不接受 replyTo。selection 必须命中该 revision 的 options.id；text+replyTo 仅在 allowText=true 时接受。API 将所选选项的已保存 label 作为用户可读消息，保留 optionId 作为结构化证据，不让前端传任意 label 或把选项 ID 拼进自由文本供模型猜测。

无 replyTo 的“可以”“好的”“就这样”等短答不得自动绑定最新问题、提案或 Run。Router 可以询问具体所指，不猜测跨任务授权。

## 4. 领域对象与状态

### 4.1 ConversationMessage

字段：`id, projectId, historySeq, coordinationTurnId|null, runId|null, replyToMessageId|null, role=user|assistant, actor=user|coordinator|worker|system|legacy_assistant, content, status=streaming|complete, revision, createdAt, updatedAt`。historySeq 是项目内稳定的消息记录顺序，首次赋值后不因关联 Run 或更新内容而改变。

M1 的协调结果是完整可展示答复，不把内部结构化 JSON 部分流当聊天文字。模型失败/中断写明确系统回复和 Turn 错误，不把截断 JSON 当答案。执行侧已有 streaming 消息维持原义。

历史助手消息不能仅凭文字猜测属于 Router 或 Worker；无可靠元数据时 actor=legacy_assistant。旧用户/消息 ID、文本和时间保持不变。

### 4.2 CoordinationTurn

字段：`id, projectId, revision, userMessageId, assistantMessageId|null, mode, runMode, status, contextVersionId, contextRevisionUsed, memoryRevisionUsed, conversationRevisionUsed, result|null, error|null, continuationOfTurnId|null, retryOfTurnId|null, createdAt, startedAt|null, completedAt|null, updatedAt`。

状态：`queued → processing → completed | failed | interrupted`；`queued|processing → cancelling → cancelled`。

clarify 是 completed 的一种结果，不把已经结束的模型调用长期标为 processing/waiting_input。未答问题由 Clarification 独立保存。Run 的原状态机不用于承载咨询生命周期。

内部 Agent completed 先表示模型结果已持久化；公共 Turn 只有在 API 完成结果校验、消息/提案/问题物化及必要的 Run 准入事务后才 completed。不得先向前端宣布完成，再异步无 fence 地派生 Run。

公共结果：

| kind | 内容 |
| --- | --- |
| `consult` | replyMessageId、contextUsed、经校验的事实/版本/文件引用 |
| `status` | replyMessageId、contextUsed、目标 Run 的 asOf/status/phase 等可信观察值 |
| `change_proposal` | proposalId、admission=proposed|run_queued|blocked、runId|null、可选准入失败原因 |
| `clarify` | clarificationId、replyMessageId |
| `control` | action=cancel_run、targetRunId、receipt、replyMessageId；只由 API 填真实执行回执 |

Router 已完成但配额不足时，Turn 可以 completed，提案保留 open/blocked，明确未创建 Run；不能把“理解完成”显示成“应用构建成功”。

### 4.3 Clarification

字段：`id, projectId, revision, originatingTurnId, questionMessageId, question, options[], allowText, contextVersionId, contextRevision, relatedProposalId|null, status, answerMessageId|null, continuationTurnId|null, expiresAt, createdAt, updatedAt`。

options 固定为 `{id,label}[]`；id 为稳定选项 ID，不接受重复 ID。选项通过 selection+replyTo、文字通过 text+replyTo 提交；不能只有按钮 label 而没有可验证 optionId。

状态：`open|answered|dismissed|superseded|expired`。answered 表示回答已持久保存，不表示模型已经处理完毕。新回答的 Turn 可独立排队、失败、重试或取消。

每个完成的协调 Turn 最多产生一个具体问题；项目可保留多个不同来源的问题卡片，但回答必须显式绑定。上下文变化造成原问题不再成立时标 superseded，不将新短答解释为授权旧操作。默认过期时间和限额由配置确定并返回明确 expiresAt。

### 4.4 ChangeProposal

字段：`id, projectId, revision, originatingTurnId, sourceMessageIds[], summary, goal, acceptance[], origin, basePolicy, contextUsed, status, acceptedRunId|null, supersedesProposalId|null, lastAdmissionError|null, expiresAt, createdAt, updatedAt`。

状态：`open|accepted|dismissed|expired|stale`。API 分配 ID、绑定来源和权限；模型只给建议内容。自动排队也先持久化提案与 admission 证据，便于解释为何创建了任务。

明确修改在 auto/build 下可自动接受，不要求每次再点按钮。ask 中的修改、模糊请求和咨询推导出的建议先提案/澄清，显式接受后才执行。

### 4.5 两种 basePolicy（不得混用）

| 策略 | 用途 | 派发规则 |
| --- | --- | --- |
| `latest_on_dispatch` | 默认清晰修改意图；表达“接下来增加搜索”等目标 | 与 v1 一样在实际出队时选最新成功版；UI 明示这一语义，不宣称锁定消息时版本 |
| `exact_version {expectedBaseVersionId: ID|null}` | 用户确认针对具体版本的提案；null 表示尚无成功版本 | 接受前核对 expectedBaseVersionId 与 proposal revision；派发前再次核对代码基线，过期 CONFLICT/重新确认，不静默换基线 |

contextVersionId 与 contextRevision 只表示答复/计划参考来源，不能被暗中当作 exact 锁定。exact 的代码基线检查是 expectedBaseVersionId，提案内容并发检查是 proposal revision；普通消息、阶段更新或其他事实快照变化不能凭 contextRevision 自动制造锁版冲突。权限/允许范围始终按当前策略另行校验。

exact 提案在接受时可创建排队 Run；后端在 RunRecord 额外持久来源提案和授权 fence。若排队期间版本/相关约束变化，在尚未执行前将该 Run failed(CONFLICT)、提案 stale，释放未启动的生成预占，明确要求刷新提案/确认；不调用 Worker、不消耗生成次数。v1 直接创建和 latest 意图队列维持原来的 latest 派发规则。

已有活跃 Run 时，latest 的明确修改可以排队，不因前一个任务发布而被迫再确认；这正是它与 exact 的区别。

exact 过期后的“刷新提案”使用 `POST /api/v2/proposals/:proposalId/refresh {expectedRevision}`，创建新的只读重评协调 Turn，引用原提案、当前可信版本和原目标，不让 UI 合成带 ID 的自然语言。刷新只耗协调预算，强制只提案、不得自动建 Run；旧 stale/expired 提案保留，新 exact 提案包含 supersedesProposalId 和新基线，用户再显式接受。不可在原提案上悄悄改 expectedBaseVersionId 后执行。

### 4.6 受限 control：cancel_run

M1 只增加任务取消控制，不开放任意 shell、批量停止、修改权限、部署等命令。Router 必须返回 `targetRunId, expectedRevision, sourceMessageIds, explicitRequestEvidence`。

API 核对同项目归属、明确请求、mode、目标 revision 和状态后复用现有取消机制。多个候选或“停掉那个”等指代不明时必须 clarify，不能猜最新任务。ask 模式不自动执行控制，可给带明确目标的 UI 操作建议。

控制不创建新 Run、不扣生成额度；若模型参与仍受协调预算限制。回执只能表示 cancelling 或已有真实终态，不能把接受取消写成已停止。Router 的取消和 Worker 的取消是两个不同端点/对象，禁止误杀对方。

### 4.7 CoordinationWorkspace 与历史分页

```ts
{
  protocolVersion: '0.2.0',
  execution: WorkspaceSnapshotV1, // 原对象完整保留，包括原 Run/Attention/版本
  context: { contextVersionId: ID | null, contextRevision: integer, memoryRevision: integer },
  conversationRevision: integer,
  messages: ConversationMessage[], // 最近 50 条，旧消息与新协调消息的统一只读投影
  olderMessagesCursor: opaqueString | null,
  pendingCoordinationTurns: CoordinationTurn[], // queued/processing/cancelling
  latestCoordinationTurn: CoordinationTurn | null, // 保留终态，刷新不丢失失败/结果
  clarifications: Clarification[], // 当前 open 问题及答复待处理关联
  proposals: ChangeProposal[], // 当前 open/stale 或最近接受的相关提案
  executionEventCursor: integer,
  conversationEventCursor: integer
}
```

整个 CoordinationWorkspace（execution、统一消息、卡片、上下文/记忆 revision 与两个游标）必须来自同一一致读边界；不能通过先后调用两个 HTTP 快照再拼接。executionEventCursor 必须等于 execution.eventCursor；两个事件游标分别标记各自序列，不能大小比较或互换。新会话界面使用顶层统一 messages，不再把 execution.messages 第二次渲染；构建面板仍使用 execution 的原状态与执行活动。

完整历史用 before 不透明 keyset 游标按稳定 historySeq 分页，返回项按记录顺序排列并保留消息 ID；前端合并时保留滚动锚点，不以模型文本或非单调时间戳当游标。历史问题/提案关联可按消息中的 ID 读取，不能只保存当前可见卡片。

### 4.8 新协调错误与配额视图

协调模块使用独立错误 Schema，沿用 `{error:{code,message,retryable,requestId,details?}}` 外形，不修改 v1 ErrorCode enum。区分协调次数不足、生成次数不足、澄清过期、提案 revision 冲突、exact 版本冲突、推理中断与服务不可达。

`CoordinationErrorCode` 固定为：`INVALID_REQUEST | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | STALE_REVISION | CLARIFICATION_EXPIRED | PROPOSAL_EXPIRED | COORDINATION_QUOTA_EXCEEDED | GENERATION_QUOTA_EXCEEDED | RATE_LIMITED | RUNTIME_UNAVAILABLE | BUDGET_EXCEEDED | INFERENCE_INTERRUPTED | INTERNAL_ERROR`。exact 版本变化使用 409 CONFLICT，并在 details.reason 标 `BASE_VERSION_CHANGED`；不将旧 v1 Run.error 的 ErrorCode enum 扩展为新协调枚举。

推荐 HTTP 语义：400 输入不合法，401 会话失效，404 无权/不存在，409 幂等异体或过期绑定/基线，403 对应额度或权限不足，429 限流/协调队列满。消息已可靠入队后返回 202，Runtime 暂不可达通过 Turn 的排队/连接提示展示，不把已接收消息伪装为未创建而引发重复。

CoordinationSession 包含原生成 quota 的只读投影与独立 `coordinationQuota={limit,reserved,used}`。计数以体验码准入主体共享，与现有生成主体一致；重登、重复请求和浏览器切换不能重置。控制 API 或轮询不隐式消费消息次数。

## 5. 项目上下文和持久 Router

### 5.1 ContextSnapshot

字段：`id, projectId, contextRevision, conversationRevision, contextVersionId|null, asOf, hash, facts, projectMemory, recentMessages, sourceArtifact?`。

- contextRevision：API 管理的事实快照版本，供来源解释与审计；不自动构成代码基线 fence，不因普通消息、每秒轮询或临时阶段变化要求重新确认提案。
- conversationRevision：已接受项目消息与决定的顺序，供 Router 串行消费与恢复，不能拿它当源码版本 fence。
- asOf：事实快照时间。Worker 可在 Router 推理期间完成发布，咨询/状态答案应保留参考时间与版本，不伪装为实时事实。
- facts：API 提供的项目、当前版本、相关 Run、检查、可用功能和部署状态；不由模型猜测平台能力。
- sourceArtifact：可选的受控已发布源码快照引用；不得提供可变 Worker workspace、宿主机路径或任何服务凭证。

facts 是 Agent 专用脱敏子集，**不能直接序列化完整 Version/Session/Workspace DTO 给模型**。允许项目标题、版本 ID/摘要、Run ID/真实状态/阶段、检查摘要、功能是否可用、部署范围及时间等必要事实；禁止 signed preview URL、Cookie、模型 Key、服务 token、宿主/内部路径和任意凭证化链接。

分享和下载以 `availableActions=[{id,kind,versionId?,available,reason?}]` 及受控版本引用表示。Router 只能引用 action ID；用户点击后由 API 根据当前归属、有效期及实际能力生成新链接。模型不能看到旧签名地址或自己拼 URL。sourceArtifact 使用 Artifact ID/manifest hash/允许路径，不使用内部 HTTP 地址；实际读取由受控适配器完成并受下表预算约束。

“如何分享这个应用”应得到基于真实部署能力的说明。如果平台仅本机预览，不能编造公网分享链接；源码导出、预览有效期、后续部署条件以 facts 为准。

### 5.2 持久性要求

M1 必须提供项目级持久 Router：优先稳定的 DSH project session/home/会话记录，按项目 FIFO 处理协调 Turn。Worker 每 Run 独立会话，不与 Router 共用可写会话或进程。

若 SDK 限制要求重建会话，替代方案必须可靠持久化项目对话、已确认决定、偏好、澄清/提案引用、memory revision 和已消费 Turn 游标，再从受控上下文恢复，并通过跨消息/跨进程验收；仅传上一版 summary 不算完成项目协调。采用替代方案时须明确标为持久上下文恢复，不冒充同一原生 session。

每轮新的权威 facts 覆盖历史中的易变事实；记忆不能扩张权限、重写政策或将引用内容变成授权。压缩摘要保留来源消息/决定 ID，不能把丢失上下文当作自动执行理由。

### 5.3 ProjectMemory 与决定来源

API 保存可审计的 `ProjectDecision`：`id,projectId,revision,kind=goal|preference|decision,text,status=active|superseded,sourceTurnId,sourceMessageIds[],sourceProposalId|null,sourceClarificationId|null,supersedesDecisionId|null,confirmedAt,createdAt,updatedAt`。决定只能来自明确用户请求、已回答的澄清或已接受提案，不把 Router 的猜测、外部文档或助手自述当成用户决定。纠正偏好时保留旧决定及 supersedes 关系，新权威记忆必须覆盖旧 session 中已失效的内容。

公开 `ProjectMemoryView={projectId,revision,decisions:ProjectDecision[],summary,summaryThroughConversationRevision,updatedAt}`。summary 是带来源决定的压缩视图，不代替 decisions 的权威状态。CoordinationWorkspace.context 增加 memoryRevision，内部 projectMemory 带完整该次使用 revision；Turn.memoryRevisionUsed 记录实际推理来源，便于审计与重启验收。

Router 可随结果提出有界 memoryUpdates，API 验证来源及允许的项目记忆种类后持久化。修改权限、额度、执行策略和安全范围不属于 memoryUpdates 的可写内容。一个被取消或拒绝准入的协调结果不能偷提交其派生的“已确认决定”。

Agent 保存 `RouterMemory`：`projectId,revision,summary,decisionIds[],summaryThroughHistorySeq,consumedConversationRevision,lastCompletedTurnId,updatedAt`，以及私有 DSH sessionId/home 映射。摘要是缓存和上下文压缩，不是授权权威；API 的原消息/决定/提案记录仍是事实来源。

每个内部协调输入的 projectMemory 含 accepted decision 子集、memory revision、来源 ID 和必要摘要。会话重建输入必须包括：最新受信 facts、已确认目标/决定、未结澄清/提案、最近消息、压缩覆盖游标和当前源版本。超过有界上下文时保留来源与缺失说明，不能静默丢弃决定再执行。

即便主路直接恢复 DSH 原生 session，也须验证跨 API/Agent 重启后记住已确认目标，且新 facts 覆盖旧状态。可靠上下文重建是有测试的替代方式，不是退回每 Run 只传上一版 summary。

## 6. 内部 Agent 协调协议

新增 `/internal/v2`，使用服务认证及协调版本头；旧 `/internal/v1` 继续严格使用执行版本 0.1.0。

| 方法与路径 | 语义 |
| --- | --- |
| PUT `/coordination-turns/:turnId` | 同 ID 同体幂等受理；异体 409；API 可在应答丢失后查询/重发同 ID |
| GET `/coordination-turns/:turnId` | `CoordinationExecutionSnapshot` |
| GET `/coordination-turns/:turnId/events?after=&limit=100` | 持久 sourceSeq，默认 100、上限 100；空页不推进游标 |
| POST `/coordination-turns/:turnId/cancel` | commandId 幂等，只停止 Router 自己的推理与进程 |

受理输入：`protocolVersion, turnId, projectId, inputMessageId, assistantMessageId, content, operation, mode, runMode, replyTo?, continuationOfTurnId?, context, budget`。

operation 必须保留经过 API 校验的可信 typed binding：普通 `{kind:'message',input}`；答复 `{kind:'clarification_answer',questionSnapshot,relatedProposal,answerMessageId,answer}`；刷新 `{kind:'proposal_refresh',proposalId,expectedRevision,forceProposalOnly:true}`。普通 input 保留 text/status target/sharing version；带 replyTo 的文字和 selection 答复必须转为完整 clarification_answer，不只传一个 optionId 或拼好的 label。控制结果引用的 sourceMessageIds 和 targetRunId 必须来自该授权输入/上下文。content 仅为可读审计文本，不能替代 operation 或让 Router 猜测选项、refresh 或取消目标。

questionSnapshot 是 API 接受回答时保留的原问题/选项/来源及当时 revision 的不可变快照；即使业务 Clarification 已 answered、已退出 pending 列表或问题超出 recentMessages 窗口，也必须随本次请求传入。relatedProposal 为其完整受信关联提案（无关联时 null）；answer 为已解析的 `{kind:'selection',optionId,label}` 或 `{kind:'text',content}`。选项 label 必须匹配 questionSnapshot 的 optionId，由 API 查询生成；Runtime 验证绑定一致性，不靠模型补猜。questionSnapshot 不是将旧问题重新打开，也不重新赋予已过期授权。

proposal_refresh 内部请求强制 mode=ask；API 提供原提案的可信只读上下文，Agent 不得把刷新按钮当普通明确修改自动执行。

内部状态：`accepted|running|cancelling|completed|failed|cancelled|interrupted`。API 映射为公共 queued/processing 等，不复用 Run 状态。

CoordinationExecutionSnapshot 包含 `protocolVersion,id,projectId,revision,status,lastSourceSeq,contextUsed,result|null,error|null,usage,updatedAt`。usage 只提供实际已报告的模型步数和输入/输出量；未知值标未知，不从字符数伪造 token。

内部结果种类：`consult|status|change_proposal|clarify|control`，包含 contextUsed、受控引用和消息证据。结果不能携带自分配 Run ID、公开版本 ID、任意下载 URL 或执行命令。

内部事件：`coordination.accepted / started / progress / completed / failed / cancelled / interrupted`，稳定 metadata 与可展示文字，不含模型隐藏推理。完成事件携带结构化结果，progress 不得被当作完成或授权。

内部事件 envelope 为 `protocolVersion,projectId,turnId,sourceSeq,occurredAt,event`；sourceSeq 按 turnId 连续。公开 ConversationEvent 为 `protocolVersion,projectId,turnId|null,seq,occurredAt,event`；seq 按项目的协调序列连续。两个 EventPage 都含 items/nextCursor/hasMore；API 保留源活动发生时间，API 自己的准入/同步事件用真实宿主时间，不用空轮询制造活动。

Agent 先保存受理账本，再调用模型；先持久完成结果，再发送 completed。同 ID 已完成返回原结果，不重复推理。崩溃时已开始但结果不确定则 interrupted，不能盲目重跑；显式重试使用新 Turn，记录 retryOfTurnId 和实际预算消费。

API 在首次发送前必须事务持久化完整 `StartCoordinationRequest`（包括 facts/context/typed operation/budget）及规范化 hash。网络重试、应答丢失和 API 重启复用完全相同的请求体，不重新计算“更新的 facts”导致同 turnId 异体冲突。项目内协调串行派发，下一条消息在前一条结果/记忆已物化后绑定首次请求上下文；后续版本变化通过 asOf/基线策略处理，不覆盖已发送快照。

## 7. 并发、预算和恢复

- 每项目 Router 协调串行；Clarification 返回后本次模型 Turn 已结束，不占计算槽，也不阻塞项目后续独立问题。
- 全局 Router 计算槽与 Worker 分开且有界，初始可配置为 1 Router + 1 Worker；这是 v0.2 显式新增资源规则，不沿用 v1“所有模型只用一个槽”的推断。
- Worker 同项目单写/全局单写保留。Router 只读已发布快照，不拿项目写锁，长构建不应堵住咨询入口。
- 协调有独立 message 次数、token、步数、壁钟和频率限制。接收消息预占协调次数，首次实际处理结算；未开始取消释放。宿主快捷回复 token=0，但仍可受消息次数/频率限制。
- 咨询、状态、澄清、只读提案不占生成次数；自动或显式接受修改时才预占 Run 额度。生成次数耗尽时仍可在协调限额内咨询，反之亦然。
- v1 生成计费保持原规则：首个 execution.started 转 used；失败/已开始取消仍计一次，内部修复不新增次数。
- API 同事务保存用户消息、协调 Turn、幂等结果和 outbox；准入 Run 时同事务保存提案状态、Run、生成预占和执行 outbox。模型调用与数据库事务分离。
- v2 修改准入复用已保存的 inputMessageId，不再追加第二条相同用户消息。RunRecord 持久 originTurnId/sourceMessageId/proposalId，(projectId,originTurnId,actionKind) 唯一；同一协调结果重投、断线恢复或重复接受都返回已有 Run。v1 直接 POST runs 仍自行创建用户消息，不改变旧语义。
- 断线查询同 turnId、按 sourceSeq/公共 seq 回放，不重复用户消息、模型执行或 Run。对外错误/恢复提示需去重且脱敏，不用假终态掩盖不可达。

### 7.1 统一默认配置（M1）

默认值统一进入配置与 fixture，三方不能各自猜测。额度属于体验码准入主体，服务器可显式配置；这些值不构成绝对费用硬限承诺。

| 配置 | 默认值 | 语义 |
| --- | --- | --- |
| 协调次数 | 每体验码 50 次 | 独立于原生成 10 次；每个新 Turn 预占，开始处理结算；网络同 ID 重试不新增 |
| 消息提交频率 | 每准入主体每分钟 20 次 | 不对 GET 轮询扣消息额度 |
| Router 全局并发 | 1 | 独立于 Worker 的 1 个槽 |
| 同项目协调并发 | 1 | FIFO，同一项目消息有序消费 |
| 同项目未终态协调 Turn 上限 | 5 | queued/processing/cancelling 合计；超限 429，不先写半个任务 |
| 同项目 open 澄清上限 | 5 | clarify 结束模型轮次，不占计算槽 |
| 同项目 open 提案上限 | 10 | 超限不给无限新提案；以明确限制回复处理 |
| 单 Turn 模型步数 | 3 | 结构化重试也计入 |
| 单 Turn 有效执行时长 | 90 秒 | 排队不计；超限只取消自己的 Router 推理 |
| 单 Turn 输入预算 | 32,768 tokens | 以实际报告的用量在边界检查 |
| 单 Turn 总输出预算 | 8,192 tokens | 包含同 Turn 的重试，不逐请求重置 |
| 结构化输出重试 | 最多 1 次 | 必须还在总步数/时间/token 预算内 |
| 一条文本消息 | 最多 12,000 字符 | v1 原 prompt 上限不受影响 |
| 单 Turn 源码读取 | 最多 5 文件、总 24 KiB | 只读受控已发布快照；截断/缺失必须说明 |
| 最近消息上下文 | 最多 20 条、总 24 KiB | 更早内容经带来源的持久摘要承接，不删除历史 |
| 项目记忆上下文 | 最多 16 KiB | 保留决定来源与摘要覆盖游标 |
| 澄清/提案有效期 | 24 小时 | exact 基线冲突可更早 stale；旧 Run 等待期限不变 |
| 普通 Run question 上限 | 每 Run 2 个 | 不含 plan_confirmation；计数和回答存 Runtime 私有执行账本 |

模型请求可能在观察到用量前已有在途消费，不能保证零超出货币硬上限；服务端次数、并发、步数和总预算共同约束。结构化宿主快捷回复 token=0，但仍属于一次已处理协调消息；直接 GET 状态不新建 Turn。

### 7.2 协调取消与派生 Run 的竞争

取消意图与 Run 准入必须在同一 API 业务权威下事务裁决。若协调取消先提交，禁止任何迟到结果派生 Run、自动接受提案或写入其派生记忆；停止确认后 cancelled。若模型已经完成但尚未准入，仍按该取消 fence 抑制写入。

若 Run 准入事务先提交，协调 Turn 的结果已包含 acceptedRunId。随后取消协调请求返回 `CancelCoordinationResponse={turn,disposition:'already_dispatched',run}`，明确任务已经派发；不得声称取消了 Worker，也不得顺手调用 Run cancel。用户可通过明确的 Run 控制另行取消。

其余 disposition 为 `cancellation_requested|cancelled|already_completed`。已完成的咨询没有 Worker 可取消；排队且尚未受理的协调可由 API 直接确认取消，释放其消息预占。所有操作幂等，重启保留取消 fence 和派生唯一关联。

### 7.3 Run 内问题与消息级澄清并存

消息级 clarify 在尚未决定执行时产生，不创建 Run；本次协调模型 Turn 完成，问题与后续回答由独立 Clarification/新 Turn 维护。

已经创建的 Run 在规划/实现过程中发现具体缺失信息时，Runtime 必须实际产生 v0.1 已有的 `Attention.kind=question`，支持 options/text 回答、revision 校验、持久恢复和取消，不能只实现 plan_confirmation。该 Run 进入 waiting_input，保留项目写锁、释放 Worker 计算槽；回答仍走原 `/api/v1/runs/:runId/answers`，不是创建新协调任务或重复 Run。

M1 每 Run 默认最多 2 个普通 question，plan_confirmation 不计数。计数、待答问题及答案在 Runtime 私有 ExecutionRecord 持久化；沿用既有 budget/maxWaitingInputMs/modelSteps，并将回答附到后续同一 Worker 上下文，不改 StartExecutionRequest、启动 hash 或重建任务来清零预算。

v2 工作区应把“项目消息问题”和“执行中的问题”分开展示并标记来源。短答必须显式绑定其中一个对象；不能把消息级回答投到某个活跃 Run，也不能反过来。

## 8. v0.1 历史、事件和快照兼容

1. 保留 `@atoms/contracts` 现有 v1 Schema、原 PROTOCOL_VERSION 字面值和入口；新增独立 conversation/coordination 模块及 CoordinationProtocolVersion，不把新字段塞进旧 strict Run/Workspace。
2. 新协调事件使用独立项目级 conversationSeq。v1 执行事件继续使用现有项目 seq，不重编号、不加入新 variant。
3. v2 工作区返回两个明确游标：executionEventCursor 与 conversationEventCursor。前端分别消费；历史只用于展示，不拿旧状态覆盖最新快照。
4. ConversationEvent 种类：`message.upserted / turn.updated / proposal.updated / clarification.updated / control.receipt`。公开消息、结果、提案变化由 API 分配序号，Agent sourceSeq 独立去重。
5. v2 消息历史只读合并既有消息与新协调消息，按稳定 historySeq/不透明游标分页。历史导入保留原 ID、文字、时间；缺少 actor/turn 元数据时标 legacy_assistant/null，禁止猜测补造。
6. 旧 v1 消息接口可以继续只投影原 Message 形状；若暴露新增消息也必须降为兼容的 user/assistant、streaming/complete，不透传额外字段。v2 负责完整协调语义。
7. API 迁移只增补协调存储、元数据和游标，不清空旧 code/session 配额、Run、Version、events 或 immutable 产物。Agent 协调账本与旧执行账本隔离。
8. 对已有旧消息重建历史时不得触发 Router/Worker、创建 Run 或消耗模型额度。版本预览与下载继续使用旧授权机制。
9. v2 inputMessage 准入成 Run 后，同一消息保留 ID/historySeq 并建立 runId 关联；不复制成新用户行。v1/v2 投影和两条事件流即使都看到该消息，也必须按消息 ID/revision upsert，不能重复显示。新关联元数据不加入旧 DTO。
10. 升级后的所有 v1 执行消息新增/变化也必须在同一事务物化为 v2 `message.upserted`，附稳定 historySeq/revision 和可靠元数据；旧 v1 DTO 保持原样。v2 界面对话只消费 v2 消息投影，v1 流用于 Run/文件/检查等执行活动，不能用缺少 revision 的 v1 Message 覆盖 v2 元数据。

## 9. M1 验收矩阵

| 用例 | 必须观察到 | 禁止结果 |
| --- | --- | --- |
| auto：“如何分享这个应用给别人？” | 基于真实能力咨询回复；Run 数和生成次数不变 | 自动新增分享功能或编造公网 URL |
| auto：“增加搜索框” | 明确修改→API 准入→latest 队列，最多一个 Run | 无意义的二次确认、重复扣额 |
| ask：“把按钮改蓝” | 提案/解释，不执行 | ask 模式自动写代码 |
| build：“这个应用如何使用？” | 咨询或澄清 | 因 build 模式强制改写 |
| 模糊修改或咨询导出的建议 | 一个具体消息级问题/提案，模型轮次结束 | 未确认先建 Run |
| 显式绑定问题的短答 | 新协调 Turn 继续原问题，保存来源证据 | 把短答当无关新构建 |
| 原问题已不在 recent/pending 列表 | typed clarification_answer 仍携带原问题、选项、关联提案和可信答案 | 只凭 label/optionId 猜原意 |
| 无绑定“可以”或过期问题 | 澄清/409，不创建 Run | 猜最新问题或跨项目授权 |
| Run 执行中确实缺少信息 | 普通 question Attention → 原 answers → 恢复同一 Run | 只支持计划确认、另建 Run 或吞掉回答 |
| Worker 运行时咨询 | 独立 Router 队列处理，旧预览可用 | 因项目写锁永久阻塞咨询 |
| latest 排队期间前任务发布 | 出队基于最新成功版执行，UI 语义明确 | 误报 exact 冲突、静默宣称锁版 |
| exact 接受/派发时版本变化 | CONFLICT/stale，未启动预占释放 | 静默使用另一版本执行 |
| exact 提案刷新 | typed proposal_refresh → 新 exact 提案 → 显式接受 | UI 拼 ID 猜意图、自动换基线执行 |
| 明确取消唯一目标 | API 复用取消，真实 stopping 回执 | 新建 Run、猜另一个任务、说已停止 |
| 多取消候选/ask 控制 | 澄清或只读建议 | 批量/越权停止 |
| 生成配额用尽仍咨询 | 按独立协调限额处理 | 咨询误扣生成次数 |
| 重复发送/应答丢失/重启 | 消息和 Run 不重复，Router 上下文可恢复 | 不确定推理自动无界重跑 |
| 首次发送后事实发生变化再重试 | 同 turnId 重发已持久请求/hash | 重新计算 facts 造成异体或静默换上下文 |
| 协调取消与自动派生 Run 同时发生 | 先提交取消则不建 Run；先准入则回 already_dispatched | 取消协调误杀 Worker、迟到结果绕过取消 |
| v2 消息最终创建 Run | 用户对话仅一条原消息，来源 Turn/Run 可追踪 | 再追加相同用户输入、重复扣额/建 Run |
| 重启后询问已确认目标/偏好 | 从持久 session/决定与摘要恢复，引用原消息来源 | 只记上一版 summary、重复索要已确认信息 |
| 用户明确纠正已保存偏好 | 保留 supersedes/来源，新 memory revision 覆盖旧 session | 用旧会话偏好压过新决定 |
| Context facts/分享引用 | 只有脱敏事实和 action/version refs，点击时 API 换链接 | 模型收到签名预览 URL、凭证或内部路径 |
| 升级旧数据 | 原对话分页可见，旧 Run/版本/活动仍可读 | 清库、重编号、重跑历史 |
| 提示注入或越权引用 | Router 只读，API 拒绝无权目标/能力 | 模型自行扩大权限或公开部署 |

G0 已冻结；M1 将分别实现 Web+Mock、API+Fake Coordination Runtime、Agent+Fake Router，再做实际三服务和有界真实 Router 样例。不得用 Fake 分类准确率替代真实 Router 的代表性咨询/修改评估。

## 10. 已冻结 G0 共享交付入口

```ts
// 既有 v1：保持版本、DTO 和导入路径不变
import { PROTOCOL_VERSION, Run, WorkspaceSnapshot } from '@atoms/contracts';
// 新 v2：独立模块，不向旧入口塞新 variant
import {
  CoordinationProtocolVersion, SubmitMessageRequest, CoordinationWorkspace,
  StartCoordinationRequest, RouterResult, ConversationEventPage,
} from '@atoms/contracts/conversation';
import { scenarios, workspace } from '@atoms/contracts/conversation-fixtures';
```

冻结文件：`packages/contracts/src/conversation.ts`、`conversation-fixtures.ts`、`test/conversation.test.ts`。主代理已亲自复验类型检查与 40 项契约测试；这些测试只校验 DTO/语义不变量和合成样例，不证明服务、持久 Router 或真实分类已实现。主代理负责提交统一 G0 基线，再从该提交建立三个独立实现 worktree，M1 实现待开始。
