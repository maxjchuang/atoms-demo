# 架构决策 v0.1.0

## 目标与当前状态

完成笔试要求的可运行网页：真实 React 多文件生成、可视化预览、对话迭代、持久化和在线访问。扩展能力采用验证修复、版本回滚与低打扰任务协作。

本仓库当前只交付协议、fixture、契约测试和实施计划；以下服务均待实现。共享协议包是唯一可执行数据定义，HTTP 语义由接口文档补充。

## 三条边界

```text
Browser / apps/web
  └── Public HTTP /api/v1 + cookie + incremental polling
       └── apps/api : sole owner of business state and publication
            ├── SQLite / queue / durable events / version storage
            └── Internal HTTP + service authentication
                 └── apps/agent : runtime adapter
                      ├── DSH Router / Worker sessions
                      ├── isolated project execution / verification
                      └── durable source events / immutable candidates
```

| 决策 | 确定方案 | 原因 |
| --- | --- | --- |
| 前端 | 独立 React/Vite/TypeScript 工程 | 与后端不共享路由目录，方便分工、Mock 与独立构建 |
| 后端 | Node/Fastify/TypeScript | 长任务由调度器运行；HTTP 请求不承载生成生命周期 |
| Agent | Node 服务包裹 DSH TypeScript SDK/profile | 吸收 DSH 版本与事件变动；不把底座类型透传给其他两方 |
| 公共进度 | 每秒增量轮询；后台页可降频 | Cloudflare Quick Tunnel 不支持 SSE；预留替换传输的能力 |
| 存储 | 后端 SQLite；Agent 独立执行账本与 DSH home | 两进程不能同时写同一业务数据库；单实例先不引入 Redis |
| 生成应用 | 固定 React/TS/Vite 模板和依赖集合 | 首版不允许任意安装依赖或任意全栈部署 |
| 交付 | 构建后发布不可变静态版本 | 不为每个项目常驻 Vite；新任务失败保留旧预览 |
| 运行认证 | 独立 DeepSeek API Key | 不依赖本机 Codex；密钥仅 Agent 模型进程可用 |
| 部署 | 本机 Docker Compose + cloudflared | 短期评审；临时域名、休眠断网限制必须写入交付说明 |

## 每个方向拥有和不拥有的内容

### 前端

拥有 Dashboard、项目工作区、文件树、只读代码视图、预览、版本和 Attention 卡片、API client、Mock API。不得导入 SQLite、DSH SDK 或内部服务 token。只从后端获取项目和版本；禁止从模型文本抽取 URL 作为预览。

### 后端

拥有体验码、Cookie 会话、项目归属、配额、队列、项目锁、任务状态机、事件投影、发布、回滚、下载和 Fake Agent。它是业务事实唯一权威。不得依赖 DSH 原生事件、直接操纵 DSH session 或把 Agent 报告当作发布结果。

### Agent

拥有 DSH 接入、项目 Router 状态/记忆、任务 Worker 会话、执行目录、预算、工具控制、构建与浏览器验证、源事件账本、候选产物。不得管理访客、扣配额、写业务表、公开发布或直接向访客发送消息。

## Super-agent 的最小实现

- Router 是项目级协调会话，整理需求与计划；Worker 是任务级执行会话。DSH session 标识只存 Agent 内部。
- API 以 Run 为授权单位；Router 不能创建绕过 API 配额的新执行。每个启动请求附 mandate 和 budget。
- 一个任务一个工作目录。同项目只允许一个写入者，其他需求持久排队；跨项目最多一个正在消耗模型/构建资源的执行。
- API 独占业务队列和项目锁的管理权，只要取得项目锁且 Runtime ready 就可派发，不依赖计算槽是否空闲。Runtime 独占实际模型/构建计算槽，accepted 执行按 FIFO 排队；公开 Run 此时仍为 queued。
- 等待输入仍保留项目锁，但释放计算槽。回答确认后进入 Runtime 的 accepted FIFO 队列，由 Runtime 调度器拿到计算槽后继续；不能在 HTTP handler 中直接恢复模型调用。execution.started 仅首发一次，恢复不再次扣额。
- 页面提交立即返回，进度和队列可查；执行日志默认折叠，完成、阻塞、待回答使用结构化卡片。首版“询问进度”直接使用任务状态，不额外唤醒模型。
- 首版不做无限后台主动工作、多 Worker 共同写项目、外部 GitHub/飞书自动触发或自动公网部署。

## 状态与一致性

Run `status`：`queued | running | waiting_input | cancelling | succeeded | failed | cancelled | interrupted`。

Run `phase`：`null | planning | generating | verifying | repairing | publishing`。phase 只描述当前/最后阶段，不表示成功。

主要转换：

```text
queued -> running -> waiting_input -> queued -> running
running -> running (phase changes) -> succeeded | failed
queued | running | waiting_input -> cancelling -> cancelled
running | waiting_input | cancelling -> interrupted (only after execution fencing)
```

- `publishing` 仅由 API 设置；Runtime 不知道公开版本是否发布。
- `waiting_input` 必须有 pendingAttention；其他状态 pendingAttention 为 null。输入需同时验证 Attention ID、问题 revision、选项与任务归属。
- 新排队任务在派发时取得最新 currentVersionId 作为 baseVersionId，不能使用入队时旧版本。
- 从 waiting_input 回到 queued 的任务已有 executionId，并继续保留项目锁；新任务未派发时 executionId 为 null。
- 终态不可回退；显式重试创建新 runId/executionId，首版 attempt 固定为 1。同 executionId 网络重试不算业务重试。
- “取消”先进入 cancelling；确认执行和子进程已停止后才 cancelled。仅 HTTP 超时不能表示停止。
- 取消意图事务与发布事务竞争：先提交者获胜。取消已提交则迟到成功不得发布；发布先完成则取消返回当前 succeeded 状态。
- Runtime 不可达且无法证明已停止时，保留 cancelling/锁并显示不可达；不得标记 interrupted 后释放锁导致双写。只有旧执行已停止或被执行代际隔离后才 interrupted。
- API 重启按 executionId 查询与重放；Agent 重启不假设 shell/browser 自动恢复。不能确定的执行在完成清理/隔离后标记 interrupted，显式重试。

## 版本发布

Runtime succeeded 仅代表有可校验候选。API 下载 manifest 和文件，核对 sha256、大小、入口、路径和 required checks；再检查当前 executionId、取消标记和 baseVersionId。失败则任务 failed，旧版本不变。

临时产物目录先完整落盘，再单次数据库事务写 Version、修改 currentVersionId、将 Run 标记 succeeded、追加公开事件。崩溃留下的未引用目录可清理，不能留下数据库指向未完成文件。

回滚不修改历史，创建新 Version（带 restoredFromVersionId）。同项目有已派发非终态任务时拒绝回滚；未派发队列任务允许存在，之后从恢复后的版本启动。

## 执行和预览隔离

模型凭证只供模型调用进程使用；shell、浏览器和生成应用不继承凭证。Agent 工具必须经受控执行环境访问项目，容器仅挂载该任务目录，不挂载 Docker socket 或宿主机 home。具体沙箱后端在 Agent 接入门禁验证；未满足不能开放公网生成。

生产预览使用与工作台不同主机的独立源，iframe 使用 `sandbox="allow-scripts allow-same-origin"`，不开放顶层导航、弹窗或下载，预览主机不接收工作台 Cookie。工作台 Cookie 必须 host-only。

Quick Tunnel 首版为工作台和预览入口分别创建隧道；API 只返回配置的预览主机生成的 URL。单预览源下不同应用会共享 origin 存储，因此明确首版只提供基础前端存储能力，浏览器数据需项目命名空间；不宣称生成应用间具备严格存储隔离。长期用每项目独立预览子域。

预览源仅提供静态文件，不能转发工作台 API；工作台 API 校验会话、Origin/Fetch Metadata，不允许预览源跨源调用。iframe 存储、模块资源、CORS 的实际行为由前端与后端联合测试。

## 依据与待验证事项

- [DSH SDK Client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)：SDK 调用与通知；确切版本与本项目兼容性待烟测。
- [DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)：插件和事件扩展。
- [Super-agent philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)：授权执行、低打扰、诚实报告；本项目借鉴设计，不移植完整原型。
- [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)：临时域名与无 SSE 限制。

未验证：DSH SDK 问题到 Attention 的精确映射、取消与子进程清理、Router/Worker 配置、Linux 容器沙箱能力、DeepSeek 模型对样例任务的实际成功率。Agent 方向必须先过接入门禁。
