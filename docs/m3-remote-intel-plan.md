# M3 远程 Intel Mac 部署与验收计划

日期：2026-11-09。最新用户指令明确：**当前这台 macOS / Intel 电脑是服务器，另一台电脑仅作为第三方浏览器访问端**。本页保留原始迁移审计记录，但后续实施以此目标和文末实测记录为准，不迁移或重置原有本机数据。

当前机器为 macOS14.4.1、Intel、16GiB物理内存。已新建独立 Colima profile `atoms-isolated`（Linux/AMD64、6GiB、4CPU、60GiB，禁用默认宿主目录挂载），Docker context 为 `colima-atoms-isolated`。原 `colima` 的4GiB实例、legacy应用及其他项目服务保留运行。完整M3将使用新实例和新公共卷、独立体验码及新认证，不能沿用旧ARM64或legacy普通容器的proof。

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

## 当前本机的混合隧道适配

2026-11-09，新增 `feat/ngrok-cloudflare` 工作分支，基于本计划所在的 `811f3ac`。目标为 ngrok 账户固定域名承载工作台，Cloudflare 承载独立预览源。两个连接器并联进入对应网关，不将预览应用并入工作台 origin。

完整 M3 的混合入口仍须经过原隔离认证、镜像身份核验、排空与域名/部署 epoch 更新，不因 ngrok 固定域名而放开生成准入。本机 Docker 实际为 Linux/AMD64、约 4 GB 内存；当前 ARM64 固定镜像/协议与 5 GiB certifier 门槛仍是完整 M3 验收阻断项，不降低门槛，也不复用其他平台 proof。

另提供明确标识的当前 main 只读兼容入口：ngrok 仅指向已运行的回环 5181 网关，复用 Cloudflare 回环 5182 预览；保留公开写入 403、现有 API/Agent 数据卷及 Fake 模式，不启动 M3 Broker/job 或调用真实模型。连接器凭证来自仓库外当前用户所有的 0600 文件，运行配置与日志仅放私有操作目录。同步 API Origin 前校验服务身份和活动 Run/Turn，失败时保留证据并回滚本次配置修改。此兼容入口的公网访问验证不等于 M3/G5 验收。

ngrok 免费开发域名固定，但有初次浏览器提示页与月请求额度。前端每轮分别轮询执行和协调事件，不能把固定域名理解为无限量生产托管。实际账户授权、域名连接和外部浏览器验证完成前，不记录成功部署地址。操作与测试说明见 `deploy/m3/README.md` 的混合隧道章节。

适配实现复验：共享契约 101/101；混合隧道/只读适配/网关/既有隧道门禁测试 23/23（零失败、零取消）；原生 ngrok 3.39.13 的 v2 配置与关闭 inspector 校验通过。最初浏览器控制台读取失败，随后操作者通过本机私有文件提供令牌；已由原生 ngrok 返回账户固定域名并完成下述实测，全程未调用模型。

实测更新：操作者提供仓库外令牌文件后，固定 ngrok 开发域名已注册，当前只读适配器启动成功，运行状态检查通过。公网首页 200、登录 201 且 Secure Cookie、原项目和版本保留、Cloudflare 独立预览 200、公开写入 403。ngrok 3.39.13 实际日志的 addr 为 Go URL 结构对象，已补兼容与严格负例测试；测试使用合成域名，不包含实际令牌。凭据与运行日志只留本机私有目录，当前最新入口仍以主工作区 data/public-deploy/urls.txt 为准。

外部浏览器复验：全新 Chromium context 成功显示并点击 ngrok 首次访问提示，完成体验码登录，读取已保留项目，验证 Secure/HttpOnly 会话 Cookie。截图与探针结果仅保存在主工作区被 Git 忽略的 data/public-deploy/ 中。
