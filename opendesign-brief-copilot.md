# Follow-up screens for DSH Prose Copilot

Edit the existing `index.html` in this project. Keep kami / 紙, the three-column manuscript-first layout, and Chinese UI. Do not turn it into VS Code.

Add three more states to the top switcher (keep 写作 / 选段 / 空白章, append):

1. **句内** — VS Code Copilot Inline Chat, novel-only
2. **命令** — composer `/` and `@` palettes
3. **审阅** — review gutters, report only

## Shared rules

- Author writes. Model assists. No “生成本章”.
- Right column remains DSH chat.
- No terminal, git, minimap, problems panel as IDE, no Agent mode.

## Screen: 句内 (Inline Chat)

Author selected 「楼道里有人经过，脚步声在转角断掉。」
A compact inline card sits **under the selection**, like Copilot Ctrl+I:

- Header: `改这句` (not Copilot, not Agent)
- Input: `收一点，别解释她怕什么`
- Two short candidates as patches, radio or stacked
- Buttons: `用这句` `关掉`
- Keyboard hint: `Ctrl+I`

Forbidden in this card: generate paragraph, keep all, regenerate chapter.

## Screen: 命令

Focus the right composer. An open palette above the input:

**Slash group** (author language, not skill jargon):
- `/问` 只讨论，不改稿
- `/改` 只改选区或本章呈现
- `/审` 找问题，列出位置，不自动改
- `/读` 模拟第一次读完的感觉
- `/对质` 关键选择给 2–3 个不同走向
- `/声音` 这段还像她本人吗
- `/顺` 改顺句子，不许改事情结局

**@ group**:
- `@本章`
- `@选区`
- `@她`（人物卡）
- `@这栋楼`（世界书）
- `@今晚`（大纲）

Highlight `/对质`. Composer still says `问剧情、审一段、对质人物……`

Do NOT show: 交接卡, 文风包, canon, AI腔, grill-your-novel, Skill.

## Screen: 审阅

Same chapter. Left of the prose, small ink ticks on 2–3 lines (gutter), not a squiggle storm.

A slim list under the chapter or in a drawer in the manuscript column:

1. 钥匙放回去了，但下一句还在确认这扇门认不认钥匙 — 选择还没落地
2. 「她没有开灯」后面如果解释怕，读者会被喂完
3. 楼道有人经过：在场的人有没有被写丢

Each row: 位置 · 一句话影响 · `只看` （default） and muted `改这句` (opens 句内). Default is report-only.

Chat on the right shows: `已按你的要求只看问题，没有改正文。`

## Implementation

One HTML file, switcher includes all six: 写作 选段 空白章 句内 命令 审阅.
Keep the existing 写作/选段/空白章 intact; add the three new views with data-view attributes.
Deliver by updating `index.html`.
