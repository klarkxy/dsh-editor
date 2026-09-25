# dsh-editor-plugins

桌面「设置 → 插件」，核心包，不可关闭。内置功能按用途开关；稿纸、写作界面与插件管理始终保留。

## 社区插件

输入关键词搜索，或粘贴 GitHub 仓库地址安装。先阅读检查结果，再点「确认安装」；检查成功不保证运行时兼容。尚未加载的包会标为「待重启」，仍可卸载。

安装或卸载后重启应用。失败时在弹窗中查看原因并重试；卸载不删除作品、对话或设置。第三方插件须来自可信来源。

## 写作模式

「写作模式」分区列出第一方写作 preset（「通用写作」「小说创作」等）。核心 preset `dsh-editor-writing` 始终部署、不可关闭；其余 preset 可开关：启用时把包内 preset 原子部署到 `<dshHome>/.agent-presets/<id>`，停用时按同样的 owner marker 纪律删除（src/writing-presets.ts）。开关立即生效、无需重启，仅影响新对话，进行中的对话不变。

## 架构指针

Host 侧在 `/dsh-editor-plugins` RPC 通道提供插件清单、安装、开关与 preset 管理（src/index.ts、src/contracts.ts）；开关与安装记录持久化在 `<dshHome>/dsh-plugins.json`（schema 版本见 `PLUGIN_STATE_SCHEMA`，src/paths.ts、src/overlay.ts）。

## 钉住宿主的客户端图

当前桌面宿主固定为 DSH `0.1.7-rc.2`。原生 client-hmr 会同步客户端模块图，开关插件后正常加载的界面即时生效。插件设置订阅原生模块加载状态，仅在完成加载仍有失败时提示保存工作后重启重试；不会因启动时模块清单过时而误报。

本仓库插件的独立安装步骤见[插件目录](../README.md)，发布与市场收录见[发布维护](../PUBLISHING.md)。
