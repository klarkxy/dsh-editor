# 文档

- [使用指南](user-guide.md)：安装、写作、作品管理、[官方插件](user-guide.md#官方-dsh-功能)（官方管理已安装清单）、发现插件与问题处理。
- [桌面更新审查与恢复](update-audit.md)：下载校验、Windows 安装交接、恢复入口与验证边界。
- [产品原则](product-principles.md)：作者工作流与产品取舍。
- [架构决策](architecture.md)：运行时权威、信任边界与发布约定。
- [架构重构](refactoring-executive-summary.md)：重构方案执行摘要（Phase 1 已完成）；[完整方案](refactoring-proposal.md)、[架构对比](architecture-comparison.md)、[Phase 1 报告](refactor-phase1-adjusted.md)。
- [界面设计](ui-design.md)：官方 Kimi Web 视觉适配、组件预览与验证范围。
- [UI 施工约定](ui-agent-guide.md)：给 Agent 的组件用法、改动边界、防偏移检查与验收证据。
- [DSH 0.1.7 升级审计](dsh-0.1.7-upgrade.md)（历史留档，已完成）：兼容性修复、能力重叠与验收范围。
- [AI 插件](ai-plugins-implementation.md)：当前插件、原生模型设置、退役与历史验证边界。
- [Fusion 协作实现](fusion-implementation.md)（历史留档，已移除）：旧的配对、任务与候选边界。
- [可移植学习边界](portable-learning.md)（历史留档，插件已退役）：Dream 与 Self Improve 的所有权、数据分流与独立部署约束。
- [H3 宣传片方案](h3-promo-preproduction.md)（历史留档，已完成）：品牌宣传片制作前的分镜与文案。
- [实机演示方案](live-demo-preproduction.md)（历史留档，已完成）：实机录屏演示制作前的脚本与清单。
- [内置插件与设置](builtin-plugins.md)：功能归类、必需模块、会话工具与模型设置归属。
- [插件目录](../packages/README.md)：预装网页搜索、发现搜索复制规格、官方安装的按需公共插件及各包说明与发布维护。
- [变更记录](../CHANGELOG.md)：版本历史。
- [交互架构图](https://klarkxy.github.io/dsh-editor/)：跨包关系与写入流程；[规范源](diagrams/)。

文档保留操作、决策理由和兼容约束。接口字段、默认值、执行流程以代码为准；插件专属说明放在对应包目录。小说知识卡与 preset 中的 Markdown 是运行时材料，单独维护。
