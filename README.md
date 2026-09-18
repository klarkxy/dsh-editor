# DSH Editor

DSH Editor 是一款 Windows / macOS 桌面写作应用。稿纸位于界面中央，AI 写作搭档在侧栏协作：作者写正文，搭档提供补全、改写、讨论与文件提案，所有正文修改经作者确认后才写入。

当前版本 **0.3.0**，内置固定版本的 DSH `0.1.5-rc.2`（Agent、会话、模型、工具与文件权限均由它提供）。

[下载](https://github.com/klarkxy/dsh-editor/releases) · [使用者指南](docs/user-guide.md) · [CHANGELOG](CHANGELOG.md)

## 功能特性

- **稿纸**：稿内查找替换、打字机滚动、段落聚焦、排版设置、ghost 补全、选段改写、章节导航。
- **作品即文件夹**：作品是普通的本地文件夹，可以直接用其他编辑器打开；正文、大纲、人物卡等目录只在你或搭档真正创建文件时出现。
- **提案确认**：搭档的正文修改以可预览的提案卡呈现，作者点击「应用」后才写入，已应用的修改可撤销；文件在提案生成后发生变化时拒绝覆盖。
- **四种写作模式**：通用写作（`dsh-editor-writing`，默认）、小说创作（`dsh-editor-novel`）、文章与自媒体（`dsh-editor-article`）、技术文档（`dsh-editor-technical`）。开新对话时选择，设置「插件 → 写作模式」里可开关后三种。
- **侧栏工具**：文稿校对（标点 / 错别字 / 敏感词 / 重复 / 口癖）、跨文件搜索替换、作品概览与写作曲线、知乎资料查询。
- **本地优先**：作品、快照与对话都保存在本机；应用只通过本机 loopback 端口与内置 DSH 通信。

## 安装与更新

Windows 提供便携版 EXE 与 NSIS 安装器，macOS 提供 Apple Silicon 的 dmg 与 zip，均从 [GitHub Releases](https://github.com/klarkxy/dsh-editor/releases) 下载。应用未签名：Windows SmartScreen 与 macOS Gatekeeper 的提示属预期。应用内可在「设置 → 关于」检查并安装更新，下载按发布页附带的 SHA-256 校验。

## 公开插件

三个插件可单独安装到普通 DSH Web profile，安装步骤见各自 README：

- [dsh-manuscript](packages/dsh-manuscript/README.md)：稿纸抽屉——工作区文本树、正文编辑、安全保存与补全。
- [dsh-proofread](packages/dsh-proofread/README.md)：基于确定性规则的中文文本校对。
- [dsh-zhihu](packages/dsh-zhihu/README.md)：知乎搜索、知识库与用量。

## 开发

环境固定为 Windows x64、Node `24.16.0`、pnpm `10.14.0`、DSH `0.1.5-rc.2`：

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` 构建 workspace 并启动 Electron 开发窗口。验证用 `pnpm build`、`pnpm typecheck`、`pnpm test`；打包与端到端命令见根 `package.json` 的 scripts。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `apps/desktop/` | Electron 主进程、profile 部署与打包配置 |
| `packages/` | 桌面插件、公开插件与共享库；每个包的用途见各自的 README |
| `docs/` | 使用者指南、产品原则、架构决策与架构图规范 |
| `e2e/` | Playwright 端到端脚本 |
| `scripts/` | 开发、打包与校验脚本 |

## 文档

- [文档索引](docs/README.md)：使用、原则与架构决策
- [架构图站](https://klarkxy.github.io/dsh-editor/)：运行时、插件分级、确认写入与版本门禁的交互图

## 许可

本仓库采用 [SATA 2.1](https://github.com/klarkxy/sata-license)（Star And Thank Author License），全文见 [LICENSE](LICENSE)。
