# M3 第二阶段操作候选（主管执行，尚未执行）

日期：2026-11-09。基础 infra 已由主管接受 `6a05d2f`。本页和三个新命令只提供后续操作编排；默认输出plan，不启动Docker认证、公网隧道或模型。本实现线只执行了 syntax/plan/guard 小测试。实际动作须主管审查后明确执行，不能把这些脚本存在当作M3/G5通过。

## 1. 独立 certifier operator

```sh
pnpm m3:certify --plan
ATOMS_ALLOW_M3_CERTIFY=1 pnpm m3:certify --project atoms-m3-public --actual-agent --certify
```

先正常drain，确认本project的API、可信Agent、正常Broker全停且Run/Turn无未完成工作，broker所有leases也确认停止。命令不自动停服务、不替用户答题。它用同一已审核trusted-Broker image建一次性operator，UID1000+实际socket GID、network=none、readonly rootfs、cap-dropALL/no-new-privileges、Docker log-driver none，只挂Docker socket、broker-data与broker-token。API/Agent数据、provider卷和模型Key均不提供。

资源明确分开：正式Broker仍256MiB；一次性operator额外2GiB、2CPU、256PID、/tmp128MiB；untrusted builder/browser原1.5–2GiB等限额不改。Docker VM最低5GiB（operator+最大job+余量）；不足时拒绝而不是OOM后误认probe失败。broker-data要求至少2GiB可用和100k空闲inodes；TMPDIR固定到broker-data/certifier-tmp，HOME另设certifier-home，不把offline cache/node_modules塞进128MiB临时文件系统。

Agent certifier须把父解析后的**实际sha256 JOB_IMAGE**传给每个smoke/child，TMPDIR也显式传递；不能父测固定digest而子用默认可变tag。Operator串行运行**11项实际门禁**（原10项+broker永不恢复时独立watchdog），最多70分钟总控制期限；正常Broker/Job策略不因测试扩额。失败保留0600完整日志，proof保持notready；若硬终止，主管检查实际owned jobs/lease后处理，不自动清扫别的资源。

成功必须是certifier实际原子落盘的 image/policy/cache/probe/evidence绑定，不能用环境变量、fixture、tag存在或旧日志声明ready。恢复正常Broker/Agent后读取认证的 `GET /internal/isolation/v1/capabilities`，再由主管对照当前job image、policy、cache、watchdog及toolchain生成配置。独立watchdog修复会改变这些binding，**不得提前stamp旧c62/ab64 tuple**。初始化尚未configured时API使用toolchain_unconfigured并拒绝生成，不回落旧host toolchain。

## 2. 双 Quick Tunnel 只指向已核验 loopback gateways

```sh
pnpm m3:tunnels plan
ATOMS_ALLOW_M3_PUBLIC_TUNNELS=1 pnpm m3:tunnels start --project atoms-m3-public
ATOMS_ALLOW_M3_PUBLIC_TUNNELS=1 pnpm m3:tunnels renew --project atoms-m3-public
ATOMS_ALLOW_M3_PUBLIC_TUNNELS=1 pnpm m3:tunnels stop --project atoms-m3-public
pnpm m3:tunnels status --project atoms-m3-public
```

start/renew要求实际认证isolation ready、当前job digest一致、业务drained/API已停；核对workbench/preview网关来自当前受审image且仅绑定127.0.0.1:18080/18081。目标分别为两个网关，永不指向Vite dev、API3001、Agent4100、broker4310、Docker、旧live或私有数据目录。构造独立0700 cloudflared HOME，避免读取操作者旧account/config；只使用官方 `tunnel --url`，不加email第二登录、不启debug。不假设SSE，仍走execution/conversation双cursor轮询。

controller保存PID、启动时间+命令fingerprint与角色/port，只能停止匹配的自有进程，PID重用/身份不符即拒绝。日志0600，不输出cookie/code/cap；成功stdout仅临时公网origins及下一步。QuickTunnel无SLA、最多200in-flight、重建域名改变、停止进程后URL失效，不承诺永久可用。

新origins经过严格HTTPS/不同host校验，原子更新host metadata/新epoch；preview域名改变时轮换signing secret。API仍须通过已审控制器重启，再由外部浏览器实际验证；配置完成不等于receipt verified。旧descriptor resolve409、旧cap在新origin403，owner/Run/Version/报告/额度不重置。停止connector本身不等于取消已授权的工作；停止/续签流程先drain。外部URL与preview cap只给浏览器，不喂模型或对话。

此脚本尚无实际tunnel成功证据，操作者须在最终拓扑/认证/role mounts通过后才执行；脚本不替代外部浏览器的TLS/cookie/资源/剪贴板/过期/轮询验证。

## 3. 最多一个真实 Code + 一个 mode=ask 分享咨询

```sh
pnpm m3:smoke-real --plan
ATOMS_ALLOW_M3_REAL_SMOKE=1 pnpm m3:smoke-real --project atoms-m3-public --run
```

前提：fresh公共namespace只有一个已发码身份、没有任何Run/Version/项目；actual Agent及Coordinator均dsh，UI image manifest为dsh；最新实际isolation proof ready且与当前reviewed tuple匹配。任何已有失败/成功任务都使此入口拒绝，不复活旧任务、不重置quota。Raw provider credential不由smoke读取，只由先前主管受控ingress经stdin写入独立provider卷，仅可信Agent可见；不进argv/env/镜像/API/GW/Broker/admin/job。

本脚本从current-owner0600 reviewer code文件登录，创建一个项目和**一次**Code Run，保存原Idempotency-Key。代码预算：8 observable steps/65,536有效输入（含缓存）/24,576输出/900,000ms active time；Prepare、Worker、验证/修复/clean共用，不能阶段重置。Run进入实际generation/verification阶段后（若极快完成则之后）最多一次自然语言分享咨询，显式mode=ask；协调预算独立3steps/90s/32,768输入/8,192输出。无自动第二Run/第二咨询、澄清续问或预算扩张。

waiting_input只记录真实绑定并失败停下，主管再判断如何在原mandate内处理；不自动答题。任一阶段失败/未知最终真实用量/超额/非DSH provenance/未发布都保留私有ledger并退出；不会用一条新的模型请求“补证”。分享答复必须consult/status，不得新增代码任务，前后生成额度不变；实际typed internal snapshot核已知Router usage，源码/版本/报告及DSH来源保留。

传输是受控本机loopback gateway+canonical HTTPS Host，**不是外部浏览器G5证明**。真实Code成功可partial并诚实列gap；不能据成功Run声称全部语义验证。G5另用已经提交的existing-project只读Web工具，经两个真实HTTPS域读取报告/日志/PNG/ZIP/diff/preview/刷新及cap轮换；不再调用模型或创建任务。

## 4. 默认与测试边界

`pnpm m3:test-stage2` 只跑5项plan/guard测试：operator资源/无provider挂载、smoke最多1+1、不带guard拒绝、tunnel默认plan/双polling、check project不能创建公网。它们不认证Docker、不启动Cloudflare、不读取provider Key、不执行模型。包入口仅新增m3命名脚本，不改旧行为、依赖或lock。主管实际执行每阶段后才更新证据/状态；若新watchdog协议尚未被接受，所有实际binding步骤保持待执行。

## 持久运行模式修正

首次public启动用显式 `--fake` 测试，或 `ATOMS_ALLOW_M3_REAL=1 ... --real --provider-key-file ...` 授权初次Key ingress；成功后私有0600 runtime-mode.json 保存project/dsh/providerConfigured，**不保存Key**。后续普通up、renew之后的up都保留dsh，不再要求或读取raw key路径。`--real`不再决定每次启动mode；Fake manifest与已配置dsh冲突或显式Fake降级均拒绝，不自动fallback。模式尚未初配时up缺明确选择则失败。此修正只影响host lifecycle/private metadata，不改业务协议、额度、模型调用预算或SDK；持久模式正反回归零provider执行。

主管独立复验本候选：core/mode9项与Stage2 plan/guard5项、三个操作入口及host mode helper语法检查通过。真实模式普通重启/更新域名后不重新读取Key、不回退Fake；这仍是零provider测试，不能代替后续实际operator11-gate认证、临时隧道或有限真实Code/ask。

## One specific reviewed pre-model failure resume (operator only)

The normal smoke still requires an empty namespace and never retries. A separate, one-use exception is bound to original ledger `real-smoke-1794178069434.json`, project `project_25e268fd8ae314bc7ba6`, failed Run `run_e122ee5f556cfd91d2c8`, Preparation `preparation_175270303037d294b176`, and its exact immutable blocked report hash. This is not a general failure classifier or retry switch. The manager-reviewed failure was native loader startup before any observed model step; input/output remain unknown (`null`), not converted to zero.

Provider-free plan:

```sh
pnpm m3:smoke-real --project atoms-m3-public --resume-reviewed-pre-model-failure "$HOME/.atoms-m3/public/real-smoke-1794178069434.json"
```

Only the manager may explicitly execute the once-authorized admission after reviewing the fixed Agent image:

```sh
ATOMS_ALLOW_M3_REAL_SMOKE=1 ATOMS_ALLOW_M3_REVIEWED_RESUME=1 pnpm m3:smoke-real --project atoms-m3-public --run --resume-reviewed-pre-model-failure "$HOME/.atoms-m3/public/real-smoke-1794178069434.json"
```

Before admission it authenticates normal public reads, verifies current real-mode images/isolation, the original terminal Run and exact final verified blocked report, no frozen bundle/attempt/export/version, Preparation zero observable steps with original unknown tokens, one code/project/Run, zero generation used/reserved, zero coordination used/reserved, and no pending work. It saves an owner-private API-data tar (SQLite/WAL bytes unchanged across capture), original ledger, and a hash-bound receipt. An exclusive-create receipt is consumed **before** the one new POST; lost admission responses or any later failure do not allow a second invocation. No old Run, report, usage, quota, project, or failure ledger is changed by the operator. Login may add a session.

It creates exactly one new Run in the same project with the original fixed goal and unchanged 8-step/65,536-input/24,576-output/900-second cap, then at most the originally unsubmitted sharing ask under the existing 3-step/90-second cap. Success expects two total Runs, one Version and one generation used; failure stops and retains all evidence. It never reads or reinstalls a provider key, answers Attention, automatically creates another task, or expands budgets. This exception has unit/guard validation only until the manager executes it; it is not an additional model or external-browser proof.

主管独立通过该限定入口的5项resume/缺guard负例及原5项Stage2测试，共10/10，语法/diff检查通过。原live API记录、原不可变报告及nullable用量在执行前继续由脚本严格核对；本条验收不触发新增Run，后续新增模型任务必须主管双guard明确执行。

### Reviewed pre-admission transport continuation

The first once-authorized resume was blocked by the gateway's retained drain pause, before the Code POST reached API admission. Its ledger is `real-smoke-1794179206574.json`; it has no new Run/Turn. The original consumed receipt is retained. Ordinary `m3:up` now explicitly pauses first, waits for actual API and authenticated Agent health, verifies current ready isolation against a stable configured metadata tuple, and only then unpauses. An unconfigured first startup stays paused; health/binding errors never open admission. This is verified with live HTTP synthetic endpoints and the actual gateway, without providers or public container changes.

The following is a separate **same-session, same-key, same-body transport continuation**, not a new mandate. Its plan is safe by default:

```sh
pnpm m3:smoke-real --project atoms-m3-public --continue-reviewed-pre-admission "$HOME/.atoms-m3/public/real-smoke-1794179206574.json"
```

Only the manager may execute after reviewing the startup correction:

```sh
ATOMS_ALLOW_M3_REAL_SMOKE=1 ATOMS_ALLOW_M3_PRE_ADMISSION_CONTINUATION=1 pnpm m3:smoke-real --project atoms-m3-public --run --continue-reviewed-pre-admission "$HOME/.atoms-m3/public/real-smoke-1794179206574.json"
```

The operator checks both frozen ledgers, both identical consumed receipt copies, the private backup and original-ledger hashes, the exact reviewed key, original immutable failed report, Preparation and current state. It restores the original still-valid session only from its unique API-owned persisted login response and verifies session ID, cookie token SHA, code owner/activity and expiry. That Cookie is held only in operator memory: no new login, output, new credential file or session. Failure to recover uniquely or expiry is a hard refusal.

If the original session/key/body already has an API idempotency receipt, the operator verifies its exact Run and continues observing it **without another POST**. Otherwise current state must still be one failed Run, zero generation/coordination used or reserved, no version or pending work; it creates an additional exclusive continuation receipt before the one allowed transport replay, retaining the same key and canonical body. It never clears the consumed receipt, resets quota, creates a project/new mandate, or retries a second transport invocation. All original unknown usage remains unknown. The existing at-most-one new Code plus at-most-one ask budget and final two-Runs/one-Version/used-one checks remain unchanged. No actual continuation/model operation has been run by the implementation lane.

主管独立通过本次完整31项host/gateway/mode/guard/continuation回归与4个语法入口检查；live synthetic gateway lifecycle测试属于该回归，不冒充真实模型或新部署操作。实际同会话传输续跑仍须主管显式guard执行。

### One specifically reviewed R2 output-failure recovery

R2 (`run_4d1b3a5d59d7589accff`) ended blocked, with no candidate or Version: Prepare settled one step (1,774 input / 2,264 output), followed by two Worker settled max-token responses with empty output bodies (16,000 and 6,312 output). The reviewed total is three steps / 15,647 input / 24,576 output, exactly the original output cap. The original sharing ask `turn_4c835731068ba98fe23f` completed as a read-only consult (one step / 1,768 input / 471 output). Both failed Runs, all reports and original token observations are retained. The Agent lane is separately correcting retry usage aliasing and disabling Worker thinking for structured source output; this operator does not change SDK/model/budget or deploy that fix.

A final, separately guarded operator is bound to `real-smoke-1794179816372.json`, the exact project/R2/execution/ask IDs and immutable report hash `885e998858b45c481afc0843f82f62ec13111f606f1a6910d194610bf278d546`. It is not a general retry policy. It requires current two failed Runs / zero Versions / generation used-one, reserved-zero / one completed ask / coordination used-one, reserved-zero / no pending work. It verifies the first failed Run/report too, current real mode, current OS tuple, and that the gateway is actually unpaused before admission. It does not alter old ledgers, reports, usage or quotas.

Provider-free plan (no ledger read or services in plan mode):

```sh
pnpm m3:smoke-real --project atoms-m3-public --recover-reviewed-output-failure "$HOME/.atoms-m3/public/real-smoke-1794179816372.json"
```

Only after reviewing the separate Worker fix and its zero-network evidence may the manager execute this once:

```sh
ATOMS_ALLOW_M3_REAL_SMOKE=1 ATOMS_ALLOW_M3_REVIEWED_OUTPUT_RECOVERY=1 pnpm m3:smoke-real --project atoms-m3-public --run --recover-reviewed-output-failure "$HOME/.atoms-m3/public/real-smoke-1794179816372.json"
```

Before the one POST it creates an owner-private API-data tar with SQLite/WAL byte-stability checks, saves the original ledger and typed old execution/ask/report evidence, and writes an exclusive one-use receipt including backup/ledger/body hashes and the new idempotency key. Existing receipt refuses even a new login; any later failure or lost response leaves the receipt consumed. It creates exactly one new Code in the same project with the original full goal and unchanged 8-step / 65,536-input / 24,576-output / 900-second budget. It creates **zero new coordination messages**, never answers Attention, retries admission or creates another project/task. There is no automatic fallback to either earlier recovery operator.

Success requires three total Runs, one Version, generation used-two/reserved-zero, original ask unchanged, coordination quota unchanged, both old report hashes unchanged, actual DSH source provenance, and known cumulative Code usage within the fixed cap. A failure stops and retains evidence. This implementation has only provider-free plan/guard/positive/negative tests until the manager explicitly executes it; it is not a claimed real generation or external-browser pass.

主管独立通过本候选与旧host/gateway/mode/guard合计37/37、两个语法入口与diff检查。Worker独立修复已由主管完整90项/check/build及实际零网络serializer验证；该operator仍不会自动执行，新增一次Code须独立guard明确授权。
