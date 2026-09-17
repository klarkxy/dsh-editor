import { describe, expect, it } from 'vitest'
import { redesignedStyles } from './styles.ts'

describe('chrome type scale', () => {
  it('raises caption to the 13px floor and keeps chrome sizes on tokens', () => {
    expect(redesignedStyles).toMatch(/\.radix-themes \{[^}]*--font-size-1: 13px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*1[123]px/)
    expect(redesignedStyles).not.toMatch(/font-size:\s*18px/)
    expect(redesignedStyles).toContain('.shell .chat-markdown h1 { font-size: var(--font-size-4)')
    expect(redesignedStyles).toContain('.shell .chat-markdown h2 { font-size: var(--font-size-3)')
  })
})

describe('paper pane alignment', () => {
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

  it('collapses the assistant panel to zero width when it is not in the grid', () => {
    expect(redesignedStyles).toContain('.shell:not(.assistant-in-grid) #assistant')
    expect(redesignedStyles).toMatch(/\.shell:not\(\.assistant-in-grid\) #assistant \{[^}]*flex-basis: 0 !important/)
    expect(redesignedStyles).toMatch(/\.shell:not\(\.assistant-in-grid\) #assistant \{[^}]*max-width: 0 !important/)
  })
})
