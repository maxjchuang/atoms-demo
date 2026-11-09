# 当前 Intel Mac 公网验收交接

初次预检：2026-11-09 16:59；双入口升级与预检：2026-11-09 17:17（Asia/Shanghai）。当前电脑运行全部服务，另一台电脑只需浏览器，无需 Docker、模型 Key 或本机代理。

## 当前入口与额度

- 主工作台：<https://spaces-entering-mumbai-char.trycloudflare.com>，Cloudflare 临时域名，实际浏览器无需 ngrok 确认页。
- 备用工作台：<https://little-dolly-thrill.ngrok-free.dev>，ngrok 固定域名。两个入口同时运行、共用数据；手动切换备用入口，分别输入同一体验码登录，不共享跨域 Cookie。
- 独立预览源：`https://toxic-cons-borough-flickr.trycloudflare.com`；预览签名由工作台获取，不把该主机根路径作为工作台入口。Cloudflare Quick Tunnel 域名在重建隧道时可能变化。
- 体验码只在服务器私有文件 `~/.atoms-m3/intel-public/experience-code`，不提交 Git。有效期到 2026-11-10 16:47:37（Asia/Shanghai）；单个登录会话有效期约一小时，过期重新输入同一码，项目与额度不重置。
- 该码共享一个公共身份：项目上限 1，构建上限 3。已创建“公网隔离验收 · 真实计数器”，预检已使用 1 次构建，剩余 2 次。未执行额外交接充值、清零或历史重写；请在已有项目中验收修改。

## 第三方浏览器步骤

1. 在另一台电脑用无痕窗口打开 Cloudflare 主工作台；建议使用不同网络以排除局域网依赖。只有使用 ngrok 备用入口时，首次访问说明需点击 Visit Site。
2. 点击“开启体验”，输入提供的体验码。进入已有“公网隔离验收 · 真实计数器”。不再显示旧公开展示入口。
3. 点击“加一”“减一”“重置”，检查右侧预览；刷新后确认项目、版本和预览仍可读取。
4. 查看“交付报告”和“代码”，点击右上角“下载源码”。当前版本为已发布、complete、verified；已验证源码 ZIP 的 SHA256 为 `ad4b383d2de492c41b2e757fb5a43875b36d11c52567bae5b887a14bc86bf9a1`。
5. 在已有项目提交一次明确修改，例如“把计数器标题改为第三方公网验收，并把数字显示为蓝色，保留加一、减一、重置功能”，使用“自动识别 / 直接构建”。等待新任务验证并发布，再检查预览、交付报告、刷新与新源码。该操作消耗一次真实构建额度。

此体验码用于一名评审，持有码者共享项目和额度，不代表多租户身份隔离。预览与工作台跨源；同一预览源内各应用的浏览器存储不宣称严格租户隔离。

## 已有证据与未完成项

- 独立 Colima `atoms-isolated`，Docker context `colima-atoms-isolated`，Linux/AMD64、4 CPU、6GiB、60GiB，无默认宿主目录挂载。原 Colima 及其他服务保持运行。
- 全部 11 项实际 OS 认证通过：policy、browser_sandbox、offline_clean、runtime_exact_export、canaries、resources、cancel_restart、runtime_cancel、runtime_restart、lease_deadline、independent_watchdog。认证绑定镜像、策略、缓存与探针；不是只检查配置文本。
- 真实 DeepSeek + DSH 任务 `run_7ebb247e1effb1110755` 于 16:58:03 成功发布 `version_19a1741f87ffb348e256`；类型检查、构建、sandbox Chromium 加载及 5/5 行为用例通过，精确 ZIP 在独立干净目录中离线冻结安装、构建和复验通过。
- 本机一次性浏览器通过真实公共 HTTPS 完成首次说明、体验码登录、跨源 iframe 交互、刷新、源码下载及 Secure/HttpOnly/host-only Cookie 检查。浏览器位于原 Colima 的临时测试容器，仅挂载测试脚本与独立证据目录，不作为任务 OS 认证证据，也不冒充另一台物理电脑。
- 公网拒绝检查：匿名源码 401、内部路由 404、错误 Origin 写入 403、无效签名预览 403。源码文件扫描未发现实际 DeepSeek/ngrok 凭据字节。
- Provider 凭据只在 trusted Agent 的只读专属卷，不在 API/GW/Broker/job 的环境或挂载中。API、Agent、Broker 无宿主端口；网关仅绑定 loopback 18080/18081。
- 当前还没有另一台物理电脑验收回执；完整分享/到期/域名轮换等 G5 清单也不据此全部标记通过。未合并 main 或推送。

私有证据：`~/.atoms-m3/intel-public/certify-1794214060479.json`、`~/.local/state/atoms-demo/m3-acceptance/`。证据包含带签名 URL 或会话文件，不能整体提交或公开。

## Cloudflare 主入口升级事实

实现提交 `b7dca7742a326b888dc39f1fb66da6e642108e79`。API/Gateway 以实际 AMD64 原生镜像重建，context hash `0a0a150ae394261fd291f1285c3c2b0b25659ce95f3f4a93339f2fd7a4196f60`，dsh 模式；Agent/Broker/Job 镜像及认证 tuple 未改。API 73/73、契约 102/102、部署/网关 61/61、主管独立网关/恢复计划 10/10 均通过。数据库与部署配置在排空后已私有备份。

新增一个 CF 工作台连接器；原 ngrok PID、CF 预览容器和预览域名保持，部署 epoch 已更新、旧外部 verification receipt 不沿用。两个入口实际浏览器均通过登录、预览交互、刷新、下载、host-only Cookie、对方入口 Origin 写入拒绝，以及预览无工作台 Cookie；两份下载与既有 verified ZIP 的 SHA256 完全一致。分享 build_entry 实测返回 CF 主入口。此次部署及预检没有触发模型调用或创建 Run。

升级前另观察到 17:08:16 的修改 Run `run_699d6b75fd006ee577b8` 在准备计划阶段 failed/PLANNING_FAILED，未 started、未新增 Version；保留该真实失败，不改写为通过。升级前备份和升级后均为 1 项目 / 2 Run / 1 Version / used1，仍剩 2 次构建。它与双入口访问成功是不同事实。

只读诊断确认该修改失败来自遗漏 `API_INTERNAL_URL`：Agent 默认请求自己容器的 `127.0.0.1:3001`，版本输入 manifest 返回 ECONNREFUSED；正确的 `http://api:3001` 返回 200 且 manifest SHA 匹配，失败用量全部为 0。部署修复 `d63f93a8095aa9ad0c83eaefe335a33be82adb2b` 设置固定内部地址，配置回归 7/7 通过，API/GW 原生重建 context `07628326a55ab0071f94bd3396068925e0e02795117664bcbe10675d25e54963`。排空后正常重启使 Agent 新环境生效，仍为 dsh/docker_linux、原认证 ready 后恢复准入；三隧道身份不变、业务计数不变。主入口重启后的真实浏览器预检再次通过，证据 `primary-final-proof/`。未重试模型、未复活失败 Run；修改需求须用户重新提交。

证据分别在私有 `m3-acceptance/primary-proof/`、`backup-proof/`、`dual-entry-summary.json`。当前服务端 sharing descriptor 仍为 externalVerification=unverified，未借本机预检伪造另一台物理电脑的独立验收回执。

## 运行条件与管理

保持服务器供电、联网及 Colima 运行。当前没有配置系统开机自启；关机、休眠或停止隧道会中断访问。工作台固定域名不等于服务永久在线。预览隧道需要重建时必须按受审流程排空任务并更新 origin/epoch，不能手动替换运行中的 URL。

主/备三连接器不使用通用 tunnel start/renew，避免丢弃备用入口；参见 [双入口维护限制](../deploy/m3/NGROK.md)。当前运维脚本由单操作者串行执行，不支持并发变更或强制中断中的 journal 写入；执行前保留私有日志副本。ngrok 是工作台备用入口，预览仍共用 CF；不宣称 CF 全站故障时预览也有独立备用链路。

操作工作目录为 `/Users/max/Projects/github/atoms-demo-ngrok`，先执行 `. "$HOME/.local/state/atoms-demo/m3-env.sh"`；所有操作显式使用 `--project atoms-m3-public`。查看服务：`docker --context colima-atoms-isolated ps`。排空停止 API：`node scripts/m3-public.mjs drain --project atoms-m3-public`；正常恢复：`node scripts/m3-public.mjs up --project atoms-m3-public`。恢复复用原凭据配置、数据与额度，不传新的 Key、不改 Fake。
