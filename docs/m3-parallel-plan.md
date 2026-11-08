# M3 隔离公网：并行计划

日期：2026-11-09。阶段顺序为 M1 项目协调 → M2 可信交付 → M3 隔离公网。M1/M2 已验收并升级本机 live；本文件是 M3 管理计划，G0 尚待共享协议审查，不能据此宣称已公网交付。

## 职责与目录

| 方向 | 专属负责人 | 实施范围 | 必须交付 |
| --- | --- | --- | --- |
| Agent | agent_implementation | apps/agent，包括其 docker/ 任务镜像与受限执行控制器 | Linux 任务 OS/文件/网络/资源隔离；同计划验证、精确导出；取消/崩溃/重启清理与 fence；实际攻击探针 |
| 后端 | backend_implementation | apps/api；明确扩展 deploy/m3/**、scripts/m3-*、根 .dockerignore | 独立体验码/会话/限额；sharing API；网关、Compose、持久化卷、双临时隧道与启动脚本；外部事实与 origin/epoch 轮换 |
| 前端 | frontend_boundary_review | apps/web | 固定版本分享、邀请构建、复制/过期/拒绝/断网反馈；Mock 与实际服务独立验证；外部浏览器验收工具 |
| 主管 | root | 协议/管理 Markdown、Git、验收与审查 | 冻结接口与范围；派活；独立验证；合并/推送及实际部署，不编写业务或基础设施实现 |

共享 Schema 由后端线临时独占 `packages/contracts` 的新增 sharing 子入口，先单独提交 Schema/fixtures/正反例与协议 MD，经主管批准后消费者才实现。旧 execution v1、conversation v0.2、delivery v0.1 strict DTO 不扩大、不重新解释。

各线使用原独立 worktree 同步 M2 的 main 基线后继续，不在 live main 编写实现。跨目录变更先报主管明确归属；另一线只读 review，不直接修补对方代码。Agent 与后端需在 G0 冻结任务镜像、可信控制器、挂载/卷及调用接口，不能各自猜 Docker 参数。

## 产品和权限基线

- 分享已发布应用：固定 Version 的到期 bearer 预览链接，不提供工作台会话、源码或模型调用权；生成应用自身可交互，不称其数据只读。
- 邀请体验构建：工作台入口，不附体验码、session、私有项目或当前用户授权；访客独立输入体验码。
- 使用全新公共数据卷和独立随机体验码，首版仅一个 reviewer code / 一个项目。绝不挂载、复制或隧道暴露 `data/review-real`、备份、真实验证临时数据及其 native home。
- 本机现有会话和项目继续运行；公共码、限额及持久化独立。总生成额度、协调预算及限流由 API 权威执行，清 Cookie 不充值。
- 预览与工作台使用不同 HTTPS 主机。预览同一 origin 的浏览器存储不具租户隔离；首版不宣称项目隔离或跨设备同步，不冒称已有 storage namespace。
- 模型仅接收 URL-free 宿主事实，浏览器点击时解析链接；分享不建消息/Run，不扣模型额度。配置公网入口与真实外部浏览器验收是两种证据。

## 顺序和硬门禁

1. G0：三线候选设计、sharing Schema/fixture/反例、任务执行控制接口、部署配置及错误/过期语义统一审查提交。随后三线并行实现，不互相等待业务代码。
2. G1：各线独立测试。前端用 Mock，API 用替身 Agent，Agent 用 Fake 模型及真实 Linux 容器；普通验证不使用模型 Key。
3. G2：主管审查产出和独立复验，确认旧 M1/M2 不变、版本/预算 fence 不回退，再合并集成分支。
4. G3：实际 Docker/Linux 全链路与恶意探针通过。证明不可信编译/浏览器进程无法读 Key、服务令牌、socket、宿主/其他任务；CPU/内存/PID/磁盘/时间/外连限制及取消/崩溃/重启清理实际生效。仅环境清理或 Docker 配置文本不算通过。
5. G5：G3 通过后才启动两个 QuickTunnel，分别仅暴露工作台和签名静态预览网关。实际外部域名浏览器验证 HTTPS 登录、固定版本分享、模块资源、交互/刷新、精确源码下载及匿名/越权/内部路由拒绝；健康检查和 Mock 不替代。
6. 完成后落事实状态、部署/失效说明、测试来源及 commit，合并 main 并推送。未通过项保留失败证据，不标完整。

## 执行与部署边界

可信模型调用者与不可信任务执行环境分开；Key 只给前者。任务不可挂 Docker socket、宿主 home、控制凭证、DSH native home、其他任务或平台数据根。必须防止通过 `/proc`、文件挂载、浏览器网络或父进程读取凭证。受控 Docker 能力仅归可信控制器，不把任意镜像/挂载/命令/网络参数交给模型或公开 HTTP。

Docker 资产必须由当前源码可追溯构建。现有 `atoms-runner:local` / `atoms-gateway:local` 及其他任务容器不是本阶段验收证据，不覆盖、清理或借用其卷。使用独立 `atoms-m3-public` Compose project、端口和镜像标识；现有 live 的 5173/3001/3002/4100 保留。

网关候选宿主端口仅 loopback 18080/18081。API、Agent、执行控制接口不发布宿主端口；工作台 allowlist 公共 API，预览仅 GET/HEAD 签名静态路径。`.dockerignore` 排除 `.env`、data、backups、.git、node_modules 及验证证据；Key 不作为 build arg、镜像层、Compose 明文配置输出或浏览器内容。

QuickTunnel 使用执行与协调双轮询，不依赖 SSE；无稳定域名或持续托管承诺。隧道域名变更时 drain、更新可信 origins/部署 epoch 与签名配置，重启后原版本/额度保持，旧签名按已定政策失效；工作台新 host 重新登录。官方限制见 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。

真实模型调用只在主管明确限定的验证任务内进行，G1/G3/G5 优先复用明确标来源的 Fake 样例或受审公开源码；不得为部署截图自动重跑模型或改写 M2 原报告。公开构建入口在 OS 隔离验收前保持关闭。
