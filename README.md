# atoms-demo

以 DeepSeek Harness（DSH）为 Agent 底座的 React 应用生成工作台。

当前已完成 M1 项目协调，并在隔离分支通过 M2 可信交付验收：真实 React 多文件生成、修改、恢复后显式接受 exact 提案再修改、冻结行为计划、同计划浏览器验证、独立安装源码 ZIP、只读咨询和严格重启。另一次受控持久化故障由真实 DeepSeek 修复并复验通过；三次业务交付仍诚实标为 partial。M2 已合入 main 并完成本机安全升级，Docker 隔离与公网分享由 M3 单独验收。详见 [当前 M2 状态](docs/m2-delivery-status.md) 和 [能力路线图](docs/capability-roadmap.md)。

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

本轮已使用该命令建立真实 DSH 模式的演示空间，入口为 **http://localhost:5173**，体验码 **`atoms-demo-2026`**；实际使用会消耗该空间的项目/生成额度，不重置用户已有数据。服务是本机进程，重启后按同一命令恢复。

当前只验证本机开发环境，**尚未交付 Docker 沙箱或公网生成服务**。不要将开发服务直接当成已通过隔离验收的公开部署。

过程反馈与字体层级已更新；M1 项目 Router 区分咨询和修改，ask 模式硬只读，API 持有权威项目记忆和独立协调/生成预算。阶段证据分别保留于 [M1 状态](docs/m1-coordination-status.md)、[M2 状态](docs/m2-delivery-status.md) 和 [过程反馈记录](docs/progress-feedback.md)。

## 阅读顺序

首版统一入口：[协议基线 v0.1.0（Markdown）](docs/protocol-baseline-v0.1.md)。

按 **M1 项目协调 → M2 可信交付 → M3 隔离公网** 推进。协调协议 [v0.2](docs/protocol-v0.2.md) 与独立 [delivery v0.1](docs/protocol-delivery-v0.1.md) 保持原 v1 strict 执行契约兼容；三线各自实现、独立测试，再由主管集成验收。

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

当前 Agent 包含项目级持久 Router 与独立任务 Worker：API 提供权威记忆、版本基线和授权，Worker 使用冻结验收计划执行生成与有界修复。真实 Worker 使用受控结构化源码编辑，通用 shell/文件系统模型工具禁用；这不等于 OS 沙箱或完整通用 Super-agent。详见 [DSH 兼容性记录](apps/agent/COMPATIBILITY.md)。
