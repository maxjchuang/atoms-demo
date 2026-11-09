# 本地项目额度配置

本地默认体验码的项目上限为10，可在仓库根`.env`配置`ATOMS_DEMO_PROJECT_LIMIT=20`等正安全整数；修改后重启API（使用`pnpm dev`时重启整套开发服务）。不接受空值、零、负数、小数、非数字或溢出值。

启动时，仅当前配置的本地demo码同步projectLimit。身份、过期/撤销状态、构建上限与已用记录均不重置；显式限额码保留自身配置。专用公网reviewer模式沿既有单项目策略，本配置不改变其授权。

验证：新增3项定向测试由主管独立重跑通过（0.75s），API check/build通过；覆盖默认10、自定义7/12、非法值、持久码3→10、原使用记录不变及第四项目可创建。作者另跑公网管理定向1项通过。本轮未调用模型、未用用户空间创建测试项目或构建。

本机已安全切换至atoms-demo-quota-integration。停服前无active Run/Turn，完整备份9655文件，源/副本hash/大小/权限一致，备份为原集成工作树`data/backups/local-preacceptance-pre-project-quota-20261109T133539`。启动后旧10集合逐值对比，仅预期的demo码projectLimit从3改10，其余内容完全相同（3项目、7任务、3版本、246消息）。实际登录接口返回projectLimit10/projectsUsed3/remaining7；构建上限10、已用7、预占0未改变。原5180 HTTP200、API ready，未重跑历史任务。
