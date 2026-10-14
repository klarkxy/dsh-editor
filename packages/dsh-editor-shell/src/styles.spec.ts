import { describe, expect, it } from 'vitest'
import { collectStyles } from './design-system/layers.ts'
import './client/base.styles.ts'
import './client/editor.styles.ts'
import './client/chat.styles.ts'
import './app/files/files-rail.styles.ts'
import './app/home/home.styles.ts'
import './app/shell/shell.styles.ts'
import './ui/list-row.styles.ts'

const shellStyles = collectStyles()

describe('chrome type scale', () => {
  it('keeps chrome sizes on tokens only, with no leftover literal scale', () => {
    // --font-size-1 is defined once in design-system/tokens.ts (dsh.tokens layer).
    expect(shellStyles).not.toMatch(/--font-size-1:\s*\d+px/)
    /* 抽屉是 Portal：聊天然规则同时覆盖 .shell 与 .dsh-drawer 宿主；
       h1/h2 同档 2xl（旧 font-size-3/4 阶梯已并入原稿刻度）。 */
    expect(shellStyles).toMatch(/\.chat-markdown h1,\s*:is\(\.shell, \.dsh-drawer\) \.chat-markdown h2[^}]*font-size: var\(--dsh-ui-text-2xl\)/)
    expect(shellStyles).toMatch(/\.chat-markdown h3[^}]*font-size: var\(--dsh-ui-text-xl\)/)
  })
})

describe('paper pane alignment', () => {
  it('keeps palette literals out of the sheets and accent on selected chrome', () => {
    // 原稿 tokens own every --gray-* / --color-* / --paper-fill value; the
    // sheets only consume them.
    expect(shellStyles).not.toMatch(/--color-background:\s*#/)
    expect(shellStyles).not.toMatch(/--color-panel-solid:\s*#/)
    expect(shellStyles).not.toMatch(/--gray-1:/)
    expect(shellStyles).not.toMatch(/--paper-fill:\s*(?!var\()/s)
    expect(shellStyles).toMatch(/\.radix-themes \.editor \{[^}]*background: var\(--dsh-ui-bg\)/)
    expect(shellStyles).toMatch(/\.shell \.editor-cell \{[^}]*background: var\(--paper-fill\)/)
    /* C36 退役后设置导航是 ListRow 行：选中态走共享的 --dsh-ui-selected。 */
    expect(shellStyles).toMatch(/\.dsh-list-row\[data-selected\][^}]*background: var\(--dsh-ui-selected\)/)
    /* 首页 chrome 与工作台顶栏同约定：底边只有 hairline，不再有 accent 条。 */
    expect(shellStyles).not.toMatch(/\.shell > \.chrome \{[^}]*box-shadow/)
  })

  it('keeps the CodeMirror scroller top-start so a short chapter does not float', () => {
    /* CodeMirror 基础主题自带 .cm-scroller { align-items: flex-start !important }，
       shell 侧只需常规声明，层折叠后不再依赖 !important。 */
    expect(shellStyles).toContain('.paper-input .cm-scroller')
    expect(shellStyles).toContain('justify-content: flex-start')
    expect(shellStyles).toContain('.paper-input .cm-content')
    expect(shellStyles).toContain('text-align: start')
  })

  it('keeps the files-rail header and chat header on the shared header height', () => {
    // Phase 4.2: the sidebar head rules live in app/files/files-rail.styles.ts
    // (dsh.surfaces layer); the chat header lives in client/chat.styles.ts.
    expect(shellStyles).toContain('.dsh-files-rail__head')
    expect(shellStyles).toMatch(/\.dsh-files-rail__head[^{]*\{[^}]*min-height: var\(--dsh-ui-header-height\)/)
    expect(shellStyles).toContain(':is(.shell, .dsh-drawer) .chat-header')
  })

  it('left-aligns file-tree rows instead of centering Radix button contents', () => {
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*justify-content: flex-start/)
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-row[^{]*\{[^}]*text-align: start/)
    expect(shellStyles).toMatch(/\.dsh-files-rail \.tree \.tree-marker[^{]*\{[^}]*display: inline-flex/)
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

  it('keeps hidden rails out of the grid via the new shell pane styles', () => {
    // Phase 4.1: the workbench drops hidden rails from the PanelGroup entirely
    // (React conditional), so the old #assistant zero-width !important hacks
    // are gone; pane surfaces live in the dsh.surfaces layer instead.
    const collected = collectStyles()
    expect(collected).not.toContain('assistant-in-grid')
    expect(collected).not.toContain('#assistant')
    expect(collected).toContain('.dsh-pane--aux')
    expect(collected).toContain('.dsh-pane--files')
    expect(collected).toContain('.dsh-pane > .chat')
  })
})
