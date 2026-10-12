# 「原稿」设计系统实施规格（第 3 阶段）

本文是第 3 阶段的实施依据，取值来自 [G1 决策](decision.md)。第 6 阶段会把它的现行部分并入 `docs/ui-design.md`，届时在本文文首标为历史留档。

## 1. 原则

- **只有一处数值来源**：颜色、字号、圆角、阴影、z 层级、动效的字面量只能写在 `src/design-system/tokens.ts` 和 `src/design-system/compat.ts`。
- **公开 token 名称不变**：继续使用 `--dsh-ui-<key>`，现有键全部保留（插件和 seats 的 `--s-*` 别名链依赖它们），只改取值，按需新增键。
- **迁移期间新旧界面共用一套 token**：旧界面立即换成新配色；新组件和旧界面读同一套变量，不会出现两套配色并存。
- **主题色固定**：删除自选主题色机制，包括 `SHELL_ACCENTS`、`ACCENT_SOLIDS`、按 `data-accent-color` 生效的规则，以及设置中的主题色选择。`localStorage` 里的旧主题色键保留，不读也不删。Radix Themes 的 `accentColor` 在迁移期固定为 `indigo`。
- **设计系统 ID**：`DESIGN_SYSTEM_ID` 从 `'dsh-official'` 改为 `'dsh-yuangao'`。`DESIGN_SOURCE` 改为描述本仓库自有设计；上游许可证注释与 `resources/third-party/` 保持不变。

## 2. Token 取值

### 2.1 颜色

| 键 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `chrome`（新增） | `#E8EBE6` | `#151816` | 窗口外框、顶栏、左右栏底色 |
| `sidebar` | `#E8EBE6` | `#151816` | 与 `chrome` 相同，保留旧键名 |
| `bg` | `#F7F8F4` | `#1C201D` | 稿纸与主内容面 |
| `paper`（新增） | `#F7F8F4` | `#1C201D` | 与 `bg` 相同，语义别名 |
| `surface` | `#EEF1EC` | `#202521` | 栏内次级面 |
| `sunken` | `#E1E5DF` | `#121513` | 凹陷面、输入槽 |
| `raised` | `#FFFFFF` | `#252A26` | 浮层、菜单、对话框、提案卡 |
| `text` | `#1E2420` | `#DADFD6` | 正文 |
| `muted` | `#5C655E` | `#97A096` | 次要文字 |
| `faint` | `#79827A` | `#747C73` | 非必要的弱提示，不用于必须读的说明 |
| `line` | `rgba(30, 36, 32, 0.10)` | `rgba(218, 223, 214, 0.10)` | 分割线 |
| `line-strong` | `rgba(30, 36, 32, 0.18)` | `rgba(218, 223, 214, 0.18)` | 控件描边、卡片边 |
| `hover` | `rgba(30, 36, 32, 0.06)` | `rgba(218, 223, 214, 0.06)` | 悬停填充 |
| `selected` | `rgba(46, 79, 122, 0.12)` | `rgba(143, 176, 222, 0.16)` | 当前位置 |
| `accent` | `#2E4F7A` | `#8FB0DE` | 焦点、业务状态 |
| `accent-hover` | `#233D5F` | `#A9C3E8` | |
| `accent-soft` | `rgba(46, 79, 122, 0.10)` | `rgba(143, 176, 222, 0.14)` | 焦点光环、浅底 |
| `accent-border` | `rgba(46, 79, 122, 0.32)` | `rgba(143, 176, 222, 0.36)` | |
| `accent-solid` | `#2E4F7A` | `#8FB0DE` | |
| `on-accent` | `#FFFFFF` | `#14181B` | |
| `link` | `#2E4F7A` | `#8FB0DE` | |
| `brand` | `#2E4F7A` | `#8FB0DE` | 主按钮、发送键 |
| `brand-hover` | `#233D5F` | `#A9C3E8` | |
| `on-brand` | `#FFFFFF` | `#14181B` | |
| `bubble` | `#E2E8EF` | `#26303A` | 作者消息气泡 |
| `marker`（新增） | `#B23A2A` | `#E07A68` | 朱色，只用于当前章节圆点 |
| `margin-rule`（新增） | `rgba(178, 58, 42, 0.35)` | `rgba(224, 122, 104, 0.35)` | 版心竖线 |
| `success` | `#2F6B3F` | `#7CC78F` | |
| `success-soft` | `#E3F0E5` | `#1F3326` | |
| `warning` | `#8A5A12` | `#E0B060` | |
| `warning-soft` | `#F6EEDC` | `#332A1A` | |
| `danger` | `#A8322A` | `#F08A7E` | |
| `danger-soft` | `#F7E4E1` | `#3A1F1C` | |
| `scrim` | `rgba(16, 20, 18, 0.48)` | `rgba(0, 0, 0, 0.55)` | 模态遮罩，不模糊 |
| `menu-fill` | `#FFFFFF` | `#252A26` | 菜单为实色，不用半透明 |
| `menu-blur` | `none` | `none` | 去掉玻璃效果 |

### 2.2 阴影

| 键 | 浅色 | 深色 |
| --- | --- | --- |
| `elevation-soft` | `0 0 0 0.5px rgba(30, 36, 32, 0.16)` | `0 0 0 0.5px rgba(218, 223, 214, 0.18)` |
| `elevation-panel` | `0 0 0 0.5px rgba(30, 36, 32, 0.18), 0 6px 20px rgba(30, 36, 32, 0.08)` | `0 0 0 0.5px rgba(218, 223, 214, 0.18), 0 6px 20px rgba(0, 0, 0, 0.35)` |
| `elevation-prominent` | `0 0 0 0.5px rgba(30, 36, 32, 0.20), 0 12px 32px rgba(30, 36, 32, 0.12)` | `0 0 0 0.5px rgba(218, 223, 214, 0.20), 0 12px 32px rgba(0, 0, 0, 0.45)` |
| `elevation-focus` | `0 0 0 1px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft)` | 同左 |
| `shadow-xs` | `none` | `none` |
| `shadow-sm` | 同 `elevation-soft` | 同 `elevation-soft` |
| `shadow-md` | 同 `elevation-panel` | 同 `elevation-panel` |
| `shadow-lg`、`shadow-xl` | 同 `elevation-prominent` | 同 `elevation-prominent` |

### 2.3 基础尺度（`FOUNDATION_TOKENS`）

- **字体**：`font-ui` 保持系统无衬线栈。`font-mono` 不变。新增 `font-display`：`"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif`。
- **间距**：现有 `space-*` 不变。
- **圆角**：`radius-xs 4px`、`radius-sm 6px`、`radius-md 8px`、`radius-lg 12px`、`radius-xl 16px`、`radius-2xl 20px`、`radius-panel 20px`、`radius-full 999px`。比官方风格收紧一档，更接近纸张。
- **字号**：`text-xs 12px`、`text-sm 13px`、`text-base 14px`、`text-md 15px`、`text-lg 17px`、`text-xl 20px`、`text-2xl 24px`。新增 `text-display 22px`（首页作品名）。
- **字重、行高**：现有键不变。
- **动效**：`duration-fast 120ms`、`duration-base 180ms`、`duration-slow 260ms`、`ease-out cubic-bezier(0.2, 0, 0, 1)`。新增 `dim-opacity 0.55`（连续输入时淡化侧栏）。
- **控件高度**：`control-xs 28px`（仅树行等紧凑行）、`control-sm 32px`、`control-md 36px`、`control-lg 40px`、`control-xl 44px`。
- **z 层级（新增）**：`z-base 0`、`z-sticky 10`、`z-rail-overlay 40`、`z-dropdown 50`、`z-dialog 60`、`z-toast 70`、`z-tooltip 80`。组件只能使用这些值。

### 2.4 Radix 兼容变量（迁移期，第 6 阶段删除）

`tokenStyles` 中的 `--gray-1` 到 `--gray-12` 和 `--gray-a1` 到 `--gray-a12` 改用 B 的中性色：

- **浅色**：`gray-1 = raised`、`gray-2 = bg`、`gray-3 = surface`、`gray-4 = chrome`、`gray-5 = sunken`；`gray-6` 到 `gray-9` 在 `sunken` 与 `muted` 之间等分插值；`gray-10`、`gray-11 = muted`；`gray-12 = text`。透明度阶梯沿用现有 alpha 值，基色改为 `rgb(30, 36, 32)`。
- **深色**：按同样的映射，基色改为 `rgb(218, 223, 214)`。

其他 Radix 映射（`--color-background`、`--radius-*`、`--shadow-*`、`--font-size-*` 等）保持现有写法，自动取到新值。

## 3. 作用域与主题

- **token 选择器**：
  - 浅色：`html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes, [data-dsh-theme])`
  - 深色：`html[data-dsh-ui="dsh-yuangao"] :is(.radix-themes.dark, [data-dsh-theme="dark"])`
  - 这样旧的 Radix Theme 元素和新的主题根读同一套变量，组件预览页中浅深色并排也可以各自生效。
- **`scope.ts`**：引用计数、卸载恢复、不撤销外部改动这三项行为保持不变。
- **新增 `ui/root.tsx` 的 `UiRoot`**：
  - 渲染 `<div class="dsh-root" data-dsh-theme={theme}>`。
  - 内部放一个 `<div data-dsh-portal-root>`，通过 React context 提供给所有新组件，作为 Radix Primitives Portal 的 `container`。
  - 原因：`official-layout.ts` 把 DSH 官方 token 以内联样式写在 `body` 上，直接挂到 `body` 的 portal 拿不到 shell 的 `--dsh-ui-*` 和覆盖后的 `--dsw-*`。
  - 迁移期 `UiRoot` 放在旧的 `ShellTheme` 内部。

## 4. 样式分层（`design-system/layers.ts`）

- 层顺序在注入的样式表开头声明一次：`@layer legacy, dsh.reset, dsh.tokens, dsh.components, dsh.surfaces, dsh.state;`。
- `defineStyles(layer, id, css)` 把一段样式注册到指定层，同一 `id` 只保留一份。`collectStyles()` 按层顺序输出完整样式表。`registerShellRoot` 的 `injectShellStyles` 改为注入它的结果。
- 迁移期间，旧的 Radix Themes CSS、`src/styles.ts`、`design-system/styles.ts` 等旧样式整体包进 `@layer legacy { … }`，新组件的层因此稳定优先。
  - 注意：层内的 `!important` 会反过来压过后面层的普通声明。迁移某个界面时，必须删掉影响该界面的旧 `!important` 规则。
- 插件样式（各插件的 `injectStyles`）不进任何层。未分层样式优先于所有层，所以插件在自己的作用域内天然优先，`[data-dsh-plugin-surface]` 边界的测试保留。
- 包进 `legacy` 层后，要截图对比旧界面，确认除了配色之外没有变化。官方插件页、插件面板也要截图对比，确认可读、没有破版。

## 5. 组件库（`packages/dsh-editor-shell/src/ui/`）

- 每个组件一个 `.tsx`，样式放在同名 `.styles.ts`，通过 `defineStyles('dsh.components', …)` 注册。
- 类名为 `dsh-<组件>`、`dsh-<组件>__<部件>`。变体用 `data-variant`、`data-size`，状态用 Radix 的 `data-state`、`data-disabled` 和 `aria-*`。
- 不使用 `!important`；`style={}` 不写外观属性。
- 可聚焦组件都用 `forwardRef`。图标按钮必须有可访问名称。禁用和加载状态要有语义：`disabled`、`aria-disabled`、`aria-busy`。
- 焦点样式统一：`:focus-visible` 时用 `outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px`。输入框和 composer 用 `elevation-focus`。

| 组件 | 接口要点 |
| --- | --- |
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`；`size: 'sm' \| 'md' \| 'lg'`（32/36/40px）；`loading`；`icon`、`iconEnd`。主按钮为 `brand` 填充、`on-brand` 文字；次按钮为 `raised` 加 `line-strong` 描边；幽灵按钮透明，悬停用 `hover` |
| `IconButton` | 必填 `label`（同时作为 `aria-label` 和提示）；`variant: 'ghost' \| 'secondary' \| 'primary'`；`size: 'sm' \| 'md'`；`pressed` 映射 `aria-pressed`，按下态文字用 `accent` |
| `SplitButton` | `label`、`onClick`、`menuLabel`、`items: { label, onSelect, shortcut? }[]` |
| `Input` | `value`、`onChange(value: string)`、`size`、`invalid`、`leading`、`trailing`；透传组字事件 |
| `TextArea` | `value`、`onChange(value: string)`、`minRows`、`maxRows`（自动增高） |
| `SearchField` | `Input` 加放大镜图标和清除按钮；清除按钮可访问名称取 `clearLabel` |
| `Select` | Radix Select；`value`、`onValueChange`、`options: { value, label, description?, disabled? }[]`、`placeholder`、`size`、`aria-label` |
| `Switch` | Radix Switch；`checked`、`onCheckedChange`、`label`、`description`、`disabled`、`shortcut`（以 `Kbd` 显示）。整行是 `<label>`，最小高度 40px，点击整行都能切换；开关本体 36x20px |
| `Checkbox`、`RadioGroup` | 同上整行可点；`RadioGroup` 的 `options: { value, label, description? }[]` |
| `SegmentedControl` | Radix ToggleGroup 单选；`value`、`onValueChange`、`options: { value, label, icon? }[]`、`aria-label`；高 32px |
| `Slider` | Radix Slider；`value`、`min`、`max`、`step`、`onValueChange`、`label`、`format(value)` |
| `Field` | `label`、`description`、`error`（`role="alert"`）、`children`；用 `htmlFor` 和 `aria-describedby` 关联 |
| `Dialog` | Radix Dialog；`open`、`onOpenChange`、`title`、`description`、`size: 'sm' \| 'md' \| 'lg'`（420/560/720px）、`initialFocusRef`、`returnFocusRef`、`dismissible`、`footer`；焦点返回用移植后的 `focus-return.ts` |
| `ConfirmDialog` | Radix AlertDialog；`open`、`title`、`message`、`confirmLabel`、`cancelLabel`、`tone: 'default' \| 'danger'`、`busy`、`onConfirm`、`onCancel` |
| `Drawer` | Radix Dialog 侧滑；`side: 'left' \| 'right'`、`title`、`closeLabel`；窄窗覆盖栏用 |
| `Menu` 系列 | DropdownMenu 与 ContextMenu 两套：`Menu`、`MenuTrigger`、`MenuContent`、`MenuItem`（`icon`、`shortcut`、`tone: 'default' \| 'danger'`、`disabled`）、`MenuSeparator`、`MenuLabel`、`MenuSub`。菜单面板为 `menu-fill` 加 `elevation-panel`，`border: 0`，不模糊 |
| `Popover` | `trigger`、`content`、`side`、`align`、`aria-label` |
| `Tooltip` | 带 Provider；内容 12px |
| `Tabs` | Radix Tabs，`Tabs`、`TabList`、`Tab`、`TabPanel`；文字页签，当前页签有 2px `accent` 下划线；高 36px |
| `Disclosure` | Radix Collapsible；`summary`、`open`、`defaultOpen`、`onOpenChange` |
| `Notice` | `tone: 'info' \| 'success' \| 'warning' \| 'danger'`、`title`、`action`；同时显示图标和文字。`danger`、`warning` 用 `role="alert"`，其余用 `role="status"`；背景用对应的 `*-soft` |
| `Badge` | `tone: 'neutral' \| 'accent' \| 'success' \| 'warning' \| 'danger'` |
| `Kbd` | 12px，`line-strong` 描边 |
| `Spinner`、`ActivityDots` | 移植现有 `ActivityDots`；减少动态效果时静止 |
| `EmptyState` | `title`、`body`、`actions` |
| `ListRow` | `leading`、`label`、`meta`、`trailing`、`selected`（`aria-current`）、`onSelect`；`density: 'compact' \| 'regular'`（28/36px） |
| `icons.tsx` | 移植 `client/icons.tsx` 的图标，统一 16px 和 1.5px 线宽，`size` 只取 `icon-sm`、`icon-md`、`icon-lg` |
| `UiRoot` | 见第 3 节；同时提供 `TooltipProvider`，以及 motion 的 `LazyMotion` |

- 从旧目录移植 `client/ui/ime.ts`、`focus-return.ts`、`motion.ts` 及其 spec 到 `src/ui/`。旧目录改为从新位置 re-export，第 6 阶段删除。
- 新增依赖（选发布超过 7 天的版本并固定）：`@radix-ui/react-switch`、`@radix-ui/react-checkbox`、`@radix-ui/react-radio-group`、`@radix-ui/react-toggle-group`、`@radix-ui/react-slider`、`@radix-ui/react-popover`、`@radix-ui/react-context-menu`、`@radix-ui/react-collapsible`、`@radix-ui/react-visually-hidden`、`@radix-ui/react-slot`。同步加进 `tsdown.config.ts` 的 `alwaysBundle`。

## 6. 兼容层（`design-system/compat.ts`）

- **扫描脚本**：新增 `scripts/scan-dsw-vars.mjs`，扫描 `node_modules/@deepseek-ai/dsh-client-ui-*`、`@deepseek-ai/dsh-web-frontend` 和 `@klarkxy/*` 的已发布制品，把用到的 `--dsw-*` 和 `--ds-*` 变量名去重排序，写入 `src/design-system/dsw-vars.ts`（`export const DSW_VARS = [...] as const`）。脚本支持 `--check` 模式：生成结果和已提交文件不一致时失败。
- **映射**：`compat.ts` 导出 `DSW_MAP: Record<DswVar, string>`，值一律引用 `var(--dsh-ui-*)`，规则如下：
  - `bg-base` → `bg`；`bg-layer-1` → `surface`；`bg-layer-2`、`bg-layer-3` → `raised`；`bg-module-platform` → `sunken`
  - `label-primary` → `text`；`label-secondary`、`label-tertiary` → `muted`；`label-primary-foreground` → `on-brand`；`label-error` → `danger`
  - `border-l1`、`border-l2` → `line`；`border-l3`、`border-l4`、`settings-card-stroke` → `line-strong`
  - `state-business-primary` → `accent`；`state-success-primary` → `success`；`state-warn-primary` → `warning`；`state-error-primary` → `danger`
  - `interactive-bg-hover` → `hover`；`interactive-bg-active` → `selected`；`interactive-bg-hover-danger` → `danger-soft`
  - `button-primary-fill` → `brand`；`button-primary-hover` → `brand-hover`；`link` → `link`
  - `--dsw-radius-*` 按名称对应 `radius-*`
  - `--dsw-elevation*` → `elevation-panel`；`elevation-prominent` → `elevation-prominent`
  - `focus-ring-color` → `accent`；`focus-ring-width` → `2px`
  - `menu-surface-fill` → `menu-fill`；`menu-backdrop-filter` → `none`
  - `scrollbar-*` 中名称含 `hover` 的 → `muted`，其余 → `line-strong`
  - `specific-sidebar-fill` → `sidebar`
  - `--ds-font-family-code` → `font-mono`；其余 `--ds-font-family-*` → `font-ui`
- **无法归类的变量**：先不映射，在交接报告中列出，由我决定。
- **输出位置**：映射写进 token 作用域（第 3 节的两个选择器），替换 `tokenStyles` 里现有的手写 `--dsw-alias-*` 行。
- **测试**：spec 断言 `DSW_VARS` 中每一项都在 `DSW_MAP` 里。

## 7. 门禁

- **`scripts/check-ui-design.mjs` 改写**，检查以下内容：
  - 浅深色 token 的键集合相同。
  - 对比度不低于 4.5:1，每种模式都检查：`text`/`bg`、`text`/`chrome`、`text`/`raised`、`muted`/`bg`、`muted`/`chrome`、`muted`/`raised`、`on-brand`/`brand`、`link`/`bg`、`link`/`raised`、`danger`/`bg`、`success`/`bg`、`warning`/`bg`。
  - token 中没有 `gradient` 和 `blur(`。
  - `DESIGN_SYSTEM_ID === 'dsh-yuangao'`。
  - 作用域生命周期的检查保留。
  - `@layer` 声明的顺序正确。
  - `DSW_MAP` 覆盖全部 `DSW_VARS`。
  - 删除所有关于主题色和 `ACCENT_SOLIDS` 的检查。
- **`scripts/check-ui-drift.mjs`**：
  - `owners` 加入 `design-system/compat.ts` 和 `design-system/dsw-vars.ts`。
  - 新增规则 `radix-themes-import`：新文件不得 import `@radix-ui/themes`；现有文件按增量基线管理，数量只能减少。
  - 新增规则 `inline-appearance`：`style={{` 中出现 `color`、`background`、`border`、`borderRadius`、`boxShadow`、`fontSize`、`fontWeight`、`fontFamily`、`zIndex` 时报告。
  - `check-ui-drift.test.mjs` 为两条新规则各补一个正例和一个反例。
- **组件预览与夹具**：重写 `design-system/gallery.tsx`，展示全部新组件，浅深色并排，每个组件都包含正常、悬停、焦点、禁用、加载、错误、空这几种适用状态。重写 `fixtures/design-system.tsx` 和 `e2e/ui-design.mjs`，覆盖：
  - portal 继承主题
  - 遮罩为黑色且不模糊
  - 菜单为实色、不模糊
  - Dialog 焦点返回、Escape 关闭
  - 主题切换时输入节点不重建
  - 禁用的发送按钮语义
  - 插件隔离
  - 1440/1024/760/390 四档宽度无横向溢出
  - 减少动态效果
  - forced-colors 下焦点和选中状态可见
  - `Switch` 整行可点击且高度不小于 40px
- **旧主题色键**：补一个测试，断言新的主题模块不会删除 `localStorage` 中的旧主题色键（契约 C43）。
