# M2 并行开发与验收计划

日期：2026-11-08。本文随 M2 G0 文档、Schema、fixtures/tests 同提交冻结；仅定义实施分工与门禁，不表示 M2 服务已实现。职责延续 [AGENTS.md](../AGENTS.md)、[架构](architecture.md)及[原并行计划](parallel-plan.md)；M2 接口、路径、版本/header 和字段以 [delivery 协议](protocol-delivery-v0.1.md)及 `@atoms/contracts/delivery` 为准，不复制 DTO。

## 1. 基线、工作区与唯一负责人

三线必须从**同一 G0 commit**启动。主管提交共享基线后统一同步 worktree；实现者不自行提交、合并或修改其他线来绕过接口失败。M1 live 保持隔离：基线 `b31d8ff`，本轮记录的 live PID 为 `54279`；PID 只作现场记录，不作为自动化操作目标。M2 测试不得使用 live 5173 或 `data/review-real`，不得停服、迁移或写入其数据。

| 范围 | 分支 / worktree | 唯一负责人及产出 |
| --- | --- | --- |
| `apps/agent/**` | `feat/agent-delivery` / `atoms-demo-v02-agent` | Agent：Prepare、DSH/Fake、DSL 解释器、验证/修复、不可变报告和可信导出 |
| `apps/api/**` | `feat/api-delivery` / `atoms-demo-v02-api` | API：准入/Seed/冻结、预算/队列/outbox、权限、发布、diff、报告/证据/导出读取、Fake Runtime |
| `apps/web/**` | `feat/web-delivery` / `atoms-demo-v02-web` | Web：API client、Mock、质量/缺口/来源、报告/证据、diff/下载与浏览器验证 |
| `packages/contracts/**`、delivery 协议与 fixtures/tests | G0 共享提交 | Agent 为本轮唯一共享作者；API/Web 只读审查，主管复验并冻结。冻结后变更仍先协调共享提交，再更新消费者 |
| Git、根 lockfile/依赖及集成 | `feat/trusted-delivery` / `atoms-demo-v02-integration` | 主管负责分支、提交/合并、依赖、门禁复跑、真实调用与升级决策 |
| `tests/integration` delivery runner、根命令与状态 MD | API worktree 的主管明确授权文件 | API 受托维护，主管 review；不据此取得其他共享文件或 App 的写权限 |

worktree 均位于 `/Users/bytedance/Projects/github/`。三线不得导入其他 `apps` 的实现；替身通过真实 HTTP 边界工作。共享状态枚举、事件和 DTO 只从 contracts 导入。新增依赖报主管，根 lockfile 由主管统一处理。

## 2. 并行任务与独立门禁 G1

| 方向 | 实施任务 | 独立验证与交付证据 |
| --- | --- | --- |
| Agent | 持久 PrepareID/request/hash、只读细化 Spec/DSL；执行前验证冻结 wrapper；同一计划的行为检查与有限修复；实际 ZIP 的干净安装/构建/同计划复验；失败报告独立可取回 | Fake Model + 独立输入服务，不依赖 API/Web/Key；真实浏览器以同一通用 DSL 验证便签六类行为与计算器两场景；保留失败→修复、invalid 不能洗失败、取消/重启、实际文件 hashes 与导出证据 |
| API | 权威目标来源/Seed；项目锁先选 base、Prepare→一次冻结→immutable execute；同 Run 总预算和首次 billable 只结算一次；持久 outbox/恢复；报告/文件独立核验及原子发布；安全 diff/分页/授权下载；恢复来源映射 | 独立 Fake Delivery Runtime HTTP + 临时 SQLite/文件目录；验证 remaining、输入锁、单 Prepare、重试同体、早失败取回、源事件去重、取消/发布 fence、partial/blocked、跨项目权限、旧数据/DTO 兼容及重启幂等；不能让 Fake 直接改业务 DB |
| Web | 使用独立 delivery 读取协议；安全 diff、逐 criterion 结果/证据和 provenance；明确 pending/complete/partial/blocked/legacy，运行成功不等同完整质量；保留旧工作区、预览和消息流程 | delivery Mock HTTP + 浏览器；覆盖完整/部分/失败/旧版/恢复来源、旧请求覆盖保护、分页/截断、断线/刷新、恶意文本安全渲染及下载入口；生产构建不静默回退 Mock |

每线提供 README、精确可运行脚本、测试结果与限制；合并前运行 contracts 检查及本线 check/tests/build。普通测试零模型 Key。Key 不进入 fixture、源码 ZIP、报告、workspace 或浏览器 bundle；真实模型仅 Agent 进程持有。

固定政策不另开交互：基础 typecheck/build/smoke、导出和完整性硬门禁通过且无未解除 required 自动失败时，合法 **partial 自动发布**，Web 显著列具体缺口。全部声明 criterion 有效通过才 complete。required 自动失败、hash/导出失败、取消/中断/无效证据为 blocked，不能 override；不新增默认“接受部分交付”按钮、host Attention 或等待生命周期。

## 3. 主管合并与跨线门禁

| 门禁 | 组合与顺序 | 必须证明 / 不能替代的内容 |
| --- | --- | --- |
| G0 | 三方审查 → 主管复跑 contracts → 同 commit 同步 | 独立 delivery 模块、协议、正反 fixtures/tests 一致，旧 execution/conversation strict 契约不变；合成 hash 不是实际执行证明 |
| G1 | 三线并行独立验收 | 上述 Fake/Mock 门禁各自通过，不依赖别线实现；接口不符先协调，不能跨线改实现让测试过 |
| G2 | Web + API + Fake Delivery Runtime | 真实 Cookie/权限、报告/证据/diff/下载、质量缺口、失败保留预览、恢复来源与刷新；Mock 成功不替代实际 HTTP |
| G3 | API + 实际 Agent Runtime + Fake Model；再接 Web 真实浏览器 | 同冻结计划、实际 React 多文件/编译/行为检查、实际 archive 干净复验及 hashes；单 Prepare/预算/重启对账/取消发布 fence。完整生成→修改→恢复→恢复后继续修改，核对新 base、父版本、diff、预览和新报告 |
| G4 | 主管统一有界真实 DeepSeek 验证 | 自然需求生成、修改、恢复后再修改的完整真实代码链；核对新授权/冻结、行为证据、父链及导出，用量含缓存读写；真实 Router + Fake Worker 不能称真实代码 G4 |

主管可先合并已通过 G1 的 API/Agent，在 Web 未完成前跑不含 Web 的 G3；输出必须明确实际组合。Web 合并后补真实 HTTP 浏览器，不能用服务健康检查冒充 UI 验收。根入口、runner 使用临时端口与独立临时数据，失败保留受控证据路径，不输出凭证；启动与重复运行不消耗 live 额度。

G4 不由默认测试触发，真实调用须主管显式启动并设定轮次/预算；尽量先用 G3 消除确定性失败。受控故障用于失败→修复验收时标 `controlled_regression`，保存补丁/hash，不能写成模型自然犯错。历史两次真实生成/修改+恢复证据保留，但不能代替**真实恢复后继续编辑**；Fake 的该流程也不能抵充。

## 4. 冻结、交付与后续范围

协议发现缺口时，负责人报告具体请求/响应和失败用例；主管协调唯一共享作者更新协议、Schema、fixture/test，先提交新共同基线，再同步三线。禁止改旧 strict DTO、各自复制状态或在 prompt 偷塞授权/冻结数据。发布版本须 API 独立核对实际字节、证据链、固定政策和事务 fence；Agent 完成、报告 final 或 DSL Schema 通过都不单独意味着已发布。

主管按各门禁实际来源记录已验证/未验证/失败与保留证据，不提前标全量通过；旧版本不补造验证，恢复不伪造新 Run 或重跑报告。M2 集成通过后再独立安排 live 排空、备份、升级/回归与推送，测试通过不自动授权覆盖 live 数据。

M3 仍为后续：每任务 OS/网络/资源隔离、Docker、工作台与预览双隧道、外部分享/认证/下载验收。M2 受控 DSL、干净目录和本机可复现导出不等于 OS 沙箱，也不等于 G5 公网交付；不将这些未完成项混入 M2 完成声明。
