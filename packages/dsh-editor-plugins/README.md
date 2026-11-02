# dsh-editor-plugins

桌面「插件」页中的发现与写作模式适配，核心包，不可关闭。已安装清单、检查、进度、构建批准、取消、开关、卸载与配置由官方 DSH 插件管理器负责。

写作模式仍由本包管理。归属及开关边界见[内置插件与设置](../../docs/builtin-plugins.md)。

## 发现插件

本包只提供 `marketplace.search`。留空搜索、本机 ASCII 关键词，或能对上保留制品的未带版本 npm 包名时，列出 native profile 仍保留的本机包：标题与简介来自发行目录，规格为 `link:` 加制品绝对路径。结果的安装与启用状态读取官方管理器当前清单；未安装条目可点击「安装」，所选规格自动填入官方安装窗口，仍需在该窗口检查并确认安装。已安装条目可打开配置。带精确版本的 `npm:` 规格与无本机命中时的 GitHub 远程搜索仍走原路径；复制规格保留在「高级」中。

发现插件页进入时直接展示搜索与结果；写作模式由插件总览展示。按需安装的可选公共插件包括知乎、当前标题、需求记录、会话纪要和网页搜索管理器。网页搜索由 DSH 原生搜索工具承担，不再预装第三方插件。

## 写作模式

RPC：`presets.list`、`presets.setEnabled`。核心 preset `dsh-editor-writing` 始终部署、不可关闭；其余 preset 可开关：启用时把包内 preset 原子部署到 `<dshHome>/.agent-presets/<id>`，停用时按同样的 owner marker 纪律删除（src/writing-presets.ts）。运行中可重载 profile 时立即应用，否则返回需重启；仅影响新对话，进行中的对话不变。

开关只更新 `<dshHome>/dsh-plugins.json` 的 `presets` 字段，保留其他记录，不读取或写入作者的 `cordis.patch.yml`。部署、保存或声明生成失败时恢复原记录、原声明与应用自有 preset 目录；无 owner marker 或其他插件拥有的目录不会被覆盖。旧插件 overlay 由桌面启动的一次性 native profile 迁移处理，本包不再写旧 overlay。

## 架构指针

官方 Host 服务 `pluginManager` 的 `listPlugins` / `listBundles` 是已安装清单的唯一权威；本包不提供 inventory RPC。有限核心守卫就地包装这两份列表以标记只读，并拒绝直接 `setPluginEnabled` / `setBundleEnabled` / `removeBundle`（src/core-lock.ts），dispose 时恢复原方法。`/dsh-editor-plugins` 仅有 `marketplace.search`、`presets.list`、`presets.setEnabled`（src/index.ts、src/contracts.ts）。写作模式记录仍在 `<dshHome>/dsh-plugins.json` 的 `presets` 字段。

宿主恢复、官方管理器核心守卫、宿主控制入口与退役名单分别投影自 `apps/desktop/src/distribution-contract.json` 的独立属性。未知包不因使用官方命名空间或 Editor 前缀而成为核心。该纯数据在本包构建时内联，运行时不依赖源码目录；退役的私有安装、检查、卸载和清单实现已删除。

内部入口 `dsh-editor-plugins/preset-config` 导出 `syncPresetDeclarations(home, profileDir)`，由桌面部署和插件运行时共同生成 preset 与已选工具入口声明。工具入口来自 native profile 实际已选、且非发行包的 bundle，而不是遗留 `installed` 名单；preset 目录仍按既有 owner 纪律部署。此入口不注册 RPC、不启动插件；独立产物为 `lib/preset-config.js` 与 `lib/preset-config.d.ts`。

## 钉住宿主的客户端图

当前桌面宿主固定为 DSH `0.2.1-rc.5`。原生 client-hmr 会同步客户端模块图。官方插件页订阅 Host 变更事件刷新清单。

本仓库插件的独立安装步骤见[插件目录](../README.md)，发布与市场收录见[发布维护](../PUBLISHING.md)。
