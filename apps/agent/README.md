# Agent runtime track

尚未实现。负责人只修改此目录。

依赖：`@atoms/contracts` 与 [内部协议](../../docs/agent-protocol.md)。先完成 DSH 接入门禁并记录 COMPATIBILITY.md。

用 Fake DSH + Fake 输入产物服务完成内部 HTTP 契约测试；真实模型 smoke:real 显式启用。需交付 dev/build/test/test:contract/smoke:real 脚本。

不接管访客身份、配额或公开发布，不向其他两方泄露 DSH 原生协议。

详见 [并行计划](../../docs/parallel-plan.md) 与 [验收](../../docs/acceptance.md)。
