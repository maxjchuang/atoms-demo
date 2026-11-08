# 并行开发与合并计划

## 当前交付与启动条件

当前交付的是 v0.1.0 协议基线，不包含产品实现。G0 类型检查、27 项契约测试及前后端边界交叉审查通过；真实行为仍需后续门禁验证。`pnpm check` 和 `pnpm test` 可直接运行；下文的各应用命令为各方向必须交付的脚本，当前尚不存在。

集成人先将本次共享契约、fixture 和文档保存为统一基线，之后创建三个独立分支/worktree：`feat/agent-runtime`、`feat/backend`、`feat/frontend`。三方从同一协议版本启动，不得各自发明字段。共享文件由集成人修改并先落基线，消费者再同步。

## 目录与文件所有权

| 路径 | 唯一负责人 | 内容 |
| --- | --- | --- |
| `apps/agent/**` | Agent 方向 | Runtime、DSH adapter、执行账本、工具、验证、候选产物、Fake DSH |
| `apps/api/**` | 后端方向 | 公共 HTTP、内部输入产物读取、SQLite、配额、队列、发布、Fake Runtime |
| `apps/web/**` | 前端方向 | 工作台、公共 API client、Mock API、浏览器测试 |
| `packages/contracts/**` | 集成人 | Schema、DTO、fixture；三方提变更建议，禁止分别复制类型 |
| `docs/**`、根配置、Compose、入口代理、`tests/integration/**` | 集成人 | 接口文档、根 lockfile、部署、跨服务测试 |

三方只修改各自 package.json；共享 pnpm-lock.yaml 由集成人在同步依赖时统一重建。依赖需精确版本或锁文件固定，不提交 API Key。禁止通过导入其他 apps 源码绕过接口。

## Track A：Agent 基座

### A0 接入门禁（先做，60–90 分钟预算）

1. 在隔离的 fixture 项目中固定 DSH/SDK 同一可用版本，验证一次真实模型调用。
2. 实际修改 React 多文件，类型检查与构建通过。
3. 将一次明确构建错误通过验证工具反馈，完成修复。
4. 验证通知、结构化 Attention、回答、会话恢复与取消。取消必须停止子任务。
5. 记录 Linux 容器沙箱、Router/Worker 和凭证隔离是否成立，输出 `apps/agent/COMPATIBILITY.md`。

这一步失败时缩减 DSH 接入方式或协调更换底座；公共 API 与前端可继续用 Fake，不被阻塞。不能为了宣称 DSH 就把假执行当成功。

### A1 实施

- 实现内部 HTTP，启动/命令幂等、源事件持久化与回放、执行状态查询。
- 实现项目 Router + 任务 Worker 的会话映射；只接受后端已授权任务。
- 实现受控模板、输入快照拉取、隔离执行、预算、计划和提问。
- 实现验证/有限修复与不可变 artifact；不得负责公开发布。
- 实现实际计算槽的单并发、accepted FIFO 和等待用户后的恢复排队。
- 提供 Fake DSH，通过同一 adapter 接口产生可控事件；协议测试不消耗模型额度。

### A2 交付与独立验证

交付脚本：`dev`、`build`、`test`、`test:contract`、`smoke:real`。提供 `.env.example`、内部调用示例、固定版本与已知限制。

`test:contract` 直接用 HTTP 测试客户端 + Fake DSH + Fake 输入产物服务启动 Runtime，不依赖后端或前端。`smoke:real` 显式配置模型 Key 才运行，默认测试不调用网络模型。

## Track B：后端

### B1 实施

- 实现会话、体验码、项目归属；所有写入幂等。
- 实现项目业务队列/锁、Run 状态机、配额预占/结算和派发 outbox。
- 实现 Agent client，超时查询、源事件去重、公开事件投影、恢复对账。
- 实现原子 workspace 快照、事件分页、Attention 输入投递和取消。
- 实现产物校验、不可变 Version 发布、恢复新版本与安全源码下载。
- 实现内部输入产物只读接口；模型密钥不进入业务数据库或 workspace。
- 提供 Fake Runtime，以独立内部 HTTP 服务模拟 Agent 协议，不能绕过 Agent client 直接修改业务状态。

### B2 交付与独立验证

交付脚本：`dev`、`build`、`test`、`test:contract`、`seed:demo`。演示 seed 使用固定体验码仅限开发，通过环境显式开启；生产不默认启用。

`test:contract` 使用临时 SQLite、临时版本目录和 Fake Runtime，验证公共 HTTP 与反向输入产物协议，不依赖前端、DSH 或模型 Key。数据库 migrations 和测试数据均归后端目录。

## Track C：前端

### C1 实施

- 实现 Dashboard、项目列表、工作区、任务阶段、排队状态、Attention、版本与预览。
- API client 只导入公共契约；Mock 模式由开发配置显式开启。
- Mock API 用 MSW 或等效 HTTP mock，使用共享 fixture，不能通过组件 props 假装已调用接口。
- 实现 snapshot→增量轮询、分页去重、网络重连、刷新恢复、过期问题刷新。
- 代码页首版只读成功版本，执行中仅显示文件变更列表；不承诺未定义的实时文件读取。
- 渲染结果区分构建、运行检查与行为未验证，不把全部状态统一显示“测试通过”。

### C2 交付与独立验证

交付脚本：`dev`、`dev:mock`、`build`、`test`、`test:e2e`。Mock 模式下无需 API 服务、DSH、Key 或数据库。

浏览器测试通过 HTTP mock 验证成功、计划确认、修复、失败保留预览、取消、刷新、配额耗尽、会话过期与回滚。生产构建必须默认禁用 Mock，配置缺失时不得静默回退到假数据。

## 共享协议变更流程

1. 提供变更原因、受影响端点/Schema、向后兼容性说明。
2. 集成人修改 contracts、文档和 fixture，运行契约检查，更新协议版本。
3. 三方同步同一基线，再修改实现。阶段内的破坏性改动也必须更新版本；不得同为 0.1.0 却出现两种行为。
4. 原生 DSH 变化由 Agent adapter 吸收，不直接要求公共接口跟随变化。

## 合并与联调门禁

| 门禁 | 组合 | 必须证明 |
| --- | --- | --- |
| G0 协议基线 | contracts + fixture | 类型检查、Schema 与样例一致；关键语义无冲突 |
| G1 各方向独立 | Web+Mock / API+Fake Runtime / Runtime+Fake DSH | 各方向 tests、build、contract test 通过，README 可复现 |
| G2 业务接口 | Web + API + Fake Runtime | 真实 Cookie、权限、配额、轮询、Attention、版本与取消流程 |
| G3 执行接口 | API + Runtime + Fake DSH | 幂等、源事件、输入快照、取消、产物哈希、重启对账 |
| G4 真实模型 | Web + API + Runtime + DeepSeek | 一次 React 生成、修改、验证、回滚后修改；明确真实调用用量 |
| G5 外网交付 | Docker + 两个 Quick Tunnel | Cookie/Origin、预览隔离、静态资源、刷新、体验码、下载；无公网内部端口 |

合并顺序：协议基线 → 后端（含 Fake）→ 前端 → Agent → 部署与跨服务测试。各分支独立验收可以并行完成；合并顺序不要求开发顺序相同。

G4/G5 的失败不能通过 Mock 成功来替代。README 标注真实完成程度、未验收项和临时域名限制。

## 6–8 小时建议排期

三条实现线并行，以下为墙钟预算估计，不是完成承诺：

- 0–1.5h：共享基线同步；Agent 做接入门禁；后端/前端分别启动 Fake/Mock 主流程。
- 1.5–4h：三线实现各自最小闭环，契约测试持续运行。
- 4–5h：各线独立验收，集成 Web+API+Fake 与 API+Agent+Fake。
- 5–6.5h：真实模型联调，优先解决生成、预览与修改问题。
- 6.5–8h：部署、浏览器验证、回滚/下载、交付说明。

缩减顺序：先去掉主动建议、复杂行为自动验收和代码 diff 精修，再去掉独立 Router 对话的额外能力。不得牺牲真实生成、持久化、可交互预览、权限与隔离、错误诚实反馈。若时间不足，明确保留“计划协调 + 单 Worker”，不要宣称完整 Super-agent。
