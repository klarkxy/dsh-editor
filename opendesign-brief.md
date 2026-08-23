# DSH Prose Copilot — OpenDesign brief

Generate a **desktop web prototype** (1440×900) of a DeepSeek Harness (DSH) plugin for Chinese novel writing.

This is **not** a VS Code clone, **not** an AI novelist, **not** a chapter factory.

## Product thesis (non-negotiable)

- The **author writes**. The model only assists.
- AI-written novels have a detectable “AI flavor”. Therefore the model must **not** draft chapters.
- The assist is **ghost FIM at the caret**: short continuation (half sentence to two sentences), Tab to accept, Esc to dismiss. Optional extra candidates with Alt+].
- Official DSH Chat is already the **sidebar assistant** (grill plot, review, ask questions). Do **not** reinvent a second chat product.
- This plugin only adds: **manuscript paper + caret ghost + select-to-patch**.
- Workspace is a normal folder: `正文/ 大纲/ 人物卡/ 世界书/`. No hidden runtime JSON, no project wizard, no “生成第N章”.

## Layout (desktop)

Three columns, manuscript-first:

1. **Left, narrow (~220px)**: file tree of the current DSH workspace. Groups: 正文, 大纲, 人物卡, 世界书. Plain names, not IDE glyphs soup. Active chapter highlighted quietly.
2. **Center, dominant**: manuscript editor. Warm paper, long-form Chinese typesetting (comfortable measure, generous line-height). Chapter title at top. This is where the author lives.
3. **Right (~360px)**: **unchanged DSH conversation**. Treat it as the existing harness chat: session title, streaming reply, composer at bottom. It is for grilling and review, not for dumping generated chapters into the file.

Top bar is DSH chrome, thin: workspace name, session, model. No Copilot marketing, no “AI 写作” badge.

## Ghost FIM (the hero interaction)

Show the default screen **mid-sentence**, caret blinking in a real Chinese paragraph.

Example body (use this, do not invent a wuxia lorem):

> 雨还没停。她把钥匙放回抽屉底层，指腹在金属齿上停了一下，像是在确认这把钥匙今晚还认不认这扇门。楼道里有人经过，脚步声在转角断掉。她没有开灯。

Caret sits after 「她没有开灯。」or in the middle of the next unwritten beat.

Ghost text is **lighter, same typeface**, inserted at caret, not a popup card covering the sentence. Example ghost (short):

> 窗玻璃上只剩一层薄雾，街灯把对面阳台的铁栏杆印进来。

A small, low toolbar **below the editor**, not over the caret: `Tab 采纳` · `Alt+] 下一条` · `Esc 关掉`. Status: “补全 · 半句”. Never “正在为你写作本章”.

Second state on the same screen or a clearly labelled variant: ghost **loading** — a faint shimmer only in the ghost span, editor still fully usable.

## Select-to-patch (secondary)

A second screen/state: author has selected 「楼道里有人经过，脚步声在转角断掉。」 A slim patch strip appears under the selection: original vs proposed one-sentence rewrite. Buttons: `用这句` / `不要`. Proposed text is also short. No “重写本章”.

## What the right chat is doing

On the default screen, DSH chat shows a **grill** turn, not a generated chapter. Example assistant message:

> 这把钥匙今晚还要不要开门，是她的选择还是作者还没决定？如果她不开，下一句只需要落到她听见什么、手往哪放，不必解释她为什么怕。

Composer placeholder: `问剧情、审一段、对质人物……` not `写第三章`.

## Explicitly forbidden

- Minimap, breadcrumbs, git blame, LSP, terminal, activity bar icon farm
- “生成大纲 / 一键写十章 / Keep all agent edits”
- Purple gradients, glassmorphism, neon AI orbs, 3D blobs
- English-only UI. Primary UI language: **简体中文**
- Fake “DeepSeek / Cursor / Notion” logos as decoration
- Making the manuscript a tiny pane beside a giant chat

## Screens to ship

1. `index.html` — default: writing + visible ghost + DSH chat grilling
2. `select-patch.html` or a tab inside the same file — selection + one-sentence patch
3. `empty.html` — empty chapter, no ghost, quiet paper, left tree with one new file `未命名`

If you combine into one HTML, use a top segmented control: `写作` / `选段` / `空白章`. Default to 写作.

## Visual direction

Use the attached design system (kami / 紙) and editorial-minimalist taste: warm paper, hairline borders, serif for chapter title, grotesque or system UI for chrome, one ink accent only. It should feel like a desk lamp over a draft, sitting **inside** DSH, not a new IDE.

Deliver real HTML/CSS, 1440×900 artboard, Chinese text as specified. No lorem ipsum.
