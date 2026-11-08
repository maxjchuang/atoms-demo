# M3 Sharing 协议 v0.1.0（G0 已冻结）

日期：2026-11-09。主管已独立审查共享 Schema/fixtures/tests，contracts check 与 97/97（既有86+新增sharing11）通过，统一提交作为消费者基线。**无 App/infra 消费者实现、实际隧道或公网验收声明。**唯一可执行定义在 `packages/contracts/src/sharing.ts`，样例为 `sharing-fixtures.ts`；不得另复制 DTO 或扩旧 strict enum。

## 1. 版本、端点与职责

- 子模块：`@atoms/contracts/sharing`；`SharingProtocolVersion='0.1.0'`。
- 公共前缀：`/api/sharing/v1`；请求/响应头：`X-Atoms-Sharing-Version: 0.1.0`，大小写按 HTTP 规则处理。消费者必须发送此版本，未知/缺失按 INVALID_REQUEST 拒绝。
- 原 execution 0.1、conversation 0.2、delivery 0.1 路由/headers/DTO 不变。相同版本字面值不表示同一协议。
- API 是 owner、已发布版本、canonical origin、部署代际、capability 签名/expiry 的权威；Web 点击时解析链接，仅展示/复制，不自动向别人发消息。模型不提供导航 URL、不签发链接、不创建分享资源。
- 不建 share 表、shareId、action 记录、账户注册或新模型 wrapper；配置/外部验收 receipt 由可信宿主维护，不是访客可写的共享业务资源。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| GET `/projects/:projectId?versionId=...` | `SharingDescriptorQuery`，仅可选 versionId | URL-free `SharingDescriptor` |
| POST `/projects/:projectId/resolve` | `ResolveSharingRequest` strict kind union | 浏览器专用 `ResolvedSharing` |

所有请求都使用既有独立体验码 Cookie 会话，先检查 code/session 有效和项目归属。无权与不存在统一404；指定版本必须是本项目实际已发布版本（包括合法恢复版），未发布候选不可分享。GET 未指定 versionId 绑定当时 current，若尚无版本则 subjectVersionId=null；resolve app_preview **必须显式带 descriptor 绑定的 versionId**，不得默认为最新或随异步更新换版。

## 2. URL-free Descriptor

完整字段以 Schema 为准，固定结构为：

- 身份/时间：protocolVersion、projectId、subjectVersionId（可null）、deploymentInstanceId、asOf。
- scope：local_only/public_temporary/unavailable；temporary 恰在 public_temporary 为true，其他必须false。这里 false 不代表地址永久，只表示未声明可用公网临时能力。
- appPreview：available、reasonCode（LOCAL_ONLY/NO_PUBLISHED_VERSION/DEPLOYMENT_UNAVAILABLE/null）、audience=anyone_with_link、capabilityTtlSeconds（可null）。
- buildEntry：available、同一 reasonCode、audience=experience_code_required、requiresExperienceCode=true。
- externalVerification：status=unverified/verified、verifiedAt（可null）、subjectVersionId（可null）。

不变量：available 当且仅当 reasonCode=null，且只能在 public_temporary；appPreview 可用还要求精确非空 subject 及整数 TTL 1..900，任何不可用 preview 的 TTL 必须null。没有已发布版时 appPreview 不可用，若公网工作台配置 ready，buildEntry 仍可用。local/unavailable 不返回“可公网分享”的能力。

配置 ready 与外部实测是两件事。配置 alone 的 fixture/响应为 unverified，两个验证字段均null。verified 必须是 public_temporary、有非空 descriptor subject、verifiedAt非空、receipt subject与 descriptor subject相同。真实服务还须核宿主 receipt 的 deploymentInstanceId、实际外部浏览器证据与当前代际一致，Schema 不伪造或证明这件事实。换域、换 signing key 或新 subject 没有匹配 receipt 时重新为 unverified，不把旧版/旧域的 G5 结果借给当前版本。

Descriptor 无 URL、code、session、服务token、内部路径、provider 配置或“项目浏览器存储已隔离”字段。访问状态不代表 M2 complete：partial/legacy 的质量仍通过 delivery view 诚实展示。

## 3. 点击解析、Audience 与有效期

请求是互斥 strict union：

```text
app_preview { kind, versionId, expectedDeploymentInstanceId }
build_entry { kind, expectedDeploymentInstanceId }
```

不能附加 URL、shareId、actor、Run 创建开关或体验码。build_entry 不接受 versionId，入口不是某个私有项目的权限授予。

响应公共字段为 protocolVersion、kind、projectId、deploymentInstanceId、scope=public_temporary、temporary=true、issuedAt、url、audience。额外字段：

| kind | audience | 特有字段与语义 |
| --- | --- | --- |
| app_preview | anyone_with_link | subjectVersionId、expiresAt；只读运行固定的已发布版，持链接者无需工作台 Cookie |
| build_entry | experience_code_required | requiresExperienceCode=true、expiresAt=null；仅工作台根登录入口，不自动登录或提供写权限 |

app_preview 的 expiresAt 必须晚于 issuedAt 且不超过900秒；API实际签发还受当前 code expiry/撤销和公共配置限制。`/p/:cap/index.html` 的现有 HMAC payload 必须绑定同一个 subject/expiry；Schema 只校验形状和时间，不验证签名或实际 origin authority。preview 的脚本/CSS/图片等资源也受 capability/owner-code检查及禁止缓存政策约束。

build_entry 的 null 不承诺隧道寿命，尤其不能解释为永不过期；UI需说明停服务/重建域名即失效。URL不得包含体验码、登录session、owner令牌；向同事发工作台入口不等于给出体验码或账户邀请。

共享 URL 字符串仅接受HTTPS，无 userinfo/query/fragment/控制字符/空白；preview 路径固定 `/p/<opaque-payload>.<opaque-signature>/index.html`，build 路径为 `/`。API必须再把 origin 与可信配置做**精确 authority比较**（scheme/host/port），不能用字符串域名后缀或模型文字。跨域、内部地址、open redirect、任意 path/URL 参数无解析权限。

POST 只进行 capability 解析/签发，不产生消息、协调Turn、Run、模型调用、生成/协调额度消费或share业务写入。重复请求可取得 fresh 短期 cap，不用旧 mutation 幂等缓存复用过期或旧代际 URL。若实现选择接收 Idempotency-Key，它不能跳过当前 epoch/expiry 验证，不代表增加业务对象。浏览器复制前应重新取descriptor/resolve；网络丢回应安全重试不能变成执行。

resolve URL 仅送浏览器，不写入 prompt、memory、消息、Router facts 或用户事件。API原有 Version预览URL cache仍按原策略处理，不据此建立分享表或改写不可变 source/report。

## 4. 部署代际与失败

`deploymentInstanceId` 是宿主独立随机 opaque ID，不是模型key/签名secret的hash。相同配置的普通重启保留；workbench/preview origin 或签名key变化必须换代。POST 先核归属/版本，然后检查 expectedDeploymentInstanceId；不允许回落旧域名、默默跟随另一个版本或返回旧cache URL。

使用现有 ApiError envelope/code，不新增旧枚举：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | strict DTO/版本头无效、缺epoch、任意URL/未知kind |
| 401 | UNAUTHENTICATED | 无有效会话/code过期或撤销 |
| 404 | NOT_FOUND | 项目/版本不存在、跨owner或尚未发布 |
| 409 | CONFLICT | 代际已变化，或local-only不能解析公网能力；刷新descriptor后由用户重新点击 |
| 429 | RATE_LIMITED | 解析入口限流，不触发模型重试 |
| 503 | RUNTIME_UNAVAILABLE | 公网deployment未ready，保留真实错误，不伪装local/legacy成功 |

响应对认证资料、cap、源下载使用 private/no-store；日志脱敏，不把Cookie、code、cap或原生凭证写入console。隧道重建由宿主先drain再原子更新 origins/key/epoch，原版本/报告/owner额度不重置；旧cap应失效，新cap点击取回。新workbench域名需重登录，新preview origin的浏览器localStorage不保证沿用。

## 5. 与旧协调和公开演示边界

旧 `context.facts.deployment` 已有 scope=local_only/public/unavailable 与 publicDeployment，继续只承载 URL-free 宿主配置事实，不新增 SharingFacts wrapper，不重算既存请求。publicDeployment=true 表示当前host已配置可提供分享入口，不能等同G5已通过或永久上线；receipt只有新descriptor展示。

M1 deployment_help resolver 按当时host事实给真实帮助，不建Run/扩权。即使public=true，模型也不能拼URL/承诺永久可用，浏览器只能用本协议解析；自然语言咨询不能因“分享”二字自动建任务。旧source_download继续M2鉴权与精确archive alias，不经无认证分享能力访问。

公开首版采用fresh单reviewer code/单项目；codeholders共享演示身份。双域隔离工作台cookie与应用脚本，但同preview域的应用浏览器存储没有项目级隔离，数据仅按浏览器origin保存，不等于服务器同步或多租户隔离。该限制在事实/帮助/UI呈现，不伪造namespace能力。

## 6. G0与后续验收

G0 fixtures仅是URL形状/DTO样例，没有活动隧道、真实签名、体验码或密钥。正反tests覆盖五种descriptor、scope/availability/TTL/receipt交叉约束、strict resolve/固定subject/epoch、HTTPS与路径/expiry/audience、安全错误及旧strict拒绝新字段。G0通过不等于已发布公网服务。

G0统一commit之后：API/Web分别用HTTP Fake/Mock并行；后端实现fresh卷、网关、auth/expiry/no-store/sharing与双隧道控制；Agent实现network=none任务隔离/可信离线cache/broker。主管实际外部浏览器经过两个HTTPS QuickTunnel验证登录、两条cursor轮询、资源、固定版分享、下载鉴权、过期/撤销/换代及无业务写/无重跑。无SSE假设；QuickTunnel上限/临时性见[官方文档](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。
