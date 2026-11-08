# M2 API 可信交付设计（候选，未实施）

日期：2026-11-08。本文是 API 方向的只读设计草案，不修改服务或共享 Schema，不新增模型调用。M1 验收优先；M2 必须先由主代理组织三方契约冻结，再开始实现。

参考 Agent 方向候选 `docs/m2-agent-delivery-design.md`：受控浏览器 DSL、实现前冻结的验收计划、每次验证绑定源码/计划、可信模板 lockfile 和干净导出复验。本 API 草案补齐授权、差异/导出读取、证据校验、发布与部分交付政策。

## 1. 目标与职责

可信交付的依据是宿主真实执行与不可变证据，不是模型的完成声明，也不是仅有文件 hash 就能证明行为正确。

| 方向 | 拥有 | 不拥有 |
| --- | --- | --- |
| API | 用户目标/验收约定及来源、冻结 binding、权限、版本 diff、报告/导出授权、自动发布政策、质量标记与版本指针 |
| Agent | 计划提议、DSL 校验/解释器、源码快照、实际编译/行为检查、有限修复、可信模板导出和干净安装复验 |
| Web | 文本安全 diff、声明覆盖/结果/证据展示、完整/部分/阻塞区别、具体缺口显著提示与下载 |
| 模型 | 实现代码、提议有界 DSL、解释失败；无权修改 required、测试计划、宿主政策、预算或发布 |

M1 项目 Router 与授权建 Run 的边界保留。M2 不绕过消息准入、不让模型直接发布，也不把本机检查当作 M3 OS 沙箱或公网验收。

## 2. 版本 diff：读取授权与安全边界

候选端点：`GET /api/v2/projects/:projectId/version-diff?baseVersionId=&headVersionId=&cursor=&limit=`。省略 base 时使用 head 的 parent；无 parent 则与空快照比较。head/base 都必须是调用者有权访问的**同项目**不可变版本，跨项目或无权统一 404。

API 只比较受控 `source/` 清单，不接收任意文件系统路径、Git 引用、URL 或执行命令。返回 added/modified/deleted 路径、双方 bytes/sha、text/binary 分类；文本附有界 hunks，二进制仅摘要。信任清单同时核对实际字节 hash，不能把缓存中旧代码当本次版本。

安全要求：

- 路径必须规范化、拒绝绝对路径、穿越、symlink、重复及大小写/Unicode 规范化碰撞，禁止静默重命名后算 hash。
- Web 将源码/hunk 当文本转义，不使用 dangerouslySetInnerHTML。HTML/SVG/JS 不在工作台执行；二进制不以内联可执行内容展示。
- API 对文件数、总字节、单文件、hunk/行数和算法耗时有上限；建议首轮 100 个 diff 文件、1 MiB 文本、5,000 行输出。精确值待 M2 G0 冻结。
- 超限返回显式 `truncated`/原因和可下载的授权源码入口，不能把缺少内容当“无差异”。复杂差异不得阻塞 API 主事件循环无限计算。
- 分页游标绑定固定 base/head/hash，不能拿另一次比较的 cursor 跳入当前结果。immutable 输入允许确定性缓存，缓存键不能省略访问边界。

diff 不创建 Run、不调用模型、不修改版本。版本恢复后再修改的父子链也必须能正确比较。

## 3. 验收约定、计划与首次派发

API 持有已确认 `AcceptanceSpec`：来源消息/提案、criterion ID、description、required、revision 和确认依据。每项有 coverage（automated/manual/unsupported/not_run），但 coverage 不替代结果，也不能通过改 required 掩盖缺口。

Agent 的只读计划服务或受信 profile 提议 BrowserTestPlan；API 核对 criterion 引用、覆盖完整性、DSL 版本和宿主资源上限。模型提出的语法合法计划不自动等于语义覆盖充分。

**Worker 写入实现前**冻结：`acceptanceSpecHash + testPlanHash + deliveryPolicyRevision + toolchain/templateId`。同 Run 修复复验使用同一计划，用户改变需求则建立新 revision/授权任务，不能重写失败计划。

v1 StartExecutionRequest 是 strict，不能把新 binding 偷塞进 prompt/projectMemory 或追加字段。建议新增独立 M2 delivery 承载模块和内部 wrapper：

```text
DeliveryExecutionRequest
  execution: StartExecutionRequestV1
  binding: { acceptanceSpecRef, testPlanRef, policyRevision, templateId, exportPolicyRef }
```

具体路径/版本号由 M2 G0 冻结，例如内部 `/internal/v2/delivery-executions/:executionId`；旧 `/internal/v1/executions` 继续旧行为。M1 新增任务可在真正派发前绑定 M2 约定，不能调用模型/写源码之后才补造“实现前计划”。

## 4. 证据绑定与无循环 hash

建议对象：AcceptanceSpec、CriterionCoverage、BrowserTestPlan、VerificationAttempt、EvidenceBinding、DeliveryAssessment、SourceExportManifest、CleanBuildReport。不增加部分接收回执对象或默认人工等待流程。

每次 attempt 至少绑定：run/execution/attempt、repairRound、sourceSnapshotHash、specHash、planHash、lockfileHash、toolchainId、distHash、startedAt/finishedAt、逐 case/criterion 结果、证据 IDs。

推荐 hash 依赖有向无环：

1. sourceSnapshotHash 对排序的 `{path,bytes,sha256}` 源码和受信配置/lockfile 清单计算，不含 node_modules/dist/evidence/DSH 数据。
2. specHash、planHash 在实现前冻结；lockfile 来自受信模板。
3. distHash 对本次构建输出清单计算；验证前后 source hash 必须一致。
4. attempt/报告引用源码、计划、lock、工具链和独立证据文件，不引用一个包含自身的最终 manifest hash。
5. 报告文件自身有 sha，放入候选 manifest 的 files/evidence；最终 manifest hash 再由 API 核验。
6. API 发布记录绑定 versionId、manifestHash、assessmentHash、固定发布 policy revision 与质量分类，不回写已经计算 hash 的原始报告。

API 独立核验：文件实际字节、归属、路径/大小、冻结计划引用、criterion 完整性、尝试链、最终 source/dist/lock 是否与候选一致。截图/日志只能绑定到对应 attempt，不能借另一版的通过结果发布。

可信边界必须说清：Agent 的宿主验证器与内部认证服务是可信计算基；hash 证明一致性，不单独证明浏览器真的运行或行为语义正确。M2 用受控解释器、真实执行日志和独立集成验收建立证据，不能宣称密码学意义上的远程执行证明。

## 5. 报告与发布政策

### 5.1 质量分类

| 分类 | API 判断 | 发布 |
| --- | --- | --- |
| complete | 基础硬门禁、冻结 required 行为、声明覆盖及干净导出复验全部满足；可选项状态/豁免有真实来源 | 依现有 API publication fence 自动发布 |
| partial | 类型/构建/smoke 和导出硬门禁全部通过，但存在明确可见的 manual/unsupported/not_run 项；无 required 自动行为失败 | API 按固定政策自动发布，质量仍为 partial，Web 显著显示每项具体缺口；不新增默认人工接收等待 |
| blocked | 基础检查失败、required 自动行为失败、源码变化、证据/计划绑定错误、导出复验失败或准入失败 | 不替换当前版本，保留失败证据 |
| legacy/unverified | 旧版本没有 M2 声明、lock/导出报告等 | 保留原访问，不补造 complete 历史 |

required 未支持/未运行项仍保留 required=true；自动发布 partial 不是把它改为 optional/passed。required 自动失败、构建/加载失败、hash 不一致和导出失败始终 blocked，不存在绕过按钮。同一 criterion 已知失败且尚未按冻结计划成功复验时，不得把末次结果改为 not_run/unsupported 来洗掉失败。

complete 的 UI 文案应是“本次约定的必需验收已通过”，不是“所有可能行为均正确”。manual/unsupported/not_run 缺口不由模型自行抹掉；如果后续增加用户明确人工验收，其记录必须绑定人、revision、source hash 和结论，不把模型意见伪装成人工签字，但这不是 M2 默认流程。

### 5.2 自动发布与既有 Run 生命周期

M2 固定政策沿用 auto 低打扰体验：Agent 生成可校验候选后，API 校验基础硬门禁、导出、required 自动行为、证据绑定、当前 executionId/取消标记/base fence；满足 complete 或允许的 partial 条件后自动发布，最多创建一个版本。

不新增 host-owned Attention、部分接收按钮或待交付等待状态，不把已完成的 Runtime 再送入 answers。原 Run-level Agent question/answers 与 M1 消息级澄清保持原义。

API 校验/落盘完成前 Run 仍处于 running/publishing，发布事务成功后才 succeeded。若 blocked 则 failed 并保留原成功预览及失败报告，不把“候选检查完成”当作已交付。没有新的业务生命周期需要前端猜测或用户确认。

取消与发布继续由既有事务 fence 决定先后；取消先提交不发布，发布先提交返回真实终态。报告和产物 staging 完整后原子创建 Version、切指针、记录 quality/policy revision 和 Run 终态。重启按原 executionId/报告 hash 对账，不重复生成或发布。

旧 Run.succeeded 只表示 API 已发布版本，不能被解释为所有新行为验收完成。partial 在旧 Version.summary 明示“部分交付”及主要缺口，新 Web 通过独立 delivery 视图醒目标记质量与逐项缺口，不往旧 strict Version 加字段。

未来如果产品需要用户明确人工验收或主动选择发布政策，应作为独立范围冻结，不是本次 M2 自动 partial 发布的前置条件。

## 6. 可复现源码导出

源目录必须包含受信 package.json、独立生成应用的 pnpm-lock.yaml、固定 packageManager、工具链要求和运行说明。不得复制平台根 lockfile（含 DSH/平台依赖），不得含私有 workspace 链接、内部 registry、认证 URL、凭证、DSH home、node_modules 或平台日志。

建议 SourceExportManifest：originVersion/run、source/template/lock/scripts hashes、文件清单、工具链要求、验证平台、cleanBuildReportRef、archive hash。包内 manifest 不能将自身 hash 自循环纳入；ZIP 排序/时间戳等元数据采用受控规则，内容 hash 与 archive hash 分开。

Agent 从实际 source.zip 解包到无平台软链的干净目录，按 frozen-lockfile 安装，默认禁生命周期脚本，再执行宿主可信脚本的 typecheck/build/页面加载/声明行为。测试使用固定工具链，记录 Node/pnpm/OS/arch；只验证 macOS 不宣称 Linux/Windows 通过。干净目录也不是 OS 沙箱。

API 导出前核对 source hash、lock/template/scripts hash 与 CleanBuildReport 一致，只返回白名单文件。下载本身不运行脚本或调用模型；若旧版本缺可信 lock，可保留原 unverified 下载，并用显式派生 ExportSnapshot/验证任务生成新资源，不能回写旧版本清单或冒充旧报告原本已存在。

“可复现”首轮指固定依赖闭包和声明平台上的干净安装/构建/功能验证，不自动承诺跨平台二进制逐字节相同。

## 7. 候选公共/内部读取协议

下表是可并行讨论的候选，不是已实现端点；新增 delivery 模块的版本/header、DTO 和所有路径必须统一冻结。旧 execution/conversation 模块保持原样。

| 方向 | 候选端点/对象 | 边界 |
| --- | --- | --- |
| Web → API | `GET projects/:id/version-diff` | 双版本授权、安全有界差异与固定游标 |
| Web → API | `GET runs/:id/delivery`、`GET versions/:id/delivery` | 完整报告视图、质量、未满足项、证据引用 |
| Web → API | `GET deliveries/:id/attempts`、`GET .../evidence/:evidenceId` | owner 校验，日志文本、截图安全 MIME，trace 下载不在工作台执行 |
| Web → API | `GET versions/:id/export`、受控 source.zip | 清单/requirements/复验状态，下载不调用模型 |
| API → Agent | M2 delivery execution wrapper | v1 执行体 + 显式冻结 binding，不在 prompt 偷传权限 |
| API → Agent | 独立报告/attempt/文件读取 | 候选报告和失败证据可在不发布 Version 时读取 |
| API → Agent | 受控导出复验任务 | 不执行模型提供的 shell 或 package scripts |

v1 ArtifactManifest 拒绝 required failed checks，因此 blocked 报告不能冒充可交付旧 manifest。M2 需要独立 report/attempt 读取能力，失败报告保留而不发旧 execution.completed。可交付候选可以把受 hash 保护的报告文件放入旧 manifest，但新 criterion required 语义只能由 M2 Spec/报告解释，不通过改 legacy Check.required 隐藏。

## 8. 三线并行与独立验证

| 方向 | 独立替身 | 必须证明 |
| --- | --- | --- |
| Agent | Fake API frozen spec/profile/产物读取；Fake Model | 同 DSL 运行便签墙与计算器，真实失败/修复/同计划复验，干净导出真实复验；无任意代码执行 |
| API | 独立 Fake Delivery Runtime HTTP | 报告/文件/绑定/fence/partial政策、旧 DTO/历史兼容；不能在 Fake 中直接改业务 DB 宣布成功 |
| Web | delivery Mock API | diff 安全渲染、逐 criterion 状态/证据、自动 partial 的醒目缺口展示、旧版未验证标记 |

共享 G0 最小对象与 fixture：AcceptanceSpec、Coverage、BrowserTestPlan、VerificationAttempt、EvidenceBinding、DeliveryAssessment、SourceExportManifest、CleanBuildReport、VersionDiffPage。定义完整发布、required 行为失败、未覆盖 partial 自动发布、导出失败、失效绑定、取消/发布竞争、旧版本七类场景，三方从同一提交开始。

API 独立验收矩阵：

1. 两版本/报告/文件/导出/证据都检查归属；跨项目和猜测路径不能绕过授权。
2. HTML/SVG/长行/二进制/路径穿越/大小写碰撞/超额 diff 安全处理，结果截断可见。
3. spec/plan/required 不可被模型修改；source/lock/dist/evidence 任一错配拒绝发布。
4. required 自动失败为 blocked，不能通过伪造覆盖/质量字段绕过；未知/manual/unsupported 与失败明确区分。
5. partial 仅在硬门禁及导出通过、无 required 自动失败时自动发布，缺口逐项可见；错误绑定拒绝，重复仅一版本；取消先赢不发布，发布先赢回真实结果。
6. 发布前后、报告落盘前后重启对账，不拿旧报告发布新源码，不释放未确认停止的写锁。
7. 旧 v1 Version/Run/活动仍严格可读，旧证据不回写；新 delivery DTO/事件不打破旧消费者。
8. 导出 ZIP 的文件/hash/lock 与实际干净复验一致；下载无凭证、私有 registry 或平台软链。

## 9. 完整 G4 与后续边界

M2 完整 G4 必须实际模型在“恢复后新版本”继续第三次修改，核对 baseVersionId、父版本、diff、预览与冻结声明行为。此前真实两次交付和只读样例证据保留，但 Fake 回滚后修改不能顶替这项。

真实失败→有限修复→复验如果使用受控故障，标 controlled_regression 并保存故障补丁/hash；不能声称模型自然犯错。所有真实调用待 M1 完成后由主代理统一有界授权，不由本草案触发。

M3 的每任务 OS/网络/资源隔离、Docker、双隧道和外部分享验收仍独立。M2 可信解释器和干净安装的成功不等于可公开执行不可信任务。
