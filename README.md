# atoms-demo

以 DeepSeek Harness（DSH）为 Agent 底座的 React 应用生成工作台。

当前已完成 **本机最小闭环验证**：三条开发线按 v0.1.0 协议实现独立服务；实际 API + Agent Runtime + **真实 DSH/DeepSeek API** 的生成、构建、发布、修改、回滚和重启恢复已通过 G4（Agent 执行，主代理审查产物与截图）。主代理另对真实第二版产物完成只读浏览器行为验收：新增、编辑、搜索匹配/空结果/清空、刷新持久化及无页面错误均通过，不调用模型或修改源码。Fake 集成另覆盖回滚后继续修改。自动 manifest 的 behavior 仍保留原始 not_run，追加的独立样例验收与原始自动结果分别记录；公网隔离 G5 尚未通过。详见 [实施记录](docs/implementation-status.md)。

## 本地启动

需要 **Node.js 24.9.0+** 和 pnpm 10.33.0（当前在 Node.js 26.5.0 验证）。这是固定 DSH 版本的最低要求，Node 22 不支持完整运行。

```bash
pnpm install --frozen-lockfile
# 显式 Fake DSH：不调用模型，实际执行 React 构建和浏览器 smoke
pnpm dev:demo
```

打开 **http://localhost:5173**，输入本地体验码（默认 `atoms-demo-2026`，可用根 `.env` 的 `ATOMS_DEMO_CODE` 修改）。预览在 **http://127.0.0.1:3002**，避免与工作台共享 Cookie。

真实模型模式：复制 `.env.example` 为 `.env`，本地设置 `DEEPSEEK_API_KEY`，然后运行 `pnpm dev`。根启动器只向 Agent 进程传递模型 Key；真实模式缺 Key 会明确退出，不回退 Fake。密钥和本地持久数据均被 Git 忽略。

单独查看前端 Mock：`pnpm --filter @atoms/web dev:mock`。Mock 与 Fake DSH 不同：前者替代公共 API，后者仍经过真实后端、Runtime、构建和发布流程。

需要独立的数据空间而保留现有项目时，可设置 `ATOMS_DATA_ROOT`：

```bash
ATOMS_DATA_ROOT=data/review-real pnpm dev
```

这会使用新的 `api/`、`agent/` 和本地服务凭证目录，并在新数据库中配置同一个本地体验码；不会删除或重置默认 `data/api`、`data/agent`。启动前先停止占用相同端口的旧服务。若另外显式设置 `API_DATA_DIR` 或 `AGENT_DATA_DIR`，它们优先于该数据根目录。

本轮交付时已使用该命令启动真实 DSH 模式的新演示空间，入口为 **http://localhost:5173**，体验码 **`atoms-demo-2026`**；该空间尚未消耗项目/生成额度。服务是当前本机进程，重启后按同一命令恢复。

当前只验证本机开发环境，**尚未交付 Docker 沙箱或公网生成服务**。不要将开发服务直接当成已通过隔离验收的公开部署。

## 阅读顺序

首版统一入口：[协议基线 v0.1.0（Markdown）](docs/protocol-baseline-v0.1.md)。

1. [架构与职责](docs/architecture.md)
2. [公共 HTTP 协议](docs/public-api.md)
3. [Agent 内部协议](docs/agent-protocol.md)
4. [并行开发与合并计划](docs/parallel-plan.md)
5. [验收与 Mock 场景](docs/acceptance.md)
6. [可执行契约](packages/contracts/src/index.ts)

## 校验协议

```bash
pnpm install
pnpm check
pnpm test
pnpm build
# 真实 API + Runtime HTTP，显式 Fake DSH；临时数据库自动清理
pnpm test:integration
# 显式调用真实 DeepSeek API，消耗额度；需要根 .env 配置
pnpm test:integration:real
```

共享契约与常规单测不需要模型 Key。API 测试使用临时 SQLite 和独立 Fake Runtime HTTP；Agent 测试使用 Fake DSH 并真实执行编译与 Chrome smoke。`test:integration:real` 才调用真实模型。浏览器安装/可执行路径与 DSH 兼容性见各应用 README 和实施记录。

## 三条开发线

| 方向 | 主目录 | 交付边界 |
| --- | --- | --- |
| 前端 | `apps/web` | React/Vite 工作台；只调用公共 API；开发使用 Mock API |
| 后端 | `apps/api` | Node/Fastify 服务；身份、任务、配额、版本发布；开发使用 Fake Agent |
| Agent | `apps/agent` | Node/DSH 适配服务；每个任务独立 Planner/Worker、验证修复；使用内部协议测试驱动 |

共享包 `packages/contracts` 的修改须由集成人统一处理，避免三方各自定义类型。默认 `data/`（或 `ATOMS_DATA_ROOT`）保存 API 数据、Agent 账本和开发用本地服务凭证，删除前请备份；自定义目录应位于 Git 忽略路径中。生产隔离、Docker 镜像和隧道交付仍需后续门禁验证。

当前 Agent 是**每个 Run 的 Planner + Worker**：跨任务通过源码快照和 `projectMemory` 传递上下文。项目级持久 Router 会话尚未实现，不能将现阶段描述为完整 Super-agent。真实 Worker 使用受控的结构化源码编辑，通用 shell/文件系统模型工具禁用；详见 [DSH 兼容性记录](apps/agent/COMPATIBILITY.md)。
