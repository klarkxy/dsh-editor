import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogFromEditorBlocks } from './core.ts'
import { blockedReason, inspectPluginPackage, parseBundlePatch, peerAllows, resolveEntryFile, resolveInside } from './inspect.ts'

const productCatalog = catalogFromEditorBlocks([
  {
    name: 'dsh-editor-shell',
    dshEditor: {
      entries: [{ id: 'editor-shell', title: '写作界面', description: '三栏稿纸与设置', locked: true }],
    },
  },
  {
    name: 'dsh-zhihu',
    dshEditor: {
      entries: [{ id: 'zhihu', title: '知乎资料', description: '知乎搜索、知识库与用量' }],
      inserts: [{ id: 'zhihu-tools', name: 'dsh-zhihu/tools', title: '知乎工具', description: '供写作搭档调用的知乎检索', feature: 'zhihu-tools' }],
    },
  },
], ['dsh-editor-shell', 'dsh-zhihu'])

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-inspect-'))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body)
  }
  return root
}

const readyClient = `window.__ModuleLoader__.load({
  id: "demo-plug",
  factory: (require) => {
    exports.apply = function (ctx) {
      ctx.slots.inject('dsh-editor.extensions', function () { return 1 })
    }
    return exports
  }
});
`

describe('bundle patch parser', () => {
  it('reads insert id/name pairs used by real DSH bundles', () => {
    expect(parseBundlePatch('- insert:\n    - id: proofread\n      name: dsh-proofread\n').inserts).toEqual([
      { id: 'proofread', name: 'dsh-proofread' },
    ])
    expect(parseBundlePatch('- insert:\n    - id: workbench\n      name: dsh-editor-workbench\n    - id: workbench-tools\n      name: dsh-editor-workbench/tools\n').inserts).toHaveLength(2)
    expect(parseBundlePatch('[]').empty).toBe(true)
    expect(parseBundlePatch('- id: zhihu\n  disabled: true\n').empty).toBe(true)
    expect(parseBundlePatch('- insert:\n    - id: x\n      name: y\n      config: !!js process.platform\n').hasJs).toBe(true)
  })
})

describe('entry file resolution', () => {
  it('maps package name and subpath exports', () => {
    const manifest = {
      name: 'dsh-zhihu',
      main: './lib/index.js',
      exports: { '.': { import: './lib/index.js' }, './tools': { default: './lib/tools.js' }, './client': { default: './lib/client.js' } },
    }
    expect(resolveEntryFile(manifest, 'dsh-zhihu')).toBe('./lib/index.js')
    expect(resolveEntryFile(manifest, 'dsh-zhihu/tools')).toBe('./lib/tools.js')
    expect(resolveEntryFile(manifest, 'dsh-zhihu/client')).toBe('./lib/client.js')
    expect(resolveEntryFile(manifest, 'other')).toBeUndefined()
    expect(resolveInside('/pkg', '../etc/passwd')).toBeUndefined()
  })
})

describe('peer ranges against the pinned host', () => {
  it('accepts the current DSH/cordis majors and rejects the next major', () => {
    expect(peerAllows('^4.0.1', '4.0.1')).toBe(true)
    expect(peerAllows('^5.0.0', '4.0.1')).toBe(false)
    expect(peerAllows('0.1.1-rc.2', '0.1.1-rc.2')).toBe(true)
    expect(peerAllows('^0.2.0', '0.1.1-rc.2')).toBe(false)
    expect(peerAllows('workspace:*', '0.1.1-rc.2')).toBe(false)
  })
})

describe('inspectPluginPackage', () => {
  it('accepts a built dual-face plugin that seats on the editor overlay', async () => {
    const dir = await fixture({
      'package.json': JSON.stringify({
        name: 'demo-plug', version: '1.0.0',
        exports: { '.': './lib/index.js', './client': './lib/client.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      }),
      'cordis.patch.yml': '- insert:\n    - id: demo-plug\n      name: demo-plug\n',
      'lib/index.js': 'export const name = "demo-plug"\n',
      'lib/client.js': readyClient,
    })
    const report = await inspectPluginPackage(dir)
    expect(report.verdict).toBe('ready')
    expect(report.entries).toEqual([{ id: 'demo-plug', name: 'demo-plug' }])
    expect(report.hasClient).toBe(true)
  })

  it('blocks source-only repos because install does not run prepare', async () => {
    const dir = await fixture({
      'package.json': JSON.stringify({
        name: 'src-only', main: './lib/index.js',
        scripts: { prepare: 'tsdown' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
      'cordis.patch.yml': '- insert:\n    - id: src-only\n      name: src-only\n',
      'src/index.ts': 'export const name = "src-only"\n',
    })
    const report = await inspectPluginPackage(dir)
    expect(report.verdict).toBe('blocked')
    expect(report.findings.some((item) => item.code === 'entry-file' && item.message.includes('不运行 prepare'))).toBe(true)
    expect(blockedReason(report)).toMatch(/源码/)
  })

  it('blocks missing bundle metadata, root-stealing clients, and core id collisions', async () => {
    const missing = await inspectPluginPackage(await fixture({ 'package.json': '{"name":"plain"}' }))
    expect(missing.verdict).toBe('blocked')
    expect(missing.findings.some((item) => item.code === 'bundle-patch')).toBe(true)

    const rootSteal = await inspectPluginPackage(await fixture({
      'package.json': JSON.stringify({
        name: 'steal-root',
        exports: { '.': './lib/index.js', './client': './lib/client.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
      }),
      'cordis.patch.yml': '- insert:\n    - id: steal-root\n      name: steal-root\n',
      'lib/index.js': 'export const name = "steal-root"\n',
      'lib/client.js': `window.__ModuleLoader__.load({ id: "steal-root", factory: () => ({ apply() { slots.register({ name: 'root' }) } }) });\n`,
    }))
    expect(rootSteal.findings.some((item) => item.code === 'client-root')).toBe(true)
    expect(rootSteal.verdict).toBe('blocked')

    const collide = await inspectPluginPackage(await fixture({
      'package.json': JSON.stringify({
        name: 'fake-shell',
        exports: { '.': './lib/index.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
      'cordis.patch.yml': '- insert:\n    - id: editor-shell\n      name: fake-shell\n',
      'lib/index.js': 'export const name = "fake-shell"\n',
    }), productCatalog)
    expect(collide.findings.some((item) => item.code === 'entry-collision-core')).toBe(true)

    const optionalId = Object.entries(productCatalog.entries).find(([, row]) => !row.locked)?.[0]
    expect(optionalId).toBeTruthy()
    const shadow = await inspectPluginPackage(await fixture({
      'package.json': JSON.stringify({
        name: 'shadow-optional',
        exports: { '.': './lib/index.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
      'cordis.patch.yml': `- insert:\n    - id: ${optionalId}\n      name: shadow-optional\n`,
      'lib/index.js': 'export const name = "shadow-optional"\n',
    }), productCatalog)
    expect(shadow.findings.some((item) => item.code === 'entry-collision-optional' && item.severity === 'warning')).toBe(true)
    expect(shadow.verdict).not.toBe('blocked')
  })

  it('warns when a client will load but has no editor seat', async () => {
    const dir = await fixture({
      'package.json': JSON.stringify({
        name: 'no-seat',
        exports: { '.': './lib/index.js', './client': './lib/client.js' },
        dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
      }),
      'cordis.patch.yml': '- insert:\n    - id: no-seat\n      name: no-seat\n',
      'lib/index.js': 'export const name = "no-seat"\n',
      'lib/client.js': `window.__ModuleLoader__.load({ id: "no-seat", factory: () => ({ apply() {} }) });\n`,
    })
    const report = await inspectPluginPackage(dir)
    expect(report.verdict).toBe('warn')
    expect(report.findings.some((item) => item.code === 'client-slot')).toBe(true)
  })

  it('accepts every Shell seat as a valid client mount, including the center overlay seat', async () => {
    for (const seat of ['dsh-editor.center.overlays', 'dsh-editor.sidebar.tools', 'dsh-editor.extensions']) {
      const dir = await fixture({
        'package.json': JSON.stringify({
          name: 'seat-only',
          exports: { '.': './lib/index.js', './client': './lib/client.js' },
          dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
        }),
        'cordis.patch.yml': '- insert:\n    - id: seat-only\n      name: seat-only\n',
        'lib/index.js': 'export const name = "seat-only"\n',
        'lib/client.js': `window.__ModuleLoader__.load({ id: "seat-only", factory: () => ({ apply(ctx) { ctx.slots.inject('${seat}', () => 1) } }) });\n`,
      })
      const report = await inspectPluginPackage(dir)
      expect(report.findings.some((item) => item.code === 'client-slot')).toBe(false)
    }
  })
})
