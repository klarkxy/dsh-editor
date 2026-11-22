# 文档

## 现行文档

- [使用指南](user-guide.md)：安装、写作、作品管理、[官方插件](user-guide.md#官方-dsh-功能)（Editor 自托管清单与安装）、发现与问题处理。
- [产品原则](product-principles.md)：作者工作流与产品取舍。
- [架构决策](architecture.md)：运行时权威、信任边界、包边界与发布约定。
- [桌面更新审查与恢复](update-audit.md)：下载校验、Windows 安装交接、恢复入口与验证边界。
- [搭档对话设计](bot-conversation.md)：一部作品一个搭档、换段与交接、闲置回顾、缓存与回读。
- [界面设计](ui-design.md)：「原稿」设计系统契约——tokens、样式分层、`src/ui/` 组件、主题作用域与验证门禁（上游许可证归属保留）。
- [UI 施工约定](ui-agent-guide.md)：给 Agent 的组件用法、改动边界、防偏移检查与验收证据。
- [界面行为契约](ui-behavior-contracts.md)：外观改动不得改变的行为、实现位置、现有测试覆盖与缺口。
- [内置插件与设置](builtin-plugins.md)：功能归类、必需模块、会话工具与模型设置归属。
- [AI 插件](ai-plugins-implementation.md)：当前插件、原生模型设置、退役与历史验证边界。
- [插件目录](../packages/README.md)：原生网页搜索、发现搜索复制规格、官方安装的按需公共插件及各包说明与发布维护。
- [变更记录](../CHANGELOG.md)：版本历史。
- [交互架构图](https://klarkxy.github.io/dsh-editor/)：跨包关系与写入流程；[规范源](diagrams/)。

## 历史留档

以下为已完成使命的审计、方案与迁移记录，仅供查证；文首均有历史留档标注，现状以现行文档与代码为准。

- [DSH 0.2.2 升级审计](dsh-0.2.2-upgrade.md)：0.2.2-rc.5 依赖闭包、补丁移植、官方升级指南核对与上游行处置记录（进行中，尚未收口）。
- [DSH 0.2.1 升级审计](dsh-0.2.1-upgrade.md)：0.2.1-rc.5 依赖闭包、补丁移植、官方升级指南核对与第三方预装清零记录。
- [DSH 0.2.0 升级审计](dsh-0.2.0-upgrade.md)：0.2.0-rc.2 依赖闭包、能力吸收与验收记录。
- [DSH 0.1.7 升级审计](dsh-0.1.7-upgrade.md)：兼容性修复、能力重叠与验收范围。
- [公共插件迁移说明](public-plugin-migration.md)：十包源码迁移交接与公共插件归属；Editor 侧的现行边界以[架构决策](architecture.md)为准。
- [可移植学习边界](portable-learning.md)：Dream 与 Self Improve 的所有权、数据分流与独立部署约束（插件已退役）。
- [Fusion 协作实现](fusion-implementation.md)：Fusion 的配对、任务与候选边界（插件已移除）。
- `redesign/` 重写过程文档：[UX 审计](redesign/ux-audit.md)、[视觉方案](redesign/visual-directions.md)、[G1 决策](redesign/decision.md)、[设计系统实施规格](redesign/design-system-spec.md)、[Shell 重写规格](redesign/shell-rewrite-spec.md)、[验收记录](redesign/acceptance.md)。
- [UI/UX 实测记录](ui-ux-audit-2026-10.md)：2026-10 前端实测结论、修复前后数字与遗留问题。
- [H3 宣传片方案](h3-promo-preproduction.md)：品牌宣传片制作前的分镜与文案。
- [实机演示方案](live-demo-preproduction.md)：实机录屏演示制作前的脚本与清单。

文档保留操作、决策理由和兼容约束。接口字段、默认值、执行流程以代码为准；插件专属说明放在对应包目录。小说知识卡与 preset 中的 Markdown 是运行时材料，单独维护。
