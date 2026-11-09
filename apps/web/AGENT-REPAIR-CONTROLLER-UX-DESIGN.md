# Agent自主验证/修复闭环：Web边界冻结候选

日期：2026-11-10。仅设计，不改生产代码、共享合同或用户记录。已对齐主管候选 `docs/agent-repair-stability-plan.md`（当前candidate worktree中的文件）。后续由Root冻结producer语义/必要接口，再由各线实施。当前UI反例来自真实5180只读审计，不把临时成功游戏替代用户实际失败。

## 1. 已查实的问题与责任

真实项目 `project_7b367b9c6a994de9807e`：两Run、零Version。

- 前序 `run_8198609c590cd812d853`：候选尝试最后5/5通过，但独立源码ZIP复验case_4失败，期望dx20/dy0/tolerance4，实际dx29/dy174；Run失败、未发布。API公开报告中 `cleanBuild.caseResults` 已含完整expected/actual。
- 最新 `run_11dd8b7ad3d44426cd4e`：规划格式1项失败，零编码尝试。实际默认chat、badge和报告均绑定最新Run，明确“尚未进入编码/交付受阻/未发布”，未把前序5/5误标为最新成功。
- Web真实缺口：`Report`只渲染`attempts[].caseResults`，漏掉`cleanBuild.caseResults`；已有clean行为失败因而被generic `EXPORT_FAILED`遮住。报告对象下拉只含active/latest/queued，本项目只有最新Run，前序失败报告缺直接入口。
- 另一通用文案问题：`phasePresentation`对所有失败都说“上一成功版本会继续保留”，空项目零Version时并无上一成功版。应使用现有workspace.currentVersion事实区分，不新增wire。

证据保留在本机临时 `atoms-current-failure-ui-BzWDz5/{actual-api-failures.json,ui-review.json,01-default-latest-failure.png,02-latest-planning-report.png}`。只登录+GET/界面切换，public计数不变，禁止业务写0、pageerror0、无模型。先前03截图点击到的是最新已接受任务，不冒称已打开前序报告；前序事实以其明确Run ID的API报告为准。

闭环为什么终止、如何分类与继续属于AgentRepairController；准入/预算/发布属于API。Web不能通过新文字把未修复的流程改成成功，也不解析裸日志替代这两方。

## 2. 首批必需实施：优先用现有DTO，不前置大新协议

| 用户要知道 | 现有可信来源 | Web实施边界 |
| --- | --- | --- |
| 本轮在做什么目标 | DeliveryReport.seed.goal、冻结bundle/spec/plan；requirements authority | 目标/Run归属可见，hash展开；不将最新消息当整轮目标 |
| 规划/生成/修复/发布阶段 | Run.status/phase、project events；DeliveryReadView.pending.phase | 直接展示实际阶段；`clean_export`才称独立源码ZIP复验，旧verifying不足以再细分时说明未提供 |
| 候选验证情况 | attempts[].checks/caseResults/repairRound、source hashes | 明确“候选尝试 N：5/5冻结自动用例通过”，不称全部需求或应用交付成功 |
| 独立复验情况 | report.cleanBuild.stages/caseResults/source/archive/plan绑定 | 单独分区逐例显示安装/类型/构建/smoke与行为结果，不能用四个基础绿灯掩盖case失败 |
| 失败是什么 | typed GateResult/CaseResult.failure与DeliveryFailure/Run.error | 由实际数据区分规划未编码、候选行为失败、独立行为失败、安装/工具链/完整性等；不从stderr关键词猜 |
| 实际下一步 | 已提交phase.changed、host生成的既有message.completed/updated、已有Attention | 只展示已经报告的决定，不因看到失败就声称Agent必将自动修复 |
| 已记录修复轮次 | VerificationAttempt.repairRound（非attempt数组长度） | 标“报告已记录修复轮次”；若当前轮尚未产生报告则明确未知，不把进入repairing次数当真实轮次 |
| 剩余资源 | 目前活动Run/报告无完整实时预算；预算恢复diagnosis只对其定义范围有效 | 明示“剩余Token/步骤/时长/轮次尚未提供”，不计算2-N、不将unknown当0/最终账单 |
| 能否交付 | DeliveryReadView.apiVerification/quality/publication + Version发布事实 | 三条独立轴，只有实际published才切预览；partial/manual/unsupported缺口继续显著可见 |
| 为什么停止/需要人 | 终态error、报告failure/gaps、Attention、budget recovery reason | 已知原因直接展示，不足则“未提供细分原因”；不新造审批或自动追加额度 |

现有DTO没有`DeliveryReport.phase`、controller decision对象或实时remaining budget。实现不得写这些假字段。Run.phase=verifying也不能自行宣称在workspace或clean哪一侧。

## 3. 用户可读的循环呈现

默认活动摘要分四行：本轮目标与任务归属；实际阶段；最近失败与证据来源；执行器已报告的下一步/实际停止原因。底下展开每次尝试与独立复验，保留旧失败及新成功的准确source/plan/attempt身份。

示例（仅在真实事件/报告提供时）：

> 候选尝试1：5/5自动用例通过；尚未交付。
> 独立ZIP复验：移动用例失败，实际位移与冻结期望不符。
> 执行器已进入第N修复轮，正在依据该失败证据改源码；剩余预算未提供。
> 修复后将重新执行候选验证与独立复验——只有执行器已经明确报告该决定才展示此句。

若控制器实际停止，末行改为准确停止原因，不能继续显示“即将自动修复”。如果只有phase=repairing而没有新report，称“已进入修复阶段；当前具体轮次未提供”。规划失败且attempts为空，直接说明“计划尚未通过，未编码”，不出现5/5或假源码。

不新增默认“批准每轮修复”弹窗；同授权/冻结计划与预算内自动执行。涉及改目标/required/断言或不可复用计划时，保留PLAN_REVIEW_REQUIRED与typed完整需求review/accept，不得把修改标准包装成修复代码。预算续作沿现有独立协议，真实eligible且用户明确换额才创建successor；不自动多买Token或复活旧Run。

## 4. 两处真实缺口的最小落地

1. **独立复验详情**：在现有Report新增`cleanBuild`只读分区。逐阶段、逐case显示状态、case名称（由同冻结plan映射）、失败step/expected/actual/reason及受权证据。基础检查与行为分别计数。5/5候选passed+1项clean required failed必须清晰blocked/未发布；不能只显示“打包失败”。无Version的失败Run也能读这块，不依赖ExportCard。
2. **历史报告入口**：使用已加载project event历史的`run.updated`与workspace Run做同project去重，保留最高revision；或从已有消息/提案Run引用读取原GET /runs/:id。加入只读任务选择与“查看此任务报告”，选定Run后左活动/右报告标清各自对象，默认最新不等于前序。现有数据足够时不新增列表协议；完整历史还在加载/不可读必须显式标注，不装成只存在一条。
3. **空预览文案**：只在实际currentVersion存在时说“保留上一成功版”，否则“本次未发布，当前没有可预览版本”。不伪造成功Version。

证据仍按既有ReportBinding/attempt/source/spec/plan/bytes/hash校验，日志文本安全转义、截图安全MIME。失败actual中的不可信JSON仅作文本，不执行/解析成控制命令，不给宿主路径/密钥/原生推理入口。

## 5. 统一RepairController的最小跨线约定

第一版优先冻**现有producer语义**，不强制大新DTO：

- Agent通过现有phase事件发布真实转移，通过现有受控message事件提供host编排的简短进展说明。不能透传原始工具日志/SDK私有推理或让模型自由文案代替真实状态。Web仅把它当“执行说明”，不解析字符串生成状态/权限/数字。
- 每次实际尝试/clean复验更新已有不可变报告及证据；旧失败仍可定位。clean required失败若还有合法修复决策，应真实回repairing并产新尝试；若停，输出准确failure。Web不能从报告自己触发修复。
- API持久投影并保持project/run/seq、幂等、重启与发布fence。内部Controller实现不进入Web依赖，DSH turn结束不等于验证/发布。

若第一版必须有可机器读取的“失败类别/已选择下一步/当前轮/资源余量/停止原因”独立卡片，才由Root协调最小新增公共投影G0。消费要求是语义而非本文件自定义wire：绑定project/run/源与冻结目标ref、独立revision/asOf；实际阶段/最近分类失败和证据ref；已决定动作及决定时间；真实repair/model-step计量与原预算上限、known/observed-lower-bound/settled-unknown区别；停止/需确认的真实原因。字段缺失应允许明确未提供，不能靠Web推测补齐。

该投影应由API对Controller事实归一化，不让Web读内部状态、裸日志或任意URL。优先附属现有读取/事件，不先造新队列/账户/工作流编辑器；若新增独立游标，不混入旧严格enum，必须共享Schema/fixtures/tests先冻结。未冻前Web只能按上表显示已存在数据或未知。

## 6. 刷新、竞态和用户控制

- 原子workspace/双游标机制保留；project/run/seq去重，410/gap重拉快照；phase是实际状态，不是前端估算进度条。
- report/evidence按subject+binding+revision加载，晚到旧尝试/旧项目结果丢弃；切到前序报告不改变最新Run或预览。历史5/5不可覆盖最新规划失败。
- 取消仍先cancelling，停止确认前不显示已停止/释放安全锁；取消期间不向UI承诺新的自动修复已获执行权。
- 刷新不创建消息/Run/额外修复。网络断开只表示观察中断，不当成任务停止；后台继续与已停止都以恢复读取为准。
- budget事件仍按已冻typed diagnosis/recovery，observed bound与settled未知分开，费用/预占/结算API权威。PLAN_REVIEW_REQUIRED无付额按钮，不将其他失败变成Token可修。

## 7. 冻结后的通用验证矩阵

| 场景 | Web+Mock及root真实HTTP必须观察 |
| --- | --- |
| 冻结前格式/状态语义失败→合法纠正 | 规划阶段的真实反馈/下一步，没编码时不造attempt，次数缺失不猜 |
| 候选类型/构建/required行为失败→两轮修复 | 每轮source/plan/结果关联，旧失败保留，只有已报告决定才显示自动修复 |
| 候选5/5通过→clean行为失败→修复→双侧通过 | 两套结果分区、failed step/expected/actual显著，最后实际发布才成功 |
| 动画瞬态/观测不足 | 不把瞬间匹配当稳定通过；具体证据/限制可见，不靠UI猜定性 |
| 安装/网络/工具链/hash失败 | 显示实际基础设施或完整性失败，不笼统称应用行为错或诱导反复改代码 |
| 连续失败/无源码进展 | 只展示控制器的实际诊断/决定/停止，源码相同本身不由前端判空转 |
| 预算/无效计划/取消/中断 | typed原因、unknown计量、无自动加额度，停止确认/恢复语义准确 |
| 刷新/重复/迟到/切项目/选择历史 | 状态和报告对象不串，零自动业务写，最新planning失败和前序clean失败可分别读 |
| 当前真实用户反例 | 原两Run/0Version不变，前序候选5/5仍不能称交付；clean case4可见，最新零编码清楚 |

普通独立测试仅Fake/Mock，无模型和用户源码运行；生产build不得回退Mock。root跨线验证使用统一故障矩阵，不把单个游戏或临时手工成功样例升级为通用稳定性。正文14px/元信息12px、失败原因和下一步是主内容，hash/平台细节展开，不靠缩字或裸日志堆满界面。

本阶段只完成现状审计与设计。等待Root冻结首批现有DTO语义/是否需要小投影后，再在apps/web实施上述必要展示，不改用户数据/额度/报告。
