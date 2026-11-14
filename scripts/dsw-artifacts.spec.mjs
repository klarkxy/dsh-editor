import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectDswVars } from './dsw-artifacts.mjs'

const temporary = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsw-artifacts-'))
  temporary.push(root)
  const manifest = join(root, 'package.json')
  await writeFile(manifest, JSON.stringify({
    name: 'fixture', dependencies: { '@deepseek-ai/dsh-web-app': '1.0.0' },
  }))
  return { root, manifest }
}

async function pkg(directory, manifest, text = '') {
  await mkdir(join(directory, 'lib'), { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(directory, 'lib/client.js'), text)
}

describe('published DSW artifact inventory', () => {
  it('checks out the generated inventory with LF when Git autocrlf is enabled', async () => {
    const { root } = await fixture()
    await writeFile(join(root, '.gitattributes'), await readFile(new URL('../.gitattributes', import.meta.url)))
    const relative = 'packages/dsh-editor-shell/src/design-system/dsw-vars.ts'
    const file = join(root, relative)
    await mkdir(join(root, 'packages/dsh-editor-shell/src/design-system'), { recursive: true })
    const text = "export const DSW_VARS = ['--dsw-test'] as const\n"
    await writeFile(file, text)
    const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' })
    git(['init', '-q'])
    git(['-c', 'core.autocrlf=true', 'add', '--', '.gitattributes', relative])
    await writeFile(file, 'changed\r\n')
    git(['-c', 'core.autocrlf=true', 'checkout-index', '--force', '--all'])
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  it('follows declared package edges and ignores unrelated store copies and vendor folders', async () => {
    const { root, manifest } = await fixture()
    const scope = join(root, 'node_modules/@deepseek-ai')
    await pkg(join(scope, 'dsh-web-app'), {
      name: '@deepseek-ai/dsh-web-app',
      dependencies: { '@deepseek-ai/dsh-client-ui-hovercard': '1.0.0', '@deepseek-ai/dsh-web-frontend': '1.0.0' },
    })
    const client = join(scope, 'dsh-client-ui-hovercard')
    await pkg(client, {
      name: '@deepseek-ai/dsh-client-ui-hovercard',
      exports: { '.': './lib/client.js' },
      optionalDependencies: { '@deepseek-ai/dsh-client-ui-missing': '1.0.0' },
    }, 'const x = "var(--dsw-hovercard-bg) var(--ds-border) --dsw-";')
    await pkg(join(client, 'node_modules/unrelated'), { name: 'unrelated' }, '"--dsw-vendor-noise"')
    await pkg(join(root, 'node_modules/.pnpm/stale/node_modules/@deepseek-ai/dsh-client-ui-old'),
      { name: '@deepseek-ai/dsh-client-ui-old' }, '"--dsw-obsolete"')
    const shortened = join(root, 'node_modules/.pnpm/@deepseek-ai+dsh-web-fronte_hash/node_modules/@deepseek-ai/dsh-web-frontend')
    await pkg(shortened, { name: '@deepseek-ai/dsh-web-frontend' }, '"--dsw-front-only"')
    await symlink(shortened, join(scope, 'dsh-web-frontend'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(collectDswVars([manifest])).toEqual(['--ds-border', '--dsw-front-only', '--dsw-hovercard-bg'])
  })

  it('checks development dependencies of workspace roots reached through another workspace', async () => {
    const { root, manifest } = await fixture()
    const workspace = join(root, 'node_modules/dsh-workspace')
    await writeFile(manifest, JSON.stringify({ dependencies: { 'dsh-workspace': '1.0.0' } }))
    await pkg(workspace, {
      name: 'dsh-workspace', devDependencies: { '@klarkxy/test-ui': '1.0.0' },
    })
    await pkg(join(root, 'node_modules/@klarkxy/test-ui'), { name: '@klarkxy/test-ui' }, '"--dsw-workspace-ui"')
    expect(collectDswVars([manifest, join(workspace, 'package.json')])).toEqual(['--dsw-workspace-ui'])
  })

  it('fails on missing required artifacts instead of shrinking the inventory silently', async () => {
    const { manifest } = await fixture()
    expect(() => collectDswVars([manifest])).toThrow('DSW scan cannot resolve @deepseek-ai/dsh-web-app')
  })
})
