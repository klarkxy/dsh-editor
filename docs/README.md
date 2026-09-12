# DSH Editor 文档索引

当前操作手册对应桌面 **0.2.0** 与内置 DSH `0.1.5-rc.2`。桌面应用版本与公开插件包版本分别维护；公开插件当前包版本为 `0.1.0`。

## 使用与维护

| 文档 | 内容 |
| --- | --- |
| [使用者指南](user-guide.md) | 新建作品、编辑保存、正文菜单、搭档、资料、设置与升级 |
| [产品原则](product-principles.md) | 作者确认、普通文件与单一 DSH 权威边界 |
| [界面与设计系统](ui.md) | 纸 / 墨主题、共享控件、设置滚动、图表与辅助文件展示 |
| [开发者指南](development.md) | 固定版本、构建顺序、调试、验收、打包与发布 |
| [架构与边界](architecture.md) | 进程、profile、持久化与安全约束 |
| [插件架构与接口](plugin-architecture.md) | 所有权、注入、RPC / Tool / slot 与替换合同 |
| [组合指南](plugin-composition-guide.md) | basic / smart / full、独立 Web 插件与复现命令 |
| [0.2.0 本地验收](release-0.2.0.md) | 本轮证据范围、产物与最终标签验证的区别 |
| [变更记录](../CHANGELOG.md) | 各版本已经发生的变化 |

0.2.0 暂停桌面校对；知乎入口在“设置 → 知乎资料”。辅助文件不显示在文件树和作者全文搜索中，原文件仍保留。不要按旧版截图寻找这些入口。

## 包级合同

- [dsh-editor-cards](../packages/dsh-editor-cards/README.md)
- [dsh-editor-memory-panel](../packages/dsh-editor-memory-panel/README.md)
- [dsh-editor-novel-kernel](../packages/dsh-editor-novel-kernel/README.md)
- [dsh-editor-overview-panel](../packages/dsh-editor-overview-panel/README.md)
- [dsh-editor-plugins](../packages/dsh-editor-plugins/README.md)
- [dsh-editor-proofread-panel](../packages/dsh-editor-proofread-panel/README.md)
- [dsh-editor-shell](../packages/dsh-editor-shell/README.md)
- [dsh-editor-workbench](../packages/dsh-editor-workbench/README.md)
- [dsh-manuscript](../packages/dsh-manuscript/README.md)
- [dsh-proofread](../packages/dsh-proofread/README.md)
- [dsh-zhihu](../packages/dsh-zhihu/README.md)

`dsh-editor-seats` 的类型合同见 [源码](../packages/dsh-editor-seats/src/index.ts)，`dsh-editor-workspace-kit` 的职责见 [插件架构](plugin-architecture.md)。小说知识卡 `resources/novel-knowledge/` 是搭档读取的运行时材料，其出处记录保留，不随界面版本改写。

## 架构图

[图站入口](diagrams/index.html) 包含桌面运行时、插件分级、组合边界和作者确认写入四张图。规范源 JSON 与生成 HTML 放在同一目录；更新规范后重新生成，并核对多尺寸截图。发布站点见 [GitHub Pages](https://klarkxy.github.io/dsh-editor/)。

## 历史记录

下列文档与 `verification/` 中的原始回执是日期快照，保留当时版本、失败和后续修复，不代表 0.2.0 已验证了同一件事。

- [拆分计划](plugin-modularization-plan.md)、[拆分实施](plugin-modularization-progress.md)、[声明式拼装记录](plugin-assembly-progress.md)
- [组合能力验证](plugin-composability-validation.md)
- [最初 MiniMax 在线验证](minimax-live-validation.md)
- [2026-09-10 在线验证](live-validation-2026-09-10.md)、[2026-09-11 在线验证](live-validation-2026-09-11.md)

发布状态以对应标签的 GitHub Actions 和 Release 附件为准。历史 PASS、源代码检查、本地构建、真实交互和持续运行是不同证据。
