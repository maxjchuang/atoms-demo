# 公共 HTTP 协议 v0.1.0

实现方：`apps/api`。消费者：`apps/web`。基础路径 `/api/v1`，JSON UTF-8。类型与 Zod Schema 来自 `@atoms/contracts`。不暴露 DSH 类型、会话标识、内部 token 或宿主机路径。

## 通用规则

- 所有响应带 `X-Atoms-Protocol-Version: 0.1.0` 和请求关联 ID；普通对象直接返回，列表按下表包装。
- JSON 请求使用 Content-Type application/json。所有 POST（含兑换体验码）和 DELETE 带 `Idempotency-Key`，8–128 个可打印 ASCII 字符。GET 不修改业务状态。
- 同一身份/会话、方法、路径、幂等键且相同规范化请求体返回首次业务结果；不同请求体返回 409 CONFLICT。记录至少保留至会话过期后 24 小时。
- 身份创建前的 code 兑换按体验码哈希 + 幂等键去重，不存明文码。重试须重新发送首次 Cookie 值或等效可恢复会话，不创建新额度。
- Idempotency-Key 不能替代身份认证或项目授权。动态资源的后续状态使用 GET 获取。
- 会话 Cookie `atoms_session`：HttpOnly、生产 Secure、SameSite=Lax、host-only、Path=/。开发 HTTP 可不设 Secure。预览域不能取得该 Cookie。
- 写请求校验 Origin/Fetch Metadata；部署在同源 `/api`，默认拒绝跨源写入。所有资源先检查归属，跨访客与不存在对象统一 404，避免泄露存在性。
- 验证失败 400；无有效会话 401；配额不足 403；状态冲突 409；过期游标 410；限流 429；内部依赖不可用 503。
- 错误统一 `ApiError`：`{error:{code,message,retryable,details?,requestId}}`。429/503 可带 Retry-After。

## 端点

| 方法与路径 | 请求 | 成功响应 | 说明 |
| --- | --- | --- | --- |
| POST `/sessions` | `RedeemCodeRequest` | 201 `Session` + Set-Cookie | 同一体验码共享配额；码哈希存储 |
| GET `/session` | — | 200 `Session` | 当前配额与过期时间 |
| DELETE `/session` | — | 204 | 注销当前会话，清 Cookie；重复调用仍 204 |
| GET `/projects?cursor=&limit=20` | — | 200 `{items:Project[],nextCursor:string|null}` | 默认按 updatedAt/id 倒序；limit 1–100 |
| POST `/projects` | `CreateProjectRequest` | 201 `Project` | 只建项目，不隐式生成 |
| GET `/projects/:projectId/workspace` | — | 200 `WorkspaceSnapshot` | 原子快照，见下节 |
| GET `/projects/:projectId/messages?before=&limit=50` | — | 200 `{items:Message[],nextCursor:string|null}` | items 按创建顺序；before 读取更早消息 |
| POST `/projects/:projectId/runs` | `CreateRunRequest` | 202 `RunMutationResponse` | 保存用户消息、预占额度、排队；事务内完成 |
| GET `/projects/:projectId/events?after=0&limit=100` | — | 200 `ProjectEventPage` | 项目级递增事件游标 |
| GET `/runs/:runId` | — | 200 `Run` | 含排队、Attention、错误和结果版本 |
| POST `/runs/:runId/answers` | `AnswerRequest` | 202 `RunMutationResponse` | 先持久存储输入/outbox，确认运行时接收后排队恢复 |
| POST `/runs/:runId/cancel` | `{}` | 202 `RunMutationResponse`；已终态 200 | 接受取消不代表立即停止 |
| GET `/projects/:projectId/versions?cursor=&limit=20` | — | 200 `{items:Version[],nextCursor:string|null}` | 按创建时间/id 倒序 |
| POST `/projects/:projectId/restore` | `RestoreVersionRequest` | 201 `RestoreVersionResponse` | 新建恢复版本；revision 不匹配 409 |
| GET `/versions/:versionId/files` | — | 200 `FileList` | 返回 source/ 下文件 manifest；只读 |
| GET `/versions/:versionId/evidence` | — | 200 `{items:EvidenceDescriptor[]}` | EvidenceDescriptor 为 `{id,kind,path,mediaType,bytes}`；仅该版本 manifest 内证据 |
| GET `/versions/:versionId/evidence/:evidenceId` | — | 200 原始证据文件 | 检查项目归属，日志按文本、截图按图片安全展示 |
| GET `/versions/:versionId/file?path=source/src/App.tsx` | — | 200 原始文件 | 路径只允许 manifest 中条目；UI 按文本转义展示 |
| GET `/versions/:versionId/source.zip` | — | 200 application/zip | 仅源码与必要配置，无凭证、node_modules、执行日志 |

列表游标为服务端不透明字符串，不允许客户端自行拼接。项目事件游标是整数，两者不能混用。

## 原子快照与轮询

WorkspaceSnapshot 必须在一致读边界内返回 project、activeRun、queuedRuns、latestRun、currentVersion、最近最多 50 条 messages 和 eventCursor。activeRun 指已取得项目锁的非终态任务，包括等待用户和恢复排队；queuedRuns 仅含尚未取得项目锁的新任务。latestRun 是最近创建的任务，包含终态，供刷新后恢复错误/交付卡片；它可能与 activeRun 不同。queued activeRun 表示已取得锁但尚未实际 running。

messages 包含截至 eventCursor 已物化的部分/完整文本，使用 Message.status 区分 streaming/complete；olderMessagesCursor 只用于补历史。前端先替换快照再请求 `after=eventCursor`，不能把游标之前的完整历史丢掉。

ProjectEvent 的 `seq` 由后端按项目分配且连续；Runtime 的 sourceSeq 不向前端分配此序号。正常分页 `nextCursor` 等于本页最后一条 seq；空页维持请求 after，hasMore=false。客户端处理本页后才能推进游标。

同一事件重复获取不会重复执行 UI 副作用，以 `(projectId,seq)` 去重。发现断档、410、项目切换或终态结果不一致时重新取快照。API 合并 Runtime message.delta，将物化后的完整 Message 用 message.updated 发布，前端只按 messageId 完整 upsert，不拼接 Runtime delta。首条 upsert 创建 streaming Message，完成时 status=complete；重复事件不会重复追加文本。

前端使用项目上下文与请求代次丢弃过期的轮询/快照响应，避免切项目或重取快照后被旧响应覆盖。

status/phase、Attention、checks、preview 均以 `run.updated`、`version.published` 或快照为准。`activity.recorded` 只用于过程时间线，不得将其中 execution.completed 解释为公开任务成功。

终态后再刷新 workspace/Run 确认公开结果；停止该任务的高频轮询。项目仍有 queuedRuns 时继续项目轮询；不以关闭页面终止任务。浏览器隐藏时降频，网络错误重试退避至最多 10 秒。

## 提问、配额与回滚

- 计划模式：规划完成必须产生 plan_confirmation；approve_plan 才执行。直接构建模式默认不要求确认，必要歧义仍可提问。
- Answer.expectedRevision 指 Attention.revision，不是 Run.revision。只能回答当前问题；kind 与选项必须匹配，不匹配 400，过期或已由不同请求回答 409 STALE_REVISION。
- answers 202 表示已可靠记录待投递，不表示 Agent 已恢复。Run.pendingAnswer 保存 attentionId、status=pending、submittedAt；前端可刷新恢复“回答已提交”。Agent 确认后变 accepted，清 pendingAttention，公开任务 queued；下一问题或终态清 pendingAnswer。传输重试复用同 commandId。
- 首版每码项目 3、生成/修改合计 10，均可配置。run 创建时 reserve；首个 execution.started 转 used；未启动任务取消/基础设施拒绝时释放。已启动后失败、取消、中断仍计一次；内部修复不另扣次数。单次及总用量预算独立限制。
- 新的修改需求一律新建 Run，不直接注入正在写入的 Worker。运行期间可查看进度或提交排队任务；首版不实现自由对话式实时改写执行目标。
- restore 检查项目 revision 和活动执行，事务内切换至新版本并追加 version.published。恢复后排队任务以新版本为基线；旧历史永不覆写。

## 预览访问

Version.previewUrl 由后端使用受信配置的预览 host 构造，固定采用 `https://preview-host/p/:signedToken/index.html`，不依赖第三方 Cookie。Version.previewExpiresAt 是地址过期时间，前端到期前 60 秒重新取 workspace 或 versions 列表更新地址；不能从跨源 iframe 内的 403 或 load 事件推断令牌有效。

有效期内复用同一签名 URL，只在接近过期时续签；否则每次拉快照更换 iframe src 会造成应用反复重载。续签本身会重新加载预览，首版接受此限制。

签名限制版本和有效期，不授权工作台 API；静态资源未授权返回 403。Vite 必须使用相对 base（`./`），路由首版使用 hash 路由，所有资源在签名路径下解析，不允许 `/assets` 等根绝对资源逃逸签名路径。fixture 中 `.example.test` 仅为样例，不会访问真实预览。

前端不得自行组合预览 URL 或将访问令牌加入日志、错误报告和导出源码。签名到期时重新请求 workspace/version 列表获取新地址。
