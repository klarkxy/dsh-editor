# DSH Editor

DSH Editor 是 Windows x64 桌面写作应用。Electron 只负责单窗口、内置运行时与进程生命周期；固定版本的 DSH `0.1.1-rc.2` 继续负责 Agent、会话、模型、工具、审批、用户提问和文件权限。应用默认显示稿件树与中央稿纸；写作搭档按需作为可调宽的第三栏打开。

仓库同时保留两个可独立安装到普通 DSH Web profile 的公开插件：

| 组件 | 用途 | 数据所有者 |
| --- | --- | --- |
| Windows 桌面应用 | 项目初始化、Markdown 写作、写作助手、修改确认与导出 | 本地作品目录与应用私有数据 |
| `dsh-manuscript` | Web 中的可关闭稿纸抽屉、文件/FIM RPC | DSH workspace、sandbox 与版本化文件 API |
| `dsh-grill` | `scaffold_novel` 与四种小说协作模式 | DSH 工具、审批与官方 Chat |
| `dsh-editor-shell` | 仅供桌面 `dsh-editor` profile 使用的私有根界面 | 不发布、不安装到日常 `web` profile |

## 开发启动

开发环境固定为 Windows x64、Node `24.16.0`、pnpm `10.14.0` 和 DSH `0.1.1-rc.2`：

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` 构建并监听三个包，然后启动 Electron。Electron 使用仓库内 `.dev/desktop-home`，以随机 loopback 端口启动应用自有 DSH 子进程；不会打开默认浏览器，也不会修改日常 `web` profile。

公开 Web 插件的旧式调试入口仍保留：

```powershell
pnpm run dev:web
```

## 验证与便携 EXE

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:desktop
pnpm prepare:desktop-runtime
pnpm pack:desktop
```

`pack:desktop` 使用 Electron Builder 的 `portable` target，在 `.pack/desktop` 生成未签名 Windows x64 EXE。它内置 Node、DSH、专用 profile 模板，以及桌面需要的 `dsh-editor-shell`、`dsh-manuscript` 两个包；首次启动会把经过整树哈希校验的运行时原子部署到应用自有缓存，之后不调用系统 Node、pnpm 或全局 dsh。Windows SmartScreen 可能提示未知发布者。

公开插件的 tarball 与安装/卸载矩阵仍使用 `pnpm pack:plugins` 和 `pnpm test:e2e:matrix`。仓库脚本不会自动 commit、push、tag、publish 或 release。

## 文档

- [使用者指南](docs/user-guide.md)：桌面启动、灵活工作台、AI 编辑、快捷键、回滚与公开插件使用
- [开发者指南](docs/development.md)：运行时准备、调试、测试与打包
- [架构与边界](docs/architecture.md)：DSH 权威边界、profile、RPC 与安全约束
- [CHANGELOG](CHANGELOG.md)：版本变化

DSH Editor 的 loopback RPC 只适用于本地单用户信任模型，不应暴露成远程多用户文件接口。
