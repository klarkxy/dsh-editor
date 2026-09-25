# dsh-editor-seats

shell 与桌面插件共用的界面扩展合同库，在构建时内联，没有独立插件入口。

## API 概览

**Slot（renderSlot 键，src/index.ts:22-27）**

- `SIDEBAR_TOOLS_SLOT`：侧栏工具位。
- `CENTER_OVERLAYS_SLOT`：中栏覆盖层位。
- `CHAT_EVENTS_SLOT`：非对话记录卡片位；在此渲染不会产生用户消息或工具结果。
- `MODEL_SETTINGS_SLOT`：可选的模型设置页；owner 提供原生 provider 编辑器。

**服务（ctx.provide / inject，src/index.ts:28-30）**

- `COMMANDS_SERVICE`（`dshEditorCommands`）：命令注册表，插件注册带标签、分组与快捷键的命令，进入命令面板与全局热键。
- `MESSAGE_CARDS_SERVICE`（`dshEditorMessageCards`）：工具结果消息卡注册表，插件按工具名注册渲染器。

**中栏覆盖层布局合同**：覆盖层打开时根元素必须带 `CENTER_OVERLAY_ATTRIBUTE`（`data-dsh-center-overlay`），关闭时渲染 `null`。shell 会把带该属性的元素放进编辑器的网格单元并遮住下方编辑器；插件不得自写 grid 规则。

**注册表工厂与工具函数**（src/index.ts:265-373）：`createCommandRegistry` 与 `createMessageCardRegistry` 建注册表（重复 id / toolName 抛错，注册返回注销函数，可订阅变更）；`shortcutMatches` / `matchRegistryShortcut` 做快捷键匹配；`registryPaletteItems` 把注册命令转换为命令面板条目，处理语言回退、按工作区状态置灰和触发前的 `revealSidebar`。

## 子路径导出

- `./tokens`：独立 Radix 降级 CSS tokens（`radixFallbackTokens`），仅在没有 `.radix-themes` 祖先时生效，供 manuscript / overlay 等宿主外场景读取与 shell 相同的变量。
- `./seat-button`：`SeatButton`，优先使用宿主提供的 Button；宿主缺失时降级为带相同变体类的原生 `<button>`，两种路径观感一致。

侧栏、设置、中栏、命令和消息卡的接入类型见 [src/index.ts](src/index.ts)。
