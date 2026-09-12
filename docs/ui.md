# DSH Editor 界面与设计系统

本文是桌面写作界面的维护说明。产品原则见 [product-principles.md](product-principles.md)，使用者操作见 [user-guide.md](user-guide.md)。Token 与代码不一致时，以桌面 shell 的 CSS 变量为准。

## 视觉身份

稿纸优先：中间是长文写作区，左右两栏是工具。观感应像灯下的一叠稿纸，坐在 DSH 里面，而不是另一套 IDE 或 AI 写作套件。

- 界面语言默认简体中文；英文只覆盖外壳，右侧 DSH 对话仍用上游文案。
- 正文用宋体栈，chrome / 文件树 / 对话用无衬线栈。
- 强调色只有一系墨蓝。禁止纯黑底、冷蓝灰 IDE 高对比、紫色渐变、玻璃拟态、霓虹装饰。
- 纸主题的画布是暖米黄，不是 `#ffffff`。墨主题是带棕意的深暖色，正文是暖米白，不是纯白。
- Chrome 与稿纸分层：顶栏/侧栏/对话用偏中性的 `--chrome-*`，稿纸继续用暖 `--surface` / `--bg`。Chrome 字号 13–14px，常用控件 32–36px，顶栏约 52px。
- 弹层 Portal 走 `.dsh-ui` 命名空间，复用同一套 token；旧 `.shell` 选择器通过 `.dsh-ui` 镜像继续生效。

## 源文件

| 职责 | 文件 |
| --- | --- |
| 桌面 token、chrome、工作台面板 | `packages/dsh-editor-shell/src/styles.ts`（`tokenStyles` / `baseStyles` / `componentStyles`，导出 `redesignedStyles`） |
| 共享 Dialog / Confirm / Menu / Tooltip / Tabs / 控件 | `packages/dsh-editor-shell/src/client/ui/` |
| 座位上的 Select / Dialog 类型 | `packages/dsh-editor-seats/src/index.ts` |
| 纸 / 墨切换、与宿主 `ui-theme` 同步 | `packages/dsh-editor-shell/src/client/theme.ts` |
| 公开稿纸 overlay 的同类 token（无 shell 时保底） | `packages/dsh-manuscript/src/client/editor-core/styles.ts` |
| overlay 抽屉（不占 root） | `packages/dsh-manuscript/src/client/overlay-styles.ts` |
| 稿纸交互（FIM、选段、查找） | `packages/dsh-manuscript/src/client/editor-core/editor.tsx` |

改颜色时两份 token 一起改：shell 是桌面权威，editor-core 的副本让公开 `dsh-manuscript` overlay 在没有 shell 时仍可读。overlay 的圆角更紧，不必强行与 shell 对齐。

选择写入 `localStorage["dsh-editor.theme"]`，并映射到宿主 `ui-theme`：纸 → `light`，墨 → `dark`。跟随系统没有对应稿纸主题，读取时按 `prefers-color-scheme` 落成纸或墨。

## 纸 / 墨 token

同一套 DOM，只切 `:root[data-theme="paper"|"ink"]`。默认纸。

| 变量 | 纸 | 墨 | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#f3f1e8` | `#161310` | 页面底 |
| `--bg-sunken` | `#ebe9df` | `#100e0b` | 侧栏 / 聊天下沉 |
| `--surface` | `#fdfcf6` | `#221e18` | 稿纸、抬起的容器 |
| `--surface-warm` | `#e8e6dc` | `#2c2820` | 悬停、次级填充 |
| `--fg` | `#141413` | `#ede7d7` | 主文字 |
| `--fg-2` | `#3d3d3a` | `#cdc7b8` | 次级文字 |
| `--muted` | `#504e49` | `#a8a294` | 说明、弱化 |
| `--meta` | `#6b6a64` | `#8f897b` | 日期、快捷键、三级 chrome |
| `--border` | `#d8d5c7` | `#3d382f` | 实色边 |
| `--border-soft` | `#e5e3d8` | `#2a261f` | 内部分隔 |
| `--hairline` | `rgba(20,20,19,.08)` | `rgba(237,231,215,.07)` | 默认细线 |
| `--hairline-strong` | `rgba(20,20,19,.12)` | `rgba(237,231,215,.14)` | 需要更清楚的细线 |
| `--accent` | `#1b365d` | `#9db4d0` | 链接、主操作、单一色相 |
| `--accent-soft` | `rgba(27,54,93,.08)` | `rgba(157,180,208,.16)` | 选中 / 激活底，不用灰底冒充强调 |
| `--accent-on` | `#faf9f5` | `#161310` | 强调色底上的字 |
| `--accent-active` | `#142a48` | `#b6c9e0` | 按下 / 焦点 |
| `--ghost` | `#78756c` | `#8f897b` | FIM 幽灵字：同字体同字号，只降颜色 |
| `--selection` | `#e4e6dc` | `#2e3547` | 选区底 |
| `--danger` | `#8a3a30` | `#c4786a` | 破坏性操作 |
| `--confirm` | `#4a6b3a` | `#8aaa70` | 已保存 / 肯定 |

主题切换不要再写 `body[data-ds-dark-theme]`。组件里不要临时写 hex；新颜色先加进上表再引用变量。

## 字体、间距与栏宽

| 变量 | 值 |
| --- | --- |
| `--font-serif` | `"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif` |
| `--font-sans` | `"Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif` |
| `--font-mono` | `ui-monospace, "SF Mono", "JetBrains Mono", Consolas, Monaco, monospace` |
| `--text-body` / `--leading-body` | `17px` / `1.9` |
| `--tree-w` / `--chat-w` / `--topbar-h` / `--control-h` | `220px` / `360px` / `52px` / `34px` |
| `--text-chrome` | `13px`（chrome 正文；稿纸 `--text-body` 仍为 17px） |
| `--chrome-bg` / `--chrome-raised` / `--chrome-sunken` | 中性工作台底；稿纸 `--surface` 保持暖色 |
| `--space-1` … `--space-6` | `4 / 8 / 12 / 16 / 20 / 24px` |
| `--radius-sm` / `--radius-md` | `6px` / `8px`（shell） |

稿纸排版（字号 14–28px、行距、段距、衬线/无衬线/等宽、窄栏 60ch / 中栏 76ch / 通栏）由 `dsh-editor-writing` 设置写入 CSS 变量，不另开一套主题。仓库不引入字体 CDN；本机缺 Noto 时走系统宋体 / 黑体。

## 布局

默认三栏：左真实目录树、中稿纸、右 DSH 对话。首页以命令条（打开 / 新建 / 导入）加最近作品列表为主入口。工作台顶栏约 52px：作品名菜单收纳次要操作，文件/专注/搭档与命令面板、设置留在可见 chrome。两侧栏可折叠或进入专注模式；栏宽只存本机界面偏好。

| 宽度 | 行为 |
| --- | --- |
| `> 1040px` | 三栏 |
| `≤ 1040px` | 收起右栏与部分顶栏 chrome |
| `≤ 760px` | 只留稿纸 |

`prefers-reduced-motion: reduce` 时关掉过渡和动画（含 `.dsh-ui` / palette / select 等 Portal 浮层）；Motion 入场去掉位移/缩放/弹簧并 `duration: 0`。幽灵补全的 loading 不再闪，只保留 `--ghost` 色。焦点与状态变化仍在。

共享弹层由 shell `src/client/ui` 提供：`Dialog` / `Confirm` / `Menu` / `Tooltip` / `Tabs` / `Button` / `Input`，外加已有 `Select`。作品菜单、文件右键、正文右键 /「⋯」、对话「⋯」都走同一套 `Menu`。正文菜单直接打开自定义改写；打字机与段落聚焦收在写作设置中，本章工作笔记用独立 Dialog。正文常驻仅保留文档名、章节导航、字数、保存状态和「⋯」，停止生成、预览采纳 / 放弃、冲突和备份恢复按需显示。菜单卸载后再交接焦点给搜索面板或弹窗。路径回退与新对话走受控 `Dialog`，不把输入框放进菜单 typeahead。Motion `m.*` 只用于首页三张入口卡和搜索面板 chrome；Radix 菜单/对话框继续 CSS Presence。稿纸、作曲区、FIM、长列表不用 Motion。IME 组字期间 Enter（含 `keyCode === 229`）由输入 `keydown` 自己 `preventDefault`，不得提交。

## 已落地的写作交互

这些文案和键位是产品契约，改之前先改 i18n 与 editor-core，并跑视觉走查。

| 交互 | 表现 | 写入规则 |
| --- | --- | --- |
| Ghost FIM | 光标处浅色续写，底栏 `补全 · Tab 采纳 · Esc 关掉`；按钮为「补全 / 接受补全 / 再来一个 / 放弃」，最多三条 | 确认后进入草稿，按常规自动或手动保存 |
| 选段改写 | 原文与建议对照；「应用修改」或 `Ctrl+Enter`，「放弃」不动正文 | 同上；过期 ticket 丢弃 |
| 文件提案 | 原文/新文件对比卡；「应用」才落盘，「忽略」不写 | 版本校验；目标已变则失效 |
| 空白章 | 安静稿纸，不自动生成 | — |
| 对话输入 | placeholder「问剧情、审一段、对质人物……」 | 不把生成章节倒进文件 |

概览、卡片、搜索使用已有面板；桌面校对暂时停用，顶栏和正文菜单不显示其入口。知乎作为搭档工具保留，配置、调用用量和知识库管理在设置内嵌显示。插件开关和页签必须在真实设置弹窗中检查外观，避免被通用按钮规则覆盖。写作搭档支持展开阅读并恢复原宽度，不复制对话状态。不另做 IDE 式 Problems / minimap / Git blame。

## 改界面时

1. 先核对本文件和 [product-principles.md](product-principles.md) 的禁止项。
2. 颜色只改 token 表对应的 CSS 变量，并同步 editor-core 副本。
3. 不要为新面板引入第二套色板或英文-only chrome。
4. 桌面视觉以 `pnpm test:e2e:visual-audit` 为准；命令面板用 `pnpm test:e2e:palette`。截图写到 `e2e/out/`，不提交。

仓库不再保留 OpenDesign brief 或静态 HTML 原型。需要对照历史稿时查 Git 历史，不要把原型截图当验收标准。

设置主体必须有受约束的高度，内容区独立滚动，导航和标题固定。用量图采用 Apache ECharts 按需打包的 SVG 柱状图，显示坐标刻度、悬浮明细与可访问数据表；隐藏标签页、主题切换、窗口缩放和卸载都要验证。辅助文件不显示在文件栏，也不提供显示开关。
