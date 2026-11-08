# M2 Web 可信交付体验设计（候选，未实施）

日期：2026-11-08。范围：下一阶段三方协议讨论与独立验收设计，**不是已经实现的 UI、接口或验收证据**。本文不修改 Web 实现、共享 Schema、M1 行为或旧版本数据，不调用模型。

参考 [能力路线图](capability-roadmap.md)、Agent 候选 `docs/m2-agent-delivery-design.md` 与 API 候选 `docs/m2-api-delivery-design.md`。候选分别由三条工作线维护，最终以主管组织的 M2 G0 冻结为准。

## 1. 固定发布政策与产品目标

用户需要知道“本次具体改了什么、哪些需求被实际验证、仍缺什么、下载后能否独立运行”，而不是只看到 Run 成功或模型宣称完成。

M2 固定政策：

| 质量分类 | 用户看到的含义 | API 发布规则与 Web 行为 |
| --- | --- | --- |
| `complete` | 本次约定的必需验收与交付硬门禁已满足，未隐藏待验项 | API 按 publication fence 自动发布；Web 不扩大为“所有可能行为都正确” |
| `partial` | 基础检查与干净导出通过，但存在 manual / unsupported / not_run 等具体缺口 | 无 required 自动行为失败时可由 API 自动发布；Web 默认醒目标注每项缺口 |
| `blocked` | required 自动行为失败，或基础检查、源码/证据/hash/导出硬门禁失败 | 不换当前成功版本，展示失败报告与真实修复证据；没有绕过按钮 |
| `legacy / unverified` | 旧版本缺 M2 声明覆盖或干净导出报告 | 保留原访问和原记录，不补造历史 complete 或新验收结果 |

**不增加默认“接受部分交付”按钮，不新增 host-owned Attention，不把 partial 送回 answers 等人确认。** 用户可直接体验已经发布的 partial 应用，再按明确需求继续改进；低打扰 auto 策略保留。

required 的 manual/unsupported/not_run 仍保留“必需”，不能通过改成可选来隐藏。已知 required 自动失败在同一冻结计划成功复验前始终阻塞，不能改成 not_run/unsupported 洗掉失败。

## 2. 生命周期与质量是两条轴

现有 v1 Run 状态机保留。Run.succeeded 表示 API 发布事务完成，**不等于质量必然 complete**；已自动发布的 partial 同样可以有 succeeded 的执行终态。

```text
Run running/verifying/repairing
  -> API 校验报告和候选，running/publishing
     -> complete 或符合政策的 partial：原子发布 Version，Run succeeded
     -> blocked：Run failed，保留之前成功预览，失败报告仍可读取
```

Web 的质量以 API 独立 Delivery 视图为权威，不从绿色 Run 状态、模型消息、截图数量或 Check 数量推断。

报告尚在读取时显示“正在读取交付报告”，不显示虚构的 0/0 或 complete。报告读取失败显示“报告暂不可读，仅展示已知版本”，不能把网络错误当 legacy，也不能自行回滚/修改 API 的版本指针。

## 3. 工作区信息架构

### 3.1 默认可见的交付摘要

在右侧预览上方与当前版本卡片中展示同一份质量摘要：

- complete：“本次约定的必需验收已通过”，附已验证项数和报告入口。
- partial：“部分交付 · 2 项待验收”，默认列出主要具体缺口，例如“刷新保存已验证；拖拽需人工验收；第三方登录当前不支持”。
- blocked：“本次未交付 · 搜索行为未通过”，同时明确“当前预览仍为 V3”。
- legacy：“历史版本 · 新声明行为与导出复验未记录”。

partial 的颜色、标题与缺口不能只藏在折叠详情或 tooltip 中。不要把 manual、unsupported、not_run 笼统写成“可能有问题”，也不要把未覆盖写成测试失败。

默认摘要提供“查看具体缺口 / 查看本次改动 / 查看交付报告 / 下载源码”等明确入口；不新增要求用户接收 partial 的审批流。

### 3.2 详情分区

复用现有预览、代码、版本与构建活动，增加明确的“改动”和“交付报告”视图，而不是重做一套聊天页面：

| 视图 | 主内容 |
| --- | --- |
| 预览 | 仅 API 已发布版本；显著质量标记、必要缺口与版本归属 |
| 改动 | 与明确基线版本比较的安全 diff，文件增删改及截断提示 |
| 交付报告 | 验收约定、覆盖、实际结果、缺口、尝试/修复链和导出复验 |
| 构建活动 | 实际过程与阶段；关联报告，不以消息替代验证证据 |
| 版本 | 每版质量、父版本、恢复来源、报告与源码入口 |

M1 项目问答与 Run 继续独立。问“完成了吗”时应引用 API 当前 delivery 事实，不能仅因旧 Run.succeeded 回答“所有功能完成”。所需 Router facts 承载方式在 M2 G0 明确，不能给现有 strict coordination DTO 偷塞字段。

## 4. 版本 diff

### 4.1 比较对象明确

默认比较 head 与其 parent；无 parent 与空源码快照比较。显示“V4 相对 V3”，恢复版本标记其恢复来源，避免把恢复后再修改与另一个未选版本混在一起。

API 对 base/head 做同项目归属校验，返回实际 source 清单和有界差异；Web 不接收宿主机路径、任意 Git ref 或模型提供的 URL。

首轮版本 diff 以已发布不可变 Version 为对象。blocked 候选没有公开 Version，不能为显示差异伪造新版本。失败候选若提供受控 source/patch 摘要，需在 G0 定义明确 Run/attempt 读取协议；未提供时诚实显示“本次候选差异未提供”，仍可查看绑定的失败证据。

### 4.2 可读与安全

- 文件列表区分 added / modified / deleted；显示真实行增删数，二进制只显示摘要。
- 默认统一 diff，可切换整文件只读查看；源码、HTML、SVG、日志均作为文本安全转义，工作台不执行。
- 每个文件/hunk 的截断、超限和未支持格式必须显著标注，不能把被截掉的内容当“无差异”。
- diff 分页游标绑定固定 base/head/hash；换版本时丢弃旧请求响应，不拼接两次比较结果。
- 长行在代码面板内部横向滚动，不能撑破整页；保留正文 14px、元信息 12px、代码约 13px 的现有尺度。
- diff 事实来自 API 实际字节与清单；模型的变更说明可作为说明文字，不能代替 diff 或完整性验证。

## 5. 验收覆盖与实际结果

逐 criterion 展示：

| 列 | 内容 |
| --- | --- |
| 验收项 | 描述、必需/可选、需求/提案来源 |
| 覆盖方式 | automated / manual / unsupported；已有映射但未运行要单独说明 |
| 本轮结果 | passed / failed / not_run / skipped / interrupted 等真实状态 |
| 缺口原因 | 需人工判断、解释器暂不支持、上游失败、预算/取消未运行等 |
| 证据 | 对应 case、attempt、日志、截图和计划绑定 |

coverage 与 result 不混用。Agent 候选中 `not_run` 的具体承载字段由 G0 统一；UI 必须区分“支持但本轮没运行”和“当前无法验证”。

计数文字应有明确分母，例如“6 项声明行为：自动验证 4 项通过、1 项需人工、1 项尚未运行”。不能以 typecheck/build/smoke 三项冒充六类需求全部通过，也不以假百分比承诺剩余时间。

验收约定和测试计划在 Worker 写入前冻结，报告中可展开核对 spec revision/hash、plan hash、确认依据和预算。普通 auto 明确需求不因此增加统一人工确认步骤；“宿主冻结”不等于每次要求用户再点击一次。

修复期间验收约定只读。用户确实要改目标/required/断言，应通过 M1 的新授权需求形成新 revision/任务，不提供“改测试让它通过”的原地编辑或一键豁免。

## 6. 失败、有限修复与证据

按实际 attempt 顺序展示：

```text
尝试 1：源码 A / 计划 T -> 刷新保存失败 -> 失败步骤与截图
修复 1：应用源码 A -> B，测试计划仍 T
尝试 2：源码 B / 计划 T -> 相关 case 实际通过
最终候选：源码 B，与已发布版本和导出记录一致
```

每次尝试显示 started/finished、repairRound、case 结果和来源标记。详情提供失败步骤、expected/actual、安全日志与截图；hash/工具链等审计数据可展开，不让用户在主流程阅读长串内部 ID。

必须明确：

- 旧失败截图属于尝试 A，不能让用户误以为它是当前通过版 B。
- 自然产生的缺陷、`controlled_regression` 与合成 fixture 分别标记；受控故障不能包装成模型自然犯错。
- 同计划复验、源码前后 hash 一致才有对应证据资格；无效/错版证据显示异常，不能显示已通过。
- 预算耗尽且 required 自动失败未消除时为 blocked；不提供增加预算或强行发布的默认按钮。
- blocked 报告独立于成功 artifact 可读取，避免“没有新 Version 就无法看到为什么失败”。

证据入口由 API 授权和生成，不能使用模型 URL。日志按文本，截图只接受安全 MIME；trace 作为下载，不在工作台执行任意内容。证据缺失或无法验证时显示具体异常，不补造图片或给旧报告补上通过。

## 7. 自动 partial 发布体验

固定发布政策需要低打扰而诚实：

1. 基础硬门禁、干净导出和证据绑定通过，且没有 required 自动失败。
2. 若仍存在 manual/unsupported/not_run，API 自动发布 partial。
3. Web 切换到新的已发布版本，同时明显显示缺口；Run 可 succeeded，质量仍 partial。
4. 用户可继续体验、查看证据、用自然语言提出下一步改进；不弹出“接受部分交付”或 host-owned Attention。

这不是降低 required，也不是模型选择是否发布。自动发布仅由固定 policy revision 与实际结果决定。任何“已知自动失败改标未运行”均不能绕过 blocked。

如后续需要人工验收记录，必须绑定人员、spec revision、source hash 和实际结论，作为独立冻结范围；本轮不把它作为默认交付等待条件。

## 8. 源码下载与可复现要求

下载卡应说明“下载的是哪个版本、包含什么、在哪个平台实际复验、还有哪些未验收项”。

新交付的源码至少包含受信 package.json、生成应用自己的 pnpm-lock.yaml、packageManager、必要源码/配置与运行说明；不能复制平台根 lockfile、node_modules、DSH home、内部 registry、认证地址或服务凭证。

Web 读取 API 的 ExportManifest / CleanBuildReport：

- 当前导出 archive/source/lock/toolchain 与报告一致。
- 已从实际 ZIP 解包到干净目录，未软链平台依赖，执行 frozen-lockfile 安装、类型、构建及声明浏览器复验。
- 显示实际 Node/pnpm/OS/arch 与时间；只验证 macOS 不宣称 Linux/Windows 通过。
- 展示基础硬门禁和行为覆盖各自结果，不因干净 build 成功掩盖功能未验收。

“可复现”首轮是固定依赖和已声明平台上的干净安装/构建/功能复验，不承诺跨平台二进制字节完全一致，也不等于 M3 OS 沙箱。

下载本身只读，不调用模型、不创建 Run、不要求接收 partial。脚本来自受信模板，UI 的运行命令说明由宿主固定，不展示模型拼装的任意 shell 作为推荐执行步骤。

旧版本仍可保留“历史源码下载 · 未有 lock/干净复验证据”的明确入口。若后续为旧版本追加导出复验，应创建独立 ExportSnapshot 并说明来源；不能回写旧 manifest 或让新证据冒充当时已存在。

## 9. Web 所需的候选读取对象

以下仅是 G0 消费要求，不是现有 Schema 或已实现端点。保留原 v1 execution 与 v0.2 coordination 严格兼容，新增独立 delivery 模块；实际版本/header/路由由三方冻结。

| 对象 | Web 必需信息 |
| --- | --- |
| DeliveryReadView | Run/Version/assessment 归属、质量分类、publication 状态、policy revision、具体缺口、报告/导出引用 |
| AcceptanceSpec | criterion ID、描述、required、来源与确认依据、spec revision/hash |
| CriterionResultView | coverage、实际结果、原因、case/attempt/evidence 引用；不可隐藏 required |
| VersionDiffPage | base/head 及 source hashes、增删改文件、text/binary、有界 hunks、截断原因、固定游标 |
| VerificationAttempt | source/spec/plan/lock/toolchain/dist 绑定、repairRound、时间、结果与来源分类 |
| EvidenceDescriptor | attempt/source 归属、类型、大小/hash、安全读取能力；模型不提供任意链接 |
| SourceExportManifest | 文件/lock/模板/脚本指纹、archive hash、工具链与 requirements |
| CleanBuildReport | 干净安装/构建/浏览器复验实际状态、平台与证据 |

API 候选中的版本 diff、Run/Version delivery、attempt/evidence 和 export 读取可作为边界。failed Run 的报告必须可单独读取；legacy 由 API 明确投影，不把任意 404/网络故障猜成旧版。

已有 v1 events/Version 不加入新的 strict 字段或 variant。Web 在选中版本或发布后读取独立 delivery 视图，异步结果必须绑定当前 run/version/source，避免晚到的 V3 报告覆盖 V4。若增加流式报告更新，使用独立明确游标，不混用既有执行/协调游标。

## 10. 独立 Mock 验收矩阵

Web 使用 delivery Mock API，不需要模型 Key、真实 Agent 或本机现有服务。Mock 是协议模拟，不能代替真实 DSL 执行、修复和干净导出的服务证据。

| 用例 | 必须观察到 | 禁止结果 |
| --- | --- | --- |
| added/modified/deleted 与恢复后改动 | 基线/父版本、文件状态和实际 hunk 对应 | 把恢复来源当当前父版、漏掉删除 |
| HTML/SVG/脚本/超长行/二进制 | 文本转义、二进制摘要、内部滚动 | 工作台执行源码、页面横溢出 |
| diff 截断/分页/切版本 | 截断原因可见，丢弃旧比较响应 | 把截断当无变化，拼错 base/head |
| complete | 本次约定及导出硬门禁有实际通过记录 | Run succeeded 自动等于所有行为正确 |
| required manual/unsupported/not_run | 自动发布 partial，新预览可用，逐项缺口显著 | 增加默认接收按钮或 Attention、把 required 改 optional |
| required 自动失败 | blocked，保留旧预览，失败报告可读 | 允许强行发布或以 not_run 洗白 |
| 失败后有限修复/同计划复验 | A/T 失败、B/T 通过、来源与预算准确 | 修改计划冒充修复、复用错版截图 |
| controlled_regression | 标明受控回归及补丁/证据 | 声称模型自然犯错 |
| 验证期间源码变化/hash 错配 | 证据异常与 blocked 解释 | 旧通过结果发布新源码 |
| 导出缺 lock / 干净安装失败 | 导出硬门禁失败阻塞；不显示已验证下载 | 只因 ZIP 有文件宣称可复现 |
| 下载操作 | 正确归属与版本，不创建 Run/模型调用 | 泄露凭证、下载另一版、下载即执行 |
| legacy 旧版本 | 原基本记录保留，新报告缺失明确 | 补造历史 complete 或改写旧 manifest |
| 报告不可达/证据丢失 | 具体读取/一致性异常，未知不标通过 | 网络错误自动当 legacy，凭截图数量推断通过 |
| 取消/发布竞争与重启 | 显示 API 裁决，仅一次发布，旧数据可恢复 | 前端自行切版本或重复创建交付 |
| 异步切任务/版本 | 报告与源版本严格关联，旧响应丢弃 | V3 证据显示为 V4 通过 |
| 两种桌面尺寸 | 14px 正文、12px 元信息、控件可达、代码内部滚动 | 为塞入报告缩回 8–10px 或整体 zoom |

## 11. 门禁和明确不做的内容

先冻结三方 delivery 对象、报告承载、发布 policy 和 fixture，再分别做 Web+Mock、API+Fake Delivery Runtime、Agent+Fake Model。Web 的场景成功不替代真实便签六类声明行为、计算器复用 DSL、失败修复链、干净 ZIP 复验或完整 G4 恢复后第三次修改。

M2 真实模型验证由主管依据已有授权统一、有界安排，本候选不触发调用或反复要求用户逐次确认。每个结果记录实际范围与来源，不把分段验证写成一次全量通过。

本阶段不实现 M3 Docker/网络隔离、公网域名、Cloudflare 隧道、支付/后端/任意工具或完整 Atoms。主管已探测到 Docker daemon 可用、cloudflared 暂未安装，仅是后续环境信息，不作为本 Web 设计的公网验收证据。
