# 自主验证修复闭环：独立验收记录

状态：本轮本机交付完成。阶段结果与最终结果分开记录；用户原失败任务未改写，自动覆盖与人工抽验边界见下文。

## 已审查的边界

- 同冻结Plan代码修复与冻结前规划纠正分开；冻结后换Plan仍需新的授权。
- 复用现有strict DTO；控制器与原native账同一次原子持久化，API独占发布/额度/项目锁。
- 基础设施本轮不自动重试；重启stop/reconcile后interrupted，不盲目重放模型。
- 无进展、来源/绑定异常、预算与取消均是明确停止路径，不靠反复验证碰运气。

## 实施阶段证据（最终结果见后文）

### Web

主管在独立`atoms-demo-repair-integration`工作树集成`dc9828e → e7fdb3f`，旧5180源工作树保持生产代码不动。独立88/88单测、check、build通过；5194端口重跑delivery29、feedback2及新repair-controller5，共36/36浏览器场景（1.2m）。1440/390截图已目视，均为Mock消费者验证，不能当作执行器或模型质量证明。

覆盖：前序独立复验失败与最新规划失败分别读取；nonfinal clean失败→修复→实际Version发布的状态呈现；旧报告/跨项目迟到响应隔离；历史证据的授权/hash读取；合法not_run与未返回数量区别；长目标默认摘要并可展开。无新公共DTO，不推算未知剩余预算。

### Agent阶段记录

作者关键真实host组4/4通过（111.62s）：工作目录pass→受控浏览器locale导致clean行为真实失败→同Run源码repair→新工作目录及新exactZIP clean均pass并正常candidate；repairLimit0停止；同源码repair无进展停止；Chromium不可启动按基础设施停止、不追加Worker。

作者另外实际compiler ENOENT及clean install ENOENT两入口2/2通过，均不进行代码repair。所有测试均Provider=0；Fake/受控环境故障不冒充真实模型自然犯错。

第一轮完整串行147项，146过/1失败（481.27s），失败是旧诊断fixture的100ms baseline预算小于新的连续稳定观测要求，未到原负例断言。保留该失败记录；修正authored fixture及生产观测预算不足分类后，须记录最终回归。不能修改用户FrozenPlan或让不可完成的观测消耗代码修复次数。

### API

作者报告首批真实HTTP8/8：nonfinal clean失败保持writer/一次额度，源码/ZIP实际变更后发布，旧sealed尝试与证据不可洗；取消/迟到/重启不重复消费；规划终态usage包含null原样保留。最终完整测试与主管独立验收待追加。

## 交付门禁（已由后文最终结果闭合）

1. Agent最终源码与完整回归、主管独立执行相关故障矩阵。
2. API最终完整回归与主管独立验证。
3. 真实API↔Agent HTTP闭环，保留每轮ZIP/报告/证据并正常发布，确认原Run一次额度。
4. 单独限定次数、原预算、独立临时数据的真实DSH完整用户需求验证；不耗用户原项目额度，不改其终态报告。
5. 运行中的用户服务排空后停服完整备份，保持原绝对dataDir和密钥，升级后逐项核对历史和真实UI，最后提交推送。

## 最终本机交付结果

本轮已完成本机闭环重构、分线/独立验收和服务升级。它不是对用户旧任务结果的改写，也不是任意自然语言应用质量的保证。

### 最终代码与回归

- Agent：最终冻结源码完整串行 **161/161**（529.89s）通过。此前160/161唯一失败是旧观察反馈要求的smoke启动文案前缀，恢复兼容文案后原runtime6/6与最终完整161均通过，未放宽原断言。更早151/151属于诊断DAG之前的候选，不能冒充最终版本结果。
- 主管新测量边界/旧Plan拒绝/诊断DAG/控制器定向 **14/14**（43.86s）、全仓`pnpm check`及Agent build通过。类型错误与行为错误被同轮真实反馈收集，修复一次后必须重新通过类型、当前源码构建、浏览器和精确ZIP；类型失败即使行为通过也仍受阻。全新构建失败不得使用旧dist，取消/基础设施/未知故障不继续依赖阶段。
- API：主管最终默认完整 **105/105**、check/build通过。涵盖同Run保锁/一次额度、非终态mixed诊断、旧sealed尝试/证据不可洗、clean/export/archive身份跨null间隙及重启不可改写；新轮次新身份才可发布。规划终态用量保留null，不回填旧历史。
- Web：主管 **88/88**单测、check/build和 **36/36**相关浏览器场景通过；1440/390截图目视通过。这些是Mock消费者门禁，不冒充模型产物。显示实际候选和clean结果、可查看历史Run、拒绝迟到跨对象响应，未知预算不推算。

### 实际API↔Agent HTTP闭环

独立154xx临时数据，Fake Provider+真实主机编译/浏览器/精确ZIP：`run_f263cf4af55103b3bfcb`最终发布`version_41d9ff2194e44a284cdc`。工作目录通过后，受控clean浏览器locale导致真实文本断言失败；同一原冻结Plan和原额度继续修复真实源码，重新工作目录及新ZIP复验均通过。两个源码尝试、两个clean轮次、30份证据全部字节/sha校验；旧轮ZIP/报告保留，三类round ID不同，原任务一次used、reserved0。Provider=0，非自然模型错误声明。

管理审计脚本曾误将普通Run的会话内幂等缓存当作跨新Session缓存，重启后新登录并POST复用key，另建了一条合成任务（后已完成）。这是管理脚本错误，未改产品语义，未使用用户数据/模型；额外合成历史和错误证据原样保留。纠正后的审计逐值核对原Run/report及原execution完整ledger重新序列化SHA，确认重启没有重放原执行。不得将此说成普通Run支持跨Session去重；预算续作的跨Session单后继是另一个已冻结协议。

### 同用户完整需求的真实DSH验证

第一次独立真实测试`run_2a4e45fbf94153aa2d39`失败记录完整保留：自动执行两次实际修复，类型错修好、行为由0到3/4，但测量在idle保存baseline后又Start随机重生实体，且有重力干扰。原反馈并未丢失：根据原源码和受信模板重构的两次修复prompt与hash收据匹配。由此补的是通用单effect/前置测量边界和安全诊断DAG，未给俄罗斯方块写特判或手改生成源码。

最终独立真实任务`run_3939fce9e99ab5530c68`，项目`project_b5153dafb20e903e77e5`，发布`version_e5ea67fff3f26bd04602`。与失败测试370字完整prompt逐字相同，总预算完全相同：输入65536、输出24576、模型步8、修复2、有效900000ms；未自动追加额度。一次真实DSH生成，经全部基础检查、2项冻结自动用例及精确ZIP独立复验正常发布，sourceProvenance为DSH。总实测2步、输入6287、输出10127、有效69053ms；扫描Git跟踪内容及实际导出ZIP，配置模型Key匹配0。

**自动覆盖边界**：2项用例实际观察的是初始可见控件和开启后的状态断言，不足以证明完整玩法或开关两个方向；不能从模型的用例名称推导未执行功能。原需求全部保留为required，报告仍是partial，主要玩法保留manual缺口，未伪造全自动验收。

独立真实浏览器核心抽样 **17/17**：真实200cell/20行、四格active实际绘制而非代理overlay；左右/旋转/软降/硬降锁定与生成；暂停1.7秒冻结后恢复；AI16秒持续堆叠，并观察4次真实消行及计分至401；关闭AI保留棋盘与分数，手动接管，重开清空；关闭AI后真实硬降堆叠触发gameover，终态棋盘冻结并禁用AI，重新开始恢复。业务写0、页面错误0、前后额度相同。主管目视真实AI堆叠截图。该随机样例未穷举七形态/墙踢/二级加速、暂停中手动输入或AI开启时自然终局，原partial/manual报告不改写。

私有证据保存在主管临时`controller-diagnostics-real-proof`与`atoms-real-quality-JoSevf/proof/controller-diagnostics-independent`，不提交原生推理、Cookie、体验码或模型Key。154xx/156xx测试服务均已停止，数据和失败记录保留。

### 本机服务与历史保护

- 确认原服务activeRuns=0/activeTurns=0后停服，完整备份 **2612个文件**，源/复制件hash、大小、权限一致。备份：原集成工作树`data/backups/local-preacceptance-pre-repair-stability-20261109T113936`。
- 从`atoms-demo-repair-integration`启动新版5180/3101/3102/4200，沿用原绝对`atoms-demo-v02-integration/data/local-preacceptance`和原secrets/体验码。登录前旧codes、sessions、projects、runs、versions、messages、events、sourceEvents、idempotency、coordination十集合逐值完全相等。仍2项目、3失败Run、0Version、111消息；原5173 M2 HTTP200，未更改。
- 实际API登录后再逐值核对3历史Run DTO与原report完全相同，used3/reserved0；原报告hash分别34f8a88e…4e4ed、73567b6e…45223a、80278349…2ed07。未重放旧任务、导入测试成功版本或消耗用户构建额度。
- 真实5180只读UI验收通过：最新任务明确规划失败/未编码，前序历史报告可选且完整显示候选5/5与clean失败dx20/dy0/tolerance4对实际dx29/dy174；选择历史不替换最新任务或预览。0Version时不再声称保留上版，仍剩7次构建。workspace revision/cursors/message/Version IDs和额度前后不变，仅登录写请求，业务写0、模型0、页面错误0，浏览器已关闭。

新版仅用于当前本机验收，不宣称Intel/Linux/Docker或Cloudflare已验证。旧任务保持真实终态；新构建才进入新版流程。
