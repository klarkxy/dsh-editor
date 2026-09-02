# DSH Editor — OpenDesign brief：双主题重构版

基于本仓库 `opendesign-brief.md` 的既有产物（kami / 紙 三栏稿纸稿）做**重构版设计**。产品 thesis、禁用清单、文案示例全部沿用旧 brief，此处只写增量要求。不要再生成一套无关的新风格。

## 本次目标

把旧稿收敛成**可落地的双主题 token 设计稿**，供前端按变量直接实现。

## 布局（相比旧稿的收敛）

三栏不变，但 chrome 极简：

1. **左栏（~220px）**：文件树，只有四组——正文 / 大纲 / 人物卡 / 世界书。组标题右侧一个内联 `+`（新建）。不要搜索框、不要归档区、不要索引状态行。
2. **中栏（主角）**：稿纸。顶部一行：章节名 · 字数 · 保存状态（已保存/未保存）。底部一条低矮 ghost 状态条：`Tab 采纳 · Alt+] 下一条 · Esc 关掉`，右侧两个小动作「补全」「改选段」。上下章导航只是章名两侧的 ‹ ›。
3. **右栏（~360px）**：dsh 对话线程。会话标题、流式回复、底部 composer。composer placeholder：`问剧情、审一段、对质人物……`。
4. **顶栏（细）**：作品名 · 对话名 · 模型名 · 一个主题切换钮（纸/墨）。没有第二个按钮。不要菜单农场、不要设置齿轮群。

旧稿里的选段补丁条保留：选中「楼道里有人经过，脚步声在转角断掉。」后出现原句 vs 一句改写的 slim strip，按钮 `用这句` / `不要`。

## 双主题（本次的核心交付）

同一套 DOM 结构类名，只切 `:root[data-theme]` 下的 CSS 变量：

- **`paper`（纸，默认）**：沿用现有 kami 暖纸 token（parchment `#f5f4ed` 系、ivory surface、暖橄榄文字、单一墨色 accent）。
- **`ink`（墨）**：深棕黑暖调"灯下夜稿"。背景是带棕意的深暖色（参考方向 `#1a1815` 系），正文文字是暖米白不是纯白，accent 与 paper 同一墨色系的浅化版。**禁止**：纯黑 `#000`、冷蓝灰、IDE 式高对比霓虹。

要求输出一份 token 表：每层变量名、paper 值、ink 值，覆盖——三级 surface、四级文字、两级边框、accent、ghost 文字色（比正文浅但仍可读）、选中底色、危险/确认各一色。变量命名用 `--bg / --surface / --surface-warm / --fg / --fg-2 / --muted / --meta / --border / --border-soft / --accent / --ghost / --selection / --danger` 这一组，方便直接映射到代码。

## 字体与排版

- 正文：Noto Serif SC 或系统宋体栈，measure ≈ 34–38 字，行高 1.9 左右，段间距克制。
- chrome / 树 / chat：system UI 或 Noto Sans SC。
- ghost 文字：同字体同字号，仅颜色降为 `--ghost`，行间 shimmer 只在 ghost span 内。

## 交付物

1. 单文件 HTML（`data-theme="paper|ink"` 可切，`data-view="write|patch|empty"` 三态），默认 paper + write。
2. 同一份 HTML 的两张 1440×900 截图：paper-write、ink-write。
3. 一份 token 表（可直接放在 HTML 顶部注释里）。

界面语言：简体中文。正文示例沿用旧 brief 的「雨还没停。她把钥匙放回抽屉底层……」段落与 ghost 示例，不要新造文案。
