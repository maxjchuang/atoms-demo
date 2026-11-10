# Atoms Demo 运维

统一入口为仓库根目录的 `./atoms`。适用于当前已初始化的 Docker 公网部署，不负责安装 Docker、启动共享 VM、初始化数据库或配置模型密钥。需要 Docker daemon 已启动、Node >=24.9；入口会自动寻找本机已安装的私有 Node 26。

```sh
cd /Users/max/Projects/github/atoms-demo-ngrok
./atoms help
./atoms status                 # 实际容器、入口、额度汇总、就绪状态
./atoms details                # 详细部署信息
./atoms start                  # 启动／修复本部署服务及缺失隧道
./atoms stop                   # 停止应用服务，保留隧道
./atoms restart                # 排空后重启应用，保留现有隧道
./atoms stop --all             # 同时关闭本部署拥有的隧道
./atoms restart --all          # 同时重建隧道；Cloudflare 临时域名会改变
./atoms backup                 # 排空、私有备份、恢复原先运行的 API
./atoms config                 # 查看路径和部署选择，不显示凭据
```

默认部署为 `colima-atoms-isolated` context、`atoms-m3-public` Compose project，私有目录为 `~/.atoms-m3/intel-public`。脚本不停止 Docker VM、不删除卷，也不操作其他项目。可从其他工作目录用入口的绝对路径执行。

## 体验码

```sh
./atoms code new                          # 新码：剩余 10 次构建，24 小时有效
./atoms code new --builds 20 --ttl-seconds 3600
./atoms code info --code-file "$HOME/.atoms-m3/intel-public/experience-code-projects10-20261109"
./atoms code reset --code-file "$HOME/.atoms-m3/intel-public/experience-code-projects10-20261109"
./atoms code reset --code-file /absolute/private/code.txt --builds 15
./atoms code extend --code-file /absolute/private/code.txt --until '2026-11-15T23:59:59.999+08:00'
```

`new` 和 `reset` 的 `--builds` 默认 10，可选 1–100。**重置的是剩余额度**：已用 2 次后重置 10 次，已用仍为 2，有效总额度为 12。历史 Run、报告、版本和用量不删除。重置不延长有效期、不恢复已撤销体验码，也不改变项目上限。过期码不能重置，`code info` 仍可显示失效状态，需要继续体验时创建新码。新码使用现有部署的项目上限（当前为 10）；当前部署最多累计创建 10 个身份。有效期最长 86400 秒。

新码只写入私有 0600 文件，默认在私有目录 `codes/<operationId>.txt`，终端只显示路径及脱敏统计。可用 `--code-file /absolute/private/new-code.txt` 指定仓库外的新文件。查询和重置接受的是**仅含原始体验码的私有文件**，不是交接说明；拒绝软链接和宽松权限。实际体验码通过私下方式交接，不放入 Git 或公共日志。

`code extend` 只延长指定体验码的有效期，必须给出带明确时区的未来时间。原体验码、额度、使用记录和项目归属不变；原签发与额度凭据保留，新增延期审计记录。只允许当前有效且未撤销的码单调延期，最晚为原签发时间后7天；已过期或撤销的码不会因此复活。新码默认及签发上限仍为24小时。会话和已签发预览链接不会自动延长，到期后重新登录或获取链接。

发码、重置和备份先暂停准入、等待任务排空、确认 broker 空闲并备份；原先运行的 API 在完成后恢复。存在活动任务或等待用户输入时，脚本可能拒绝继续，不会自动取消或回答。它们不创建 Code Run，不调用模型。`code info` 为只读查询。

## 预演、重试与故障

```sh
./atoms restart --dry-run
./atoms code new --operation-id review-code-20261109 --dry-run
./atoms code new --operation-id review-code-20261109
```

保留终端打印的 operation ID。中断后用**同一命令、同一参数和同一 ID**重试；不要换 ID 来绕过未知结果。同一发码／重置操作重放只返回当前额度，不重复充值。操作日志位于私有目录 `ops-journal/`，备份位于 `backups/`；均含私有业务数据，不应公开。

并发管理操作通过独立锁互斥。锁、未确认备份、origin 更新结果不明确或 `recoveryRequired` 为真时，需要检查私有日志与实际部署后人工恢复；不要直接删锁或覆盖归档。脚本不强制恢复未知写入状态。错误输出只含受控阶段和排障提示，不回显子进程原始输出。

默认保留隧道可减少域名变化。完整停隧道后，`start` 会恢复当前部署的 ngrok 固定工作台和两条 Cloudflare 临时入口；Cloudflare 域名和签名会更新，旧链接可能失效，新工作台 host 需重新登录。仅支持现有三隧道拓扑。以 `status` 输出的实际入口为准，不依赖历史文档地址。

## 私有配置与升级

可选配置文件为 `~/.atoms-m3/intel-public/ops-config.json`，必须为当前用户拥有的 0600 普通文件。也可传 `--config /absolute/private/ops-config.json`。JSON 只接受以下字段；不执行 shell、不保存 token 值。私有目录须为 0700，路径应在仓库外。

```json
{
  "dockerContext": "colima-atoms-isolated",
  "project": "atoms-m3-public",
  "privateDir": "/Users/max/.atoms-m3/intel-public",
  "ngrokBinary": "/Users/max/.local/bin/ngrok",
  "ngrokTokenFile": "/Users/max/.local/state/atoms-demo/ngrok-private/authtoken"
}
```

脚本使用明确 context 并清除继承的 Docker endpoint/TLS 覆盖项。`status` 中 `servingHealthy` 表示现有部署健康，`updateAvailable` 表示私有镜像清单与实际容器不同；二者可以同时为真。源码更新后先构建受审 API／网关镜像，再执行 `start` 或 `restart` 应用更新。当前发码／重置功能需要本次新增管理命令的 API 镜像；镜像准备好后首次额度操作也会恢复到该镜像。

隔离元组须与现有认证一致；不匹配则停止启动，不回退 host/Fake。`ready` 复用已有部署证明，**不是本次安全验收全部通过**。已接受的硬链接缺陷、跨访客／过期／撤销／轮换未完整验证、单预览源存储隔离及临时入口限制仍保留。

本次测试包括运维流程替身测试、API／契约检查，以及当前部署只读查询；没有以测试名义实际停服、发码或重置额度。运维测试 41/41、契约测试 102/102；API 首次 84/85，预览轮换时间竞争测试定向重跑 1/1、全量重跑 85/85，该既有竞争未修复。测试证据：`~/.local/state/atoms-demo/ops-tooling-20261109/`。

## 隧道持续监控

```sh
./atoms monitor check          # 即时只读检查，不改变后台告警计数
./atoms monitor start --notify # 安装并启动当前用户的后台监控，登录后自动启动
./atoms monitor status         # 进程身份、最近采样时间、是否过期及当前域名
./atoms monitor stop           # 停止监控并取消登录自启，保留监控记录
./atoms monitor run --notify   # 改用前台运行；Ctrl+C停止
```

前台和后台共用单实例锁，不能同时运行。默认每轮检查完成后等待30秒；同一监控项连续3轮失败时通知，连续2轮健康后记录恢复。可用 `--interval 30 --failure-threshold 3 --recovery-threshold 2 --timeout-ms 8000` 调整。`--notify` 开启本机桌面通知；通知权限、勿扰模式会影响可见性，日志仍是核对依据，不向邮件、聊天或第三方服务发送消息。

监控每轮读取部署元数据和隧道登记，核对Cloudflare容器身份、ngrok进程身份、本地网关及公网工作台的真实HTML与匿名项目401。预览主机检查内部接口404及响应边界，只证明主机/网关可达，不代表签名应用功能通过。管理流程更新域名后会自动跟随，并记录、通知拓扑变化。探测使用本机网络，不冒充第二物理设备或独立外部监控。

监控不自动重启、修复、重建隧道或改域名，不登录、不读取体验码或模型凭据、不提交构建、不扣额度。进程存在与公网可用分别记录；运维暂停及过期维护锁也不会显示为健康。所有命令和HTTP请求有超时、响应体积上限，不跟随重定向。日志不保存原始响应、Cookie或带签名URL。

私有记录在 `~/.atoms-m3/intel-public/monitor/`：`latest.json` 是逐项详情，`events.ndjson` 记录告警、恢复与域名变化，`notifications.ndjson` 记录通知请求结果；事件和通知日志各保留当前及一份轮换文件。`stdout.log`/`stderr.log` 用于守护进程启动排障。目录0700、文件0600，不提交Git。后台使用当前用户LaunchAgent `com.atoms-demo.tunnel-monitor`，不需要sudo，也不启动Docker VM或业务服务。

已验证死亡且归属明确的监控实例锁可以安全回收；存活、身份不明或PID复用的锁拒绝接管，不向其他PID发送信号。脚本更新后用 `monitor stop`、`monitor start --notify` 加载新版。电脑休眠、关机或用户退出登录时无法持续采样；本机监控无法在整台服务器不可用时独立告警。
