# Requirements Web 第二批独立交付

日期：2026-11-09；共享 requirements G0 `241ce25`（主管同步到 Web merge `a16a096`），预算第一批已由主管提交为 `0bc3022`。本批仅 `apps/web/**`，未自行Git提交/合并、不改Shared/API/Agent/infra、不读取Key、不调用provider或运行用户生成源码。下文是Web+Mock证据，不是实际API/Agent/NLP/3D生成修复/G5证明。

## 实现范围

- 新 `requirements-api.ts`：独立版本头/路径、严格Schema；project/proposal绑定；独立WebCrypto重算canonical snapshot/summary SHA256（仅去各自顶层hash）。来源结构和hash校验不是自然语言语义/实际源码可用性的证明，后者仍由API/Agent及用户完整审阅负责。
- 新 `Requirements.tsx`/CSS：默认展示权威完整goal、累计验收和实际empty/published base；当前快照方案在前，原始source条目及requested/suggested/confirmed、active/withdrawn/superseded状态、明确排除/替换与来源quote完整保留。验收要求不是已通过结果，不用TSCpass或绿色勾伪装应用功能成功。
- typed accept绑定summary/proposal/snapshot revision/hash与精确base，只能审阅后显式授权。旧bound proposal改为完整方案导航，不提供旧accept按钮；旧未绑定路径也先GET核对，只有明确NOT_FOUND才走原流程，其余读错fail closed。Mock旧v2绕过请求实际409，没有新Run。
- “整理完整需求”只填可编辑草稿；Composer显著标注仅整理现有scope、不增撤销，不自动发送或构建。reviewMode固定ask/plan，真实点击“发送整理草稿”才POST typed review，保留用户发送的实际文字（含首尾空白/换行）。用户可退出到普通消息并保留草稿；普通消息仍原v2入口，不用关键词猜purpose。
- 预算PLAN_REVIEW_REQUIRED路径现在先readonly获取当前快照再填整理草稿，不付额、不直接发消息/Run，不重写旧失败报告。来源/目标若需修正须走新明确审阅和新授权，追加预算不能修正错误冻结验收语义。
- mutation key按路径+请求body哈希保留，不将草稿明文放进storage key；网络未知保留同key。响应绑定/hash完整核对后才清key；不自动重造授权。UI处理旧snapshot/base、不可读源码、错误hash和异步subject；接受单任务仍由API唯一性/配额事务最终保证。

Mock在HTTP边界提供独立合成authority与显式outcome recipe；默认保留原M1兼容场景，不声称其是生产语言合并器。三轮ask源测试由共享shape fixture或显式change outcome提供；普通consult outcome不新增entry。作品集场景使用相同生产UI/client，无Tetris关键词分支。Mock review保留同key/同体回执、不会重复生成turn/scope/Run。

## 文件

新增：`src/requirements-api.ts`、`src/Requirements.tsx`、`src/requirements.css`、`src/mock/requirements-handlers.ts`、`test/requirements.test.ts`、`e2e/requirements.spec.ts`、本文。

修改：`src/App.tsx`（typed review草稿状态和实际发送）、`src/ProjectConversation.tsx`（authority读取/统一方案/旧路径保护/预算回审阅）、`src/mock/browser.ts`、`src/mock/coordination-handlers.ts`（只导出Mock协作seam）、README。`MULTITURN-REQUIREMENTS-DESIGN.md`保留设计来源，可随本批提交。

## 实际执行的验证与失败记录

| 命令 | 结果与边界 |
| --- | --- |
| contracts check/test | 122/122通过；未改共享定义 |
| Web check/test | 完整78/78通过（已接受72+新增requirements6） |
| Web build | 通过；最终复跑产物约485KB JS；不带Mock fixture/handler |
| requirements Mock第一轮11 | 10过/1失败：StrictMode identity effect cleanup置空后未恢复，accept回执被自己的late fence丢弃，UI busy未结束 |
| 修正StrictMode绑定后定向three-ask | 1/1通过，4.8秒；真实问题保留，不改写首次结果 |
| requirements扩展独立12 | 12/12通过，16.0秒 |
| `playwright test e2e/requirements.spec.ts e2e/coordination.spec.ts e2e/budget-recovery.spec.ts`（5193） | 36/36通过，2.0分钟：requirements12、原协调8、预算16 |
| 原样保留草稿首尾空白/换行后定向review+两尺寸 | 3/3通过，6.0秒；不冒称完整36再次重跑 |
| Mock review同key回执补测 | review单项1/1通过，4.4秒；随后最后review+两尺寸3/3通过6.0秒，含同key重复HTTP仍单review、零Run/scope变化 |
| 最终check/build/diff | 通过。最后增加测试时出现回调变量被TS收窄成never的测试类型错误，改为类型明确的捕获数组后check/build已过；不是实际wire或产品故障 |

6项新增单元覆盖：独立Node/WebCrypto canonical hash一致及改文拒绝；最初目标+全部requested增量保留；stale/真实published base绑定；真实可编辑review body+ask/plan回执；丢回应稳定key/缺版本/错误hash不回退legacy；跨项目快照拒绝。

12项浏览器覆盖：三ask完整源与typed接受唯一Run、旧accept409；填稿零发送/编辑原文typed review零Run和同key回执；普通ask三轮精确保留、consult不新增；建议/替换/通用作品集；stale禁接受；缺源码；published base+错hash拒绝；预算回审阅只填draft；1440/390可读。全部明确Mock，无模型用量或历史用户3D重跑。

最后生产dist文本检索未发现 `atoms_web_mock_requirements`、`Synthetic Mock`或共享fixture中的游戏源句；HTTP错误不会启用Mock。普通单测/浏览器无需API/Agent或Key。

## 截图、复跑与剩余门禁

截图在不提交的 `review-artifacts/requirements/`：`full-review-1440.png`、`full-review-390.png`（完整目标和真实空基线在主区可见、14/12字号、内部滚动）、`accepted-complete.png`。前端已目视两尺寸；源码与quote文本安全转义，长文本不撑出页面。主管还需独立视觉review/测试。

root复跑建议 `ATOMS_MOCK_PORT=5194`（先确认空闲），避免复用live5173。实现线5193已退出。契约/单测日志在本机不提交目录 `review-artifacts/requirements/{contracts,web-unit}.log`。

本批可提交给主管独立review，最终API真实HTTP、Agent完整source/semantics、历史导入不变、跨session接受/幂等及实际生成/修复质量由各线Fake门禁和root联调证明。结构覆盖/hash不能保证模型正确理解全部自然语言。现用户旧3D记录/错误DSL/原报告均未修改；当前无新增真实模型、Intel Docker认证或公网验收声明。

## root独立初审与typed review迟到回执限定修正

root已独立通过修正前的check、完整78单元、build及38浏览器（5194，2.3分钟），并目视完整scope/source/hash、14/12和滚动布局。这38项属于下面迟到回执修正前，不回写为修正后全量。

root静态审查发现typed review沿用了普通submitPrompt的无条件清draft/open/loadCurrent：发送后离开项目可能被晚到回执拉回，且不匹配context可能退化普通消息。按限定授权将typed review分成独立分支：发送前snapshot/state/真实hash路由subject必须相同；不符直接提示重新选择整理，零普通POST。捕获project、generation与operation对象；旧回执/错误/最终busy更新只属于该operation，切项目释放其UI ownership，后台已授权turn继续而不是被取消。

同项目只有draft和review purpose仍是原对象/原文字时清理，新的草稿/新purpose保留。typed路径不再调用open旧项目。loadCurrent与refreshProjects增加可选canCommit（默认true），只有typed路径传ownsView，读取内外均检查，原普通发送语义不变。

新增1个纯subject谓词单元及3个慢回应/导航浏览器：离开项目后保留新dashboard草稿且不拉回；同项目新草稿及明确review目的保留；路由变化瞬间旧context不降普通POST。Mock保存合法review回执后延迟HTTP响应，证明已授权结果仍存在、无Run，不用provider或用户源码。

最后实际复验：Web check通过；requirements定向7/7；`ATOMS_MOCK_PORT=5193 ... playwright test e2e/requirements.spec.ts --grep 'slow review|subject mismatch|review shortcut|ordinary ask|budget PLAN'`6/6（12.8秒）；build/diff通过。当前requirements文件共15项（原12+新3），完整单元应79项（原78+新1），本线未声称修正后全41浏览器/79单元已重跑。root可独立跑受影响集合后提交，代码现稳定。
