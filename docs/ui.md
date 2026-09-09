# DSH Editor 界面与设计系统

本文是桌面写作界面的维护说明。产品原则见 [product-principles.md](product-principles.md)，使用者操作见 [user-guide.md](user-guide.md)。Token 与代码不一致时，以桌面 shell 的 CSS 变量为准。

## 视觉身份

稿纸优先：中间是长文写作区，左右两栏是工具。观感应像灯下的一叠稿纸，坐在 DSH 里面，而不是另一套 IDE 或 AI 写作套件。

- 界面语言默认简体中文；英文只覆盖外壳，右侧 DSH 对话仍用上游文案。
- 正文用宋体栈，chrome / 文件树 / 对话用无衬线栈。
- 强调色只有一系墨蓝。禁止纯黑底、冷蓝灰 IDE 高对比、紫色渐变、玻璃拟态、霓虹装饰。
- 纸主题的画布是暖米黄，不是 `#ffffff`。墨主题是带棕意的深暖色，正文是暖米白，不是纯白。

## 源文件

| 职责 | 文件 |
| --- | --- |
| 桌面 token、chrome、工作台面板 | `packages/dsh-editor-shell/src/styles.ts`（`tokenStyles` / `baseStyles` / `componentStyles`，导出 `redesignedStyles`） |
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
| `--tree-w` / `--chat-w` / `--topbar-h` | `220px` / `360px` / `40px` |
| `--space-1` … `--space-6` | `4 / 8 / 12 / 16 / 20 / 24px` |
| `--radius-sm` / `--radius-md` | `6px` / `8px`（shell） |

稿纸排版（字号 14–28px、行距、段距、衬线/无衬线/等宽、窄栏 60ch / 中栏 76ch / 通栏）由 `dsh-editor-writing` 设置写入 CSS 变量，不另开一套主题。仓库不引入字体 CDN；本机缺 Noto 时走系统宋体 / 黑体。

## 布局

默认三栏：左真实目录树、中稿纸、右 DSH 对话。顶栏细：作品名、对话、模型、纸/墨切换。两侧栏可折叠或进入专注模式；栏宽只存本机界面偏好。

| 宽度 | 行为 |
| --- | --- |
| `> 1040px` | 三栏 |
| `≤ 1040px` | 收起右栏与部分顶栏 chrome |
| `≤ 760px` | 只留稿纸 |

`prefers-reduced-motion: reduce` 时关掉过渡和动画；幽灵补全的 loading 不再闪，只保留 `--ghost` 色。

## 已落地的写作交互

这些文案和键位是产品契约，改之前先改 i18n 与 editor-core，并跑视觉走查。

| 交互 | 表现 | 写入规则 |
| --- | --- | --- |
| Ghost FIM | 光标处浅色续写，底栏 `补全 · Tab 采纳 · Esc 关掉`；按钮为「补全 / 接受补全 / 再来一个 / 放弃」，最多三条 | 只进编辑 buffer，需显式保存 |
| 选段改写 | 原文与建议并排；「应用修改」或 `Ctrl+Enter`，「放弃」不动正文 | 同上；过期 ticket 丢弃 |
| 文件提案 | 原文/新文件对比卡；「应用」才落盘，「忽略」不写 | 版本校验；目标已变则失效 |
| 空白章 | 安静稿纸，不自动生成 | — |
| 对话输入 | placeholder「问剧情、审一段、对质人物……」 | 不把生成章节倒进文件 |

校对、概览、卡片、搜索是侧栏面板，不另做 IDE 式 Problems / minimap / Git blame。

## 改界面时

1. 先核对本文件和 [product-principles.md](product-principles.md) 的禁止项。
2. 颜色只改 token 表对应的 CSS 变量，并同步 editor-core 副本。
3. 不要为新面板引入第二套色板或英文-only chrome。
4. 桌面视觉以 `pnpm test:e2e:visual-audit` 为准；命令面板用 `pnpm test:e2e:palette`。截图写到 `e2e/out/`，不提交。

仓库不再保留 OpenDesign brief 或静态 HTML 原型。需要对照历史稿时查 Git 历史，不要把原型截图当验收标准。
