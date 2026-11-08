# M2 Agent 可信交付设计（候选，未实施）

日期：2026-11-08。状态：供下一阶段三方冻结；不是已实现能力或新增验收证据。M1 项目协调验收优先，M2 实施及有界模型验证由主管依据既有任务授权统一安排；本候选文档不触发执行。

本文补充 [能力路线图](capability-roadmap.md) 的 M2 Agent 方向：声明验收、受控浏览器执行、失败修复证据和可复现源码导出。现有类型/构建/页面加载检查保留，不能继续用 smoke 代替需求行为验收。

## 1. 目标与边界

交付的判断由宿主实际执行和证据决定，不由模型说“完成”决定。

```text
已确认验收约定
  -> 生成并校验受控 DSL 计划
  -> 实现前冻结 Spec/Plan/hash
  -> Worker 实现代码
  -> 绑定本轮源码快照
  -> 类型/构建/加载 + DSL 行为检查
      -> 失败证据 -> 原预算内修复 -> 同一计划复验
  -> 可信 lockfile + 干净导出安装/构建
  -> complete / partial / blocked 报告
  -> API 校验和发布政策
```

| 方向 | 责任 |
| --- | --- |
| Agent | DSL 校验与解释器、源码完整性、实际检查、有限修复、证据与导出复验报告 |
| API | 已确认约定、计划绑定及发布权威；独立校验证据/hash；决定部分交付政策 |
| Web | 展示每项验收的覆盖、结果与证据；区分未覆盖、未运行和失败 |
| 模型 | 提议实现/测试数据、解释真实失败、修改应用源码；不能执行任意测试脚本或改验收政策 |

M2 不开放 shell/fs 模型工具，不做插件市场或任意测试代码执行。OS/容器隔离与公网仍归 M3；本地可信解释器与干净目录不是 OS 沙箱。

## 2. 通用受控浏览器 DSL

解释器只识别版本化的 JSON 数据，不识别 JavaScript、Node、Playwright 代码、shell、表达式或动态函数。应用类别不进入解释器分支；便签墙和计算器均使用同一组动作与断言。

### 2.1 定位器

首轮支持：

- `role`：受限角色、可见名称、exact 以及有界 nth。
- `label`：精确可访问标签及可选 nth。
- `test_id`：固定字符串及可选 nth。

不接受 XPath、任意 CSS、正则程序、跨 frame 选择器或 JS predicate。定位结果有上限；严格动作默认要求唯一可见目标。稳定 testId/可访问标签可作为组件的内部测试契约，不进入面向用户的产品流程。

### 2.2 动作与断言

| 类别 | 首轮能力 | 宿主约束 |
| --- | --- | --- |
| 导航 | 打开当前绑定应用、reload | 起始 URL 由宿主提供，模型不能指定外站或内部服务 URL |
| 操作 | click、fill、有限按键、checkbox check/uncheck | 仅当前应用主 frame；数据为普通字符串/布尔值 |
| 拖拽 | 从定位器拖动固定 delta 或到另一定位器 | 位移限额、视口边界；不访问操作系统桌面 |
| 断言 | visible/hidden、text、value、count、位置变化 | exact/contains 为固定枚举，不执行表达式 |
| 通用检查 | 无 pageerror、应用非空、限定资源加载 | 由宿主实现，不能由模型覆盖 |

每步使用有界自动等待。禁止任意 sleep、无限循环、自定义重试、动态导入、page.evaluate/model script、系统文件读写或访问宿主网络资源。可信解释器内部可以调用 Playwright 的 locator/boundingBox 等固定 API，但从不把模型字符串当代码执行。

每个 case 使用新浏览器上下文，不继承工作台 Cookie、真实用户 profile 或服务凭证。刷新持久化在同一 case/context 内验证。案例之间不共享已输入的数据，防止前序 case 残留导致假通过。

建议冻结有界配置：最多 10 个 case、总计 120 步，每步最多 5 秒，总浏览器验证最多 90 秒；精确值在下一轮共享契约确认。超时/限制失败作为真实结果，不自动放宽。

### 2.3 JSON 形状示意

以下为设计示意，不是当前共享 Schema：

```json
{
  "caseId": "case_note_persistence",
  "criterionIds": ["criterion_note_refresh"],
  "steps": [
    { "op": "click", "target": { "by": "role", "role": "button", "name": "新建便签" } },
    { "op": "fill", "target": { "by": "label", "name": "便签内容", "nth": 1 }, "value": "验收便签 A" },
    { "op": "reload" },
    { "op": "expect_value", "target": { "by": "label", "name": "便签内容", "nth": 1 }, "equals": "验收便签 A" }
  ]
}
```

源文件中的“忽略规则”“运行命令”等文本只能是页面/源码数据，不能改变 DSL 白名单、验收断言或权限。

## 3. 两类应用证明可复用

### 3.1 便签墙：完整覆盖六类声明行为

| Criterion | DSL 场景 |
| --- | --- |
| 新增 | 记录便签数量，点击新增，数量加一且新编辑框可见 |
| 编辑 | 向指定便签填写唯一文本，断言该编辑框 value 一致 |
| 删除 | 删除指定便签，数量减少且目标便签消失 |
| 搜索 | 创建两个不同文本便签，填写搜索词，仅匹配便签可见；清空后恢复 |
| 拖拽 | 记录 card bounding box，拖动 handle，断言实际位置变化并在允许容差内 |
| 刷新保存 | 编辑内容并拖动后 reload，断言文本保留、位置仍接近拖动后的记录 |

最后一项的位置记录使用解释器提供的有限变量（仅宿主记录的 bounding box/数量），不是模型表达式。变量只能由固定动作生成，用固定断言比较，不能拼脚本。

### 3.2 计算器：使用相同基础 DSL

示例一：依次点击 7、+、5、=，断言结果区域文本为 12。示例二：清空，依次点击 9、×、3、=，断言为 27，再清空检查初始值。

计算器不增加专用 JS 测试函数，仅使用 click、text 断言和可访问定位器。这证明执行器不依赖便签的源码结构或组件名。

两类声明计划可作为受信样例 profile，但通用解释器不得硬编码 `if notes` 或 `if calculator` 执行业务脚本。新应用可提交经过同样校验的声明计划；没有受支持映射的需求不得套用不相干样例后宣称通过。

## 4. 验收项映射和实现前冻结

`AcceptanceSpec` 必须保留用户请求、已确认提案/计划、criterion ID 和来源。计划中的每个 criterion 都有明确 coverage：

- `automated`：存在已冻结 DSL case。
- `manual`：需要人工判断，记录理由与待验收状态。
- `unsupported`：当前解释器无法验证，明确缺少的能力。
- `not_run`：已有映射但本轮未执行，说明取消、上游失败或预算等原因。

coverage 不等于执行结果。测试失败不能改成 unsupported；未运行不能算通过。保留 criterion 的 required 属性，即使暂不支持也不能把它改成可选。

冻结顺序：

1. 宿主确认本轮需求/验收约定及来源。
2. 宿主或模型提出声明计划，可信校验器核对 DSL、定位器和资源上限，并完整列出未覆盖项。
3. **Worker 实现前**持久绑定 `acceptanceSpecHash` 与 `testPlanHash`。
4. Worker 只获得约定与必要接口测试契约，不能写测试计划文件、断言、required、预算或校验器。
5. 修复只改应用源码；同一 Run 的复验始终使用同一个冻结 testPlanHash。

用户确实改变需求时，通过新的授权计划 revision/任务处理，保留旧计划，不允许模型为了通过而静默放宽断言。模型提议的 DSL 通过语法校验不代表其语义已正确覆盖需求，coverage 和案例审查仍需真实证据。

当前 v1 StartExecutionRequest 是 strict；计划引用的传递方式必须在 M2 三方契约中明确，不能偷偷塞进 prompt/projectMemory 绕过协议冻结。

## 5. 每次验证都绑定源码与计划

每次尝试至少记录：

```text
attemptId / runId / repairRound / sourceSnapshotHash
acceptanceSpecHash / testPlanHash / lockfileHash / toolchainId
startedAt / finishedAt / caseResults / evidenceIds
```

`sourceSnapshotHash` 由宿主对规范化、排序的 `{path,bytes,sha256}` 文件清单计算；包含源码和受信构建配置/lockfile，不含 node_modules、dist、证据目录或 DSH 数据。每个文件拒绝 symlink、越界和超额体积。

**验证前后重新计算源码 hash，必须一致。** 若源码在执行中变化，本次结果标为无效/中断，不能拿变更前的通过结果发布变更后的应用。截图、日志、失败步骤、断言 expected/actual 和可选 trace 均绑定同一 attempt/source/testPlan，API 下载产物后独立校验。

验证器的输出目录在源码根之外。浏览器仅运行该次构建产物，不能跳到工作台、服务端 API 或外站。测试输入与错误作为数据传递给修复 Worker，不允许它们重新定义权限。

原 v1 Check 和 ArtifactManifest 保持历史可读。新增报告可以作为 manifest 中受 hash 保护的 report 文件，但其对象 Schema、必需绑定和发布政策须由三方统一定义；不能只加一段自由文本“行为通过”。

## 6. 真实失败、修复与复验

首个完整证据链选择便签墙：新增/编辑/搜索/拖拽/保存均由实际浏览器操作产生结果。

优先记录真实模型产物出现的行为缺陷。若为了演示可复现性使用受控故障，必须明确标 `controlled_regression`，保存固定故障补丁/hash，不声称是模型自然犯错。

例如刷新保存缺陷的链路：

1. 实际输入便签、拖动并 reload，断言发现文本/位置丢失。
2. 保存失败步骤、预期/实际、截图和源码 hash；失败真实发生，不使用合成 fixture 代替浏览器结果。
3. 在原有限修复预算内，把证据交给 Worker，禁止修改冻结测试计划。
4. 修复后生成新的源码 hash，使用**同一 testPlanHash**复验全部相关 case。
5. 保存失败与通过两次 attempt、补丁差异及实际模型用量。

真实模型验证由主管依据既有任务授权，在 M1 验收完成后统一有界启动，不增加逐次向用户请求确认的流程；普通独立测试不消耗模型额度。失败证据不足或预算耗尽时诚实报告，不扩大预算或伪造通过。

## 7. complete、partial、blocked

| 状态 | 含义 |
| --- | --- |
| `complete` | 基础硬门禁、受支持的必需行为、声明覆盖和导出复验均满足，没有被隐藏的待验收项 |
| `partial` | 基础与导出检查通过且没有 required 自动行为失败，但仍有 manual/unsupported/not_run criterion；required 但 unsupported/manual 也只能是 partial，缺口必须逐项可见 |
| `blocked` | 类型/构建/运行失败、required 自动行为失败、hash 不一致或导出复验失败；不能替换当前可用版本，也不能人工覆盖成通过 |

required criterion 的缺口不能被模型降级消失。采用统一候选发布政策：typecheck/build/smoke 和干净导出检查均通过、且没有 required 自动行为失败时，由 API 自动发布 partial；Web 必须显著显示“部分交付”及未覆盖/人工验收/未运行明细，不能显示全通过。默认不新增“是否接受部分结果”的确认、host Attention 或等待流程。blocked 不得替换当前版本、不得 override。模型不能选择或修改发布政策。旧版本没有声明报告时明确标为 legacy/unverified，不修改旧 manifest 或追加虚构历史。

## 8. 可信 lockfile 与干净导出

### 8.1 受信模板

- 为 React/Vite 模板单独生成并维护 `package.json`、`pnpm-lock.yaml`、packageManager 与工具链说明。
- lockfile 来自受信宿主流程，直接及传递依赖固定并带完整性校验；模型不得修改依赖、脚本、Vite 配置或 lockfile。
- 使用公开可访问 registry；不得包含 bnpm、企业内部 registry、认证地址或私有 workspace 链接。
- 不复制平台根 pnpm-lock.yaml：它包含平台/DSH 依赖，不是生成应用的依赖闭包。

### 8.2 干净目录复验

1. 从实际 source.zip 解包到全新目录，检查路径、symlink、文件大小和 manifest hash。
2. 不使用或挂载平台 node_modules，不软链平台包，不继承工作台/Agent 的 HOME、Cookie、模型 Key 或服务 token。
3. 使用固定工具链执行 frozen-lockfile 安装、类型检查和生产构建，记录真实日志及退出码。
4. 安装默认禁用生命周期脚本，只执行宿主固定的构建命令；不能把模型字符串变成命令。必要的受信 vendor 例外须单独审查，不能遇到错误就静默开启全部脚本。
5. 新产物再做页面加载与声明行为检查，证明导出内容实际可用，不只是 zip 中有文件。

可复现命令示例（在 workspace 之外的干净解包目录执行）：

```bash
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org
pnpm run typecheck
pnpm run build
```

scripts 本身也属于受信模板并校验 hash，不能执行模型修改过的 package.json。记录实际验证的 Node/pnpm/OS/架构；只验证 macOS 时不能宣称 Linux 已通过。

导出应包含必要源码、配置、lockfile、运行要求和说明；禁止凭证、DSH home、内部日志、node_modules 和宿主路径。一次干净目录成功不替代 M3 的 OS/网络/资源隔离门禁。

## 9. 建议共享对象（待三方冻结）

建议新增独立 delivery 契约模块，保持旧 execution/conversation 模块兼容，不先修改实现。

| 对象 | 必需内容 |
| --- | --- |
| `AcceptanceSpec` | ID/revision、来源消息/提案、criterion 描述与 required、确认依据 |
| `CriterionCoverage` | criterionId、automated/manual/unsupported/not_run、caseIds、原因 |
| `BrowserTestPlan` | DSL version、冻结 case/步骤、预算、spec/plan hash、冻结时间 |
| `LocatorSpec` / `BrowserStep` | 受限定位、动作、断言、有限变量；无代码字段 |
| `VerificationAttempt` | source/spec/plan/lock/toolchain 绑定、repairRound、时间与状态 |
| `TestCaseResult` | criterionIds、实际步骤、passed/failed/not_run、失败分类与 evidenceIds |
| `VerificationEvidenceBinding` | 每项文件 sha/大小/类型、attemptId、source hash |
| `DeliveryAssessment` | complete/partial/blocked、覆盖明细、未满足要求、发布政策判定输入 |
| `SourceExportManifest` | 模板、源码、lock、脚本与工具链指纹，导出白名单 |
| `CleanBuildReport` | 干净安装/构建/浏览器实际结果、工具链、平台、日志和证据引用 |

这些对象的承载路由、manifest 报告入口、部分交付政策和历史兼容视图仍须在 M2 G0 一起冻结；不得各方向自行增加不同字段。

## 10. M2 门禁建议

1. 无模型独立测试证明 DSL 不接受任意代码/URL/路径/无限动作，源文件修改与断言篡改会使证据失效。
2. 便签六类行为全部由实际浏览器执行，计算器至少两种独立运算由同一解释器执行。
3. 未覆盖、未运行和失败分别可见，不能通过删除 criterion 或更改 required 取得 complete。
4. 有真实失败→有限模型修复→同计划复验的完整证据链，故障注入来源如实标记。
5. source.zip 在无平台软链的干净目录按 lockfile 安装、构建、加载和行为复验。
6. 三方独立测试及 API/Agent/Web 联调通过后，才更新交付状态与能力说明；M3 公网门禁仍独立。
