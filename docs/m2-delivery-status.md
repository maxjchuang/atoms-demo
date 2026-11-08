# M2 可信交付实施状态

更新日期：2026-11-08。G0 协议/Schema 已冻结；本页仅记录实现与已执行证据，不将合成 fixture 当实际浏览器或模型结果。职责与门禁见 [并行计划](m2-parallel-plan.md)，协议见 [delivery v0.1](protocol-delivery-v0.1.md)。

| 范围 | 当前状态与证据 |
| --- | --- |
| API G1 | API 实现线已执行 check 通过；旧 30 项兼容测试及新增 15 组 delivery HTTP 测试通过（共 45 项）。实现线已复跑 contracts check/80 tests、API check/build；最终 API 45 项汇总复跑 exit 0。主管已独立复验 API check exit 0、45/45 全测通过（4.47 秒）、runner 语法检查与 diffcheck exit 0 |
| 独立 HTTP Fake | 实际小文件、canonical report hashes、证据字节、source ZIP 与 contents manifest；明确 synthetic 检查，无模型/编译/浏览器执行 |
| API 发布/读取 | 默认新任务 delivery；唯一 Prepare/outbox、冻结/剩余预算、首次 used 一次；实际文件/ZIP 核验、partial 自动发布、错误阻断、精确旧 URL alias、授权报告/证据/diff/恢复来源实现并有独测 |
| 恢复与兼容 | 独测证明 legacy Run/Version JSON 与额度升级不改、不重放；legacy 恢复仍未验证，不补造可信交付；M2 恢复保留原验证来源，后续编辑产生新冻结与正确父链 |
| 跨服务 G2/G3 | runner 已写、`node --check` 通过；等待主管集成实际 M2 Agent/Web 后运行，尚不能称通过 |
| 真实代码 G4 | 未执行本轮模型调用。runner 真实分支为直接 v1 Run + 真实 Prepare/Worker，未测试 Router；完整恢复后第三次真实修改仍须实际证据 |
| M3 / G5 | 未实现本轮 OS/网络/资源隔离及双隧道公网分享验收，不与 M2 混淆 |

API 新增独测已覆盖：真实 ZIP alias 与证据下载 hashes；remaining=total-used；响应丢失/API 重启同体、used 一次；Prepare 无 execution 早失败；未派发取消/不确定取消不造新推理且保留锁；required fail 与 A-fail→invalid-pass→not-run 不洗失败；clean 错计划、报告错主体、同版本换 input artifact、丢 gap、坏 archive 阻断；25 文件游标分页、跨比较 cursor 拒绝、110 文件显式截断与 owner 授权；delivery-aware outer facts 重启不重算、咨询零 Run；发布下载中断恢复、staging 取消赢；v2 自动准入保留完整 goal/来源、exact 基线漂移在 Prepare 前拒绝；冻结后未派发 Worker 的取消报告/计费；失败终态后迟到报告只读取回、未知最终 token 阻断；历史迁移与 legacy 恢复。

可复跑独立命令：`pnpm --filter @atoms/contracts check`、`pnpm --filter @atoms/contracts test`、`pnpm --filter @atoms/api check`、`pnpm --filter @atoms/api test:contract`、`pnpm --filter @atoms/api build`。跨服务准备入口为 `pnpm test:delivery --no-web`，该模式使用实际 Runtime/Fake Model，不是 API HTTP Fake；Web HTTP ready 不冒充 UI 验收。

真实 runner 不默认调用模型：须主管设置 `ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION=1` 再运行 `pnpm test:delivery:real --no-web`。三 Run 共最多 24 observable model steps、196,608 有效输入（含缓存）/73,728 输出，每 Run active time 最多 900,000 ms；Prepare 包含于总额，不自动扩额或重建任务重试。真实模式 Key 只给 Agent，证据目录保留。后续 v2 Router 代表性验收另由主管统一安排有界调用，不默认叠加。

本轮实现和测试均在隔离 API worktree/临时数据进行；未修改 live 5173 或 `data/review-real`，没有执行部署/迁移、模型调用或读取本机 Key。

主管已批准最小 mixed runner 作为后续有界入口：Fake `pnpm test:delivery --no-web --mixed-router`；真实须同时设 `ATOMS_ALLOW_REAL_DELIVERY_INTEGRATION=1 ATOMS_ALLOW_REAL_DELIVERY_ROUTER=1`。第三次恢复后修改改由真实 v2 auto/outer Router 准入，不加第四 Run；另一次 ask 质量短答零 Run，并校验实际 outer facts 与版本质量/缺口，保存答复。两个 Router Turn 单独预算各 3 steps/90s/32,768 有效输入/8,192 输出，合计最多 6 Router steps。默认 direct 入口不行使 Router；目前 mixed 亦仅语法验证，尚未跨服务执行。
