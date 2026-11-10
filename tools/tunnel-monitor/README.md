# 独立公网监控器

工具随本项目保存在 `tools/tunnel-monitor/`。在另一台电脑拉取仓库后，进入此目录即可独立运行，不需要压缩包，也不需要启动 Atoms 服务。安装 **Node.js 22 或更新版本**即可；无需 npm install、pnpm、Docker、本机部署文件或模型密钥。支持 macOS、Windows、Linux，默认前台运行。

它从监控电脑检查三个显式配置的公网入口，不会启动、停止、重启隧道，不会创建项目、构建或修改额度。**它无法检查部署服务器上的进程，也不能自动发现新的 Cloudflare 临时域名。**

## 在另一台 Mac 拉取并启动

第一次使用时，把 `<仓库地址>` 换成此项目的 Git 地址：

```sh
git clone <仓库地址> atoms-demo
cd atoms-demo/tools/tunnel-monitor
node --version
cp config.example.json config.json
chmod 600 config.json
```

核对 `config.json` 中的 `targets.primary`（Cloudflare 工作台）、`targets.backup`（ngrok 备用入口）、`targets.preview`（预览网关）。示例地址是编写时的临时入口，使用前须与服务器当前地址核对；示例文件不是域名自动发现机制。配置路径可以为相对或绝对路径。

然后执行：

```sh
node monitor.mjs check --config ./config.json
node monitor.mjs run --config ./config.json
```

`check` 只做一轮公网 GET 检查，输出脱敏结果，不发送通知、不写状态或改变守护程序计数。退出码：0 全部通过，2 检查未通过，1 配置或运行错误。`run` 持续串行检查，Ctrl+C/SIGTERM 会退出并清理运行锁。

默认每轮完成后等待 600 秒（10 分钟）；每个 HTTP 请求最多 8 秒、响应最多 256 KiB，不跟随重定向。每个入口连续 3 轮不健康产生一次该入口的报警，连续 2 轮健康产生一次该入口的恢复事件。检查耗时会影响轮次间隔，默认连续 3 轮约 30 分钟报警，不能保证精确时间。持续同一故障不会每轮重复通知；不同入口分别计数。计数保存在本次进程内，重启会重新累计，可能再次报警，不能保证跨重启去重或补发恢复通知。

默认频率下，ngrok 单独由此监控产生约 288 次请求/日、8640 次/30 天。它与部署机现有监控、访客请求共享账号流量限额。ngrok Free 当前上限为每月 20,000 请求，调小间隔前请核对剩余额度：[官方限额](https://ngrok.com/docs/pricing-limits)。本工具不会更改服务器上已有监控的频率。

检查内容：

- 主入口、备用入口：真实 Atoms 页面标记，加匿名 `/api/v1/projects` 返回 401。ngrok 请求携带跳过首次确认页的头，单独的警告页 200 不算健康。
- 预览入口：API 路径和内部路径返回预期网关 404/安全响应头。此项仅检查拒绝边界，**不是已签名生成应用的功能验收**。
- 结果仅代表这台监控电脑的访问情况。监控电脑断网、DNS/TLS 故障与服务故障可能混淆；电脑休眠或离线时也不能发出通知。

Node 的 HTTP 请求直接连接目标，不读取浏览器代理、Clash PAC 或 `HTTPS_PROXY`。请确保监控电脑的 Node 进程能直接访问这些 HTTPS 地址；浏览器能打开不代表 Node 也能连接。

## 配置和状态

常用配置项：

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `intervalSeconds` | `600` | 每轮完成后的等待秒数 |
| `timeoutMs` | `8000` | 单次请求的超时毫秒数 |
| `failureThreshold` | `3` | 同一入口连续失败多少轮告警 |
| `recoveryThreshold` | `2` | 已告警入口连续正常多少轮恢复 |
| `stateDirectory` | `./state` | 状态及事件日志目录 |
| `notifications.enabled` | `false` | 是否启用已配置的微信发送渠道 |

查看最近结果及事件（在工具目录下，使用默认状态路径时）：

```sh
cat state/latest.json
tail -n 20 state/events.ndjson
```

未启用通知时，`run` 静默持续运行，结果写入上述文件；不会自动发送微信或弹出桌面通知。单次 `check` 的输出也不会覆盖持续监控的状态。

`stateDirectory` 相对于**配置文件所在目录**解析。默认 `./state`，其中包含 `latest.json`、`events.ndjson`、一份轮换文件 `events.ndjson.1` 和运行时 `run.lock`。单份事件日志默认最多 1 MiB；状态不含响应正文、体验码、会话、token 或签名链接。macOS/Linux 目录要求 0700、文件 0600；Windows 应使用账户私有目录并限制 ACL，不放在共享或同步目录。

同一状态目录只能运行一个实例。SIGKILL、掉电等异常退出可能留下锁，launchd 自动重启也不会绕过该锁；先确认旧进程确实已停止，再核对并手动移除该目录中的 `run.lock`。不要同时运行两个后台任务。

本机的 `config.json`、`state/` 和日志不要提交 Git；如需存放其他名称的配置或日志，优先放在仓库外的私有目录。示例配置不含凭据，真实 token 始终单独保存在仓库外。

配置只在启动时加载。临时域名变化后，手动更新 `config.json` 的显式 origin 并重启此监控进程。配置只接受 HTTPS 的 Cloudflare Quick Tunnel 和 ngrok 域名，不能含用户名、密码、端口、路径、查询参数或片段。域名变化不会由远端自动探测，也不会自动修改服务器。

## 可选：通过已绑定的 PushPlus 微信 ClawBot 通知

默认 `notifications.enabled=false`。**如果你现有 ClawBot 绑定的不是 PushPlus，不要重新扫码或改绑。** 此适配器只适用于现有 PushPlus 绑定；其他服务需要它自己的发送 API，当前不会代替或改动已有绑定。

仅在确认服务为 PushPlus、通知渠道已激活后，把配置改成：

```json
"notifications": {
  "enabled": true,
  "provider": "pushplus",
  "channel": "clawbot",
  "tokenFile": "/Users/YOUR_NAME/.config/atoms-monitor/pushplus-token.txt"
}
```

token 文件只放原始 token，必须在此工具目录之外，macOS/Linux 为本人拥有的 0600 普通文件，不能是软链接。不要把 token 写入配置、命令行、Git 或截图。也可以用 `tokenEnv` 指定环境变量名，例如示例中的 `ATOMS_MONITOR_PUSHPLUS_TOKEN`；由你的私有环境配置提供值，不能同时配置文件和环境变量来源。不要在 launchd plist 的公开环境字段里粘贴 token。

工具仅在报警/恢复状态转换时发送固定标签、时间及排障提示，发送到固定的 `https://www.pushplus.plus/send`，token 仅在 HTTPS JSON 正文。不会发送响应正文、完整配置、体验码或签名链接。每次事件最多尝试两次，仅收到明确 502/503/504 才重试一次；超时结果可能已送达，不盲目重发。提供方返回接受不等于微信最终送达。失败只记录通用状态，不回显原始错误。`check` 永不发送通知。

按 PushPlus 当前官方渠道说明，每推送 10 条消息或间隔 24 小时，需要用户主动向该 ClawBot 发起对话以继续使用；这是提供方当前限制，可能调整，不能保证长期自动送达。请以最新官方说明为准。

官方依据：[微信 ClawBot 渠道说明](https://pushplus.plus/doc/channel/clawbot.html)、[发送接口](https://pushplus.plus/doc/guide/api.html)。此工具不调用任何绑定接口。

## macOS 后台运行（手动，可选）

先在终端成功执行 `check`。用 `command -v node` 找到绝对 Node 路径；终端当前 Node 和 launchd 的 PATH 可能不同。以下为模板，**先替换全部绝对路径**，不要使用 `~`。plist 不包含通知 token：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.atoms-public-monitor</string>
  <key>ProgramArguments</key><array>
    <string>/ABSOLUTE/PATH/TO/node</string>
    <string>/ABSOLUTE/PATH/tunnel-monitor/monitor.mjs</string>
    <string>run</string><string>--config</string>
    <string>/ABSOLUTE/PATH/tunnel-monitor/config.json</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>/ABSOLUTE/PRIVATE/PATH/monitor.stdout.log</string>
  <key>StandardErrorPath</key><string>/ABSOLUTE/PRIVATE/PATH/monitor.stderr.log</string>
</dict></plist>
```

保存为 `~/Library/LaunchAgents/com.example.atoms-public-monitor.plist`，先创建日志父目录并限制权限，再手动执行：

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.example.atoms-public-monitor.plist"
launchctl print "gui/$(id -u)/com.example.atoms-public-monitor"
# 停止（不会停止被监控的服务器或隧道）
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.example.atoms-public-monitor.plist"
```

没有自动安装任务。本工具自己的事件日志会轮换；launchd 的 stdout/stderr 是独立文件，模板运行默认只输出错误，仍应由你定期检查其大小。使用基于版本目录的 Node 路径时，升级 Node 后记得同步修改 plist。Windows 可由任务计划程序、Linux 可由用户级 systemd 执行同一条 `run` 命令；选择账户私有状态目录，确保只有一个实例。

用户退出登录、电脑休眠或关机期间，LaunchAgent 不能持续采样。监控机使用与服务器独立的网络，才能在服务器网络断开后继续访问通知服务。

## 更新代码、配置与停止

先停止此监控：前台按 Ctrl+C；后台使用上文的 `launchctl bootout`。然后在仓库无未提交代码改动时更新：

```sh
# 在仓库根目录执行
git switch main
git pull --ff-only origin main
cd tools/tunnel-monitor
node --test test.mjs
node monitor.mjs check --config ./config.json
```

保留自己已有的 `config.json`，不要每次拉取后覆盖为示例。按新版示例核对配置项，临时域名改变时手动更新 `targets`。检查完成后重新执行 `run`，或使用 `launchctl bootstrap` 恢复后台监控。代码更新和配置修改都需要重启监控才会生效；这些操作不影响服务器上的业务服务及隧道。

## 测试

```sh
node --test test.mjs
```

测试仅使用替身传输和临时本机 HTTP 服务，不发送真实通知、不调用模型、不修改部署。复制目录后的独立执行也由测试覆盖。
