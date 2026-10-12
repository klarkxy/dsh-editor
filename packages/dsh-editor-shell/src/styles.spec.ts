import { describe, expect, it } from 'vitest'
import { redesignedStyles } from './styles.ts'

describe('chrome type scale', () => {
  it('keeps chrome sizes on tokens only, with no leftover literal scale', () => {
    // --font-size-1 is defined once in design-system/tokens.ts (dsh.tokens layer).
    expect(redesignedStyles).not.toMatch(/--font-size-1:\s*\d+px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*1[123]px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*18px/)
    expect(redesignedStyles).toContain('.shell .chat-markdown h1 { font-size: var(--font-size-4)')
    expect(redesignedStyles).toContain('.shell .chat-markdown h2 { font-size: var(--font-size-3)')
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

  it('shares a header rule line across the three columns', () => {
    expect(redesignedStyles).toContain('.shell .sidebar .side-title')
    expect(redesignedStyles).toContain('.shell .chat-header')
    expect(redesignedStyles).toContain('min-height: var(--space-8)')
    expect(redesignedStyles).toContain('border-bottom: 1px solid var(--gray-a5)')
  })

  it('left-aligns file-tree rows instead of centering Radix button contents', () => {
    expect(redesignedStyles).toContain('.shell .tree .tree-row')
    expect(redesignedStyles).toMatch(/\.shell \.tree \.tree-row \{[^}]*justify-content: flex-start/)
    expect(redesignedStyles).toMatch(/\.shell \.tree \.tree-row \{[^}]*padding-inline: 0/)
    expect(redesignedStyles).toContain('.shell .tree .tree-marker')
    expect(redesignedStyles).toMatch(/\.shell \.tree \.tree-marker \{[^}]*display: inline-flex/)
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

  it('collapses the assistant panel to zero width when it is not in the grid', () => {
    expect(redesignedStyles).toContain('.shell:not(.assistant-in-grid) #assistant')
    expect(redesignedStyles).toMatch(/\.shell:not\(\.assistant-in-grid\) #assistant \{[^}]*flex-basis: 0 !important/)
    expect(redesignedStyles).toMatch(/\.shell:not\(\.assistant-in-grid\) #assistant \{[^}]*max-width: 0 !important/)
  })
})
