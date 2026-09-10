import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CATALOG_FILE, catalogFor, catalogFromEditorBlocks, classifyEntry, isProtectedEntry, isProtectedPackage,
  isSafeEntryId, isSafePackageName, loadRuntimeCatalog, packageNameOf,
} from './core.ts'

const catalog = catalogFromEditorBlocks([
  {
    name: 'dsh-editor-shell',
    dshEditor: {
      role: 'core',
      visibility: 'desktop',
      entries: [{ id: 'editor-shell', title: '写作界面', description: '三栏稿纸与设置', locked: true }],
    },
  },
  {
    name: 'dsh-editor-plugins',
    dshEditor: {
      role: 'core',
      visibility: 'desktop',
      entries: [{ id: 'editor-plugins', title: '插件管理', description: '开关、搜索与安装插件', locked: true }],
    },
  },
  {
    name: 'dsh-manuscript',
    dshEditor: {
      role: 'core',
      visibility: 'public',
      entries: [
        { id: 'manuscript', title: '稿纸', description: '正文读写、草稿与补全', locked: true },
        { id: 'manuscript-assist', title: '补全服务', description: '行内补全与选段改写', feature: 'completion' },
      ],
    },
  },
  {
    name: 'dsh-zhihu',
    dshEditor: {
      role: 'feature',
      visibility: 'public',
      entries: [{ id: 'zhihu', title: '知乎资料', description: '知乎搜索、知识库与用量', feature: 'zhihu' }],
    },
  },
  {
    name: 'dsh-proofread',
    dshEditor: {
      role: 'feature',
      visibility: 'public',
      entries: [{ id: 'proofread', title: '校对', description: '独立文本校对面板' }],
    },
  },
], [
  '@deepseek-ai/dsh-base',
  'dsh-editor-shell',
  'dsh-editor-plugins',
  'dsh-manuscript',
  'dsh-zhihu',
  'dsh-proofread',
])

describe('plugin core protection', () => {
  it('locks the writing minimum and every DeepSeek Harness package', () => {
    expect(isProtectedPackage('dsh-editor-shell', catalog.bundles)).toBe(true)
    expect(isProtectedPackage('dsh-editor-plugins', catalog.bundles)).toBe(true)
    expect(isProtectedPackage('@deepseek-ai/dsh-base', catalog.bundles)).toBe(true)
    expect(isProtectedPackage('@deepseek-ai/dsh-client-ui-sidebar', catalog.bundles)).toBe(true)
    expect(isProtectedPackage('community-theme', catalog.bundles)).toBe(false)
    expect(isProtectedEntry('editor-shell', 'dsh-editor-shell', catalog)).toBe(true)
    expect(isProtectedEntry('editor-plugins', 'dsh-editor-plugins', catalog)).toBe(true)
    expect(isProtectedEntry('manuscript', 'dsh-manuscript', catalog)).toBe(true)
    expect(isProtectedEntry('zhihu', 'dsh-zhihu', catalog)).toBe(false)
    expect(isProtectedEntry('proofread', 'dsh-proofread', catalog)).toBe(false)
    expect(isProtectedEntry('ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar', catalog)).toBe(true)
  })

  it('classifies catalog entries and hides harness internals', () => {
    expect(classifyEntry('manuscript', 'dsh-manuscript', catalog)).toBe('core')
    expect(classifyEntry('include:manuscript', 'dsh-manuscript', catalog)).toBe('core')
    expect(classifyEntry('zhihu', 'dsh-zhihu', catalog)).toBe('optional')
    expect(classifyEntry('include:zhihu', 'dsh-zhihu', catalog)).toBe('optional')
    expect(classifyEntry('ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar', catalog)).toBe('hidden')
    expect(classifyEntry('theme-paper', 'dsh-theme-paper', catalog)).toBe('community')
    expect(classifyEntry('include', 'cordis:include', catalog)).toBe('hidden')
    expect(catalogFor('include:manuscript', 'dsh-manuscript', catalog).title).toBe('稿纸')
    expect(isProtectedEntry('include:editor-shell', 'dsh-editor-shell', catalog)).toBe(true)
    expect(catalogFor('zhihu', 'dsh-zhihu', catalog).title).toBe('知乎资料')
    expect(packageNameOf('dsh-zhihu/tools')).toBe('dsh-zhihu')
    expect(packageNameOf('@scope/pkg/tools')).toBe('@scope/pkg')
  })

  it('rejects unsafe identifiers', () => {
    expect(isSafeEntryId('zhihu')).toBe(true)
    expect(isSafeEntryId('../etc')).toBe(false)
    expect(isSafePackageName('dsh-theme')).toBe(true)
    expect(isSafePackageName('@acme/dsh-plugin')).toBe(true)
    expect(isSafePackageName('../evil')).toBe(false)
  })

  it('reads the prepared catalog without scanning node_modules', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
    await writeFile(join(profileDir, RUNTIME_CATALOG_FILE), `${JSON.stringify({
      bundles: ['dsh-editor-shell', 'dsh-zhihu'],
      entries: {
        'editor-shell': { title: '写作界面', description: '三栏稿纸与设置', locked: true, packageName: 'dsh-editor-shell' },
        zhihu: { title: '知乎资料', description: '知乎搜索', locked: false, packageName: 'dsh-zhihu', feature: 'zhihu' },
      },
    }, null, 2)}\n`)
    const loaded = await loadRuntimeCatalog(profileDir, [])
    expect(loaded.entries['editor-shell']?.locked).toBe(true)
    expect(loaded.entries.zhihu?.title).toBe('知乎资料')
    expect(classifyEntry('editor-shell', 'dsh-editor-shell', loaded)).toBe('core')
    expect(classifyEntry('zhihu', 'dsh-zhihu', loaded)).toBe('optional')
  })
})
