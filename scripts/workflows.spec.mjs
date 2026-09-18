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

  it('starts the packed Windows portable wrapper before publishing', () => {
    expect(release).toContain('pnpm test:e2e:portable')
    expect(release).toMatch(/if: runner\.os == 'Windows'\s*\n\s*run: pnpm test:e2e:portable/)
  })
})
