# 本地体验码额度补足

保留历史真实已用量，以累计上限减已用量和预占量计算可用额度。停服且无活动任务时备份SQLite，再对目标本地体验码设置runLimit=已用构建+希望可用次数、coordinationMessageLimit=已用对话+希望可用次数。不得修改started或删除原消息、项目、构建和版本记录来伪造未消费。

coordinationMessageLimit为Code私有可选字段，不改变公共wire或新增admin入口。优先级：显式宿主messageLimit（包括公网默认）→该体验码覆盖→默认50。非法非正安全整数明确拒绝。其他体验码不受影响。

验证：API类型检查及协调HTTP22/22通过，覆盖持久重启、两身份隔离、原used/history保留、后续真实计数、非法配置和显式host上限优先。当前本地补额后真实session接口显示buildsAvailable=10、messagesAvailable=50，历史used分别20和50；原project/version/history保留，未发起模型调用。备份和quota-grants审计保留在私有数据目录/本机临时目录，不提交数据库或体验码。
