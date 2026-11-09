# 固定 ngrok 工作台与 Cloudflare 预览

两个提供方并行接入独立网关：固定 ngrok HTTPS 域名 → 工作台；Cloudflare Quick Tunnel → 静态预览。ngrok 不是 Cloudflare 的上游反向代理。工作台 Cookie 不发送到预览源；预览域名重启仍可能变化，旧预览分享链接不保证永久有效。

仅支持账户明确分配的 `ngrok-free.app`、`ngrok-free.dev`、`ngrok.app`、`ngrok.dev` HTTPS 主机；不接受任意目标、端口、自定义证书或 URL 凭证。使用经操作者核验的原生 ngrok 可执行文件；不自动安装，也不隐式切换原生/Docker transport。

## 凭据与进程

将已有 ngrok authtoken 保存成仓库外、当前用户拥有的普通 0600 文件，禁止软链接。命令只传该文件路径，不能把令牌填入 argv 或环境变量。工具创建专用 0600 ngrok 配置，禁用本机流量检查 Web UI；配置、日志和 PID 身份日志全部保存在仓库外 0700 私有目录。实际令牌不进入镜像、生成应用、API、Agent、浏览器包或 Git。

私有日志不会自动输出到终端；连接失败时操作者应在本机查看并脱敏。停止动作核对 PID 启动时间、完整命令及专用配置路径，拒绝操作身份不匹配的进程。客户端原生自动重连；重启电脑后需重新启动本工具，不宣称已安装开机服务。

## 当前 Intel Mac 的只读部署

原默认 Docker VM 内存约 4 GiB，完整 M3 certifier 要求至少 5 GiB。新增原生 AMD64 资产选择后，仍须在明确选择的独立 Docker context 中重新构建与认证，不能通过改用 ngrok 绕过认证。本工具另提供显式的当前 main 只读部署适配器，保留原有 API/Agent/数据卷和 Cloudflare 预览，不开启公网生成，也不伪造 M3 ready。

```sh
node scripts/m3-current-readonly.mjs plan
node scripts/m3-current-readonly.mjs start \
  --deployment-root /absolute/path/to/current-main \
  --state-dir /absolute/private/ngrok-state \
  --ngrok-origin https://YOUR-ASSIGNED.ngrok-free.dev \
  --ngrok-token-file /absolute/private/raw-ngrok-token \
  --ngrok-binary /absolute/path/to/ngrok
```

适配器会检查运行中的 main 网关归属、镜像配置与源配置一致、5181 仅绑定回环、公网写请求真实返回 403，核验当前 Cloudflare 预览身份和配置域名一致。通过体验码读取所有当前身份项目的 v2 workspace，存在活动 Run 或协调 Turn 即拒绝重启 API。操作期间请勿从本机入口发起新任务；现有 main 不提供原子停准入接口，因此两次状态检查不能宣称消除了其他本机客户端并发提交的竞态。

ngrok 必须以指定域名和固定只读目标成功注册后，才更新 main 的 ALLOWED_ORIGINS（保留原值）、重建 API 并重载 Nginx。原有 Cloudflare 工作台隧道不会被停止。private state 与 deployment 的 ignored data 目录分别加排他操作锁；遗留锁不自动按猜测 PID 删除。更新失败会在仍持有本次文件内容时恢复原配置并重启 API；并发编辑冲突则保留备份/故障日志，要求操作者处理。

同一 `--deployment-root`、`--state-dir` 可用 `status` 和 `stop`。停止仅停止本工具拥有的 ngrok；已持有的本机地址文件会明确标记 ngrok stopped，不重置 API 数据或额度。不要再用 main 的 `deploy/public-up.sh` 覆盖当前 ngrok 域名；预览隧道续期后需先更新 main 预览配置，再停止/重启此适配器并重新验证。

## 完整 M3 集成（认证门禁保持）

```sh
ATOMS_ALLOW_M3_PUBLIC_TUNNELS=1 node scripts/m3-tunnels.mjs start \
  --project atoms-m3-public \
  --workbench-provider ngrok \
  --ngrok-origin https://YOUR-ASSIGNED.ngrok-free.dev \
  --ngrok-token-file /absolute/private/raw-ngrok-token \
  --ngrok-binary /absolute/path/to/ngrok \
  --transport docker
```

此处 `--transport docker` 只决定 Cloudflare 预览连接器的 transport；ngrok 工作台仍使用明确的原生客户端。原有不带 `--workbench-provider ngrok` 的双 Cloudflare 模式保留。M3 图像身份、实际隔离认证、API 停止/工作排空、部署 epoch 与签名轮换门禁仍全部执行。目标 Docker context 不满足这些条件时命令应拒绝；上述命令不是已完成的 Intel M3 部署证据。

域名配置变化使用既有 `renew` 流程；`status` 输出每个角色的提供方和身份状态；`stop` 只清理受日志绑定的连接器。固定 ngrok 域名不会避免 Cloudflare 预览续期，也不能保证旧签名仍有效。

ngrok 免费域名可能显示浏览器提示页，首次需访客点击继续；请求/带宽额度及具体方案限制以账户控制台为准。本项目有轮询，请评估月度请求消耗。

## 验证

```sh
node --test scripts/m3-ngrok.test.mjs scripts/m3-current-readonly.test.mjs \
  scripts/m3-docker-transport.test.mjs scripts/m3-stage2.test.mjs \
  deploy/m3/gateway.test.mjs
```

测试使用合成令牌和本机进程，不访问 ngrok、Cloudflare 或模型。网关不再把来访者 `CF-Connecting-IP` 当作可信身份，统一使用连接器对端 IP，因此经同一连接器的访客会共享 API 的 IP 限流桶；真实访客 IP 透传需后续建立提供方与来源绑定，不能简单信任任意头。
