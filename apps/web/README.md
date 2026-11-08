# Frontend track

已实现首版工作台：Dashboard、体验码入口、项目与对话、计划确认、执行进度、取消、预览、只读源码、历史版本和恢复。只依赖公共 HTTP 协议，不导入 API 或 DSH 实现。

依赖：`@atoms/contracts` 的公共 DTO、fixture 和 [公共 API](../../docs/public-api.md)。

## 独立开发与验证

```bash
pnpm --filter @atoms/web dev:mock
pnpm --filter @atoms/web check
pnpm --filter @atoms/web test
pnpm --filter @atoms/web build
pnpm --filter @atoms/web test:e2e
```

`dev:mock` 使用 MSW 拦截实际 HTTP 请求，状态存在当前浏览器 localStorage，顶部明确标记模拟模式；体验码为 `atoms-demo-2026`。支持计划确认、成功交付、修改、取消、回滚；需求包含“失败”可触发失败，包含“修复”可展示修复阶段。所有 Mock 代码、检查结果和预览均是合成演示，不能视为真实模型或构建证据。Mock 源码下载为空 ZIP 并明确命名 `mock-empty-source.zip`。

生产构建由 Vite 静态裁剪 Mock 启动路径，无静默 fallback。真实服务不可用时显示错误并保留上一可用版本。

## 接真实后端

```bash
pnpm --filter @atoms/web dev
```

工作台地址 `http://localhost:5173`，默认将 `/api` 代理到 `http://127.0.0.1:3001`。可用环境变量 `VITE_API_PROXY_TARGET` 修改。预览应运行在不同主机，例如 `http://127.0.0.1:3002`，工作台 Cookie 不发往该主机。

`VITE_RUNTIME_MODE=fake` 仅显示“Fake DSH 生成、真实构建验证”标记，不改变请求行为；真实模式不设置该值或设置为 `dsh`。浏览器环境变量中禁止配置服务令牌或模型 Key。

## 浏览器测试

默认 `test:e2e` 在独立端口 `http://localhost:5181` 启动 Mock 工作台，不复用或访问现有 5173 服务，并使用系统 Chrome（macOS）或 Playwright Chromium。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器，`ATOMS_MOCK_PORT` 指定独立测试端口。

```bash
# 三服务已启动后，显式运行真实服务主流程。不会自动启动或回退 Mock。
ATOMS_E2E_REAL=1 ATOMS_DEMO_CODE=atoms-demo-2026 pnpm --filter @atoms/web test:e2e
```

针对本机完整服务、Fake DSH 但真实构建验证（不消费模型）的验收：

```bash
ATOMS_E2E_REAL=1 ATOMS_E2E_PLAN=1 ATOMS_E2E_FAKE_RUNTIME=1 pnpm --filter @atoms/web exec playwright test e2e/workspace.spec.ts --grep generation
```

该用例实际新建项目、确认计划、刷新恢复、在预览中新增并编辑便签、再次刷新检查内容持久化、读取代码、提交修改、恢复版本。它会消耗该体验码的项目/任务配额，重复运行请准备独立测试体验码。

也可指定 `ATOMS_E2E_EXISTING_PROJECT=<projectId>` 并运行 `e2e/existing.spec.ts`，仅对已有应用验证预览交互、刷新与源码读取，不创建生成任务。

真实主流程包含生成、刷新恢复、源码读取、修改和回滚。计划/取消/失败的故障注入测试只在 Mock 模式运行。真实交互与沙箱验证仍需 Agent/后端集成测试支持。截图保存在 `apps/web/test-results/`，被 git 忽略。

单元测试覆盖共享 11 个场景、消息 upsert、事件去重、游标缺口、跨项目事件隔离、终态判断、请求幂等键和协议错误。它们不需要模型 Key。

## 当前验证记录

- 类型检查、生产构建、30 项单元测试通过。
- 独立 Mock 浏览器测试 5 项通过（含长等待、修复与历史恢复）；已有真实项目用例默认按条件跳过。
- 完整后端 + Runtime + Fake DSH 的浏览器主流程 1 项通过（真实 React 构建、计划确认、预览交互/持久化、修改和回滚）。
- 生产产物仅含 index.html、JS/CSS，没有 Mock Service Worker、模拟预览 HTML 或 Mock handler bundle。
- 截图在 `test-results/workspace-generation-refre-88c41-e-modification-and-rollback/` 的 dashboard.png 和 workspace.png。

## 过程反馈

任务卡默认展示当前真实阶段及说明、总耗时/阶段耗时、最后执行活动时间、API 同步状态、必要检查结果和文件变更摘要。超过 45 秒无新执行结果时显示等待说明和停止入口，不提供虚构百分比或剩余时间。

API 轮询成功与 Runtime 有新活动分别统计；空轮询及 API 恢复通知不会推进“最后执行活动”。终态计时使用任务 updatedAt 冻结。验证结果仅统计已返回的类型/构建/页面运行检查，未返回标“待结果”。修复阶段保留规划与生成里程碑。

可展开时间线从公共 `activity.recorded` 和业务事件形成。刷新后分页读取 after=0 的历史，仅恢复展示状态；不会把历史 run.updated 应用到最新 workspace，也不会推进增量工作区游标。事件按项目 seq 去重，时间保留源 occurredAt；界面最多展示最近 200 条活动，阶段起点仍从完整任务历史计算。

新增反馈单元测试覆盖分页竞态、N/N+1 游标隔离、API 消息与 Runtime 活动区分、延迟回放、修复里程碑和必要检查计数。Mock 中 `[long-wait]` 仅用于冻结模拟生成阶段，配合测试时钟验证等待体验；它不影响真实服务或模型行为。

只读历史截图可运行 `node scripts/capture-project.mjs <已完成的projectId>`。该脚本只允许 GET 和体验码登录，拦截其他写请求，不创建或修改任务；输出 `test-results/real-history-timeline.png`。

详见 [并行计划](../../docs/parallel-plan.md) 与 [验收](../../docs/acceptance.md)。
