# Frontend track

当前实现 M1 项目协调工作台：v0.2 项目对话与 v0.1 构建任务独立；保留 Dashboard、体验码、预览、源码和版本恢复。只依赖公共 HTTP 协议，不导入 API 或 DSH 实现。新工作台需要支持 `/api/v2` 的后端；服务不支持时显示真实错误，不退回“所有消息都创建 Run”。

依赖：`@atoms/contracts` 的公共 DTO、fixture 和 [公共 API](../../docs/public-api.md)。

## 独立开发与验证

```bash
pnpm --filter @atoms/web dev:mock --port 5183
pnpm --filter @atoms/web check
pnpm --filter @atoms/web test
pnpm --filter @atoms/web build
pnpm --filter @atoms/web test:e2e
```

`dev:mock` 使用 MSW 拦截实际 HTTP 请求，状态存在当前浏览器 localStorage，顶部明确标记模拟模式；体验码为 `atoms-demo-2026`。支持计划确认、成功交付、修改、取消、回滚；明确的修改需求包含“失败”可触发模拟失败，包含“修复”可展示修复阶段；普通咨询不会为了故障注入而创建 Run。所有 Mock 代码、检查结果和预览均是合成演示，不能视为真实模型或构建证据。Mock 源码下载为空 ZIP 并明确命名 `mock-empty-source.zip`。

生产构建由 Vite 静态裁剪 Mock 启动路径，无静默 fallback。真实服务不可用时显示错误并保留上一可用版本。

## 接真实后端

```bash
pnpm --filter @atoms/web dev
```

工作台地址 `http://localhost:5173`，默认将 `/api` 代理到 `http://127.0.0.1:3001`。可用环境变量 `VITE_API_PROXY_TARGET` 修改。预览应运行在不同主机，例如 `http://127.0.0.1:3002`，工作台 Cookie 不发往该主机。

`VITE_RUNTIME_MODE=fake` 仅显示“Fake DSH 生成、真实构建验证”标记，不改变请求行为；真实模式不设置该值或设置为 `dsh`。浏览器环境变量中禁止配置服务令牌或模型 Key。

## 浏览器测试

默认 `test:e2e` 在独立端口 `http://localhost:5183` 启动 Mock 工作台，不复用或访问现有 5173 服务，并使用系统 Chrome（macOS）或 Playwright Chromium。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器，`ATOMS_MOCK_PORT` 指定独立测试端口。Mock 模式禁用 Vite 的 API 代理，未声明的 `/api/` 请求 fail-closed，避免测试落到真实后端。

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

- 类型检查、生产构建、42 项单元测试通过（含 v1 执行与 v2 协调消费者）。
- 独立 Mock 浏览器测试 15 项通过（M1 协调 8 项与原闭环/反馈/两尺寸布局 7 项）；已有真实项目用例默认按条件跳过。
- 上一阶段 v0.1 完整后端 + Runtime + Fake DSH 的浏览器主流程 1 项通过（真实 React 构建、计划确认、预览交互/持久化、修改和回滚）。
- 生产产物仅含 index.html、JS/CSS，没有 Mock Service Worker、模拟预览 HTML 或 Mock handler bundle。
- 截图在 `test-results/workspace-generation-refre-88c41-e-modification-and-rollback/` 的 dashboard.png 和 workspace.png。

## 过程反馈

任务卡默认展示当前真实阶段及说明、总耗时/阶段耗时、最后执行活动时间、API 同步状态、必要检查结果和文件变更摘要。超过 45 秒无新执行结果时显示等待说明和停止入口，不提供虚构百分比或剩余时间。

API 轮询成功与 Runtime 有新活动分别统计；空轮询及 API 恢复通知不会推进“最后执行活动”。终态计时使用任务 updatedAt 冻结。验证结果仅统计已返回的类型/构建/页面运行检查，未返回标“待结果”。修复阶段保留规划与生成里程碑。

可展开时间线从公共 `activity.recorded` 和业务事件形成。刷新后分页读取 after=0 的历史，仅恢复展示状态；不会把历史 run.updated 应用到最新 workspace，也不会推进增量工作区游标。事件按项目 seq 去重，时间保留源 occurredAt；界面最多展示最近 200 条活动，阶段起点仍从完整任务历史计算。

新增反馈单元测试覆盖分页竞态、N/N+1 游标隔离、API 消息与 Runtime 活动区分、延迟回放、修复里程碑和必要检查计数。Mock 中 `[long-wait]` 仅用于冻结模拟生成阶段，配合测试时钟验证等待体验；它不影响真实服务或模型行为。

只读历史截图可运行 `node scripts/capture-project.mjs <已完成的projectId>`。该脚本只允许 GET 和体验码登录，拦截其他写请求，不创建或修改任务；输出 `test-results/real-history-timeline.png`。

## 字号与布局对照

详见 [Typography 对照与修正](typography-review.md)。本机 before/after 使用同一浏览器、1440×1000 与 1366×768、100% 缩放实测；线上仅有登录 Dashboard 的目视参考，未伪造线上 CSS 数值。

主标题保留 36/45px，消息和任务正文 14px、元信息和时间线 12px，首页输入 16px、工作区输入 14px，统一系统字体栈并提升颜色对比度。实现为组件级 token，不采用全局 zoom。

```bash
# 真实服务只读审计，需要已有成功项目；不创建 Run、不调用模型。
ATOMS_TYPOGRAPHY_PROJECT=<projectId> pnpm --filter @atoms/web test:typography
# 独立 5183 Mock 布局验证
pnpm --filter @atoms/web exec playwright test e2e/typography.spec.ts
```

原始 JSON 在 `typography/`；本地 before/after 截图在被 gitignore 的 `review-artifacts/typography/`。

## M1 项目消息协调

- 默认“自动识别”，明确修改经后端准入后直接排队，不重复要求确认；“只问项目”不直接创建 Run；“修改应用”也不会把明显咨询强制变成改代码。`直接构建/先做计划` 是独立执行策略。
- 消息级澄清带 question ID/revision 的结构化 selection/text 回答，和构建任务的计划确认、普通问题分别显示。无绑定短答不猜测最新问题。
- 对话、构建活动、项目约定三视图分开。默认对话页保留真实构建状态、阶段、耗时、详情和停止构建入口。消息推理有独立处理状态、停止回答和重试；停止回答不隐式停止已创建的 Run。
- v2 消息按 ID/revision upsert、historySeq 排序，提供更早历史分页及滚动锚点。v1 事件只管理执行/活动，不覆盖带 actor 元数据的新消息；旧助手明确标“历史助手”。
- API 记忆显示目标/偏好/决定 revision、纠正关系和可点击来源；纠正按钮预填“只问项目”消息，由用户发送后再协调，不在浏览器直接改业务记忆。
- `latest_on_dispatch` 明示开始时使用最新成功版本；exact 提案过期时只读刷新，产生新提案后再次接受，不静默重基。
- 宿主 action 标签来自 GET 描述，点击时 POST resolve 获取新预览/源码/任务引用或真实部署说明。签名 URL 不进入消息正文或浏览器持久化；取消引用只定位任务，用户需另行明确停止。
- 当前支持受控 React 前端与浏览器本地数据；界面默认提示类型/构建/加载不等于全部需求行为验收。本阶段不实现任意后端、全行为自动验收或公网部署。

M1 的前端 Mock 使用明确的确定性路由模拟，不是生产 Router，也不作为自然语言准确率或 DSH 持久会话的证据。真实 Router、准入、记忆权威和取消 fence 的服务验证属于其他两条实现线与集成门禁。

```bash
pnpm --filter @atoms/web exec playwright test e2e/coordination.spec.ts
```

用例通过浏览器真实 HTTP 边界覆盖只读咨询、ask 提案、绑定澄清、运行中咨询/后续排队、取消回执、exact 刷新、旧消息分页与记忆来源，复用共享契约校验。浏览器测试中的 `/__mock/v2/seed` 仅为历史迁移 fixture 初始化，不进入生产构建。

详见 [并行计划](../../docs/parallel-plan.md) 与 [验收](../../docs/acceptance.md)。

M1 本轮独立验证：check、42 项单元、生产构建通过；Playwright 15 passed / 1 条件 skip（约 2.6 分钟，独立 5183）。覆盖普通 Run question 回答后恢复同一任务、默认对话页真实构建阶段/耗时，以及消息与任务的独立生命周期。M1 真实 API/Agent 联调和真实 Router 评估仍由集成门禁验证，不能用此前 v0.1 的证据替代。本轮没有调用模型。稳定截图在 `review-artifacts/m1/`，不受 Playwright 清理影响。

实际 Fake 三服务浏览器验收脚本已准备，**需集成负责人先建立独立数据空间并确认 Router/Worker 均为 Fake**，不会自行切换服务模式。脚本要求显式本机 URL，拒绝现有 live 5173，检查没有 MSW 控制页面；会真实创建咨询、构建、计划确认、修改提案和项目约定。

```bash
ATOMS_FAKE_SERVICES=1 ATOMS_WEB_URL=http://localhost:<独立工作台端口> \
  pnpm --filter @atoms/web exec node scripts/check-coordination-services.mjs
```

该脚本不属于默认 Mock E2E；环境未就绪时不运行，不把 MSW 结果当作三服务证据，也不承诺服务器配置未知时无付费调用。运行结果另行记录，截图写 `review-artifacts/m1-services/`。

## M2 可信交付工作台

新增独立 `@atoms/contracts/delivery` 消费，不扩展旧 execution/conversation DTO。生产不加载 Mock，不触发模型调用。

- 默认预览与版本列表显示 API 权威质量、发布状态和逐项缺口。`partial` 自动发布，required 仍保留；没有接收部分交付按钮。报告 final/基础检查通过都不等于已发布。
- 独立报告可按当前/已保留任务或版本选择；失败任务无新 Version 也可显示失败原因与尝试，预览仍由 v1 当前成功版本指针决定。legacy 由 API 明确返回；HTTP/协议错误会保留真实错误。
- 报告展示原始目标、细化约定、每项 required/coverage/result、失败→修复尝试、来源与冻结审计。受控回归明确标注注入；没有来源字段时显示未记录，不猜测模型自然错误。
- diff 以不可变版本为对象，默认父版/首版空基线；安全文本 hunk、增删改、二进制摘要、截断与固定比较分页。失败候选不虚构公开版本 diff。
- 证据先取 typed descriptor，核对 report revision/source/attempt/spec/plan 与文件 sha256/bytes/MIME，再显示转义文本/PNG/JPEG或附件下载；损坏、过期、缺失与错版均显示错误。清理失效对象 URL，不执行 HTML/SVG/trace。
- 源 ZIP 先读取 export view，用明确 subject 的固定路由下载并核对实际 archive SHA-256/bytes；只说明实际报告中的 Node/pnpm/OS/arch 与独立 lockfile，不宣称跨平台均通过。历史源码下载显式未验证。下载不建 Run。
- 恢复版区分当前 subject、直接恢复源与最初实际验证源，明确复用原约定证据且未重跑。

独立 Mock：

```bash
pnpm --filter @atoms/web exec playwright test e2e/delivery.spec.ts
```

Mock 通过真实 fetch/MSW 边界消费共享 fixtures，`/__mock/delivery/seed` 仅用于指定合成情景；不能证明真实模型、浏览器解释器或干净构建已执行。模拟 ZIP 是明确的空 ZIP，只验证前端授权与指纹流程，不当作可运行源码。测试会等待 Mock 启动完成，未声明 API fail-closed，不落到 live 服务。

实际 Fake 三服务浏览器脚本已准备，默认不会运行。须主管先提供独立工作台/API/Agent、确认 Fake Router/Worker 和 M2 execution flavor；拒绝 localhost:5173、拒绝 MSW。必须显式指定已有且已结束执行的项目，只读验证报告/日志/PNG/精确 ZIP/diff/预览/刷新；缺少项目直接拒绝，工具不再提供新建生成分支。

```bash
ATOMS_FAKE_SERVICES=1 ATOMS_WEB_URL=http://localhost:<隔离工作台端口> \
  ATOMS_DELIVERY_PROJECT=<已有M2项目ID> \
  pnpm --filter @atoms/web exec node --import tsx scripts/check-delivery-services.mjs
```

脚本/截图范围会单独记录在 `review-artifacts/m2-services/result.json`。仅 HTTP 健康不算 UI 验收；当前 Mock 证据不抵充实际服务或真实 DSH G4。M3 公网与 OS 隔离仍独立。

M2 G1 独立验证记录（2026-11-08）：共享 contracts check 与 80 项契约测试、Web 50 项单元测试、生产 build 通过。完整浏览器回归 37 passed / 1 条件 skip，随后 M2 最终 25 项定向聚合全部通过（含 required manual / unsupported / 支持但 not_run 三类合法 partial）；最后对象归属文案调整另定向复验 complete/partial/blocked/截图证据，不重复声称全量重跑。所有浏览器写入均在独立 5183 Mock，没有访问 live 5173、没有调用模型。正文 14px / 元信息 12px，两尺寸报告与长行 diff 无页面横向溢出。

稳定证据：`review-artifacts/m2/partial-preview-{1440,1366}-mock.png`、`blocked-preview-{1440,1366}-mock.png` 为默认预览，明确当前预览版本及本次任务归属；另有 `complete-mock.png`、`partial-mock.png`、`repair-mock.png`、`diff-mock.png`。全部显式 Mock，截图不随代码提交；G1 当时尚未运行实际三服务脚本，不能将这批 Mock 记录视为 G2/G3/G4 完成；后续只读实际服务结果另列如下。

M2 实际 Fake HTTP 浏览器只读验收（2026-11-08）：在主管 integration 栈 `localhost:5185` 复用 `project_c1e25b6c308aa0570651`，已提交脚本经 `node --import tsx` 运行退出 0。验证已发布 complete 报告、逐项覆盖/尝试、实际日志、精确源码 ZIP 指纹、首版源码 diff 和刷新。直接 `node` 启动因 contracts 内部 `.js` → TS 解析报错，发生在浏览器/HTTP 启动前；应使用上述既有 tsx loader，不是 UI 或服务失败。

另一次补充只读浏览器检查退出 0：真实预览 React root 已加载且存在可见交互控件；PNG 证据通过工作台 descriptor/指纹/MIME 校验后以 blob 展示，实际解码 1280×876。补充检查拦截除登录外全部 API 写请求，无此类请求；前后 runsUsed=2、runsReserved=0、协调 used=0/reserved=0、conversationRevision=2、当前版本和完整版本列表均不变。两次检查均未提交消息或创建 Run，没有 MSW；Fake 模型与真实构建/DSL/clean 服务不等于真实 DSH 模型证据。

实际截图与结果保存在 integration 的 `apps/web/review-artifacts/m2-services/`：`preview-quality.png`、`report.png`、`diff.png`、`preview-loaded.png`、`png-evidence.png`、`result.json`、`readonly-supplement.json`。本次不验证历史失败 Run 的 UI 可选入口、回滚、第三轮修改、OS 沙箱或公网部署；不把这些只读证据扩称完整 G3/G4。

## 已完成真实任务的只读浏览器审计

同一个脚本支持互斥的 `ATOMS_FAKE_SERVICES=1` 或 `ATOMS_READONLY_REAL_SERVICES=1`。两种模式都必须指定已有项目与隔离 URL，拒绝 live 5173，不启动任何服务/模型。真实模式不要求 Fake banner，但要求最终尝试显式 `sourceProvenance=model_output/dsh`；缺省、Fake、synthetic 或仅受控注入来源都不能冒认真实模型。API 已发布 complete 或 partial 均可检查，partial 具体 gap 保持可见。

```bash
# 仅在主管已结束模型任务、启动隔离真实服务之后手工调用
ATOMS_READONLY_REAL_SERVICES=1 ATOMS_WEB_URL=http://localhost:<隔离端口> \
  ATOMS_DELIVERY_PROJECT=<已有真实M2项目ID> ATOMS_DEMO_CODE=<体验码> \
  pnpm --filter @atoms/web exec node --import tsx scripts/check-delivery-services.mjs
```

浏览器 context route 在发出请求前只允许 GET/HEAD 与同工作台 origin 的精确 `POST /api/v1/sessions` 登录（不接受额外 query/尾斜杠）；其他写请求先 abort，任何写尝试都使审计失败。禁用 Service Worker。前后比较构建/问答额度、消息 ID 与 revision、任务与版本指针/列表，必须不变。结果记录 `mode=fake|readonly_real`、实际来源、具体 gap、0 新消息/Run 和写拦截记录；Fake 输出仍在 `review-artifacts/m2-services/`，真实只读输出单独在 `review-artifacts/m2-readonly-real-services/`。exit 0 表示完整只读审计通过，exit 1 表示未通过；不会静默降为 Mock/Fake。

工具更新验证：54 项 Web 单元测试/check 通过（含双模式写禁止、参数互斥/live 拒绝、DSH 来源负例）；现有 5185 Fake 项目只读完整回归退出 0、计数不变。双模式浏览器 guard 对不存在任务的取消探针均在服务端前 abort（服务端写入 0），没有真正取消任务或触发模型。真实 DSH 的只读成功验收仍须主管后续提供已有真实项目，不用这些 Fake/合成测试冒充。
