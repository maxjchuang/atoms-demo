# M2 可信交付实施状态

更新日期：2026-11-09。G0、三线独立验证、完整 Fake mixed/只读 UI、真实生成→修改→恢复后修改及 reviewed-exact 续跑的只读 UI/严格重启已有实际证据。**第三次代码任务经明确接受 exact 提案执行，原 mixed runner 的 auto 准入断言仍失败；三次真实交付均 partial；另一次独立受控故障已通过真实 DSH 失败→修复→同计划及 clean ZIP 复验。M2 App 尚未升级用户 live，主仓当前仅合入共享基线 `a1c7c23`；M3 三线设计已启动，G5 尚未开始。**职责见 [并行计划](m2-parallel-plan.md)，字段与政策见 [delivery 协议](protocol-delivery-v0.1.md)。

## 独立验证与完整 Fake 门禁

| 范围 | 证据与边界 |
| --- | --- |
| contracts | 主管独立 check、86/86：既有 80 + canonical Seed/derived 投影 6；不改旧 strict DTO/enum/parse |
| API | 主管独立 check/build 与 55/55：既有 46 + 投影/冻结 authority 6 + 预览缓存刷新 3；HTTP Fake 检查是 synthetic，不是实际浏览器证据 |
| Web | 主管独立 56 项；Mock/质量缺口/证据来源/安全呈现与旧流程回归。真实浏览器门禁另列 |
| Agent | 作者报告当前 71 项通过；主管此前完整 61 项与最新 18 项 focused 复验分开记录，不相加或称主管完整复跑 71 项 |
| 编排工具 | 主管独立 22/22：resume 11 + audit/process/readonly 11；不混算生产包测试 |
| 最新完整 Fake G3 | 主管 `ATOMS_KEEP_TEST_DATA=1 pnpm test:delivery --mixed-router --verify-web-readonly` exit 0，证据 `atoms-m2-delivery-Vd1rPn`；实际 API + Agent/Fake Model、真实编译/Browser DSL/clean ZIP、2 Router、只读 UI 和严格重启 |
| Fake 质量 | complete、complete、partial；Fake Router token 保留 null/unknown，不造 measured zero；真实模式仍要求已知用量且不超预算 |
| M3/G5 | OS/网络/资源隔离、Docker、双隧道、公网分享未开始；本机干净目录/受控 DSL 不等于操作系统沙箱 |

最新 Fake 目录：`/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-delivery-Vd1rPn`。四段均通过：生成与精确 ZIP/证据/签名预览；修改与 diff；不可变恢复后新冻结并修改、正确 base/parent；只读 UI 和严格重启前后 sealed/生成与协调额度不变。此前完整 Fake `101VCl` 与各停点 `m3GBFi`、`KOdLFa`、`5KSIbo`、`WoHHNH` 保留，不把早期停点改为成功。

API 独立回归覆盖唯一 Preparation、原目标与来源、immutable outbox、remaining=total-used、planning share authority、used 一次、取消/重启/丢回应、早失败与迟到报告、required failure 不能洗掉、hash/ZIP/输入错配阻断、owner 证据下载、有限 diff/绑定游标、旧数据不重跑。新 model_proposed+derived 在冻结前仅断言 shared parent 投影，不修正模型结果；已有 wrapper/report 与 host_profile 历史不重编译。

## 有界真实尝试与合法续跑

前三次真实尝试 `PMMN5g`、`epad1z`、`HaEXjt` 均停在首 Run Preparation，未进入 Worker、生成应用源码或发布版本；失败证据、已用额度和原报告保留。第四次与续跑共用原空间：

```text
/var/folders/xk/61y0rx650b1b6pf9wyc5p_tr0000gn/T/atoms-m2-delivery-ryZwrG
```

第四次原 runner（session 55204）先完成两个真实 Code Run、diff/证据/精确 ZIP 与预览、创建恢复 V3。恢复后 Router 输出合法 `explicit_request`、`exact_version` 提案，API 按既定政策保持 `proposed`；runner 期望 `run_queued` 的严格断言 exit 1。该历史失败未抹去，未把 exact 改成 latest 或放宽准入。

主管审阅提案 `proposal_91e10bb774cd2b59b217` revision 1 后批准显式接受。实际 baseline 为恢复 **V3** `version_86330d74e662946d74e9`，restoredFrom V1；模型 goal 中的 `v2` 是原 context alias，不改写历史文字或解释为实际显示 V2。受控 resume（session 41038）exit 0，最终 ledger 为 `resume-control/resume-acceptance.json`，kind=`reviewed_exact_accept_not_auto`。未重建前两个成功任务；本次空间总量仍为 3 Code Run、4 Version、2 Router Turn。

| 真实 Code Run | 发布版本 / 基线 | 质量与冻结覆盖 | 动态验证 |
| --- | --- | --- | --- |
| `run_3576e8b55490b4d6761e` | V1 `version_1e80ef9242bc941ab31e`，base=null | partial；1 canonical + 9 derived；7 auto leaf、2 manual leaf，原 Goal 父汇总 manual | attempt_0 passed，repairRound=0，7/7 cases；clean ZIP 同计划 7/7 |
| `run_91970bfc4d0882843eb9` | V2 `version_e494864c4b20e3dbcca9`，base=V1 | partial；1 canonical + 10 derived；8 auto leaf、2 manual leaf，父汇总 manual | attempt_0 passed，repairRound=0，8/8 cases；clean ZIP 同计划 8/8 |
| `run_e48a5937c3874a457955` | V4 `version_b7c360e659a778d45caa`，base/parent=恢复 V3 | partial；5 canonical + 10 derived；8 auto leaf、2 manual leaf；父投影 2 auto/3 manual，不能称 10 个独立自动用例 | attempt_0 passed，repairRound=0，8/8 cases；clean ZIP 同计划 8/8；Seed=explicit_proposal_acceptance |

三个 report 的真实 provenance 均为 model_output/dsh；Run.status=succeeded，phase 保留最后 publishing，不表示新执行。manual 涵盖源码多文件结构或中文说明/交互体验人工审查，canonical 父项仅为保守元数据汇总。三次均无 failed attempt、无 repairRound>0；这三个业务 Run 本身没有失败修复；新增独立受控修复证据见下节，不回写业务历史。

初次计划对新增、编辑、删除、搜索、拖拽、刷新文字/位置均有 required 自动 leaf。7/8/8 个用例实际通过只证明各自冻结步骤/断言；例如初版删除只测单便签，刷新用例未先编辑，fill 中文不等于输入法 composition 事件。不能把字符串覆盖、计划语法或静态代码审查扩大为全部自然语言语义已验证。

### 独立真实受控修复门禁

主管独立通过新增 3 项本地测试及 Agent check 后，提交 `678fce1`，只执行一次有界真实验证（session 31856，exit 0）。证据目录 `atoms-controlled-repair-8tSEg2`；Run=`run_controlled_446a4f19249e41aca2183a`，execution=`execution_controlled_a684df287f0244fb9b7893`。此工具不经过业务 API、不新增 Router 或发布 Version，原三个业务 Run/报告/源码保持不变。

原 V4 真实源码先通过原 8 cases / 70 steps / 15 required，随后宿主在独立副本注入 localStorage 写入失效；attempt_0 来源明确为 `controlled_regression`，真实浏览器捕获持久化失败。正常 DshAdapter 在 attempt_1 / repairRound=1 修复，来源为 `model_output/dsh`。冻结计划 hash=`da0bc554e5ab9d931b42523d4dd1c6208ac1dad3a087504673cc9786a80d8321`；步骤/断言/required 不变，最终 8/8 与独立精确 ZIP 的同计划 8/8 通过。它证明受控故障的真实修复能力，不宣称自然模型首次生成曾失败。

总用量：1 observable model step、9,931 有效输入、4,842 输出、102,861ms active，均在原单 Run 总预算内。初始源码载入和宿主计划不冒充模型生成或模型步骤。质量仍 partial，原 manual 缺口保留。reportHash=`3980ef07ed9f8ef554c7c1d0d6a62bf61313f1751a697b9849d2551cdbe5d6a3`，archiveHash=`b142d0c2aae25ee838e9d874ace4610db2dd45abae7e3cfd501116e68b92630d`。完整来源、护栏与命令见 [受控修复说明](../apps/agent/CONTROLLED-REPAIR.md)。Linux/OS 隔离与公网仍由 M3 单独验收。

### Router、原证据与最终重启

- 原 Turn `turn_74cb7ef8a53f7d3fb8bf` 保持 auto / completed / change_proposal / proposed / runId=null。显式接受另存 API confirmation，不回写原 Turn 为 auto success。
- 最后 Turn `turn_d5aa4a97656cee2c5373` 为 ask / completed / consult，引用 V4 的 delivery facts；真实 1 step、13,534 有效输入、978 输出，在原冻结预算内。未增加第四 Run 或第三 Turn。
- final ledger 验证原两个 Run、三 Version（除预览 URL cache）、110 个原证据文件及原失败 runner log 不变。records fingerprint=`ef36918fe34de00731a954bbadaa929ef5a28fb3e0b23bd7e716686fdb619a1f`，整体 fingerprint=`dc72d4733f6d3aeb6526d5f314115fbd8cf2f6e52d47d69ef8cc9682f4bb2e06`。这是 runner 实际前后字节核验结果；文档审查只读 ledger，不冒充再次执行。
- 真实只读 Web CLI 通过：仅登录可写，既有项目/报告/证据/diff/下载/预览读取不新增消息、Run 或模型；sealed 与两类 quota 前后相同。
- API+Runtime 严格重启通过：current=V4、latestRun=第三 Run、projectRevision=5、execution cursor=270、conversation cursor=105、conversationRevision=4、latestTurn=上述 consult/completed。版本、报告、游标、实体与额度前后相同，无 replay。

## 修复与失败记录

| 问题 | 处理与验收口径 |
| --- | --- |
| lockfile false positive | API 不再把合法 excludeLinksFromLockfile 键尾当 file:；真实本地协议/私有 registry 仍拒绝，正反例通过 |
| clean install 进入祖先 workspace | Agent 使用 --ignore-workspace --ignore-pnpmfile，不放松 lock/导出政策；portable targeted 曾独立通过，旧 blocked 结果不回写 |
| 模型细化的 auto/manual 冲突 | canonical Seed + derived leaves 纯 metadata 投影，保留原文/required/来源及双向引用；旧失败仍拒绝，新 proposal 才使用该格式 |
| API 冻结 authority | shared 投影 assert + 已有 FreezeDeliveryPlanRequest 全量核验；超 planning share 未超 total 亦阻断，不改预算/Schema |
| 预览凭证轮换 | key/origin 改变或近过期才重建 URL，普通 poll 稳定；旧 key 签名 403；版本/源字节/报告不变 |
| 首次 resume 备份门禁 | SQLite readOnly 查询仍触碰 SHM mtime，完整校验正确拒绝，未启动服务/accept/模型；不忽略 SHM/mtime 或回拨时间。预检改临时 0700 DB/WAL/SHM 副本读最新 WAL并清理，原 metadata/opaque bytes 稳定；重新完整备份后才续跑 |
| runner 的 Fake/生命周期修复 | nullable usage 保留 unknown；最后 ask 后取 sealed；区分 service/oneshot。历史失败与完整日志保留，不当作模型自然错误 |

## 预算、复跑与部署边界

代码 Run 的 Prepare+Worker/验证/修复/clean export 共用最多 8 observable steps、65,536 有效输入（含缓存）、24,576 输出、900,000 ms active time、修复 2 轮。最多 2 Router Turn，各 3 steps / 90,000ms / 32,768 输入 / 8,192 输出。阶段不重置预算，丢回应复用同 ID/幂等键，不新造任务；不承诺 provider 在途费用绝对硬限。

Fake 完整入口仍为 `ATOMS_KEEP_TEST_DATA=1 pnpm test:delivery --mixed-router --verify-web-readonly`；默认 direct 不行使 Router，省略只读 flag 仅称 Web HTTP ready。受控续跑、只读 receipt、三 guard、备份/私有凭证/实际限制见 [DELIVERY-RESUME](../tests/integration/DELIVERY-RESUME.md)。真实调用仅由主管显式授权；不能为了证明失败修复而自动追加 Code。

密钥仅传 Agent，不进 Web、fixture、生成应用或 ZIP。公开/内部协议、required/发布政策未改变。M2 App 和本次数据位于隔离 worktree/临时空间，未升级 live 5173 或改写 data/review-real。主仓当前仅有共享 `a1c7c23`；应用合并、live drain/停服/备份/升级待主管另行安排。M3 Docker/系统隔离/双隧道/外部分享未启动。
