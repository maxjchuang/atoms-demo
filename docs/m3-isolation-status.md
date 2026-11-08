# M3 隔离公网实施状态

更新日期：2026-11-09。M2 已安全升级本机；M3 三条应用线已独立验收并合入集成分支，本地 OS/Runtime 实际门禁由主管复验通过。最终部署内认证、网关/凭证拓扑与外网 G5 待完成，未开放公网构建。职责与顺序见 [并行计划](m3-parallel-plan.md)。

| 范围 | 当前事实 | 后续门禁 |
| --- | --- | --- |
| Sharing G0 | `4eb886b` 独立共享协议；规范化 URL 收紧 `1dcc735`；主管最初 check 与97/97、合并 isolation 后 check 与101/101通过 | 后续规范收紧须单独提交复验，不静默漂移 |
| Isolation G0 | `88d8643` capabilities/readiness 契约冻结，`f3c3d5b`独立exports；broker命令属于Agent私有实现 | 主管独立90/90（Agent WT原86+isolation4），集成101/101通过；实际Docker证明待实施 |
| 前端 | 独立门禁验收、提交`1bbb3f3`并合入集成分支；主管64单测/build+19 Mock浏览器，限定补修后check/9定向单测/新1浏览器 | 桌面/390视觉已审；真实API/外部双域浏览器待联调，不称G5 |
| 后端 | API App提交`7f98fc9`并合入集成分支，主管check/63全包/build通过；网关/Compose/隧道脚本实施中 | API测试隔离就绪为显式synthetic；镜像/网关与实际Agent联调待验收，禁止提前开隧道构建 |
| Agent | network-none/离线依赖、可信 broker、独立 builder/browser 设计收敛；`f0dbd6b`已验收合入集成：主管check/78全量/build；实际Linux/精确ZIP/资源/跨plane与peer canary/HTTP取消/双进程强杀恢复/绝对deadline/trusted service TERM逐片通过 | 最终部署broker内certifier固定10实际门禁并核绑定image/policy/cache后才ready；最终跨服务发布与公网另验 |
| 公网 G5 | 未开始，没有可交付公网地址 | G3 通过后由主管启动双隧道，再实际外部浏览器验收 |

三条线分别由不同 subagent 执行。主管只统一协议、派活、审查、独立测试、Git 和部署验收，不编写 App 或部署基础设施实现。共享模块与旧 strict execution/conversation/delivery 分离；既有业务状态与额度不重置。

当前环境只读确认 Docker Engine29.5.2、Linux/aarch64、4CPU、约5.77GiB内存、AppArmor/seccomp/cgroupns；cloudflared2026.10.7。它们是环境信息，不是隔离证明。其他任务的 `atoms-review` 镜像/容器不复用为本阶段证据，不清理其资源。

公共空间使用全新卷、随机体验码和一个项目；不挂载/导入私有 `data/review-real`、其备份或实际模型验收临时目录。预览同源浏览器存储没有租户隔离，首版明确披露。可信服务才可读取各自凭证；Key 不作为镜像构建输入、生成源码、验证任务输入或浏览器内容。

所有不可信任务禁网，包括独立源码 ZIP 安装；可信镜像构建预取并校验固定公共依赖，任务使用私有离线 store，在新目录实际安装。缺缓存、工具链错配、未完成 probe 或旧代际结果均不得回退宿主运行或声明 ready。普通本机 M2 模式仍保留其原范围，不作为 M3 证据。

基础容器策略：主管实际复跑`smoke-policy.ts` exit0，证据`atoms-v03-policy-sC7z4Y`，uid/gid10001、CapEff0、NoNewPrivs1、root EROFS、network none、CPU1.5/内存2GiB/swap0/PID128及无持久job日志均观测通过。探测的是未挂载路径，不冒充真实跨平面canary/浏览器/取消/崩溃门禁。原浏览器安装器100%后停顿已按15分钟硬超时保留；改用固定官方matching Playwright镜像与Node26.5后构建成功，未改隔离要求。

当前main为协议澄清 `1aa26d7` 与M2 App；M3 App仅在集成分支，未升级本机live或公网。

Chromium差异验证：默认seccomp失败`atoms-v03-browser-3xLSUV`；官方Playwright userns配置仍缺sandbox内部chroot，失败`njP5GA`；仅允许chroot syscall而不授任何cap后，作者与主管独立实际通过（主管`aUmNjY`）：chromiumSandbox=true、Node26.5/Linuxarm64、Chromium141、uid10001/CapEff0/NoNewPriv1；外层chroot仍EPERM(125)、mount拒绝(32)。不使用privileged/unconfined/hostIPC/no-sandbox或VM全局修改。这是当时镜像的browser smoke，不是最终完整OS readiness。后续离线runner装配/原DSL、资源、跨平面canary、取消/崩溃/重启与实际Runtime联调仍未完成，ready保持false。

API补修`59f81f5`已由主管check/public10定向验证：Docker不可用不阻断可信只读Router，auto意图可按原授权排队/预占；无匹配证明不派Prepare/Worker、不计生成used，恢复不重跑Router。MD-only澄清已推main`1aa26d7`；M3 App仍仅集成分支。

最终独立Agent回归：78/78（120.9s）、check/build通过。绝对deadline pending/running超时`Gk8MYc`、真实control/broker容器与文件凭证/active job TERM清理`82K5TR`通过。Root复验路径均为独立临时证据，不包括用户私有data/review-real。Agent job image固定`sha256:c62d88a3b4062b8ffb2b16b0db53d0f939765e223af5cbb8e989cca0d5c77be6`，当前policy `ab64f8441b4639a87987aa77ea21dbd693fdf6ee85f3f21b274c9b237180a8e1`；最终certifier仍未执行，因此不能据本节把部署ready设true。
