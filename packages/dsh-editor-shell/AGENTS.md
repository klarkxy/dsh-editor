# Shell UI: preserve the design contract

涉及可见界面时，先读仓库根目录的 [UI 施工约定](../../docs/ui-agent-guide.md) 和 [设计说明](../../docs/ui-design.md)。
本文件适用于 shell 全包，不只是 `src/client/ui/`。

## 修改落点

| 需要改变什么 | 唯一入口或既有入口 |
| --- | --- |
| 配色、字号/圆角/间距/动效尺度、z 层级 | `src/design-system/tokens.ts` |
| 产品外观规则 | 所属区域的 `*.styles.ts`（`app/`、`client/`、`src/ui/`），用 `defineStyles()` 注册进 `dsh.*` 层；需要排除插件面时用 `design-system/styles.ts` 的 `uiRule()` |
| 可访问的基础交互 | `src/ui/` 内部组件（构建在 Radix primitives 上；仓库已无 `@radix-ui/themes`） |
| CodeMirror、窗口拖拽、分栏、hidden/inert 等结构 | `client/base.styles.ts`、`client/editor.styles.ts` 与 `model/workbench-layout.ts`、`client/narrow-layout.ts` |
| 主题作用域与生命周期 | `client/ui/theme-root.tsx`、`design-system/scope.ts` |
| 官方制品变量映射 | `design-system/compat.ts` + `scripts/scan-dsw-vars.mjs` |
| 活体组件示例 | `src/design-system/gallery.tsx`（工作台 `Ctrl+Alt+Shift+D`） |
| 浏览器契约 | `fixtures/design-system.tsx`、`e2e/ui-design.mjs`、`e2e/layout-invariants.mjs` |
| 中英文案 | `src/i18n/messages.zh.ts`、`messages.en.ts`，成对增删 |
| E2E 选择器 | `e2e/helpers/selectors.mjs`（唯一登记处） |

不要给每个页面再建一套覆盖层；视觉规则写进所属区域的 sheet。替换规则时删除被替换的重复项，但不要顺手改写无关结构。

## 必须保持

- 主题作用域是 `html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes, [data-dsh-theme])`：`.radix-themes` 是 `ShellTheme` 输出的作用域类名，与依赖无关；官方制品的同名包装也靠它读变量。Portal 挂进 `UiRoot` 的 `data-dsh-portal-root`，继承主题作用域；不凭全局 DOM 猜主题。
- 主色固定黛蓝（G1 决策 3）：主按钮、发送键、当前位置（`--dsh-ui-selected`）、用户气泡、链接和焦点使用它，其余表面保持中性。没有自选主题色、`data-accent-color` 或 `ACCENT_SOLIDS`；localStorage 旧键不读不删。平面卡片和分割线是 0.5px 且无阴影；菜单、对话框用含 0.5px 描边的 elevation；菜单实色不模糊，模态遮罩是黑色 scrim 不模糊。
- `scope.ts` 的引用计数、卸载恢复、StrictMode 行为不变；z 层级只用 token 表中的固定值。
- 样式全部进 `dsh.reset`/`tokens`/`components`/`surfaces`/`state` 五层之一；唯一未分层宿主规则是 `app/shell/shell.styles.ts` 的 `pluginBoundaryStyles`。产品样式中 `!important` 为零——压过规则靠层序或特异性。
- 位置选中沿用 `--dsh-ui-selected`，不另造页面专属颜色；错误、冲突和待确认不能仅靠颜色或被折叠隐藏。
- 编辑器实例、草稿、滚动位置、IME、作者字体和行宽不随外观变化重置（C40）。
- 图标按钮有可访问名称；弹窗保留焦点限制、Escape 和关闭后焦点返回；禁用/加载状态不能只“看起来不可点”。

新增基础组件或变体前，先检查已有 props；确需扩展时同步 gallery 和对应测试。外观变更同时看浅色、深色、键盘焦点与窄窗。设计源码的常量允许集中定义，不代表可以跳过主题对称性、对比度和视觉审查。
