# 最小失败澄清与重新规划恢复

本轮仅实现小范围恢复入口，复用原严格协议。没有新增公共状态、模型编队或额外Reviewer调用，没有改写旧测试/报告，也没有重跑用户任务。

- Agent在同一Worker响应支持fix_code、clarify、replan_tests、environment。普通clarify只补充原计划的实现细节；问题不扣代码修复次数，模型steps/tokens/active时间仍累计。诊断与问题不能写源码；测试错误保存绑定原source/spec/plan的修订建议，不能通过普通答案改冻结标准。
- 同源码无进展且仍有原修复余额时，可在终态stop前进入实现澄清。真实源码循环、原终态、未知用量或耗尽次数不被答案复活，不新增诊断调用；由显式重新规划入口恢复协作。
- 问题卡和失败任务均可选择重新规划：核对完整Goal/问题/答案/失败观测→原cancel同key→GET确认终态和writer释放→可编辑内容→用户明确发送ask/plan。真实提案仍需确认，才按原规则创建新Code；仅填草稿不当完成，不自动扣构建额度。
- 停止请求未到服务时，刷新不自动POST，可由用户核对原attention后用原key重试。发送结果未知保留原body/key。跨项目迟到响应不跳回或覆盖草稿。目标超出消息上限时明确拒绝，不截断完整Goal。

## 本轮验证

- Agent作者关键15/15；主管两份新增文件7/7（9.86s）及check/build。必要旧no_change真实host兼容2/2（54.15s）：有余额waiting_input/原hash与用量保留，无余额仍终止不再发Worker；旧clean JSON/ZIP bytes/hash不变。
- API仅新增一条组合HTTPgate，主管独立1/1和check：cancel未确认保writer、旧answer409、确认停止后同key只有1个ask/plan提案、没有新增Code、原Goal/答案保留、跨项目/晚产物拒绝。生产API和shared均未改。
- Web作者首批6/6 Mock浏览器、最终4单测和check/build。主管独立首轮相关浏览器5/6，失败在第二项目setup直接json读取空响应；保留失败日志。test-only等待MockApp就绪并检查HTTPstatus/body后，主管剩余late用例1/1（5.4s）通过，生产跨项目guard没有放宽；最终4/4单测和check/build通过。未把分批验证冒称最终全量一次通过，未跑161全套。
- 没有调用真实DeepSeek模型，没有使用用户任务/构建额度作测试。

## 本机交付

新工作树atoms-demo-clarification-integration，分支feat/clarification-recovery。5180/3101/3102/4200沿用原绝对data/local-preacceptance和原secrets。停服前无active Run/Turn，完整备份5035文件且hash/大小/权限一致：原集成工作树data/backups/local-preacceptance-pre-clarification-20261109T130028。

启动后登录前codes/sessions/projects/runs/versions/messages/events/sourceEvents/idempotency/coordination十集合逐值完全相等（3项目5任务1版本166消息）。随后只读API确认所有5个Run DTO/report精确不变，used5/reserved0；原鹈鹕V1保留。5180及5173 HTTP200，API ready。没有通过发送重新规划来冒充只读验收；本轮未在真实用户空间发新消息或构建。

时间说明：20分钟检查点时主体已完成；必要的独立测试准备修正、旧用例兼容和备份切换继续占用了收尾时间，超过了最初预设，记录如实保留。没有借此增加架构范围。该版本提供恢复路径，不保证模型每次诊断正确，也不实现同Run自动替换冻结计划。
