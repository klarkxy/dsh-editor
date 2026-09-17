# DSH Editor 界面与设计系统

本文是桌面写作界面的维护说明。产品原则见 [product-principles.md](product-principles.md)，操作见 [user-guide.md](user-guide.md)。

## 设计系统

界面以 **Radix Themes**（`@radix-ui/themes`）为唯一设计系统。根组件是 `src/client/ui/theme-root.tsx` 的 `<ShellTheme>`，内部是：

```tsx
<Theme
  className="shell-theme"
  appearance={appearance}          // 'light' | 'dark'，与宿主 ui-theme 同步
  accentColor={accent}             // indigo / blue / teal / green / amber / crimson / violet
  grayColor="auto"
  radius="medium"
  scaling="100%"
  panelBackground="solid"
>
```

`appearance` 跟宿主 `ui-theme`（及本机 `dsh-editor.theme`）对齐。强调色来自设置里的色彩风格，映射到 Themes 的 `accentColor`。

## CSS 怎么注入

没有 Tailwind / CSS Modules / PostCSS。`@radix-ui/themes/styles.css` 经 tsdown `loader: { '.css': 'text' }` 当字符串打进客户端包，`root.tsx` 的 `injectStyles()` 写入 `<style>`。注入前把 `:root` / `:root, .light` 改写成 `.radix-themes`，避免 `--gray-*` 落到 DSH 宿主 `:root`。

手写残留在 `packages/dsh-editor-shell/src/styles.ts`，导出 `redesignedStyles`，与 Themes CSS 拼在一起注入。规则：

- 拼装优先：Themes 组件 + 布局 props（`p / gap / width / …`）。
- 手写 CSS 只允许：三栏 grid、`-webkit-app-region`、CodeMirror、cmdk、分隔条、`@keyframes`、fixed/absolute 定位。
- **颜色只用 Radix 变量，组件里禁止 hex / rgba。**

`.radix-themes` 上覆盖 CJK 无衬线与等宽栈：`--default-font-family`、`--code-font-family`。Chrome 把 `--font-size-1` 抬到 **13px**，对齐 [product-principles.md](product-principles.md) 的常用 chrome 地板。稿纸宋体 / 字号 / 行距仍由写作设置写 `--paper-*`（默认 17px，作者可调 14–28px），不跟 chrome 混成一套。`.shell-theme` 提供栏高常量 `--topbar-h`（52px）。

## 字号角色

Chrome 只认角色，不写 `11px` / `12px` / `13px` / `18px`。`Text` / `Heading` 的 `size` 对应 `--font-size-N`。

| 角色 | 用法 | token | 值 |
| --- | --- | --- | --- |
| caption | 次级说明、时间、badge、kbd、步骤细节 | `size="1"` / `--font-size-1` | 13px |
| body | 默认界面字、设置行标题、树 / 列表、聊天正文、表单 label、主按钮字 | `size="2"` / `--font-size-2` | 14px |
| section | 设置卡片小标题、侧栏分区 | `Heading size="3"` / `--font-size-3` | 16px |
| title | 对话框、设置页眉、侧栏面板标题 | `Heading size="4"` / `--font-size-4` | 18px |
| display | 首页校验态、空稿纸大标题 | `Heading size="6"` / `--font-size-6` | 24px |

禁止：把可读正文或表单 label 写成 `size="1"`；chrome 里用 `Heading size="5"|"7"|"8"|"9"`。`size="3"` 以上其余阶仍用 Radix 原值（16 / 18 / 20 / 24 / …），独立渲染时由 `dsh-editor-seats/tokens` 补齐 `--font-size-1`–`9`。搭档回复正文至少 14px。

## 变量速查

| 用途 | 用这个 |
| --- | --- |
| 页面底 | `--color-background` |
| 面板 / 卡片 | `--color-panel-solid`、`--color-surface` |
| 主文字 / 次级 | `--gray-12` / `--gray-11` |
| 边框 / 细线 | `--gray-6`、`--gray-a5`、`--gray-a6` |
| 悬停 / 选中 | `--gray-a3` / `--accent-a3` |
| 主操作 | `--accent-9`、字 `--accent-contrast` |
| 危险 / 成功 | `--red-9` / `--green-9` |
| 间距 / 圆角 / 阴影 | `--space-N`、`--radius-N`、`--shadow-N` |

旧 `--bg` / `--surface` / `--fg` / `--hairline` / `--chrome-*` 已删除，不要再引用。

## 插件与座位

侧栏面板、稿纸 overlay、设置内嵌插件都在 `.radix-themes` 下读同一套变量。座位组件（`Button` / `Input` / `Select` / `Dialog`）由 shell 注入，面板能用座位就不要自绘控件。

独立渲染（没有 Themes 祖先）时，`dsh-editor-seats/tokens` 的 `radixFallbackTokens` 在 `:root:not(:has(.radix-themes))` 上补一份 gray + indigo 的 light/dark 变量；`:root[data-theme="dark"]` 为暗色。有 `.radix-themes` 时这块不生效。

## 结构钩子

e2e 依赖语义 class / `data-testid`（`.shell`、`.chrome`、`.home-stage`、`.tree`、`.chat`、`.palette-overlay`、`.settings-dialog`、`getByTestId('paper-editor')` 等）。这些名字是钩子，不再承担配色。改名前先搜 `e2e/` 和 `*.spec.ts`。

## 断点与运动

| 宽度 | 行为 |
| --- | --- |
| `> 1040px` | 三栏 |
| `≤ 1040px` | 搭档改为覆盖稿纸的抽屉 |
| `≤ 760px` | 只留稿纸；文件栏开关不可用 |

`prefers-reduced-motion: reduce` 关掉过渡和循环动画（含 palette 等 Portal）。幽灵补全 loading 停闪，只留 `--gray-9`。活动点 / 微光 / 骨架停循环，保留静态形。

## 活动原语

`src/client/ui/activity.tsx`：`ActivityDots`（pulse / typing）、`ActivityRing`（Themes `Spinner`）、`ActivityShimmer`、`ActivitySkeleton`（Themes `Skeleton`）、`ActivityText`（`role=status` + `aria-live`）、`SuccessMark`。面板复用 `.panel-activity-dots` / `.panel-skeleton`。忙碌按钮保持原标签，装饰一律 `aria-hidden`。

## 改界面时

1. 先核对本文件和 [product-principles.md](product-principles.md) 的禁止项。
2. 颜色只改 Radix 变量或 `<Theme accentColor>`，不要在组件里写 hex。
3. 不要为新面板引入第二套色板或英文-only chrome。
4. 验收：`pnpm typecheck`、`pnpm test`、`pnpm --filter dsh-editor-shell build`、`pnpm test:e2e:visual-audit`。截图写到 `e2e/out/`，不提交。

设置主体要有受约束高度，`.settings-pages` 是唯一内容滚动区。用量图用 ECharts SVG，系列色在运行时用 `getComputedStyle` 读 `--indigo-9` 等。字号按上文角色表，不要另起一套。
