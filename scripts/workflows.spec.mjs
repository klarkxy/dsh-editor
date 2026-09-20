import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const release = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')

describe('github workflows', () => {
  it('runs build, typecheck and tests on push and pull requests', () => {
    expect(ci).toContain('pull_request:')
    expect(ci).toContain('pnpm typecheck && pnpm test')
    expect(ci).toContain('tags-ignore:')
  })

  it('creates a draft release when the tag has no release yet', () => {
    expect(release).toContain('gh release create "$RELEASE_TAG" --draft --title')
    expect(release).not.toMatch(/gh release create "\$RELEASE_TAG" --title/)
  })

  it('runs Windows unit tests in a single fork pool', () => {
    expect(release).toContain('--pool=forks')
    expect(release).toContain("runner.os == 'Windows' && '1'")
  })

  it('starts the packed Windows portable wrapper before publishing', () => {
    expect(release).toContain('pnpm test:e2e:portable')
    expect(release).toContain('DSH_PORTABLE_SMOKE:')
    expect(release).toMatch(/if: runner\.os == 'Windows'\s*\n\s*env:\s*\n\s*DSH_PORTABLE_SMOKE: '1'\s*\n\s*run: pnpm test:e2e:portable/)
  })

  it('verifies plugin delivery and search settings on Windows before packing', () => {
    const commands =
      'pnpm pack:plugins && node e2e/plugin-matrix.mjs && node e2e/missing-private-plugin.mjs && node e2e/web-search-settings.mjs'
    const stepStart = release.indexOf('- name: Verify plugin delivery and search settings')
    const packStart = release.indexOf('- name: Pack desktop artifacts')
    const uploadStart = release.indexOf('actions/upload-artifact')
    expect(stepStart).toBeGreaterThan(-1)
    expect(packStart).toBeGreaterThan(stepStart)
    expect(uploadStart).toBeGreaterThan(packStart)
    const step = release.slice(stepStart, packStart)
    expect(step).toContain("if: runner.os == 'Windows'")
    expect(step).toContain(`run: ${commands}`)
    expect(step).not.toMatch(/continue-on-error/)
    expect(release).toMatch(
      /if: runner\.os == 'Windows'\s*\n\s*run: pnpm pack:plugins && node e2e\/plugin-matrix\.mjs && node e2e\/missing-private-plugin\.mjs && node e2e\/web-search-settings\.mjs/,
    )
    expect(release.indexOf(commands)).toBeGreaterThan(-1)
    expect(release.indexOf(commands)).toBeLessThan(release.indexOf('pnpm pack:desktop'))
    expect(release.indexOf(commands)).toBeLessThan(uploadStart)
  })
})
