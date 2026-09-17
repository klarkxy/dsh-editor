import { describe, expect, it } from 'vitest'
import { resolveThemePortalContainer, resolveThemePortalFromAnchor } from './command-palette.tsx'

function fakeRoot(classNames: readonly string[]) {
  const nodes = classNames.map((className) => ({ className }))
  return {
    querySelector(selector: string) {
      const required = selector.split('.').filter(Boolean)
      return nodes.find((node) => required.every((cls) => node.className.split(/\s+/).includes(cls))) as HTMLElement | undefined ?? null
    },
  }
}

describe('resolveThemePortalContainer', () => {
  it('prefers the shell Theme root so palette tokens resolve', () => {
    const shell = { className: 'radix-themes shell-theme' }
    const root = fakeRoot(['radix-themes', shell.className])
    expect(resolveThemePortalContainer(root)).toEqual(shell)
  })

  it('falls back to any Theme root when shell-theme is absent', () => {
    const host = { className: 'radix-themes' }
    expect(resolveThemePortalContainer(fakeRoot([host.className]))).toEqual(host)
  })

  it('returns undefined when Theme is not mounted', () => {
    expect(resolveThemePortalContainer(fakeRoot([]))).toBeUndefined()
  })
})

describe('resolveThemePortalFromAnchor', () => {
  it('walks up to the shell Theme, not a leftover Themes wrapper', () => {
    const leftover = { className: 'radix-themes', closest: () => leftover }
    const shell = { className: 'radix-themes shell-theme' }
    const anchor = {
      closest(selector: string) {
        if (selector === '.radix-themes.shell-theme') return shell
        if (selector === '.radix-themes') return leftover
        return null
      },
    } as unknown as Element
    expect(resolveThemePortalFromAnchor(anchor)).toEqual(shell)
  })

  it('returns undefined without an anchor', () => {
    expect(resolveThemePortalFromAnchor(null)).toBeUndefined()
  })
})
