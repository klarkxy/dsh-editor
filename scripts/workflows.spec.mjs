import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const release = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
const npmPublish = readFileSync(resolve(root, '.github/workflows/npm-publish.yml'), 'utf8')

describe('github workflows', () => {
  it('runs build, typecheck and tests on push and pull requests', () => {
    expect(ci).toContain('pull_request:')
    expect(ci).toContain('pnpm typecheck && pnpm test')
    expect(ci).toContain('tags-ignore:')
  })

  it('publishes npm packages only for version tags', () => {
    expect(npmPublish).toMatch(/push:\s*\r?\n\s*tags: \['v\*'\]/)
    expect(npmPublish).not.toContain('branches: [main]')
    expect(npmPublish).not.toContain('workflow_dispatch:')
    expect(npmPublish).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(npmPublish).toContain('node scripts/verify-release-version.mjs')
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

  it('verifies plugin delivery on Windows before packing', () => {
    const commands =
      'pnpm pack:plugins && node e2e/plugin-matrix.mjs && node e2e/missing-private-plugin.mjs'
    const stepStart = release.indexOf('- name: Verify plugin delivery')
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
      /if: runner\.os == 'Windows'\s*\n\s*run: pnpm pack:plugins && node e2e\/plugin-matrix\.mjs && node e2e\/missing-private-plugin\.mjs/,
    )
    expect(release.indexOf(commands)).toBeGreaterThan(-1)
    expect(release.indexOf(commands)).toBeLessThan(release.indexOf('pnpm pack:desktop'))
    expect(release.indexOf(commands)).toBeLessThan(uploadStart)
  })

  it('only runs e2e scripts that exist on disk', () => {
    const workflows = readdirSync(resolve(root, '.github/workflows'))
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    expect(workflows.length).toBeGreaterThan(0)
    const referenced = new Set()
    for (const name of workflows) {
      const text = readFileSync(join(root, '.github/workflows', name), 'utf8')
      for (const match of text.matchAll(/node\s+e2e\/([\w.-]+\.mjs)/g)) {
        referenced.add(match[1])
      }
    }
    expect(referenced.size).toBeGreaterThan(0)
    const missing = [...referenced].filter((file) => !existsSync(join(root, 'e2e', file)))
    expect(missing, `workflow references missing e2e scripts: ${missing.join(', ')}`).toEqual([])
  })
})
