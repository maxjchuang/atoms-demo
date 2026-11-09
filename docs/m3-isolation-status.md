# M3 隔离公网实施状态

更新日期：2026-11-09。当前 Intel Mac 的新公共服务已启动，真实应用已发布，公网浏览器预检通过；**另一台物理电脑的独立验收仍待进行，不宣称完整 G5 已完成。**本次部署位于 `feat/ngrok-cloudflare`，实现提交 `a094dad451534ff9d1fd2c0bcc9cc1e23daa1603`；main 与原服务、历史失败及其额度均保留。当前交付信息见 [本机公网验收交接](m3-current-public-handoff.md)。

下文保留原 ARM64 部署的历史审计记录，其环境阻断、旧额度、域名及“尚未发布”状态不描述当前独立 Intel 公共空间；不能将两套证据或账本混用。

## 已接受的实现与验证

| 方向 | 已验证事实 | 边界 |
| --- | --- | --- |
| 共享协议 | 独立 sharing/isolation G0，主管 check/101项通过；旧 strict v1/v0.2/delivery 不扩枚举 | 配置 ready 与外部实测分开，模型不接收 URL/凭证 |
| 前端 | 固定版本分享/邀请构建、真实剪贴板与拒绝态、过期/换代/晚到响应、14px/12px；主管分段单测/Mock浏览器/桌面及390px目视通过 | 真实 HTTPS 登录 Cookie 已实际通过；尚无 published app 的完整外部 G5 |
| API | 主管最新 check、串行69/69、build、运营guard4项通过；v1/v2统一 effective quota；typed host帮助与真实Router分开 | 私有交接授权代码已验收但没有执行；旧用量和 baseline3 不重写 |
| Agent | 既有主管完整90项与SDK零网络serializer；新增有界失败观察、future私有源码快照/manifest、同hash Spec/Plan输入及通用hook约定，作者串行98/98，主管新增11项/类型/构建通过 | 最终 Dockerfile 缓存分层优化后的镜像、权限、tuple 和完整认证仍待恢复 VM 验证 |
| 部署基础 | 主管实际 synthetic Docker API/GW/auth/撤销/跨PID离线CLI/崩溃恢复/WAL/精确ZIP通过；used/Run/Version1/1/1保留；镜像层34blob与构建context7类canary通过 | 这是独立check空间，不是实际模型或G5 |
| OS/Runtime | 主管逐片复验非root/readonly/caps0/禁网/CPU内存PID磁盘日志、live跨plane/peer canary、Broker与Agent强杀/取消/迟到候选、独立原生PID1 watchdog/两UID；旧942镜像部署内11项certifier实际通过 | 新诊断镜像与最终分层recipe改变后不能借用旧proof；必须新tuple认证 |

职责与顺序见 [并行计划](m3-parallel-plan.md)，接口见 [sharing](protocol-sharing-v0.1.md)、[isolation](protocol-isolation-v0.1.md)，部署命令与每项限定续跑见 [第二阶段操作](../apps/api/M3-OPERATIONS-STAGE2.md)。

## 真实验证：失败保留，不降验收

公共空间独立于 `data/review-real`，未导入私有真实应用或其 native home。当前一个身份/一个项目、3个终态失败Run、0 Version、generation used2，唯一一次真实分享咨询 completed/consult，未新增Run。

1. R1 `run_e122ee5f556cfd91d2c8`：SDK在 noexec `/tmp` 缓存原生模块后加载失败，0可观察native步骤、输入输出保持null未知、未发布。修复固定 `NARB_DISABLE_NATIVE_CACHE=1` 从受信只读镜像加载；主管实际network-none、无真实Key卷的握手通过，prompt0。旧失败未复活。
2. R2 `run_4d1b3a5d59d7589accff`：已结算3步/input15647/output24576，两个Worker请求max-tokens且正文0；预算正确停下。发现可变usage引用令重试差值误算0，已修标量快照；Worker结构化生成/修复改off，预算、模型、SDK不变。旧用量完整保留，不声称全部output均是thinking。唯一ask1步/input1768/output471，consult且零Run。
3. R3 `run_179a74e39cf8c9213a81`：真实生成及两轮修复，TSC/build/smoke均过，行为3/9→6/9→6/9；最终required case5/7/9仍fail，正确blocked/noVersion/noClean。已结算5步/input49491（含cache28160）/output13287/active130039ms，未耗token/time而是达到原repair2上限。冻结Plan9case/66step/11required未改变。问题包括fixture-specific hook约定不清、卡片中心拖拽与代码排除p冲突，以及generic反馈不够具体。没有旧A0/A1源码内容可重建，不补造；新增快照只适用于未来attempt。

原首轮有界续跑还曾在gateway pause前被拦截，未产生新Run：原session/key/body限定传输续跑后才创建R2。所有账本、不可变报告、unknown与known用量、失败日志保留。没有清零或退回已用次数，没有删step/降required/追加旧Run repair。

## 已实际部署、尚未交付验收

- 公共Docker拓扑仅loopback18080/18081；API/Agent/Broker无hostports，Broker唯一socket；模型凭据独立卷只给trusted Agent及一次性network-none Agent ingress。主管实际5角色uid1000/readonly/caps0与mount检查通过。
- Homebrew和官方Developer ID签名Darwin cloudflared tunnel都被本机SIGKILL，原软件和安全设置未修改。显式官方Linux arm64 Docker transport已校验SHA、隔离live sentinel网络探针通过；连接器只接GW专用edge，无token/data/provider/socket挂载。双QuickTunnel域名已分配、实际外部工作台HTTP200、真实浏览器登录Secure/HttpOnly/host-only/SameSite=Lax通过。这不等于完整应用分享G5。
- 实际Key未进构建参数、镜像或容器配置ENV，也未提供给API/GW/Broker/admin/job；只在受信模型Agent与其native请求进程的私有内存/env中使用；临时host输入已删。主管对六类当前镜像config/history/raw+gzip层扫描真实配置Key字节（4.81GB/98文件/59gzip），0命中，未输出Key值，临时needle/tar已删。
- 真实model凭据仍只保存在trusted Agent专属卷；为稳定环境，主管已停止本项目Docker API/Agent/Broker，未中断其他项目。Host原M2服务继续保留。

## 当前环境阻断与权限边界

宿主磁盘曾ENOSPC：Data仅292MiB。主管只回收本任务18条精确private/reclaimable旧browser chmod缓存链14.46GB；全部image ID/tag列表逐项保持，未做system/image/volume全局prune。只删除保留Fake M2测试的可重建node_modules副本，683+3832个非缓存source/report/证据文件SHA保持，real `ryZwrG`/`8tSEg2`数据不动。源缓存回收记录在私有 `.atoms-m3/cache-recovery`。

Host恢复约1.5–1.7GiB，但共享 `colima-link-bot` VM持续出现Guest shell `/bin/bash: Input/output error` 和新container临时mount目录I/O error，不能构建或启动新的验证容器。VM另有5个非本项目容器（atoms-review、link-bot）在运行。主管已记录12个原running容器的ID/image/restart策略，并请求用户允许重启该共享VM；**许可仍待回复，未执行重启/中断其他服务**。没有通过等待时长推定同意。

ENOSPC期间Agent全回归首轮4项host clean失败保留为环境失败；释放空间后四项串行4/4与完整98/98、check/build通过。API串行69/69也已重新通过。最后source/测试已提交，实际大镜像/cache/权限与G5动作仍阻断。

## 恢复后的剩余顺序

1. 仅获许可后修复/重启共享VM，恢复非本项目原running状态，核对可用磁盘；不删除用户数据或其他项目资源。
2. 验证优化后的静态依赖cache层与新harness最终job/control/broker镜像、两UID/权限；新tuple实际11-gate认证，不沿用旧image proof。
3. 主管审查后才决定剩余一次有界真实Code；当前剩余generation额度1，原ask已完成，不重复问，不自动新建任务/扩模型预算。
4. 只有required自动验收与精确ZIP通过并发布后，才执行真实外部浏览器分享、模块资源、本地持久化/刷新、匿名和internal拒绝、下载、签名过期/轮换、普通重启不回退Fake/不replay/不重扣额。
5. 交接运营授权只能在published+实际G5通过后按唯一审计ledger补足访客remaining3，旧used/history/baseline不改；当前未执行。
6. 最终验收完成后，停服前排空、完整备份用户本机数据，再安全升级main并推送；不能把当前集成候选称M3已完成。

私有兼容性已先通过：完整停服备份的安全副本在5187/5601/5602/5700无模型模式实际启动/停止/重启，十类API状态集合逐项hash相同，2项目/5Run/5Version/55消息保留，2个旧v2工作区认证读取/schema通过。只新增clone登录和预览cache，副本已停止，原live未停止或修改；证据 `atoms-m3-private-compat-tx2hefnr/compatibility-result.json`。
