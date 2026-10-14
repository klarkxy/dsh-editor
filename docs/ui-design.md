# 界面设计契约：「原稿」设计系统

自 `redesign/ui-v2` 第 6 阶段起，本文是现行界面设计契约。第 3 阶段的[实施规格](redesign/design-system-spec.md)已完成使命、保留为历史留档；决策记录见 [G1 决策](redesign/decision.md)。

## 来源与边界

视觉基准是本仓库自有的「原稿」设计系统（`DESIGN_SYSTEM_ID = 'dsh-yuangao'`），不再适配上游界面。数值的唯一来源是 `packages/dsh-editor-shell/src/design-system/tokens.ts`；本文不另抄一份色表。

上游归属不变：内置 DSH 固定为 `0.2.0-rc.2`，官方插件制品按其自有界面运行，适配过的上游代码保留 MIT 声明于 `packages/dsh-editor-shell/resources/third-party/deepseek-harness-MIT.txt`；更早的 Kimi Web 声明在同目录 `kimi-web-MIT.txt`。DSH 的名称、美术与身份归 DSH 所有；不复制上游字体文件。

不变边界：React / Electron / CodeMirror、DSH 的会话/模型/审批/权限权威、稿纸的作者排版（字体、字号、行距、纸宽）都不随本系统改变。本系统只是界面层，不是引擎替换或前端分叉。

## Design tokens

`tokens.ts` 导出 `LIGHT_TOKENS` / `DARK_TOKENS`（键集合由检查器强制对称）与 `FOUNDATION_TOKENS`，公开名一律 `--dsh-ui-<key>`。

- **颜色**（完整取值见 tokens.ts）：浅色外框/侧栏 `#E8EBE6`、稿纸 `#F7F8F4`、浮层 `#FFFFFF`、正文 `#1E2420`、次要 `#5C655E`；深色外框 `#151816`、稿纸 `#1C201D`、浮层 `#252A26`、正文 `#DADFD6`、次要 `#97A096`。分割线 `line` / `line-strong` 是低透明中性色。`success` / `warning` / `danger` 各配 `*-soft` 底。
- **主色固定黛蓝**（G1 决策 3）：浅色 `accent`/`brand` `#2E4F7A` 配白字，深色 `#8FB0DE` 配 `#14181B`；链接、焦点、当前位置选中态（`selected`）用同一色相。自选主题色机制已删除，`localStorage` 旧键保留不读不删。朱色 `marker` / `margin-rule` 只用于当前章节圆点与版心竖线。
- **阴影**：`elevation-soft` / `elevation-panel` / `elevation-prominent` / `elevation-focus`，每条都以 0.5px 描边开头；`shadow-xs` 恒为 `none`。平面分割线和静态卡片只有 0.5px 中性边、无阴影；菜单为实色（`menu-fill`），不使用模糊（`menu-blur: none`）；模态遮罩是 `scrim` 纯黑半透明，不模糊页面。
- **基础尺度**：间距 `space-1`…`space-8`（4–32px）；圆角 `radius-xs` 4 … `radius-panel`/`radius-2xl` 20、`radius-full` 999；字号 `text-xs` 12 … `text-2xl` 24、`text-display` 22；字重 400/500/600；动效 `duration-fast` 120 / `base` 180 / `slow` 260ms，`ease-out`；控件高 `control-xs` 28（仅紧凑行）/ `sm` 32 / `md` 36 / `lg` 40 / `xl` 44；z 层级固定 `z-base`/`z-sticky`/`z-rail-overlay`/`z-dropdown`/`z-dialog`/`z-toast`/`z-tooltip`；`header-height` 48（栏内页头）、`content-max` 760、`tap-target` 44。
- **图表分类色**：`chart-1`…`chart-8`，`chart-1` 即主色，供官方用量图等表面使用。

### 主题作用域

token 声明输出到 `SCOPE` / `SCOPE_DARK`（tokens.ts）：`html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes, [data-dsh-theme])`（深色加 `.dark` / `[data-dsh-theme="dark"]`）。`.radix-themes` 是 `ShellTheme` 仍在输出的作用域类名——名字沿用自迁移前的根，与依赖无关；官方制品的同名包装元素由此读到同一套变量。`design-system/scope.ts` 的引用计数、卸载恢复先前值、StrictMode 行为不变。

token 作用域内还带两组别名：

- `RADIX_ALIASES`：`--font-size-*`、`--line-height-*`、`--space-*`、`--radius-*`、`--shadow-*`、`--paper-fill` 等旧梯级名映射到 `--dsh-ui-*`（官方制品与 manuscript 挂件样式仍在读这些名字）。`--gray-*` 调色板变量已随第 6a 阶段删除，不再输出。
- `compat.ts` 的 `--dsw-*` / `--ds-*` 兼容层：官方制品读到的变量按 `ALIAS_MAP` / `SPECIFIC_MAP` / 前缀规则映射到 `var(--dsh-ui-*)`。当前 **422** 个已扫描变量中 **144** 个映射、**278** 个留在 `DSW_PENDING` 不猜值。清单由 `node scripts/scan-dsw-vars.mjs --check` 保鲜，`check-ui-design` 会复核。

插件表面的 `--s-*` 别名链在 `packages/dsh-editor-seats/src/tokens.ts`：`--s-*` → `--dsh-ui-*` → 官方 `--dsw-*` → 上游兜底值，使插件在独立 DSH 宿主（没有 `--dsh-ui-*`）下仍完整可读。

## 样式分层

`design-system/layers.ts` 声明五层：`@layer dsh.reset, dsh.tokens, dsh.components, dsh.surfaces, dsh.state`。规则用 `defineStyles(layer, id, css)` 注册（同 id 只留一份），`collectStyles()` 按层序输出，`registerShellRoot` 的 `injectShellStyles`（`src/client/root.tsx`）把结果注入 head。

规则归属：

- 页面/区域：`src/app/<区域>/*.styles.ts`（home、files、assistant、settings、shell），进 `dsh.surfaces`；
- 共享 chrome：`src/client/*.styles.ts`（base、chat、dialogs、editor、palette、pinned-pane 等）；
- 基础组件：`src/ui/*.styles.ts`，进 `dsh.components`；
- 结构契约（CodeMirror、窗口拖拽、hidden/inert、网格骨架）在 `client/base.styles.ts` 与 `client/editor.styles.ts`。

`design-system/styles.ts` 的 `uiRule()` 仍用于需要「限定主题作用域并排除插件面（`[data-dsh-plugin-surface]` 及其后代）」的外观规则。插件样式（各自的 `injectStyles`）不进任何层——未分层声明天然优先于所有层，插件在自己作用域内不会被压过。

唯一允许未分层的宿主规则是 `app/shell/shell.styles.ts` 导出的 `pluginBoundaryStyles`：官方 rightbar 面板根是 `pointer-events:none` 的未分层声明，宿主用类+属性选择器（0,2,0）恢复其子树命中，不用 `!important`。它追加在 `collectStyles()` 之后注入；新增同类规则必须写进同一份导出并说明压过哪条插件声明。

产品样式中的 `!important` 总数为零（shell、manuscript、官方插件、proofread 与私有面板全部覆盖在 `check-ui-design` 的扫描内）。需要压过时用层序或特异性（如 `html ` 前缀），不用 `!important`。

## 组件库 `src/ui/`

每个组件一个 `.tsx`，同名 `.styles.ts` 进 `dsh.components`；类名 `dsh-<组件>` / `dsh-<组件>__<部件>`；变体用 `data-variant` / `data-size`，状态用 `data-state` / `data-disabled` / `aria-*`。可聚焦组件用 `forwardRef`；图标按钮必填可访问名称；禁用/加载有语义（`disabled`、`aria-disabled`、`aria-busy`）。焦点统一 `:focus-visible` + `outline: 2px solid var(--dsh-ui-accent)`；输入框与 composer 用 `elevation-focus`。

现有组件（以目录为准）：`Button`、`IconButton`、`SplitButton`、`Input`、`TextArea`、`SearchField`、`Select`、`Switch`、`Checkbox`、`RadioGroup`、`SegmentedControl`、`Slider`、`Field`、`Dialog`、`ConfirmDialog`、`Drawer`、`Menu`/`ContextMenu` 系列、`Popover`、`Tooltip`、`Tabs`、`Disclosure`、`Notice`、`Badge`、`Kbd`、`Spinner`、`ActivityDots`、`EmptyState`、`ListRow`、`Card`、`DataList`、`Progress`、`ScrollArea`、`Typography`、`icons.tsx`；基础设施 `UiRoot`（含 `TooltipProvider` 与 motion `LazyMotion`）、`ime.ts`、`focus-return.ts`、`motion.ts`。接口要点与逐组件约定见[实施规格 §5](redesign/design-system-spec.md)（留档）与各源文件注释。

按 `Ctrl+Alt+Shift+D` 打开生产组件 gallery：浅深色并排，不写工作区；不抢占打开的模态、重复按键或 IME 组字，Escape 关闭并返回焦点。

## 布局模型

工作台外框是 flex 列：`.dsh-topbar` 高 **44px**（固定值，窗口拖动区在其上），其下三列网格。栏内页头（文件栏头、辅助栏页头、编辑器头、设置页头）用 `--dsh-ui-header-height`（48px）。首页 chrome 用 `--topbar-h`（= `header-height`）。

- 左栏「文件 / 搜索」两个页签；右辅助栏横向页签「搭档 / 资料 / 工具」，官方 rightbar 槽位常驻挂载。
- 断点：窗口 ≤ **1040px** 时辅助栏让位为覆盖抽屉，≤ **760px** 时文件栏同样抽屉化，两抽屉互斥。判定是 `use-workbench-layout.ts` 的媒体查询，让位/恢复/作者优先的偏好归属规则见 `client/narrow-layout.ts` 与 `model/workbench-layout.ts`（契约 C30–C34）。
- 稿纸铺满中栏，作者排版不被外观重置；C40 要求主题/字号/设置切换不重建编辑器实例。

## 字体与排版

界面文字用 `font-ui` 系统无衬线栈；代码用 `font-mono`；作品名、章节标题、首页作品名与分节符用 `font-display` 楷体栈（`"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif`）。不加载远程字体。稿纸默认排版（系统无衬线、17px/1.9、段距 0.25em、76ch 居中）由 `writing-settings.tsx` 与 manuscript 的 `typography.ts` 共同声明，属作者偏好，不由本系统重置。

## 明暗、动效与可达性

明暗两套 token 键集合对称，状态色在两种模式下都配 `*-soft` 底。连续输入时两侧栏与顶栏按 `dim-opacity`（0.55）淡化，鼠标/快捷键/焦点移入即恢复；`prefers-reduced-motion` 下直接切换、无过渡，`forced-colors` 下焦点与选中态保留可见样式（顶栏描边等兜底规则散见各 sheet）。所有被检查的文字/表面组合在两种模式下对比度 ≥ 4.5:1，由 `check-ui-design` 强制。

## 验证门禁

```sh
# 设计契约（21 项，无依赖）：token 对称、对比度、分层顺序、DSW 映射覆盖、
# 无 !important、无 Radix 调色板变量、无 @radix-ui/themes 引用等
node --experimental-strip-types scripts/check-ui-design.mjs

# 增量偏移：与基线提交比对字面量颜色、!important、内联外观、新层外规则
node --test scripts/check-ui-drift.test.mjs
node scripts/check-ui-drift.mjs --base <base-sha>

# 构建/类型/单元测试
pnpm build && pnpm typecheck && pnpm test --maxWorkers=2

# 浏览器夹具（组件级契约：portal 主题、遮罩、焦点返回、输入节点稳定、
# 插件隔离、四档宽度、reduced-motion、forced-colors）
pnpm exec playwright install chromium
node e2e/ui-design.mjs

# 真实前端不变量（顶栏 44px、稿纸到底、栏/抽屉行为、编辑器身份 C40、
# 命令面板末项不被裁剪、设置不横向溢出等）
node e2e/layout-invariants.mjs
```

`e2e/ui-design.mjs` 的夹具不是完整应用：不验证 Electron 窗口控件、模型流式、保存与冲突；窗口缩放、保存偏好与覆盖层要用 `layout-invariants` 或桌面实测（见 [UI/UX 实测记录](ui-ux-audit-2026-10.md)）。输入法与显示缩放沿用操作系统、Electron 与 CodeMirror 的既有能力。
