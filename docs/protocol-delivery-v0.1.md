# M2 可信交付协议 v0.1.0（G0 已冻结）

日期：2026-11-08。状态：G0 已冻结。主管已独立复验 contracts check exit 0、78/78 契约测试（原 42 项保持、新增 delivery 36 项）、旧 execution/conversation 源文件与 fixture/tests 无修改，以及独立 canonical 实现的固定 Seed 向量一致；API/Web 最终只读审查均无剩余阻断。**本次仅冻结文档、Schema 和合成 fixture，不是 App 实现、浏览器执行或真实模型证据；本次未调用模型。**

依据：[能力路线图](capability-roadmap.md)、[Agent 候选](m2-agent-delivery-design.md)、[API 候选](m2-api-delivery-design.md)、[Web 候选](m2-web-delivery-design.md)。本协议优先于候选中的歧义。

## 1. 独立协议与兼容边界

- 新共享模块：`@atoms/contracts/delivery`；`DeliveryProtocolVersion = '0.1.0'`。
- 新路径：`/api/delivery/v1`、`/internal/delivery/v1`；版本头 `X-Atoms-Delivery-Version: 0.1.0`。
- 原 execution v0.1 的 DTO/版本头/事件不变；原 coordination v0.2 同样不变。相同版本字面值不表示相同协议，必须按路径和头区分。
- Delivery 是新执行方式和独立读取视图，不把字段塞入旧 strict Run、Version、ArtifactManifest、CoordinationFacts 或 ContextUsed。
- 原 v1 直接执行继续 legacy；M2 准入由 API-owned execution flavor 明确选择。一个 executionId 只能属于一种 flavor；准备阶段已为 delivery 保留的 ID 不能再通过 legacy PUT 启动写入，反向也拒绝，返回 409。
- 旧成功/失败/恢复版数据不重写，不为旧版本补造行为/lockfile/干净导出证据。

职责保持：API 拥有用户目标、来源、准入、预算结算、项目写锁、冻结 binding 和发布；Agent 只读提议计划、执行可信解释器、改应用及产出证据；Web 不从绿色 Run 推断全部行为正确；模型不能修改权限/required/计划/发布政策。

## 2. 从任意自然语言目标产生约定

### 2.1 RequirementSeed：先保存原目标，而非凭空已有完整 Spec

API 在准入后持久化 `RequirementSeed`：id、project/run/execution、revision、完整原 goal、来源消息及准入依据、seedItems、hash。

- 至少一个 `kind=goal` 的 seedItem 原文等于完整 goal；既有 M1 acceptance 每项逐条原文保留，不被改写或丢弃。
- required 默认 true。只有 API 已保存的明确可信可选依据才可 false，模型不能凭自己判断降低。
- 准入依据区分 `auto_explicit_request`、`explicit_proposal_acceptance`、`confirmed_plan`；自动准入不假称用户人工确认了每条 DSL。
- goal 是 API 冻结的完整授权目标：accepted proposal goal、显式澄清后的 resolved goal，或直接任务原 prompt；原用户消息仍保留作来源。不能把 M1 拼入的技术“验收”提示当原目标，也不能只留下抽取关键词而丢原句。
- API 不用关键词识别 notes/calculator。受信 profile hint 必须来自显式宿主选择/配置，不从一句自然语言硬猜。

### 2.2 只读 Prepare：允许模型细化，所有原目标仍可追踪

`host_profile` 使用可信声明模板，不调用模型；`model_proposed` 可以有界调用模型细化 criteria 与 DSL，但只提议数据，不能写源码、安装依赖或启动 Worker。

最终 `AcceptanceSpec` 保留 seed 原 goal、source 和所有 seedItem 原文/required。细化 criterion 显式映射到 seedItems；所有 seedItems 至少有映射，派生于 required seed 的 criterion 不能降 required。未知/含糊/当前无法验证的项保留 manual/unsupported，不能删除。

语法合法、引用完整和字符串覆盖**不是自然语言语义正确性的证明**。Spec 保留 `origin=host_profile|model_proposed`，报告/Web 可查看原目标、细化约定和覆盖理由。complete 只代表本次冻结约定，不能宣传所有可能需求都正确。

## 3. Prepare → API freeze → dispatch

```text
已准入 Run 排队
  -> 取得项目写锁，选择当前 base
  -> 持久 RequirementSeed 与独立 Preparation 请求/ID
  -> Agent 只读 Prepare，提议 Spec/Plan
  -> API 校验原目标/required/覆盖/DSL/预算/模板
  -> API 单次事务冻结 FrozenDeliveryBundle
  -> 用剩余预算构造首次、不可变 execution wrapper
  -> Worker 才能准备/写入应用源码
  -> 验证/修复/导出/报告
  -> API publication fence 与原子版本发布
```

### 3.1 基线和项目锁

latest 在**整个 M2 pipeline 开始 Prepare 前**、取得项目写锁时绑定最新成功版；exact 在此重验。写锁贯穿 prepare/freeze/execute/publication，不能先付费 prepare 旧源码，再在 Worker 启动时悄悄改 latest。只读项目 Router 不拿此写锁，仍独立响应。

### 3.2 typed planning 输入与输出

`PrepareDeliveryPlanRequest`：delivery version、preparationId、projectId、runId、executionId、RequirementSeed、baseVersionId、只读输入快照引用、planningMode、可选可信 profileHint、可信 template/toolchain、总预算、planning 子预算。

`PlanPreparationSnapshot`：id/revision/status/requestHash/sourceSeq、实际 usage、error、完成后的 `ProposedDeliveryPlan`。后者含 seedHash、AcceptanceSpec、BrowserTestPlan、提议来源和未覆盖理由。只有 completed 可有完整 result；失败/取消不冒充可冻结计划。

请求同 ID 同体幂等；异体 409。服务先落受理记录再调用模型。模型结果持久后才 completed；崩溃后已开始但不确定的推理 interrupted，不无界自动重跑。typed 结果的 ID/hash/来源由宿主填充核对，不要求模型发明 opaque 值。

每个 Run/execution 唯一绑定一个 preparationId；不能换 preparation ID 重置预算或选另一份计划。只允许原 ID 内有界结构重试，失败重做须新授权 Run。

### 3.3 API 一次冻结

`FrozenDeliveryBundle` 包含原 seed、最终 spec、plan 和 `FrozenDeliveryBinding`。binding 记录 run/execution/preparation、固定 base、seed/spec/plan hash、template/package/scripts/lock hash、toolchainId、发布/导出 policy revision、总预算、已消耗 planning usage 与 frozenAt；自身 hash 不包含自身 hash 字段。

API 检查：种属与来源、原目标不改、required 不降、每项 coverage、case/变量引用、预算、模板、输入基线。冻结不新增用户审批或 host Attention。改目标/断言需新的授权任务/revision，不在原 Run 上把失败计划改到通过。

`DeliveryExecutionRequest={protocolVersion,execution:StartExecutionRequestV1,bundle:FrozenDeliveryBundle}`。原 execution 在首次 wrapper 构造时一次确定并持久化，之后 PUT 重试完全同体；不能先发无计划 execution，再给相同 ID 更新 body。

Runtime 再校验 bundle、base、flavor 和剩余预算后才能开始应用写入。wrapper 是独立处理器，不是绕过冻结直接转调 legacy 启动。

### 3.4 总预算与配额

- prepare 与 Worker 共用受限生成资源池，Router 使用独立槽；不能阶段切换就重置总预算。
- planning 子预算不超过总预算：建议最多 3 模型步骤、60 秒有效时间、32,768 有效输入、8,192 输出、一次结构化重试；host_profile 模型用量为 0。
- 实际模型步骤事件 `planning.model_started` 首次出现时，API 将同 Run 生成预占结算 used；后续 execution.started 不再扣一次。纯 host planning 在 Worker 实际开始前不结算生成 used。
- API 以可观察、已结算 usage 计算 Worker 剩余时间/步数/有效输入/输出，封入首次 execution.budget。无法核验 usage 或已耗尽则 blocked，不悄悄扩大。
- 总有效时间包含 prepare、Worker、验证/修复及 clean export 的实际执行，不含资源排队和等待用户。preparation snapshot 的可信 usage.activeMs 以毫秒累计；remaining wall/model/input/output 分别为 total 减已发生规划消费，修复次数/单问题等待/产物上限不因阶段重新放大。
- 缓存读写纳入有效输入，重复 settled 事件去重，沿用 M1 修正。所有阶段仍可能有在途消费，不宣称绝对费用硬限。
- 取消 prepare 必须确认 Runtime 停止才释放锁；已产生 billable work 不退 used。未决 PUT 先按同 ID 对账，不绕过确认创建第二任务。

## 4. 通用无代码 Browser DSL

`BrowserDslVersion='browser-dsl-v1'`。解释器不含应用类别分支，不运行模型 JS/Node/Playwright 代码、shell、函数、动态导入、XPath、任意 CSS 或 regex 程序。

### 4.1 定位和动作

- Locator：role+name、label、test_id；exact，nth 0–99；单个字符串不超过 240 字符。动作默认唯一可见目标。
- 动作：open_current_app、reload、click、fill、check/uncheck、有限 press（Enter/Tab/Escape/Backspace/Arrow keys）、drag_by。
- open_current_app 无 URL 字段；origin、资源路径、浏览器上下文、出站请求规则由宿主给定。不可访问工作台、内部 API、外站或其他 frame。
- 断言：visible/hidden、text/value exact/contains、count、box moved_by/same_as。
- 有限变量只允许宿主 `save_count` 和 `save_box` 产生；同 case 先定义后使用，不能重定义或跨 case 共享。count 只允许固定 offset（-100–100），box 只允许固定比较与容差（0–20 px），没有通用表达式。
- box 可保存相对指定应用内锚点的位置；后续比较必须使用相同坐标系，不把滚动变化当拖拽持久化。
- 每 case 新浏览器 context；刷新持久化在同 case 内验证，不继承其他 case 或真实用户数据。

### 4.2 预算和覆盖

固定上限：10 case、总 120 step、单步 5 秒、每次浏览器验证 90 秒；拖动每轴不超过 512 px，受视口边界限制；变量每 case 最多 10 个。所有阶段还受 Run 剩余有效时间限制。

coverage 与 result 正交：冻结 coverage.method 为 `automated|manual|unsupported`；**not_run 只作为执行结果**，不能把一次自动失败改成 coverage=not_run。automated 必须有 caseIds，manual/unsupported 必须有具体理由且不虚构 case。

每个 case 的 criterionIds 都必须存在；每项 Spec criterion 恰有一个 coverage。required/manual/unsupported 属性不会因失败而改变。

### 4.3 首轮复用门禁

便签：新增、编辑、删除、搜索、拖拽、刷新后文本/位置保留，六类声明行为全部覆盖。

计算器：至少 7+5=12、清空后 9×3=27 两条独立场景，使用同样 click/text/assert DSL，不增加专用业务 JS。可信 profile 是声明数据，不是解释器硬编码测试函数。

## 5. 证据 DAG 与实际结果

### 5.1 不循环的 hash 顺序

1. seedHash；模型/宿主提议 Spec 后 specHash；Plan 引用 specHash，再 planHash；API 固定 bindingHash。
2. sourceSnapshotHash 对排序 `{path,bytes,sha256}` 源码/config/lock 清单计算，不含 dist/node_modules/evidence/DSH。
3. distHash 对构建产物清单计算。每次验证都有 sourceBeforeHash/sourceAfterHash，两者不一致则本次无效，不能发布。
4. attempt 绑定上述 hashes、toolchain、实际 case 结果和独立证据文件 hashes；report 不能引用包含自己的最终 artifactManifestHash。
5. ZIP 内 contents-manifest 只列源码、模板与内容指纹，不含自身 archiveHash 或后产生的 clean report hash。
6. 实际 ZIP 完成后生成 archiveHash，再做干净复验并产生 CleanBuildReport。外部 SourceExportManifest 与 DeliveryReport 最后引用 archive/clean report，不能反向塞回 ZIP 造成循环。
7. 最终 artifact manifest 可引用 report 文件 hash；API publication 记录引用 manifestHash/reportHash/policy，不回写原报告。

hash 证明一致性，不单独证明浏览器实际执行或语义正确；可信计算基是宿主校验器/解释器与内部服务，通过真实执行日志、截图、集成验收建立证据，不宣称远程执行密码学证明。

### 5.1.1 精确 canonical 字节规则

先经相应 Schema 得到规范 DTO（包括显式 defaults），然后才计算 hash。只允许 JSON：null 保留，数组顺序保留，string/boolean/有限 number 原样；禁止 undefined（含数组洞）、函数、Date 对象、BigInt、NaN/Infinity。可选字段缺省应省略，不显式塞 undefined。旧 M1 hash 实现及其历史字节规则不改。

对象递归按 M1 的 `Object.entries(...).sort(([a],[b]) => a.localeCompare(b))` 排键，数组不排序，`JSON.stringify` 无缩进、无尾换行，UTF-8 编码后 SHA-256，小写 hex。新模块导出无 Node 依赖的 `canonicalDeliveryJson` 与 `deliveryHashBody`；后者**仅删除传入对象顶层的 hash**，不能删除嵌套 refs 的 hash、时间、revision 或任何其他字段。

| 被 hash 对象 | 精确 payload |
| --- | --- |
| Seed / Spec / BrowserTestPlan / FrozenBinding / Attempt | 各自完整规范 DTO，仅排除自己的顶层 hash；所有 refs/hash/时间/revision 保留 |
| SourceExportManifest / CleanBuildReport / DeliveryReport / DeliveryFacts | 同上；只排自己的 hash，不删除嵌套对象 hash；报告无 final artifact hash 字段 |
| DeliveryCoordinationRequest.hash | 完整外层去顶层 hash；内层协调对象/context.hash 不变，deliveryFacts.hash 保留 |
| Prepare / execution wrapper requestHash | 完整规范请求 DTO，不排任何字段（请求自身没有 hash 字段）；内层绑定 hash 全部参与 |
| sourceSnapshotHash / distHash | 使用候选 manifest 的完整 `source/` / `dist/` 前缀路径，对规范 `{path,bytes,sha256}` 清单按 path 的 Unicode 字面序（JS `<`/`>`）排序后 canonical JSON；不得剥除前缀，不含 mediaType/目录时间，不隐式改大小写/NFC |
| 文件 / ZIP archive / report 传输字节 | SHA-256 原始实际字节；传输 report 文件的 bytes hash 与 report 对象自己的 hash 分开，不能混用 |

静态跨实现向量：`delivery-fixtures.seed`（含中文、嵌套对象、数组及 null），仅去顶层 hash 后为 **1202 UTF-8 bytes**，SHA256 **769646b0930ff5c4923bd9eb056a0579995db3aa98656822effbbd002143321b**。它只验证规范化，不代表真实浏览器或导出证据；其他 fixture 文件/ZIP digest 是明确的合成绑定样例，不冒充真实执行。

### 5.2 Attempt 与失败修复

`VerificationAttempt`：id、run/execution、repairRound、previousAttemptId、binding/spec/plan/lock/toolchain、source 前后、dist、时间、基础检查与 caseResults、evidence。

每个尝试都列出计划中的所有 case：passed/failed/not_run，并给未运行理由；记录与当前源码一致的最后一个 attempt，不能挑旧通过结果冒充最新。

修复不改 testPlanHash。required 自动失败只有在同一冻结计划、后续有效源码尝试中相关 case 全部实际通过才可解除。后续 not_run/unsupported、覆盖删除或另一版截图不能洗掉已知失败。

普通 Run question/计划确认只可在不变的冻结约定内继续；用户只是批准原计划仍继续同一 Run，不重复扣额。若回答实际改变验收目标，必须建立新授权 Run/新 revision，并对原 Run 按取消或终止的真实语义处理；不能在同一 Run/execution 替换 Spec/Plan/binding，也不能借回答修改冻结断言/required。

真实失败→修复→同计划复验记录 source A/T 失败、source B/T 通过和实际用量。受控回归须标 `controlled_regression` 与补丁/hash，不能声称模型自然犯错。

可选 `VerificationAttempt.sourceProvenance` 由宿主记录：model_output 明确 adapterMode=dsh/fake；controlled_regression 必有 baseSourceHash/patchHash/injectedSourceHash/patchEvidenceId，且 injectedSourceHash 等于该 attempt.sourceBeforeHash，报告内补丁证据字节 hash/attempt/source 匹配；synthetic_fixture 只用于合成契约样例。缺省显示“来源未记录”，不能猜是自然模型失败。此字段不授权通过质量门禁，模型无权自行声明受控注入。

### 5.3 独立失败报告

`DeliveryReport` 有自己的 deliveryId/hash/revision/final、run/execution/preparation、seed、可空冻结对象、attempt 链、可空导出/clean report、quality、具体缺口与错误。

- Prepare 尚未冻结就失败：binding/spec/plan/source 等尚不存在的项明确 null，不伪造零 hash；report 仍可按 Run 读取并显示 planning blocked。
- 已冻结执行失败：保留实际绑定与已产生尝试，即使没有 Version、没有合法旧 v1 ArtifactManifest 也可读取。
- v1 manifest 不允许 required failed checks；blocked 报告走独立资源，不能冒充旧可交付 manifest 或发送旧 execution.completed。
- report 尚不可达用 HTTP/typed error 表达，不能自动映射为 legacy。

## 6. 质量与固定自动发布政策

| 质量 | 判定 |
| --- | --- |
| complete | typecheck/build/smoke、导出与完整性硬门禁均通过，所有声明 criterion 都有当前有效通过结论 |
| partial | 硬门禁/导出均通过，无 required 自动失败，但有 manual/unsupported/not_run 或可选自动失败；required 未覆盖仍保留 required=true |
| blocked | 基础失败、required 自动失败未同计划修复、source/hash/证据错配、导出失败、取消/中断/预算未完成或准入失败 |
| legacy/unverified | 旧版本没有 delivery binding/报告，保留旧访问；网络错误不属于此类 |

API 独立核对报告、冻结 binding、实际文件与 attempt 链后重算分类，不信任 Agent 自由文本 quality。

满足 complete 或合法 partial 后固定自动发布，最多一个版本；partial 必须由 Web 显著列缺口，不新增接收按钮、host Attention 或默认等待。blocked 不换当前版本，不允许 override。取消/中断/预算或证据无效不能借 partial 发布。

Run 生命周期不变：API 检查/staging 时仍 running/publishing，事务成功才 succeeded；succeeded 只表示已发布，不表示质量 complete。partial 的旧 Version.summary 也明确主要缺口，新质量通过独立 view 呈现。

取消与发布沿用 API 事务 fence：取消先赢不发布；发布先赢回真实结果。executionId、base、binding、取消、policy revision 一起核对，重启不得重复生成/发布。

## 7. 可信导出与干净复验

- 受信模板独立持有 package.json、scripts、pnpm-lock.yaml、packageManager/toolchain；模型不可改这些指纹。
- 不复制平台根 lock；仅生成应用闭包。公开 registry 固定为 `https://registry.npmjs.org`，无内部 registry、认证 URL、workspace 链接。
- ZIP 排序和时间戳固定，内容 hash 与 archive hash 分开。导出不含凭证、DSH home、node_modules、内部日志或宿主路径。
- `SourceExportManifest.files` 与候选 artifact 的 `source/` 清单完全同集，路径保留 `source/` 前缀；ZIP 另含根级 `contents-manifest.json`，解包后进入 `source/` 安装/构建，包内 README 明示该步骤。sourceSnapshotHash 使用同一带前缀清单，不允许一方计算时剥除前缀。
- `contents-manifest.json` 精确字节为 canonical JSON `{protocolVersion,sourceSnapshotHash,templateId,toolchainId,files:[{path,bytes,sha256}]}` 的 UTF-8、无尾换行，files 按 path 字面序排序；它不列自身，`contentsManifestHash` 对这些精确字节计算。`scriptsHash` 对完整 `package.json.scripts` 的 canonical JSON 计算，不删除任何内容键；templateHash 由服务认证的发现 descriptor 提供、Agent 核对实际受信模板，API 不宣称独立重建远程模板的证明。默认工具链 ID 为 `toolchain_react_v1`。
- 从实际 ZIP 解包到全新目录，不挂载/软链平台 node_modules，不继承工作台/Agent HOME、Key、Cookie、服务 token。
- frozen-lockfile 安装、默认禁生命周期脚本，只运行指纹匹配的宿主可信 typecheck/build，再加载并使用同一声明计划验证。
- `CleanBuildReport` 记录 source/archive/lock/toolchain、实际 Node/pnpm/OS/arch、安装/类型/构建/加载/行为结果与证据。只测 macOS 不声称 Linux 通过；可复现不是跨平台二进制逐字节一致。
- 安装超时、依赖缺失或脚本要求不符合政策则 export blocked，不能静默开启任意脚本。

## 8. 公共读取协议

所有公共读取先做 owner/project 检查；不同项目和无权统一 404。游标不替代授权。下载不调用模型、不运行代码、不创建 Run。

| 方法与路径（`/api/delivery/v1`） | 响应与语义 |
| --- | --- |
| GET `/runs/:runId` | `DeliveryReadView`，失败/取消无 Version 也可读取 |
| GET `/versions/:versionId` | `DeliveryReadView`，含恢复证据来源 |
| GET `/deliveries/:deliveryId/attempts?cursor=&limit=` | attempt 页，绑定同一 report revision/hash |
| GET `/deliveries/:deliveryId/evidence/:evidenceId` | typed EvidenceDescriptor，含 report/source/attempt 绑定，不接收任意 path/URL |
| GET `/deliveries/:deliveryId/evidence/:evidenceId/content` | descriptor 指定 kind/MIME/disposition 的原始字节，owner-scoped；trace 只附件下载 |
| GET `/versions/:versionId/export` | 独立 export view：verified/unverified/pending/failed 与可信 descriptor |
| GET `/versions/:versionId/source.zip` | 对应授权导出；旧版可保留 unverified 来源，不能伪装有 lock 复验 |
| GET `/projects/:projectId/version-diff?baseVersionId=&headVersionId=&cursor=&limit=` | 固定同项目双版本的有界 diff 页 |

`DeliveryReadView` 明确 pending/available/legacy。pending 返回真实 phase/revision；available 有 final/provisional、API-authoritative quality、可选独立 provisional report quality、具体缺口、来源与 report。publication 状态必填（not_published/publishing/published/rejected/cancelled），subject/publishedVersionId 可为 null；final 不等于已发布。若 API 判定证据不可信，只返回 blocked 解释/错误，不把未验证原文报告标为通过。legacy 仅来自持久化不存在 M2 binding 的事实。

attempt 分页、证据 descriptor 和 export view 都携带 deliveryId/reportHash/reportRevision/source 绑定；cursor 绑定同一 revision，变化返回 409 重新读取，不能把 provisional 页接到另一个 final 报告。Web 即使已收到完整 final 报告也只按 publication 与真实版本指针切预览。

Web 按 run/version/execution/source/spec/plan/report hash+revision 合并，旧请求响应不能覆盖另一版；活动时轮询 delivery view，final 后停止高频轮询，新 run/版本/恢复触发重新读取。报告/证据 401/403/404/410/503 保持真实错误，不能当 legacy。

日志/源码按 text/plain+nosniff、安全转义；截图只支持经校验的 PNG/JPEG，不内联 SVG/HTML；trace 仅附件下载，不在工作台执行。descriptor 不泄露内部路径/服务地址/凭证化模型 URL。

M1 旧 host action 的 source_download 仍只解析到 `/api/v1/versions/:id/source.zip`，不改 strict action Schema。对 M2 新版本，该旧 URL 必须透明返回与 delivery 导出相同、已干净复验的精确 archive 字节/hash，不动态重构另一个 ZIP；对 legacy 保留原 unverified 下载语义。新 URL 可作 alias，不能有不同 archive。

ExportReadView 返回明确 `downloadRef={verification,subjectVersionId,archiveId,archiveHash}`；legacy 的 archiveId/hash 为 null 且 verification=legacy_unverified。标准 API client 使用 subjectVersionId 调用上表固定 source.zip 路由并核对 archive 绑定；没有 opaque downloadActionId、额外 resolve 系统或模型 URL。

## 9. diff 与恢复 provenance

diff 仅比较 source/；省略 base 使用 head.parent，无 parent 与空快照比较。base/head 都须同项目有权。状态 added/modified/deleted，含双方 hash/bytes、text/binary、带行号的文本 hunks；无任意 Git 引用或文件系统路径输入。

上限：每页 20 文件，最多比较 100 文件/1 MiB 文本/5,000 输出行，单文件 256 KiB 文本，算法有效时限 1 秒；截断有理由，不等于无差异。binary 只摘要，不执行；失败候选 diff 首轮明确不支持，失败报告/证据仍可读。

cursor 由 API 生成并绑定 base/head/source hashes、过滤与位置。空基线单独表示，不能用空字符串猜版本。路径拒绝 traversal/symlink/绝对路径/重复/大小写或 Unicode 规范化碰撞；不静默重命名后计算 hash。

恢复不新建 Run、不重新验证、不改旧 report/attempt。source/config/lock 逐字节相同才复制 API-owned attachment 映射：

- `subjectVersionId`：当前被读取的恢复版。
- `restoredFromVersionId`：直接恢复来源。
- `verificationOrigin`：最初实际验证的 version/run/execution/report/hash/source。
- `evidenceReuse=restored_unchanged_source`、`verificationRerun=false`，UI 明示“复用原约定证据，未重跑”。

恢复链始终指最初验证源；原 legacy 恢复仍 legacy，不能因新 Version ID 变 complete。下载可按当前 subject 授权但标 origin。恢复后修改是新 Run、新冻结和新报告，不自动复用旧通过结论。

## 10. 内部服务协议

内部服务沿用 token，禁止公网直接访问；路径与 delivery header 不得混淆两个旧协议。

| 方法与路径（`/internal/delivery/v1`） | 语义 |
| --- | --- |
| GET `/toolchains/:toolchainId` | 服务认证+delivery header 的只读 ToolchainDescriptor；不调用模型、不写源码 |
| PUT `/preparations/:preparationId` | typed PrepareDeliveryPlanRequest，只读；首 201、重试同体 200 |
| GET `/preparations/:preparationId` | PlanPreparationSnapshot |
| GET `/preparations/:preparationId/report` | 独立 ReportRead pending/available；即使 execution 尚未 PUT，准备失败仍可读取 blocked 报告 |
| GET `/preparations/:preparationId/evidence/:evidenceId` | 准备失败日志按 Preparation 索引受控读取，无需 execution record 或 Version |
| GET `/preparations/:preparationId/events?after=&limit=100` | preparation 自己的 sourceSeq，accepted/started/model_started/progress/completed/failed/cancelled/interrupted |
| POST `/preparations/:preparationId/cancel` | commandId 幂等，确认停止前不声称 cancelled |
| PUT `/executions/:executionId` | typed DeliveryExecutionRequest，校验整个 frozen bundle 后才写源码 |
| GET `/executions/:executionId` | execution v1 状态的 delivery wrapper 与交付阶段/报告引用 |
| GET `/executions/:executionId/events?after=&limit=100` | 原 execution 事件页的只读 wrapper，独立 delivery metadata，不向旧 enum 塞 variant |
| POST `/executions/:executionId/inputs`、`/cancel` | 原 Run 答复/取消 payload，delivery flavor 下同样幂等 |
| GET `/executions/:executionId/report` | 独立 DeliveryReport，blocked 亦可读 |
| GET `/executions/:executionId/evidence/:evidenceId` | 受控失败/成功证据读取 |
| GET `/executions/:executionId/export/:archiveId` | 读取实际源 ZIP，不接受任意 path |

API 提供只读 frozen bundle/输入 artifact 端点或将 bundle 全量放 wrapper；本版选择**wrapper 全量携带**，API 是冻结权威，Runtime 不再另选/重生成计划。源码输入继续使用受控 artifact ID/manifest hash。

API 配置 `M2_TOOLCHAIN_ID`，首次 Prepare 前从上述只读端点获取实际可信 descriptor，并在该 Run 不可变请求中持久固定；网络失败不猜 hash、不回退 legacy，重试不换 descriptor。Agent 每次 Prepare 核对 template/package/scripts/lock/toolchain 全部实际指纹。成功候选的 artifact manifest/file 继续沿用既有 `/internal/v1/executions/:id/artifacts/:artifactId/manifest|file` 读取；这不允许绕过 delivery 启动/freeze。失败报告、证据和实际 ZIP 使用本节独立 delivery 路由，不依赖成功 Version 或 v1 manifest。

独立失败报告资源不要求 Version 或 v1 manifest 存在。read report 的尚未生成与依赖不可达分别表达，不能用空成功对象掩盖。

## 11. Router 的 delivery-aware 外层

不改旧 `CoordinationFacts`、context.hash 或 `RouterResult` 字段。新增 `DeliveryFacts`：projectId/revision/asOf/hash、受权 version/run 的质量/具体覆盖缺口/来源、host action refs；禁止 URL、Key、内部路径。它有独立 canonical hash。

`DeliveryCoordinationRequest={protocolVersion,coordination:StartCoordinationRequestV2,deliveryFacts,hash}`。路径 `PUT /internal/delivery/v1/coordination-turns/:turnId`，配套 GET/events/cancel 的 delivery wrapper。API 首次派发冻结整个外层，重试不重算 deliveryFacts；inner request/hash 保持原样。

Agent 明确向模型提供新事实，partial/legacy/blocked 不能被旧 Run.succeeded 覆盖。ContextUsed 仍引用原协调快照；outer snapshot 另带 `deliveryFactsUsed={projectId,revision,asOf,hash}` 供审计。旧 RouterResult 只引用原受权 version/run/action IDs；新报告/导出/diff动作由 Web 的 delivery view 获取，不将新 kind 偷塞进旧 ContextReference。

同 turnId 不得先在裸 v2 协调受理再以不同 delivery 外层重派，flavor/hash 一次绑定。API 自己的结果准入、记忆/取消和 Worker 权限仍用 M1 fence，不由 deliveryFacts 授权。

## 12. 共享对象与 G0 验收

独立模块已落盘：RequirementSeed、AcceptanceSpec、CriterionCoverage、BrowserTestPlan、DSL Locator/Step/变量、Toolchain/TemplateDescriptor、Preparation request/result/snapshot/events、FrozenDeliveryBundle/Binding、DeliveryExecutionRequest/Snapshot、VerificationAttempt/CaseResult/EvidenceBinding、DeliveryReport/Assessment、SourceExportManifest/CleanBuildReport、DeliveryReadView/ExportReadView/VersionDiffPage、DeliveryFacts/Coordination wrapper。

fixture 覆盖：完整交付、required 未覆盖自动 partial、可选自动失败 partial、required 自动失败 blocked、A/T失败→B/T成功、已知失败不能洗成 not_run、源码验证期变化、无 Version 的失败报告、导出失败、取消/发布竞争、恢复复用原证据、legacy 恢复、错误 diff cursor/分页、安全 HTML/二进制/截断，以及便签/计算器通用 DSL。

G0 tests 只校验契约/合成 fixture，不执行浏览器或模型。Schema 验证跨引用/required/变量先定义/预算与报告质量约束；实际文件 hash、执行真实性、归属、进程停止和发布事务必须由 App 集成门禁验证，不把 Zod 通过当作真实验收。

## 13. 已裁定项与后续实施门禁

1. complete/partial/blocked 的共享聚合函数只做纯数据政策计算；API 仍需先独立核验实际文件和证据。Schema 不承担浏览器执行或远程证明。
2. Prepare 失败早于 Spec/Plan 冻结时，报告中的尚不存在对象使用 null，并明确 planning blocked；禁止伪造全零 hash。
3. coverage.method 使用 automated/manual/unsupported，not_run 统一放执行 result；这是新模块的明确选择，不更改旧 Check/事实 enum。
4. 新增字段/端点以本文及已冻结的独立 delivery Schema/fixtures 为基线；M2 App 实现与真实验证由主管另行组织，G0 通过不替代后续执行与发布门禁。
