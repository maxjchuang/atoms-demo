# M3 Web 分享与外网体验设计（G0 候选，未实施）

日期：2026-11-09。唯一写入范围 `apps/web/**`。本文是设计与协议消费要求，不是新增功能、协议冻结、外网部署或验收证明。G0 冻结前不实现，不改共享 contracts，不调用模型，不启动隧道或部署。

## 1. 基线、检查范围与边界

- 已读取根 `AGENTS.md`、`docs/architecture.md`、`docs/public-api.md`、`docs/protocol-v0.2.md`、`docs/protocol-delivery-v0.1.md`、`docs/parallel-plan.md`、`docs/m2-parallel-plan.md` 和 Web M2 设计。
- 本工作树 `feat/web-delivery` 的设计起点 HEAD 为 `f0f60fc`。首次只读比较 `HEAD..feat/trusted-delivery -- apps/web` 无差异，没有待合并的集成前端变更；未执行 merge。主管后续报告 M2 已接受并升级 live，当前公共同步目标为 main `8d21259`；本工作树在候选设计提交后由主管统一同步，不自行合并。
- M1/M2 的状态以主管验收记录为准；本文不追加受控修复结果或改写旧证据。工作树内部分旧状态 MD 是历史记录，不能据此声称 M3 已部署。
- 现有 Web：`HostAction.tsx` 在点击时解析 M1 opaque action；工作区已有版本预览、M2 质量/具体缺口、报告、精确 ZIP 下载、只读服务审计。M3 必须保留这些边界。
- Web 只拥有交互、公共 API client、Mock 和浏览器验收。API 负责受信外部地址、签名、Cookie、配额、授权、隧道配置与实际部署事实；Agent 负责 OS/网络/资源沙箱。Web 不安装/控制 cloudflared，不访问 Docker socket、DSH 或内部服务。

## 2. 两种不同的分享目标

| 入口 | 授予的能力 | 不授予的能力 | UI 主说明 |
| --- | --- | --- | --- |
| 分享应用预览 | 持有链接者在有效期内打开固定的已发布 Version，操作该应用 | 工作台会话、项目源码/报告、模型调用、改平台项目/生成新版本 | “分享 Vn 应用预览；链接持有者可访问，截止时间见下方” |
| 邀请体验构建 | 打开工作台入口，自行输入体验码后在该码配额内使用 | 当前用户项目归属、当前会话、体验码自动发放、生成次数保证 | “发送工作台入口；对方仍需体验码，代码另行提供” |

“预览只读”仅指不能修改平台项目和版本；生成应用自身的输入、按钮及浏览器本地存储仍可交互，不笼统称应用不可写。预览链接本身是 bearer capability，不等于链接保密或访客身份认证。源码下载仅保留已有有会话/归属检查的入口，首版不做匿名源码分享。

复制链接只操作本机剪贴板，不代用户发送消息。邀请入口不拼接体验码、Cookie、API Key、项目私有 ID 或会话到 query；退出登录、换浏览器或清 Cookie 不重置服务端额度。

## 3. UI 布局与交互

### 3.1 入口位置与版本固定

- 预览工具栏增加有文字标签的“分享”，版本卡片可使用同一入口；打开对话框时固定 `projectId + subjectVersionId`。
- 无成功发布版本时不提供可用的“分享应用”按钮，解释“尚无已发布版本，可先邀请体验构建”。失败候选、正在构建的 workspace 不得生成预览分享链接。
- 当前旧版仍可分享，即使新任务 blocked；明确“当前分享 V2，本次任务未交付”。不会因为弹窗期间发布 V3 就静默改分享目标；提供“切换到最新已发布版”的显式操作。
- 分享界面显示该版本的 M2 质量标签和主要具体缺口；复制成功不改变 complete/partial/blocked/legacy，不用“成功上线”替代“链接已复制”。恢复版保留“复用原约定证据，未重跑”来源说明。

### 3.2 分享对话框

两个清晰分区：“应用预览”和“邀请构建”。首屏信息按以下顺序展示：

1. 分享对象与固定版本；质量和具体缺口仍然优先。
2. API 声明的可访问范围：公网临时 / 仅本机 / 暂不可用。
3. 预览链接到期时间，使用明确日期、时间与时区；工作台入口通常没有可保证的截止时间，应显示“随演示服务/临时隧道停止失效”。
4. “临时域名；电脑休眠、断网、服务停止或隧道更换后可能失效。不承诺持续托管。”
5. “复制应用链接”或“复制工作台入口”；次要操作“在新窗口打开”。

链接来自 API 可信解析，不使用 Router 文本 URL，不在模型上下文、业务消息记录、URL 日志或错误遥测中保存 capability。界面可以显示可选择的 URL，但普通状态日志仅记录 version/action/部署实例等不含令牌字段。

### 3.3 剪贴板、新窗口与续签

- 点击复制时重新检查服务端授权、选定版本、部署实例与有效期；接口返回后再次核对当前弹窗 generation/subject，过期响应不覆盖新版本。
- `navigator.clipboard.writeText` 拒绝、不支持或非安全上下文时显示“浏览器未允许自动复制，请选中链接手动复制”，提供只读文本框和选中按钮；不能显示“已复制”。成功仅表示浏览器剪贴板操作成功，不表示收件人打开或公网链路已验收。
- 不自动触发浏览器权限申请，也不以无反馈的 execCommand 回退宣称成功。复制/打开只由用户点击触发。
- 打开新窗口延续 M1 预占窗口模式；`opener=null`，被阻止时展示可点击链接。读取或复制错误关闭预占空窗口。
- 预览 capability 临近到期允许显式“更新链接”。提示“新链接不会延长已发出的旧链接”；旧链接按其原有效期失效。API 续签不改 Version 或制造业务事件。
- 有效期内同主体复用 capability，避免每次轮询都更新 iframe src；到期续签重新加载预览是已知限制。剪贴板内容不会被后台静默替换。

### 3.4 必须覆盖的异常状态

| 状态 | 展示与操作 | 禁止行为 |
| --- | --- | --- |
| 读取中 / 解析中 | 按钮忙碌，可取消弹窗，不丢当前预览 | 提前显示可分享成功 |
| `local_only` | “仅当前电脑可访问”；可打开本地预览，不提供公网分享承诺 | 把 localhost 链接标成对方可访问 |
| 无已发布版本 / 已无权 | 解释原因；无权与不存在采用 API 404 语义 | 复制旧候选、泄露另一访客资源 |
| 签名到期 | 明确旧链接到期，可重新解析 | 从 iframe load/跨源 403 猜测有效期 |
| 部署实例/临时域名变化 | “入口已变更，请获取新链接” | 拼接新 host 与旧 token 或自动宣传旧域名仍可用 |
| 401 / 体验码失效 | 重新输入体验码，保留未发送输入与固定分享意图，登录后重新鉴权 | 自动重放消息、创建 Run、自动消耗模型额度 |
| 403 配额耗尽 | 分清项目/生成/协调额度；已有预览/合法下载仍按权限可用 | 因生成次数为零就隐藏可读版本，或自行充值/换码 |
| 429 | 遵守 Retry-After，有限重试，可手动继续 | 无上限请求或自动新模型任务 |
| 503 / 断网 | 状态未知、保留当前已知结果并显示时间；重试只读解析 | 以服务不可达当版本被删除，或显示公网已验证 |
| 剪贴板拒绝 / 弹窗阻止 | 手动复制/明确打开入口 | 虚假成功提示 |

## 4. 候选 wire/API 要求（待三方 G0，不是既有接口）

保持 v1 execution、v0.2 conversation、delivery/v1 strict DTO 不变，不把 share kind 偷塞进旧 enum。Web/API 已设计协商采用独立 `@atoms/contracts/sharing`，sharing 版本 `0.1.0`、候选路径 `/api/sharing/v1`；最终 header 和字段名由后端作为本阶段唯一共享作者提交 G0，主管接受后消费者再更新。复用现有签名预览与宿主部署配置，不新增 shareId、分享记录表、账户系统或 SharingFacts 模型 wrapper。

### 4.1 不含 capability 的共享描述

`GET /api/sharing/v1/projects/:projectId?versionId=:selectedPublishedVersionId`：已鉴权/同项目，返回固定版本与两个目标的宿主描述，不含 URL/token。不启动 Router/Worker、不新建消息、不扣协调或生成次数。

每个选项需要明确以下信息，正式类型只在 contracts 定义：

| 字段语义 | 必要原因 |
| --- | --- |
| project/subjectVersion（构建入口不授予私有项目） | 版本与权限绑定，防止复制错版 |
| appPreview/buildEntry 可用性描述，解析 kind=`app_preview` 或 `build_entry` | 不混淆预览与生成能力，无需持久 action ID |
| available、reasonCode/用户可读原因 | local/unavailable/not-published/unauthorized 分开 |
| scope、temporary、deploymentInstanceId、asOf | 说明地址所属部署与事实时点，不猜公网能力；最终 enum 由 G0 固定 |
| requiresExperienceCode、audience=`bearer_preview/experience_code` | 访客认证和可用范围明确 |
| externalVerification=unverified/verified，verified 时有宿主验收时间/receipt | “配置为公网”不能冒充真实外部浏览器验收；不是前端自行健康探测后的结论 |

模型继续使用已有 M1 `CoordinationFacts.deployment.scope/publicDeployment` 作为 URL-free 宿主配置事实；无需新增模型 wrapper 或扩大 `AvailableAction/ContextReference`。`publicDeployment=true` 不等于 G5 已通过。自然语言咨询和宿主 `deployment_help` 可解释实际状态；所有可执行链接仍由浏览器点击时宿主解析。

### 4.2 点击时解析浏览器专用能力

`POST /api/sharing/v1/projects/:projectId/resolve`：沿用会话、Origin/Fetch Metadata。请求 union 为 `app_preview {versionId,expectedDeploymentInstanceId}` 或 `build_entry {expectedDeploymentInstanceId}`。API 核对归属、已发布版本和当前部署代际后仅解析/签发浏览器能力，不创建 Run、消息、分享业务记录，不扣额度、不取消任务、不自动公开代码。

成功响应必须有 kind、实际 project/subjectVersion、deploymentInstanceId、url、issuedAt/asOf、expiry（预览 expiresAt 必填；构建入口 validUntil 允许 null）、scope、temporary、audience，以及宿主临时链接说明；正式字段名由 G0 固定。API 只能根据受信外部 host 配置生成 HTTP(S) URL；生产必须 HTTPS，不返回任意传入 URL、宿主路径或内部地址。

- app_preview 指向**固定已发布版本**的现有签名资源路径 `/p/:signedToken/index.html`，相对模块与资源仍在 capability 路径下；不换成需要工作台 Cookie 的地址。
- build_entry 只返回工作台公开入口，绝不包含体验码、当前用户 session 或私有项目直达能力；它不保证访客拥有额度。
- expectedDeploymentInstanceId 过期返回 409，前端重新取描述再让用户重试，不把旧 token 搬到新 host。续签返回新 expiry；resolve 是安全可重试的只读 capability mint，不沿用旧业务 mutation 缓存以免回放过期链接。重试允许返回 fresh 短期 capability，不获得新业务权限；仍受限流约束。若 G0 要求 Idempotency-Key，必须明确其不永久缓存短期 URL 的语义。
- 真正的 origin/signer 轮换行为和签名失效机制由 API 定义并独立测试；不能宣传尚未实现的撤销功能。若只有到期失效，UI 如实说明。

### 4.3 宿主操作与 M2 下载边界

- 保留已有 `HostAction` 点击时解析、取消只定位目标任务的边界。预览 action 可共享底层解析，但“打开”和“复制/分享”必须有不同的用户反馈。
- 已有 M1 `deployment_help` resolver 不能继续硬编码“本机运行”，应按当前宿主配置/外网验收事实形成说明；不增加 Run/写入权。即使 `publicDeployment=true`，也不能放行模型拼接 URL、虚构永久托管或未证实的公网验收，链接始终宿主解析。Web 只展示可信 descriptor/resolution，不把 Router 自由文本 URL 渲染为可执行分享链接。
- 当前 M1 source_download 解析为旧 v1 路径；M3 不得让新分享入口绕过 M2 的导出质量与字节/hash 校验。下载保持 `ExportReadView` 和当前 subject 的已核对 ZIP；legacy 明确未验证。是否把旧 host download 引导至 M2 卡片，需由主管协调，不在本设计直接改实现。
- 所有这些操作均为宿主能力，不要求再发一条自然语言给 Router。问“如何分享”可得到真实宿主说明和受控 ref；不能为了复制链接创建咨询或构建任务。
- 共享选项不暴露额度给匿名预览访客。额度仍从现有会话视图获取，只在工作台显示；前端不复制其 DTO。

## 5. 预览、登录与公共访问政策

- 工作台与预览使用不同外部 HTTPS 主机；工作台 Cookie host-only / HttpOnly / Secure / SameSite=Lax，前端不读 Cookie 值。
- iframe 保留 `sandbox="allow-scripts allow-same-origin"`，不增加顶层导航、弹窗或下载授权；预览主机只提供签名静态资源，不能反代工作台 API 或内部接口。
- 当前不同项目共享预览 origin，实际未提供通用 project storage namespace，不得把“建议命名空间”写成已隔离实现。主管已接受公网评审范围为 **fresh 演示数据、单体验码/单项目**；API 在专用部署配置与配额落实此范围，不公开原用户数据。UI 明示浏览器存储非后端同步、同预览域非租户隔离。共享链接不承诺跨设备数据同步，也不宣称严格多租户存储隔离；本阶段不为此另造通用存储代理。
- 首版邀请构建采用体验码登录，不新增注册、密码或恢复账户。无/错/过期/已撤销体验码、会话过期、配额耗尽分别按 API 返回展示。体验码不硬编码在生产 bundle、不随分享链接发送。
- 新建/修改按钮按服务端配额/任务状态显示可用性；UI disable 是提示，实际准入仍由 API。现有等待输入、ask 只读、exact/latest、旧数据和 M2 partial 自动发布政策不改。
- “公网已验证”只可引用本次部署实际外部浏览器证据及时间/范围；后台 `/health`、隧道启动日志、开发者机器 localhost 或 Mock 成功不满足该语义。无证据时写“已配置公网入口，当前可达性以实际访问为准”。

## 6. 视觉与交互验收

延续 M1/M2 的信息层次：当前版本与具体质量缺口优先，分享是次要操作；不挤占验收面板，不缩小字体。正文 14px、元信息至少 12px、代码约 13px，禁止全页 zoom/transform 缩放。临时域名与 expiry 虽是元信息，但不能低对比度到不可读。

对话框键盘可达、Esc 关闭、焦点圈与打开/关闭后焦点恢复明确；复制结果用 `aria-live`，失败有文本，不只依赖颜色/toast。长链接在输入框/局部容器内滚动，不能撑破页面。至少覆盖 1440×900、1280×720 与 390px 宽度；小屏仍能访问原质量、预览和源码下载。

## 7. 三层测试门禁

### G1 Web 独立（不使用 Key）

G0 后使用 sharing Mock HTTP 与共享 fixtures 实现，不依赖 API/Agent 源码。覆盖：两种目标、固定版本/晚到响应、无版本/local/unavailable、expiry/续签、部署轮换、401/403/404/409/429/503、剪贴板拒绝/不可用、弹窗阻止、安全文本、关闭弹窗不取消后台任务、M1/M2 回归和字体尺寸。

断言复制/打开/描述读取不 POST messages、不 POST runs、不消耗配额；只允许冻结的 sharing resolve 写请求。生产构建默认无 MSW，不允许失败后静默回退 Mock。独立测试仅证明 Web 行为，不是外网交付。

### G2 实际本地服务（不新建真实模型任务）

真实 Web/API 的会话、权限、签名、质量、精确下载；可用已有已发布版本或明确 Fake Worker 样例，但必须标来源。复用只读审计 guard 的思想：记录前后消息/Run/revision/quota/cursor，确认分享、续签、下载只读地不改变生成业务，分享 capability 自身的签发记录单独允许。

现有 `service-audit-guard` 明确只允许 localhost 隔离端口；不得为了跑公网验收直接放宽它或伪装外网为 localhost。新增外网审计工具必须在 G0/主管审阅后有独立模式、显式受信 domain allowlist、只读写方法白名单和不记录 token 的日志策略。

### G5 实际外部域名浏览器（唯一可证明公网分享）

由主管/API 完成隧道和 Agent OS 隔离门禁后，使用实际工作台域与不同预览域，普通浏览器与新无 Cookie context；不注册 MSW、不使用 route.fulfill 替代服务、不调用模型。至少留下以下真实证据：

1. 从外部工作台 URL 输入实际体验码，HTTPS Cookie/刷新会话有效；错码/无会话被拒绝。用量限制由实际 API 或明确隔离额度样例验收，不为截图消耗模型调用。
2. 在已有版本点分享，clipboard API 成功后读取实际剪贴板比对该次签名 URL；另测权限拒绝的手动复制反馈。自动化环境无法可靠读系统剪贴板时标未验证，不以 spy 返回值冒充实际复制证明。
3. 新无工作台 Cookie 的浏览器上下文打开所复制 URL，真实 HTML、React 模块、CSS 等资源加载成功并来源正确；不是仅 HTTP 200/health。
4. 在该共享应用实际交互、写入浏览器数据并刷新确认同一浏览器恢复；同时确认另一浏览器不被声称共享存储。保存样例操作和实际观察，不扩大为任意应用行为保证。
5. 签名到期/非法 token 与无签名资源路径实际拒绝；续签返回可用新地址，旧地址按实际政策失效。临时域名变化需主管控制，Web 不能自行重启隧道。
6. 回到有会话工作台下载所选版本精确 source.zip，复核实际 bytes/hash/subject；无会话和跨访客下载拒绝，不从匿名预览获取源码。
7. 外部工作台和预览域不能访问 DSH 管理、`/internal/**`、Runtime health/执行接口、Docker socket、任意宿主路径；预览源发起工作台写请求被拒绝。保存真实状态码与结果，不只断言链接未显示。
8. 浏览器/网络错误、Cookie 与签名 expiry 是不同状态；控制台/截图/追踪导出不泄露模型 Key、内部 token、体验码或完整 capability。

G5 报告记录实际域名（不含 token）、时间、版本、浏览器/上下文、组合模式、测试脚本与截图/网络证据路径，明确临时域限制。任何未通过项保留失败/未验证，不能用 G1 Mock、健康检查或 localhost 结果代替。

## 8. G0 决策与实施顺序

已由主管接受的最小边界：独立 sharing 模块、GET 项目描述与 POST resolve 两路、无 share 状态/新账户/模型 wrapper、旧 M1 URL-free deployment 事实复用、配置公网与实际验收分离、fresh 单码单项目和诚实同源存储限制。后端为本阶段唯一共享作者，统一 Schema/fixture/反例/tests；Web 只审查和消费。

G0 尚需冻结具体 header/字段及失败码、subject/deployment fence、链接期限/续签/轮换、既有 deployment_help 更新方式、M1 下载与 M2 下载导向、外网验收 receipt 来源。后端同时拥有 `deploy/m3`、`scripts/m3-*` 与 `.dockerignore`；Agent 拥有执行隔离资产，Web 不越界补实现。

冻结后 Web 顺序：独立 client/Mock → 分享/邀请 UI 与错误态 → host action 适配 → 独立测试/字体审计 → 主管 review 后合并 → 实际本地只读联调 → OS 隔离与双隧道就绪后 G5。不可在 G0 前开写实现或因分享 UI 完成提前开放公网生成。

交付时明确“已实现 UI”“本地服务已验证”“真实外网已验证”三个层次。本文当前只完成设计；不承诺上线时间、域名持续可用或未实现的撤销/多租户隔离能力。
