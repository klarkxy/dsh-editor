# Shell UI: preserve the design contract

涉及可见界面时，先读仓库根目录的 [UI 施工约定](../../docs/ui-agent-guide.md) 和 [设计说明](../../docs/ui-design.md)。
本文件适用于 shell 全包，不只是 `src/client/ui/`。

## 修改落点

| 需要改变什么 | 唯一入口或既有入口 |
| --- | --- |
| 配色、字号/圆角/间距/动效尺度 | `src/design-system/tokens.ts` |
| 产品外观与现有 DOM 的映射 | `src/design-system/styles.ts` 的原规则 |
| 可访问的基础交互 | `src/client/ui/` 与已使用的 Radix 组件 |
| CodeMirror、窗口拖拽、分栏、hidden/inert 等结构 | `src/styles.ts` 与现有布局组件 |
| 活体组件示例 | `src/design-system/gallery.tsx` |
| 浏览器契约 | `fixtures/design-system.tsx`、根目录 `e2e/ui-design.mjs` |

不要把视觉规则追加到旧 `src/styles.ts` 的末尾，或给每个页面再建一套覆盖层。替换规则时删除被替换的重复项，但不要顺手改写无关结构。

## 必须保持

- 外观选择器使用 `uiRule()`，保留 `html[data-dsh-ui="dsh-official"]` 与插件排除边界。Portal 必须继承所在 Radix Theme 的主题，不凭全局 DOM 猜主题。
- 主按钮、发送键、当前位置（侧边栏/设置选中态）、用户气泡、链接和焦点跟随保存的主题色，其余表面保持中性。主按钮实色沿用 `tokens.ts` 的 `ACCENT_SOLIDS`，保持明暗主题对比度；主题色的具体契约以设计说明和生产 tokens 为准。平面卡片和分割线是 0.5px 且无阴影。菜单、对话框和 composer 只用含 0.5px 描边的 elevation。菜单模糊只留在现有菜单规则。模态遮罩不模糊。
- `scope.ts` 的引用计数、卸载恢复、StrictMode 行为不变；不全局重新编号 Radix spacing 和 z-index。
- 位置选中沿用 `--dsh-ui-selected`，不另造页面专属颜色；错误、冲突和待确认不能仅靠颜色或被折叠隐藏。
- 普通助手文本不层层套卡片；执行记录可折叠；提案/审批是明确的决策区域。
- 编辑器实例、草稿、滚动位置、IME、作者字体和行宽不随外观变化重置。
- 图标按钮有可访问名称；弹窗保留焦点限制、Escape 和关闭后焦点返回；禁用/加载状态不能只“看起来不可点”。

新增基础组件或变体前，先检查已有 props；确需扩展时同步 gallery 和对应测试。外观变更同时看浅色、深色、键盘焦点与窄窗。设计源码的常量允许集中定义，不代表可以跳过主题对称性、对比度和视觉审查。
