import { describe, expect, it } from 'vitest'
import { redesignedStyles } from './styles.ts'
import { collectStyles } from './design-system/layers.ts'
import './app/files/files-rail.styles.ts'
import './app/home/home.styles.ts'
import './ui/list-row.styles.ts'

const filesRailStyles = collectStyles()

describe('chrome type scale', () => {
  it('keeps chrome sizes on tokens only, with no leftover literal scale', () => {
    // --font-size-1 is defined once in design-system/tokens.ts (dsh.tokens layer).
    expect(redesignedStyles).not.toMatch(/--font-size-1:\s*\d+px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*1[123]px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*18px/)
    /* 抽屉是 Portal：聊天然规则同时覆盖 .shell 与 .dsh-drawer 宿主。 */
    expect(redesignedStyles).toContain(':is(.shell, .dsh-drawer) .chat-markdown h1 { font-size: var(--font-size-4)')
    expect(redesignedStyles).toContain(':is(.shell, .dsh-drawer) .chat-markdown h2 { font-size: var(--font-size-3)')
  })
})

describe('paper pane alignment', () => {
  it('keeps palette literals out of the structural sheet and accent on selected chrome', () => {
    // 原稿 tokens own every --gray-* / --color-* / --paper-fill value; the
    // structural sheet only consumes them.
    expect(redesignedStyles).not.toMatch(/--color-background:\s*#/)
    expect(redesignedStyles).not.toMatch(/--color-panel-solid:\s*#/)
    expect(redesignedStyles).not.toMatch(/--gray-1:/)
    expect(redesignedStyles).not.toMatch(/--paper-fill:\s*(?!var\()/)
    expect(redesignedStyles).toMatch(/\.radix-themes \.editor \{[^}]*background: var\(--paper-fill\)/)
    expect(redesignedStyles).toMatch(/\.shell \.editor-cell \{[^}]*background: var\(--paper-fill\)/)
    /* C36 退役后设置导航是 ListRow 行：选中态走共享的 --dsh-ui-selected。 */
    expect(filesRailStyles).toMatch(/\.dsh-list-row\[data-selected\][^}]*background: var\(--dsh-ui-selected\)/)
    /* 首页 chrome 与工作台顶栏同约定：底边只有 hairline，不再有 accent 条。 */
    expect(redesignedStyles).not.toMatch(/\.shell > \.chrome \{[^}]*box-shadow/)
  })

  it('keeps the CodeMirror scroller top-start so a short chapter does not float', () => {
    expect(redesignedStyles).toContain('.paper-input .cm-scroller')
    expect(redesignedStyles).toContain('align-items: flex-start !important')
    expect(redesignedStyles).toContain('justify-content: flex-start')
    expect(redesignedStyles).toContain('.paper-input .cm-content')
    expect(redesignedStyles).toContain('text-align: start')
  })

  it('keeps the files-rail header and chat header on the shared header height', () => {
    // Phase 4.2: the sidebar head rules moved to app/files/files-rail.styles.ts
    // (dsh.surfaces layer); the chat header stays in the structural sheet.
    expect(filesRailStyles).toContain('.dsh-files-rail__head')
    expect(filesRailStyles).toMatch(/\.dsh-files-rail__head[^{]*\{[^}]*min-height: var\(--dsh-ui-header-height\)/)
    expect(redesignedStyles).toContain(':is(.shell, .dsh-drawer) .chat-header')
  })

  it('left-aligns file-tree rows instead of centering Radix button contents', () => {
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*justify-content: flex-start/)
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*text-align: start/)
    expect(filesRailStyles).toMatch(/\.dsh-files-rail \.tree \.tree-marker[^{]*\{[^}]*display: inline-flex/)
  })

  it('keeps the home 继续写作 block and table-of-contents rows in the surfaces layer', () => {
    // Phase 4.5: the home page moved to app/home/home.styles.ts — the continue
    // block is a flat raised surface and recent works render as a book TOC
    // (display type + dotted leader + right-aligned info).
    const collected = collectStyles()
    expect(collected).toContain('.dsh-home-continue')
    expect(collected).toMatch(/\.dsh-home-continue__title \{[^}]*font-family: var\(--dsh-ui-font-display\)/)
    expect(collected).toContain('.dsh-home-row__leader')
    expect(collected).toMatch(/\.dsh-home-row__title \{[^}]*font-family: var\(--dsh-ui-font-display\)/)
    expect(collected).toMatch(/\.dsh-home-row__info \{[^}]*color: var\(--dsh-ui-muted\)/)
  })

  it('keeps home recent-work rows as left-aligned text buttons, not centered controls', () => {
    const collected = collectStyles()
    expect(collected).toMatch(/\.dsh-home-row__main \{[^}]*text-align: start/)
    expect(collected).toMatch(/\.dsh-home-row__main \{[^}]*width: 100%/)
  })

  it('keeps hidden rails out of the grid via the new shell pane styles', async () => {
    // Phase 4.1: the workbench drops hidden rails from the PanelGroup entirely
    // (React conditional), so the old #assistant zero-width !important hacks
    // are gone; pane surfaces live in the dsh.surfaces layer instead.
    await import('./app/shell/shell.styles.ts')
    const { collectStyles } = await import('./design-system/layers.ts')
    const collected = collectStyles()
    expect(redesignedStyles).not.toContain('assistant-in-grid')
    expect(redesignedStyles).not.toContain('#assistant')
    expect(collected).toContain('.dsh-pane--aux')
    expect(collected).toContain('.dsh-pane--files')
    expect(collected).toContain('.dsh-pane > .chat')
  })
})
