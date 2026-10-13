import { describe, expect, it } from 'vitest'
import { redesignedStyles } from './styles.ts'
import { collectStyles } from './design-system/layers.ts'
import './app/files/files-rail.styles.ts'

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
    expect(redesignedStyles).toMatch(/\.settings-nav \.settings-tab\[data-state="active"\][^}]*background: var\(--accent-a3\)/)
    expect(redesignedStyles).toMatch(/\.shell > \.chrome \{[^}]*box-shadow: inset 0 -2px 0 var\(--accent-a5\)/)
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

  it('keeps the two home entry cards on one stretched row', () => {
    expect(redesignedStyles).toContain('.radix-themes .home-command-bar')
    expect(redesignedStyles).toMatch(/\.home-command-bar \{[^}]*display: grid/)
    expect(redesignedStyles).toMatch(/\.home-entry-card \{[^}]*height: 100%/)
  })

  it('left-aligns home recent-work rows instead of centering Radix button contents', () => {
    expect(redesignedStyles).toContain('.radix-themes .home-recent .workspace-row .tree-row')
    expect(redesignedStyles).toMatch(/\.home-recent \.workspace-row \.tree-row \{[^}]*justify-content: flex-start/)
    expect(redesignedStyles).toMatch(/\.home-recent \.workspace-row \.tree-row \{[^}]*text-align: start/)
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
