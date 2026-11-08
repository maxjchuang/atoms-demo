# atoms-demo

以 DeepSeek Harness（DSH）为 Agent 底座的 React 应用生成工作台。

当前阶段为 **协议与实施计划基线 v0.1.0**，G0 契约检查与前后端边界审查已通过。尚未实现工作台、后端服务或真实 Agent。

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
```

这些命令只校验共享协议和样例，不需要模型密钥、Docker、SQLite 或 DSH。

## 三条开发线

| 方向 | 主目录 | 交付边界 |
| --- | --- | --- |
| 前端 | `apps/web` | React/Vite 工作台；只调用公共 API；开发使用 Mock API |
| 后端 | `apps/api` | Node/Fastify 服务；身份、任务、配额、版本发布；开发使用 Fake Agent |
| Agent | `apps/agent` | Node/DSH 适配服务；项目负责人、Worker、验证修复；使用内部协议测试驱动 |

共享包 `packages/contracts` 的修改须由集成人统一处理，避免三方各自定义类型。框架版本、DSH 版本和运行镜像在各方向脚手架阶段固定到 lockfile；本阶段未安装 DSH，也未验证其端到端行为。
