# DSH Editor

<p align="center">
  <img src="docs/assets/mascot.webp" alt="DSH Editor 看板娘" width="260">
</p>

Windows / macOS 桌面写作应用。作者在稿纸上写正文，AI 搭档在侧栏提供补全、改写、讨论与文件提案；修改经作者确认后写入。作品是普通的本地文件夹。

[下载](https://github.com/klarkxy/dsh-editor/releases) · [使用指南](docs/user-guide.md) · [变更记录](CHANGELOG.md)

支持查找替换、章节导航、校对、版本回滚和 Markdown / TXT / DOCX / EPUB 导出。新对话可选通用写作、小说创作、文章与自媒体、技术文档。

## 安装

Windows 提供便携版 EXE 和安装器，macOS 提供 Apple Silicon 的 dmg / zip。应用未签名，首次运行可能出现系统安全提示。更新入口在「设置 → 关于」，操作见[使用指南](docs/user-guide.md#安装与更新)。

## 插件

| 插件 | 用途 | 安装来源 |
| --- | --- | --- |
| [@klarkxy/dsh-zhihu](packages/dsh-zhihu/docs/README.zh-CN.md) | 知乎搜索与知识库 | npm |
| [@klarkxy/dsh-web-search-manager](packages/dsh-web-search-manager/docs/README.zh-CN.md) | 网络搜索与网页读取 | npm |
| [dsh-manuscript](packages/dsh-manuscript/README.md) | 稿纸编辑 | 本地 tarball，尚未发布到 npm |
| [dsh-proofread](packages/dsh-proofread/README.md) | 中文文本校对 | 本地 tarball，尚未发布到 npm |

新增六个 AI 功能：当前标题、需求澄清、回顾、长期记忆、自我改进、模型中心；均预装并默认启用，仍可分别停用。Dream、Agent 检查点等额外自动行为保留独立开关。目前随本地构建交付，见 [使用与实现说明](docs/ai-plugins-implementation.md)。

安装步骤在各包目录。仓库根目录是桌面应用 workspace，不能作为单个 DSH 插件安装。全部包与发布说明见 [packages/](packages/README.md)。

## 开发

使用 Node `24.16.0`、pnpm `10.14.0`，内置 DSH 固定为 `0.1.5-rc.2`。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

检查用 `pnpm build`、`pnpm typecheck`、`pnpm test`；打包与端到端命令见 [package.json](package.json)。

桌面入口在 [apps/desktop/](apps/desktop/)，插件在 [packages/](packages/README.md)，开发约定与跨包架构见[文档索引](docs/README.md)。

## 许可

[SATA 2.1](LICENSE)（Star And Thank Author License）。
