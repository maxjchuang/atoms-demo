# M3 隔离公网实施状态

更新日期：2026-11-09。M2 已安全升级本机，当前 M3 尚未通过 Docker/外网门禁，未开放公网构建。职责与顺序见 [并行计划](m3-parallel-plan.md)。

| 范围 | 当前事实 | 后续门禁 |
| --- | --- | --- |
| Sharing G0 | `4eb886b` 独立共享协议；规范化 URL 收紧 `1dcc735`；主管最初 check 与97/97、合并 isolation 后 check 与101/101通过 | 后续规范收紧须单独提交复验，不静默漂移 |
| Isolation G0 | `88d8643` capabilities/readiness 契约冻结，`f3c3d5b`独立exports；broker命令属于Agent私有实现 | 主管独立90/90（Agent WT原86+isolation4），集成101/101通过；实际Docker证明待实施 |
| 前端 | sharing client/交互/Mock 与浏览器验证工具开始实施 | 独立 Mock/字体/无业务写门禁，再真实服务与外部双域浏览器 |
| 后端 | 认证、sharing API、网关/Compose/隧道脚本开始实施 | 独立 FakeAgent/就绪替身测试、镜像与网关验证；禁止提前开隧道构建 |
| Agent | network-none/离线依赖、可信 broker、独立 builder/browser 设计收敛；G0通过后 Apps 与Docker资产开始实施 | 实际 Linux 限权/网络/资源/取消与崩溃清理探针，再同计划功能/clean ZIP |
| 公网 G5 | 未开始，没有可交付公网地址 | G3 通过后由主管启动双隧道，再实际外部浏览器验收 |

三条线分别由不同 subagent 执行。主管只统一协议、派活、审查、独立测试、Git 和部署验收，不编写 App 或部署基础设施实现。共享模块与旧 strict execution/conversation/delivery 分离；既有业务状态与额度不重置。

当前环境只读确认 Docker Engine29.5.2、Linux/aarch64、4CPU、约5.77GiB内存、AppArmor/seccomp/cgroupns；cloudflared2026.10.7。它们是环境信息，不是隔离证明。其他任务的 `atoms-review` 镜像/容器不复用为本阶段证据，不清理其资源。

公共空间使用全新卷、随机体验码和一个项目；不挂载/导入私有 `data/review-real`、其备份或实际模型验收临时目录。预览同源浏览器存储没有租户隔离，首版明确披露。可信服务才可读取各自凭证；Key 不作为镜像构建输入、生成源码、验证任务输入或浏览器内容。

所有不可信任务禁网，包括独立源码 ZIP 安装；可信镜像构建预取并校验固定公共依赖，任务使用私有离线 store，在新目录实际安装。缺缓存、工具链错配、未完成 probe 或旧代际结果均不得回退宿主运行或声明 ready。普通本机 M2 模式仍保留其原范围，不作为 M3 证据。
