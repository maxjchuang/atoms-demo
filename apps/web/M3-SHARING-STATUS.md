# M3 Web 独立实施与验证记录

日期：2026-11-09。共享基线：sharing G0 `4eb886b`，后续 raw URL hardening `1dcc735`、isolation `88d8643`/exports `f3c3d5b` 已由主管同步。仅改 `apps/web/**`；未提交、合并、修改共享/API/Agent/infra、调用模型或创建隧道。以下是 Web G1，不是实际外网 G5。

## 已实现

- 独立 sharing HTTP client，严格 Schema/header、project/固定版本/kind/deployment epoch 绑定；preview 不同主机，build entry 与浏览器 workbench origin 精确相同。信任鉴权 exact resolver 为 canonical authority，不用旧 Version.previewUrl 阻挡合法轮换。
- 工作区与历史版本分享入口，固定已发布 subject、M2 质量/具体缺口常显；无版本只能邀请构建。分享不改变发布、质量、消息、任务或额度。
- 应用预览与体验构建入口分开，明确 bearer/体验码、临时性、到期/无承诺寿命、同码共享演示身份/额度、同源浏览器存储非租户隔离及非跨设备同步。
- 点击重读 descriptor，代际变化要求核对后重新点击；解析/关闭/切目标异步代次保护。网络、401重新登录、403/404、409、429 Retry-After、503、无版本/local/unavailable 不假报成功。
- 实际 clipboard.writeText 结果反馈；拒绝或缺失为手工选中复制。新窗口预占/阻止 fallback；过期链接不继续提供打开入口。
- 原 v1/v2/Delivery/HostAction 逻辑保留，正文14px、元信息12px、焦点/Tab/Esc和内部滚动。显式 Mock 向同一校验器注入合成 HTTPS workbench origin，生产使用 location.origin；无网络失败降级 Mock。
- 独立外网 audit helper 与 exact 双 HTTPS allowlist/只读守卫，不放宽原 localhost guard。它尚未运行；预先要求操作者声明 OS 门禁、已有批准项目/版本和 owner-only code 文件，严禁新消息/Run/第三域请求。

## 实际执行过的验证

| 命令 | 结果 | 范围 |
| --- | --- | --- |
| `pnpm --filter @atoms/contracts check` | 通过 | 共享契约类型，无修改共享 |
| `pnpm --filter @atoms/contracts test` | 101/101通过 | 共享契约/合成fixtures，不是实际公网证明 |
| `pnpm --filter @atoms/web check` | 通过 | 包含新增client、UI、Mock、测试与被测试的audit guard |
| `pnpm --filter @atoms/web test` | 64/64通过 | 既有56+sharing6+外网guard2，零模型调用 |
| `pnpm --filter @atoms/web build` | 通过（最终复跑见主管接收消息） | 生产bundle，不启用Mock |
| `pnpm --filter @atoms/web exec playwright test e2e/sharing.spec.ts` | 最终19/19通过，45.2秒 | 独立5183 Mock、真实浏览器，未访问外部合成域 |
| `node --check apps/web/scripts/check-sharing-external.mjs` | 通过 | 仅语法检查，不启动外网审计 |
| `git diff --check` | 通过 | 无空白错误 |

19项包含：实际clipboard write/read匹配（非spy成功）、构建入口无code/session、合成拒绝手工复制与Esc焦点、local/unavailable、无版本、409/429/503/断网、过期/错subject/同host拒绝、短期到期与弹窗阻止、弹窗中发布新版本仍固定旧subject、401恢复分享意图、轮换及关闭后晚到不复制、1280与390布局。新增3个用例只补既定expiry/固定subject/网络状态，不扩产品范围。

首轮完整16项为15过/1失败：390px setup错误等待小屏隐藏的“开启体验”按钮，不是API或分享逻辑失败；之后等待可见应用输入，390px单独复跑1/1通过，再执行上述完整19/19。首次类型检查发现test里DOM union和fixture nullable narrowing，均已改为显式类型处理；不把首次检查改写成通过。

`review-artifacts/m3-mock/`截图不提交源码：

- `share-partial.png`：1440×1000，固定V1、具体partial缺口、临时/存储说明、实际复制成功，链接输入已遮罩。
- `build-invitation.png`：工作台根入口与体验码/同码限制，输入已遮罩。
- `clipboard-denied.png`：合成拒绝后的手工复制，非成功。
- `dialog-1280.png`、`dialog-390.png`：可读尺度与内部滚动；390内部可滚动到“重新读取”。

前端已目视检查1440/390截图：保留质量卡片优先、14/12字号、未横向溢出，小屏对话框内部滚动。主管仍需独立视觉review和测试复跑。

## 外网工具与未通过门禁

使用方式和环境变量见 `README.md` 的“实际外部双域名审计工具”。helper只允许登录与typed capability resolve POST；GET/HEAD限定两个显式外部HTTPSorigin，拒绝MSW/Mock路径与第三域。浏览器请求仅continue/abort，无route.fulfill；凭证文件不写日志，cap路径脱敏、截图遮罩input，不启用trace。

实际执行时将验证外部Cookie/刷新、实际复制/无Cookie新context、模块与CSS/文档资源、批准样例新增编辑后刷新保存、M2精确源码ZIP实际bytes/hash、匿名源码拒绝、非法cap及内部路径拒绝，前后消息/Run/版本/双cursor/配额不变。脚本只操作已有settled项目，不新建任务或模型调用。

目前**未运行helper，也没有真实公网、Linux OS隔离、隧道或G5通过结果**。过期/撤销/换域/key轮换和错误Origin写入需后端/主管单独控制门禁；helper不自行操纵隧道或扩大权限。Mock的实际clipboard证明只覆盖Mock浏览器，不能抵充外部域名复制证据；本机测试或health也不能替代G5。

## 主管 review 后的限定补修

主管报告已独立复跑上述64项单测、build、19项Mock浏览器，并目视1440/390的14/12尺度和内部滚动。随后发现外网helper最初使用stat会跟随symlink，且owner-only并非exact0600；原2项guard测试不覆盖该文件边界，不能声称最初版本已满足。

按主管限定授权，仅修改：`scripts/external-sharing-guard.ts`新增受保护codefile读取、`scripts/check-sharing-external.mjs`调用该函数、`test/external-sharing-guard.test.ts`新增1项临时文件边界测试、`e2e/sharing.spec.ts`新增1项null→首次发布动态回归。产品UI行为没有变化，README同步该限制。

codefile现为lstat检查regular/nonsymlink/currentuid/exact0600，O_NOFOLLOW打开后fstat核对dev/inode及同样属性，再从已打开handle读取；清理handle，错误不携路径/内容/cause。临时测试覆盖正常0600、0400、0640、目录、symlink和缺失/无效内容，reject前后fetch调用为0。实际网络/浏览器仍未启动。

null→首次发布回归在弹窗捕获subjectVersionId=null后由显式Mock setup发布第一版，再重读descriptor（它此时确有nonnullcurrent），确认UI仍标未选定版本、app copy/open禁用、没有resolve请求，邀请入口可用。既有`canResolve`与activate二次检查已阻断静默换版，因此只补测试。

限定复验：`pnpm --filter @atoms/web check`通过；`pnpm --filter @atoms/web exec tsx --test test/external-sharing-guard.test.ts test/sharing.test.ts`9/9通过；`node --check apps/web/scripts/check-sharing-external.mjs`通过；`pnpm --filter @atoms/web exec playwright test e2e/sharing.spec.ts --grep 'dialog opened without a version'`1/1通过（5.0秒）。没有重复声称完整20浏览器或65单元已重跑，没有新增模型、外网或部署证据。

## 主管独立复验

主管已独立通过此前64项单测、生产build（包含类型检查）、完整19项sharing Mock浏览器（42.9s），并目视1440/390截图。针对随后限定修正，主管再次通过check、定向sharing6+guard3共9项和新增null→首次发布浏览器1项（5.2s）。没有把分段结果相加称完整65/20复跑，也未重复不受影响门禁。产物待与真实API、Linux隔离及外部域名联调；这一节不标G5完成。
