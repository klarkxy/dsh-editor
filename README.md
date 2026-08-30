# DSH Editor

DSH Editor 是 Windows x64 桌面写作应用。Electron 只负责单窗口、内置运行时与进程生命周期；固定版本的 DSH `0.1.1-rc.2` 继续负责 Agent、会话、模型、工具、审批、用户提问和文件权限。应用默认显示稿件树与中央稿纸；写作搭档按需作为可调宽的第三栏打开。

仓库保留两个可独立安装到普通 DSH Web profile 的公开插件，以及三个只随桌面 profile 交付的私有插件：

| 组件 | 用途 | 数据所有者 |
| --- | --- | --- |
| Windows 桌面应用 | 项目初始化、Markdown 写作、写作助手、修改确认与导出 | 本地作品目录与应用私有数据 |
| `dsh-manuscript` | Web 中的可关闭稿纸抽屉、文件/FIM RPC | DSH workspace、sandbox 与版本化文件 API |
| `dsh-grill` | `scaffold_novel` 与四种小说协作模式 | DSH 工具、审批与官方 Chat |
| `dsh-editor-workbench` | 项目、上下文、导入、快照、移动与归档 | 同一 live-session workspace authority |
| `dsh-editor-novel-kernel` | 小说知识、预览提案、工具守卫与系统提示词 | DSH 工具与作者确认边界 |
| `dsh-editor-shell` | 桌面唯一根界面、Chat 投影与编辑状态 | 不发布、不安装到日常 `web` profile |

## 开发启动

开发环境固定为 Windows x64、Node `24.16.0`、pnpm `10.14.0` 和 DSH `0.1.1-rc.2`：

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` 构建 workspace，监听四个桌面 profile 插件，然后启动 Electron。Electron 使用仓库内 `.dev/desktop-home`，以随机 loopback 端口启动应用自有 DSH 子进程；不会打开默认浏览器，也不会修改日常 `web` profile。

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
pnpm test:e2e:workbench
pnpm test:e2e:missing-private
pnpm prepare:desktop-runtime
pnpm pack:desktop
pnpm test:e2e:portable
```

`pack:desktop` 使用 Electron Builder 的 `portable` target，在 `.pack/desktop` 生成未签名 Windows x64 EXE。它内置 Node、DSH、专用 profile 模板，以及 manuscript、workbench、novel-kernel、shell 四个桌面包；首次启动会把经过整树哈希校验的运行时原子部署到应用自有缓存，之后不调用系统 Node、pnpm 或全局 dsh。Windows SmartScreen 可能提示未知发布者。

公开插件的 tarball 与安装/卸载矩阵仍使用 `pnpm pack:plugins` 和 `pnpm test:e2e:matrix`。仓库脚本不会自动 commit、push、tag、publish 或 release。

## 文档

- [使用者指南](docs/user-guide.md)：桌面启动、灵活工作台、AI 编辑、快捷键、回滚与公开插件使用
- [开发者指南](docs/development.md)：运行时准备、调试、测试与打包
- [架构与边界](docs/architecture.md)：DSH 权威边界、profile、RPC 与安全约束
- [插件架构与接口](docs/plugin-architecture.md)：双私有 Host 拓扑、RPC/Tool/slot 契约以及修改、替换和新建插件流程
- [桌面运行时图](docs/diagrams/dsh-editor-runtime.html)：Electron、DSH Host 与桌面 profile
- [插件拓扑图](docs/diagrams/dsh-editor-plugins.html)：公开 Web 插件与桌面私有包
- [确认写入时序图](docs/diagrams/author-confirm-write.html)：从 context 编译到作者确认写入
- [CHANGELOG](CHANGELOG.md)：版本变化

DSH Editor 的 loopback RPC 只适用于本地单用户信任模型，不应暴露成远程多用户文件接口。
