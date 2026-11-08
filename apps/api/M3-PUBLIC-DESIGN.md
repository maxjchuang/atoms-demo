# M3 公网交付与后端设计候选（待主管 G0 冻结）

日期：2026-11-09。仅设计，尚无 M3 App/部署/隧道实施或外部验收。已读 AGENTS、M2 状态与 delivery 协议；只读查看 integration 最新 `875b048` 等提交，没有自行合并。主管报告 M2 已合入/安全升级，最后 controlled repair 由主管执行通过；本文件不替代其实际证据。私有 live 的 5173/3001/3002/4100 与 `data/review-real` 不用于 M3。

## 1. 固定范围与目录所有权

- 新的 Compose project `atoms-m3-public`，全新命名卷 `atoms-m3-public-api`、`atoms-m3-public-agent`。不复制、挂载或隧道暴露 live、真实验收临时目录、备份、宿主 HOME 或旧私有 SQLite。初始化要求空卷，不提供“自动找最近数据”行为。
- 主管仅管理/review/提交/运行验收；**后端线**独占 `apps/api/**`、`deploy/m3/**`、`scripts/m3-*`，经协调扩展根 `.dockerignore`，负责 compose、API/gateway 镜像、隧道控制、公开 deployment metadata/bootstrap。**Agent 线**独占 `apps/agent/docker/**` 与 Agent 运行隔离/受限 broker/controller；Web 仅自己的 UI、只读工具。共享 Schema 暂由后端唯一作者，先获主管批准、共享 G0 提交后消费者再实现。
- 首版仅一个 fresh reviewer code、一个公开演示项目，不重做账户/邮箱注册，不叠加 Cloudflare email auth。体验码持有人共享同一演示身份/额度；这不是多用户独立账户系统。
- 同一 preview host 的 localStorage/IndexedDB 属于同一 origin，目前**没有项目级存储隔离机制**。不通过命名 key 或 `allow-same-origin` 声称隔离。公开演示只放适合共享的样例数据，UI 明示浏览器本地存储/同源限制；不同浏览器、设备、隧道新域名不自动同步。源码/Run 的 owner 授权是另一层，不等于应用浏览器数据隔离。生产多租户独立 preview origin 后续另定。

## 2. 实际入口与可信边界

```text
外部浏览器 -- HTTPS workbench QuickTunnel --> 127.0.0.1:18080 workbench-gateway
  静态 Web dist + allowlisted /api/... --> api:3001
外部浏览器 -- HTTPS preview QuickTunnel --> 127.0.0.1:18081 preview-gateway
  仅 GET/HEAD /p/:cap/* --> api:3002（独立 preview Fastify listener）
API -- 内部认证HTTP --> Agent可信控制面 --> 受限broker --> 单任务Linux build/browser容器
```

网关、端口与卷配置由后端实施，Agent 不改网关。API/Agent/broker 无宿主公开 ports；容器内必要监听 0.0.0.0，但只有两个 gateway 绑定上述宿主 loopback 端口。网关默认拒绝未知 Host/路由，workbench 仅代理 `/api/v1/**`、`/api/v2/**`、`/api/delivery/v1/**`、新 `/api/sharing/v1/**` 的已知公共路由；`/internal/**`、DSH 管理、broker、metrics、Docker、源码目录与任意 upstream 一律 404。preview 网关不服务工作台、`/api/**`、登录、源 ZIP 或 evidence，不信任 query 中的 proxy URL/path。

API 仍是发布权威。preview 专用端口只读已发布 manifest 的 dist 文件，不执行源码；previewSecret/API 状态只属于可信后端，不进入生成应用。首次不为了部署重写现有 preview 为另一业务服务。对生成应用的脚本、截图、ZIP 的安全 MIME/附件政策及 M2 发布 fence 保持。

Agent 已确认的设计边界：模型/DSH 会话与密钥在可信控制面；不可信 builder/browser 分别在非 root、cap-drop、no-new-privileges、只读 rootfs、受限 tmpfs/cgroup CPU/mem/PID/磁盘/硬时限的 Linux job 中。任务仅获校验后的输入快照/专用卷，不挂 API 数据、DSH HOME、模型 Key、平台工作树、Docker socket。全部不可信 job 的 network 均为 none。固定 public-lock tarball store 在可信镜像构建阶段预取并核验完整性，按任务复制私有 store 后 offline frozen install，缺 cache fail closed；不使用 job registry egress 代理，禁生命周期脚本；浏览器与当前 app 同 job loopback，禁止访问其他 job/API/工作台/互联网。取消杀整个 job，并确认停止/代际 fence 后才结束。Docker 控制只能在私有受限 broker；API/Web/不可信 job 不拿 socket。具体 broker typed policy 由 Agent 提案、主管冻结，不能让模型拼 Docker 命令。

## 3. 体验码、Cookie、权限与资源限制

保留独立体验码登录，不把公网地址当鉴权。宿主 CLI 生成 32 个随机 bytes 的 base64url code，只保存 hash 到 fresh SQLite；明文放 0600、仓库外运行时文件，不能进 URL、镜像、日志、fixtures 或浏览器 bundle。建议 code 24h、session 最长 1h 且不晚于 code 过期；公开 profile 一码/全局一个项目、3 次代码任务、15 次协调消息，协调每码 6 次/分钟。既有 Run 总预算不扩大；首次 billable 计次、预占/取消/过期/重启沿用权威状态。

当前实现的默认 demo seed 是固定码/7天、session 7天、项目3/Run10、登录进程内20次/分钟，不能原样作为公开 profile。M3 需要独立 host-only issue/revoke/expiry CLI 和配置，不使用生产禁用的 `ATOMS_ENABLE_DEMO=true` 绕过规则；公共 HTTP 不新增发码/配额重置/管理员入口。建议入口登录 IP 5次/分钟 + code-hash 5次/分钟，余读限流由 gateway 按预算保护；正确识别可信 gateway 的 client IP，不让任意 `X-Forwarded-*` 成为身份或 Origin。

Cookie 保留 host-only（无 Domain）、HttpOnly、Secure、SameSite=Lax，Max-Age 与真实 session 过期一致；preview 不收/不设该 cookie。公开 unsafe 方法必须有当前精确 workbench Origin，不接受缺失、`null`、旧域名或 wildcard；不信访客 Host/X-Forwarded-Host 改写 canonical origin。gateway 将正确 public Host/proto 传给 API，并只信专用 proxy 边界。公开 API 不开放任意 credentialed CORS。

登录以外所有项目/Run/版本/证据/导出/diff/sharing 都验证 owner；无权与不存在统一 404。code 过期/撤销立即拒绝新操作与 preview capability；未派发的排队任务不再启动，活跃任务走真实 cancel/停止确认，不伪造停止或退回已消费次数。此过期调度/preview owner-code 检查为 M3 实施项，不能只依靠前端倒计时。

## 4. 最小 Sharing G0 精确候选

独立 `@atoms/contracts/sharing`，`SharingProtocolVersion='0.1.0'`；`X-Atoms-Sharing-Version: 0.1.0`，prefix `/api/sharing/v1`。不改旧 strict DTO/enum，不建 share 表、shareId、action 记录或模型 wrapper；Id/Timestamp/错误基础字段复用 contracts。以下是待主管批准的精确字段，尚未写 Schema：

```ts
SharingReason = 'LOCAL_ONLY' | 'NO_PUBLISHED_VERSION' | 'DEPLOYMENT_UNAVAILABLE';
SharingDescriptor = {
  protocolVersion: '0.1.0'; projectId: Id; subjectVersionId: Id | null;
  deploymentInstanceId: Id; asOf: Timestamp;
  scope: 'local_only' | 'public_temporary' | 'unavailable'; temporary: boolean;
  appPreview: { available: boolean; reasonCode: SharingReason | null;
    audience: 'anyone_with_link'; capabilityTtlSeconds: number | null };
  buildEntry: { available: boolean; reasonCode: SharingReason | null;
    audience: 'experience_code_required'; requiresExperienceCode: true };
  externalVerification: { status: 'unverified' | 'verified';
    verifiedAt: Timestamp | null; subjectVersionId: Id | null };
};
ResolveSharingRequest =
  | { kind: 'app_preview'; versionId: Id; expectedDeploymentInstanceId: Id }
  | { kind: 'build_entry'; expectedDeploymentInstanceId: Id };
ResolvedSharing =
  | { protocolVersion: '0.1.0'; kind: 'app_preview'; projectId: Id;
      subjectVersionId: Id; deploymentInstanceId: Id; scope: 'public_temporary';
      temporary: true; audience: 'anyone_with_link'; issuedAt: Timestamp;
      url: HTTPS_URL; expiresAt: Timestamp }
  | { protocolVersion: '0.1.0'; kind: 'build_entry'; projectId: Id;
      deploymentInstanceId: Id; scope: 'public_temporary'; temporary: true;
      audience: 'experience_code_required'; requiresExperienceCode: true;
      issuedAt: Timestamp; url: HTTPS_URL; expiresAt: null };
```

- `GET /projects/:projectId?versionId=...` 返回 URL-free descriptor；省略 versionId 时绑定当时 current 已发布版本，无版本为 null。指定外项目/未发布版本 404。available 与 reasonCode 相反；available 只在 public_temporary，temporary 必为 true；没有 subject 时 appPreview 不可用，buildEntry 可在配置 ready 时使用。
- `POST /projects/:projectId/resolve` 点击时重验归属、版本已发布与 `expectedDeploymentInstanceId`。epoch 不同 409；host 不 ready 503；local_only 不提供可被误认为公网的链接；未授权 401/404；限流 429。基础错误 envelope 复用现有 code（CONFLICT/RUNTIME_UNAVAILABLE/INVALID_REQUEST 等）+requestId，不新增旧枚举。
- app_preview 固定 subjectVersionId，绝不悄悄换成新版本。fresh cap 最长 900 秒并不晚于 code 过期；响应 URL 只能是当前 host 声明的 preview HTTPS origin+受控 `/p/` 路径，无 userinfo/query/外部 URL。任何持该链接的人可在有效期内只读运行此版；它不是工作台登录或源码权限。
- build_entry 返回当前 workbench HTTPS origin 的 `/` 登录入口，不含 code/session/owner 写令牌，也不自动向别人发消息。expiresAt=null 表示没有可承诺的确定隧道寿命，**不表示永久**；temporary=true 文案必须说明停服/重建失效。
- POST 是只读 capability 解析/签发，没有消息、Run、配额消费或 share 业务写入。重复请求可返回 fresh 短期 cap；不套用旧业务 mutation 幂等缓存返回已过期/旧 epoch 的 URL。接口本身不创建“用户已部署”的行为事实。
- descriptor 不含 URL/体验码/secret/内部地址；resolve 的 URL 仅送 browser，不进 prompt、对话、memory 或 Router snapshot。分享不会改变 M2 quality，partial/legacy 的具体状态继续由 delivery view 诚实展示。

`deploymentInstanceId` 是宿主生成的独立随机 ID，代表 origin/preview signing key 配置的一代；不从 secret 派生。重启但配置不变保留 ID，origin/key 变化必须换 ID。host-only receipt 必须匹配当前 epoch 与被实际外部验证的 subjectVersionId 才令 externalVerification=verified，verifiedAt/subject 不能为空；没有 receipt 或换版/换域则 unverified。它是外部浏览器验收的宿主回执，不能由模型/访客写入；配置 ready 与 G5 已验证是两回事。

旧 `context.facts.deployment` 可直接表达 URL-free host 配置（scope local_only/public/unavailable、publicDeployment）；不扩 CoordinationFacts 或重算旧请求 hash。新 Turn 首次冻结时才使用当前配置。M1 deployment_help resolver 根据当前 host 事实解释临时链接/体验码/验收状态，不建 Run。即使 publicDeployment=true，模型 URL/永久上线宣称仍不可信；链接必须由上述 browser resolver 获取，不能放行模型字符串作为导航。

## 5. 双 Quick Tunnel 与轮换

[Cloudflare 官方 Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)（2026-11-09核对）明确：无需账户/域名；URL 是临时 trycloudflare.com，停进程失效、重新创建换 hostname；无 uptime 保证，每 tunnel 最多200个 in-flight，超出429，**无 SSE**。保留当前 execution `/api/v1/projects/:id/events` 和 conversation `/api/v2/projects/:id/conversation-events` cursor 轮询、workspace 刷新与 delivery 读取；429/断网退避/恢复不重建消息或 Run，不以 SSE 测试代替公网轮询。

```sh
# G0之后由主管运行；现在不执行，不使用旧live端口
cloudflared tunnel --url http://127.0.0.1:18080
cloudflared tunnel --url http://127.0.0.1:18081
```

仅这两条已由官方 Quick 文档直接给出的 `--url` 形式是基线；`--protocol http2` 只作 UDP 受限诊断备选，auto 默认 QUIC/可退 HTTP2。loglevel 保持 info，不启用会记录 headers/URL 的 debug；metrics 仅 loopback，不代理公网。`--no-autoupdate` 对交互/包管理安装并不适用，不能当稳定性保障。[官方参数说明](https://developers.cloudflare.com/tunnel/reference/run-parameters/)、[官方安装](https://developers.cloudflare.com/tunnel/downloads/)。不叠加 `--allowed-mail`；我们的独立体验码仍是工作台认证。

启动：fresh Compose/卷先只读维护状态→分别启动两个 tunnel并取得URL→宿主验证两个不同的 HTTPS trycloudflare origin→原子配置 gateway 精确Host、API allowedOrigin、PREVIEW_PUBLIC_URL、独立 signing secret/epoch→ready后再允许公开登录/写入。Origin/bootstrap 控制只在宿主，不加公网管理员 endpoint。API 的 publicDeployment 表示此 host 配置 ready，不表示外部验收已过。

轮换：先停止新业务准入、保留读取/已有事件，等待全部 Run/Turn drain（确需取消也要确认停）→重建 tunnel→换 deploymentInstanceId/origin，preview host/key 改变时轮换 previewSecret→原数据卷不变并重启/重载→重新外部验证 receipt。M2 已有 preview cache 能在 key/origin 改变时重建 URL；旧 key cap 在新 origin 上应403，旧 descriptor resolve应409。workbench hostname 改变后 cookie 不跨域迁移，用户用原体验码重登录，owner/额度不重置。预览数据按 origin 变化不保证延续，UI不能承诺。

所有有凭证的 API、evidence、source ZIP 和签名 preview/资源响应加 private/no-store，网关/边缘不可缓存过期或已撤销 capability；日志屏蔽cookie、code、token以及 `/p/:cap/`，模型与截图不显示内部URL。

## 6. 持久卷、secret 与镜像

API public 卷保存SQLite/WAL、幂等记录、报告、版本、精确archive与代码quota；Agent public 卷保存其账本/可信会话，job临时卷按任务隔离并有清理策略。重启不重 seed/重跑模型；持久卷备份按drain/停服或SQLite一致性策略执行，不能只拷贝主db丢WAL。API配置状态与origin epoch持久保存；secret不放public metadata。

build context采用白名单COPY与根.dockerignore，排除`.env*`、data/**、各级node_modules、DSH/session/cache、review-artifacts、密钥与私有logs。构建不得以ARG/ENV传模型key，不以COPY后删除隐藏历史层泄漏；runtime secret文件只挂可信服务，既不挂job也不进源码ZIP。当前API启动依赖tsx且contracts导出TS，不能假设`pnpm --prod`裁掉工具后仍能启动；后端Dockerfile需实际启动健康门禁。Node固定26.5.0兼容>=24.9，pnpm10.33.0/frozen lock；Linux arm64浏览器/依赖在Agent job镜像实际验证，不借macOS测试证明。

只读本机检查：Docker Engine29.5.2、Linux arm64/cgroupv2能力由Agent报告；现有atoms-gateway:local digest `28ce4227…291ae32`、atoms-runner:local digest `d19fe13f…ed67d`，均本地标签，未获得可追溯source/revision标签。不能因存在镜像就复用为可信G5产物，需主管审来源或按冻结Dockerfile重建并记录digest。主管已确认缓存精确tag `public.ecr.aws/docker/library/node:26.5.0-bookworm-slim`；构建时核验并固定官方RepoDigest，不猜node:26.5简称或26.5.2。cloudflared现已只读发现2026.10.7（此前missing状态已变化），未创建任何 tunnel。上述检查未输出image Env/history命令或任何Key。

## 7. 拟交付命令与实际验收门禁

以下部署/控制脚本名称是G0后待实施接口，当前不存在，不声称可直接运行：

```sh
# 后端交付，主管review后运行；secret只来自仓库外0600文件
pnpm m3:preflight --profile public --fresh
pnpm m3:up --project atoms-m3-public
pnpm m3:issue-code --code-file <private-runtime-file> --ttl-hours 24 --projects 1 --runs 3
pnpm m3:tunnels:start
pnpm m3:origins:apply --public-manifest <generated-public-origins.json>
pnpm m3:verify:external --workbench <https-origin> --preview <https-origin>
pnpm m3:drain
pnpm m3:tunnels:renew
pnpm m3:down                 # 不隐式 -v/删除数据
```

| 门禁 | 必须留实际证据，不能用配置截图替代 |
| --- | --- |
| G0 | sharing独立Schema/fixtures/正反测试、broker/volume/secret policy及compose路径审批，同一提交起步 |
| 容器/网关离线 | 构建context与image层不含secret；任务容器不能读宿主/其他卷/Key/socket、不能达内部API；限额/恶意脚本/取消整job实际探针由Agent与主管跑；两GW路径/Host/穿越/未知路由403/404 |
| 公网登录/双轮询 | 独立外部浏览器真实HTTPS登录、Secure host-only cookie、未登录401/跨项目404/错误Origin或null-Origin写拒；execution与conversation增量轮询/刷新恢复/429退避，不能重建Run/重扣额 |
| 分享/资源 | 外部无工作台cookie的新浏览器只用固定版短期preview cap，实际JS/CSS资源与交互加载；工作台invite只到登录；source ZIP/evidence无认证拒；预览/API之间无cookie泄漏/内部路径/开放代理；partial质量缺口诚实可见 |
| 过期/轮换/重启 | code/session/cap过期与撤销实际拒绝；tunnel停/重建换域，旧descriptor409/旧cap403；新cap正常，receipt重置未验证；卷/版本/报告/双cursor/用量不变、不replay；localStorage新origin限制明确 |
| 公开数据边界 | fresh空间仅批准样例，旧live/备份完全未挂载/未隧道访问；单码单项目限制实际验证。单preview origin不做跨项目storage隔离成功声明 |

外部浏览器必须实际经过两个trycloudflare HTTPS域；localhost、容器curl、仅HTTP200、Fake/Mock截图不能抵G5。先无Key/Fake模式完成部署与恶意探针，再由主管决定有限真实调用；本设计不发起任何模型或公网服务。

## 8. G0需主管最后裁定/实现阻断

1. 上述sharing字段/epoch/audience/expiry和新header/prefix待批准后才写共享Schema/fixtures，先独立G0再App消费者；外部receipt先host只读JSON，不建share表。
2. 后端接管infra实现范围已获主管明确授权；Agent需冻结受限broker/job policy及Linux镜像，Docker socket只在可信broker，不先用旧镜像证明隔离。
3. 现有API缺public专用TTL/发码/撤销/expiry调度/严格Origin/preview-owner-expiry/no-store，属于M3实现清单；不假称现状已满足。gateway/client-IP/secret注入和轮换脚本必须实际门禁验证。
4. 固定镜像来源/digest与cloudflared当前安装来源须主管审查；版本可用不等于来源已审。无模型预算/协议validator放宽，无旧私有数据导入。
