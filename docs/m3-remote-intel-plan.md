# M3 远程 Intel Mac 部署与验收计划

日期：2026-11-09。用户将最终服务机改为另一台 **macOS / Intel CPU** 电脑：在那里运行 Docker 和两条 Cloudflare 隧道。本机保留 M2 live，不再以修复/重启本机共享 VM 为本次公网验收前置。本页是三线只读审计后的管理计划，**不是已可直接执行的 AMD64 部署手册，也不表示 M3/G5 已完成**。

## 目标拓扑与数据边界

- 服务机：Intel Mac 的 Docker Linux VM，实际 daemon 与镜像架构为 `linux/amd64`；API、Agent、Broker、两个网关和两个 cloudflared connector 均在该服务机运行。
- 访问端：另一台电脑的浏览器经两个真实 HTTPS 临时域名访问；本机可以作为独立审计机，无需运行服务或提供模型 Key。
- 本机 `data/review-real`、备份、原 public volumes、DSH home、旧 Run/额度和证据均不迁移。目标机全新公共 namespace、私有根、秘密卷、体验码和目标机认证记录；旧失败历史继续留在本机。
- 新机单独配置 DeepSeek Key，只给可信 Agent 的专属卷。体验码可通过私密通道传给审计机，落为当前用户拥有、非软链接、0600 文件；模型 Key 不传给审计浏览器或前端。
- 不复制本机 proof、部署 tuple、images.json、runtime-mode.json 或 operator receipt；原 ARM64 证据不能证明新机 AMD64 隔离。

## 已确认的适配缺口

| 归属 | 当前事实 | 必须完成 |
| --- | --- | --- |
| Agent / shared G0 | isolation 平台只允许 linux/arm64 | 先协调冻结该独立协议的 AMD64 增量、双平台 fixtures/正反例；旧 execution/conversation/delivery strict DTO 不改 |
| Agent | job/control/broker Node 与 Playwright base 固定 ARM64 子 manifest；metadata、toolchain、clean report 写死 ARM64 | 核验官方 AMD64 digest；原生构建；由实际 image/Node 架构产生平台和报告；不得把 QEMU ARM64 结果称为 AMD64 验收 |
| Backend / deploy | API/GW build flag 与 base 固定 ARM64 | 同一受审平台配置选择 AMD64 base/build，核对 daemon、image、tuple 一致 |
| Backend / connector | 二进制名、SHA、ELF machine、Dockerfile COPY、build 与 inspect 校验均固定 ARM64 | 一体增加官方 AMD64 asset 及固定校验，保留 TLS 和无数据/秘密/socket 的 edge-only 网络 |
| Backend / fresh bootstrap | connector 要求事先存在私有 release.json，目前没有完整新机获取引导 | 补齐官方 release 元数据获取及冻结校验，不能依赖本机遗留文件 |
| Frontend / verification | 外部 helper 可跨机复用，无 ARM64/个人绝对路径依赖；新浏览器 context 不是第二物理设备 | 管理验收附服务机实际架构/镜像/认证 tuple、审计机 Node/浏览器/commit 和物理设备来源，另核真实 DSH provenance |

部署脚本未发现硬编码 colima-link-bot context；它使用显式 DOCKER_CONTEXT/DOCKER_HOST 或当前 Docker context。目标机必须独立确认实际 daemon，不能复制本机 socket/profile。当前 proof 没有宿主身份字段，因此本次以全新卷和目标机重新认证作为迁移硬门禁；是否增加私有 daemon/kernel 指纹另行评审，不能假称已有防复制保证。

## 三线职责与执行顺序

1. Agent 线先提交 isolation G0 双平台候选；主管审查契约/反例后冻结。后端和 Agent 消费者再据同一平台定义并行修改，前端维持外部分享契约。
2. Agent 线完成 AMD64 job/control/broker、真实平台报告和隔离验证入口；后端线完成 AMD64 API/GW/connector、首次安装与凭据流程；前端线完成独立审计机操作说明和证据绑定清单。三线各自测试，主管独立 review/复验后集成。
3. 新机预检：Git、满足项目 engines 的 Node（当前 >=24.9）、pnpm10.33.0、Docker CLI/buildx/Compose 或已支持的 standalone fallback；不能假设 Node26 自带 corepack。确认 docker info 的 Linux/amd64、可用内存/磁盘/inodes、网络及 repo 外0700私有根。现 certifier 最低 VM 内存5GiB，仍须为其他服务与构建留余量。
4. 固定交付 commit，在目标机构建原生镜像并保留 source context→commit→image digest 映射；普通单测与 Fake 验证不用真实 Key，不复用其他项目镜像/卷。
5. 按已审首次启动顺序创建新 secrets/data、体验码和 DSH 凭据；初始未认证/未配置时构建准入保持关闭。目标机实际跑完整11项 OS 门禁，核对 image/policy/cache/probe/toolchain/platform；任何失败均不 fallback host/Fake。
6. 只给两个网关建立 Docker connector 隧道，应用实际 origins/epoch/签名配置，服务健康与能力绑定确认后再开放准入。Cloudflare 在服务机运行，访问端不需要安装客户端。
7. 主管限定新 namespace 的一次真实 Code 与最多一次分享 ask；原 per-Run 预算与 required 发布规则不变。失败保留，不自动重置额度/扩修复次数；若通过则完成精确 ZIP 复验和发布。
8. 独立访问端做真实 HTTPS 登录、固定版本分享/剪贴板、静态模块、交互/刷新/浏览器存储、ZIP 下载、匿名/内部/错误 Origin 拒绝；另做签名到期、域名/签名轮换、重启后不重跑和不重扣额。不能用 Mock、新 context 或工作台 HTTP200替代这些证据。
9. G5 完成后按既有授权规则交接体验额度，落地目标机操作手册/证据，再合并 main。仅远程部署不要求停止或升级本机 M2 live；若另需升级本机，仍独立排空/完整备份。

## 当前状态与待确认信息

三条线已分别完成只读审计；本页记录审计结论。本轮尚未修改 AMD64 业务/部署实现、未访问目标机、未构建 AMD64 镜像、未调用新模型或运行新隧道。

目标机系统与 CPU 已确认；macOS 版本、Docker 是否可用、可分配资源，以及由用户在目标机执行命令还是通过已授权远程终端执行，尚未确认。取得实际终端能力前，只能完成源码适配和交付准备，不能声称目标部署/验收已执行。
