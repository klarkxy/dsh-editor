# DSH Editor

DSH Editor 为官方 DSH 提供两个可独立安装的小说写作插件。它不会替换 DSH 的 Chat、Agent、模型、审批或会话系统。

| 插件 | 面向谁 | 提供什么 |
| --- | --- | --- |
| `dsh-manuscript` | 需要在 DSH 内查看和编辑本地稿件的作者 | 可折叠“稿纸”、工作区文件树、安全保存、本地草稿、字数、前后篇导航和可选补全 |
| `dsh-grill` | 需要小说协作提示和项目脚手架的作者 | `scaffold_novel` 工具，以及 planning、drafting、review、first-reader 四种协作模式 |

两者没有运行时依赖：可以只安装一个、同时安装，或分别卸载。

## 从这里开始

- **我是使用者**：阅读 [使用者指南](docs/user-guide.md)，完成插件选择、安装、首次使用、升级、回滚、卸载和故障排查。
- **我是开发者**：阅读 [开发者指南](docs/development.md)，了解仓库结构、本地开发、测试、打包和交付流程。
- **我要审查设计**：阅读 [架构与边界](docs/architecture.md)。
- **我要查看版本变化**：阅读 [CHANGELOG.md](CHANGELOG.md)。

## 当前兼容范围

- Windows
- `@deepseek-ai/dsh` `0.1.1-rc.1`
- 插件版本 `0.1.0`
- 从源码构建时需要 Node.js 22+ 与 pnpm 10.14.0

这是已经验证的范围，不代表其他 DSH 版本也兼容。交付产物位于 `.pack`，标准交付闸门为：

```powershell
pnpm verify:delivery
```

本仓库不会自动推送、打标签或发布；这些动作需要单独授权。

## 重要安全边界

`dsh-manuscript` 只适用于 DSH 的本地单用户、loopback 信任模型。不要把它作为远程多用户文件接口暴露。详情见 [架构与边界](docs/architecture.md#已知限制与兼容风险)。
