import { EventEmitter } from 'node:events'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedNavigation, parseDshWebUrl } from '../src/dsh-url.js'
import { clipboardWritePayload, isTrustedClipboardSender, readTrustedClipboardText, writeTrustedClipboardText } from '../src/clipboard.js'
import { PROFILE_DEPLOY_ALGORITHM, PROFILE_MARKER, ProfileCollisionError, deployOwnedProfile, deployProfile, resolveDshHome, type ProfileDeployIdentity } from '../src/profile.js'
import { sanitizeHostLockedPluginOverrides } from '../src/user-plugins.js'
import { installNavigationPolicy, isAllowedExternalUrl } from '../src/navigation.js'
import { DshSupervisor } from '../src/supervisor.js'
import { hasPackagedRuntimeCache, materializePackagedRuntime, readProfileDeployIdentity, runtimeFromResources, shouldMaterializePackagedRuntime, treeDigest } from '../src/runtime-cache.js'
import { claimPrimaryInstance, createDesktopLifecycle, exportFileFilter, type DesktopLifecycleDeps, type EditorInput, type EditorWindow } from '../src/window-lifecycle.js'
import type { ChildLike } from '../src/contracts.js'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 8123
  exitCode: number | null = null
  stdout = new PassThrough()
  stderr = new PassThrough()
  killedWith: string | number | undefined
  kill(signal?: NodeJS.Signals | number): boolean { this.killedWith = signal; return true }
  exit(code = 0): void { this.exitCode = code; this.emit('exit', code, null) }
}

type CompositionRow = { id?: string; name?: unknown; group?: unknown; config?: unknown }

function compositionProblem(text: string): string | undefined {
  return entryListProblem(parseCompositionRows(text))
}

function entryListProblem(rows: unknown, at = ''): string | undefined {
  if (!Array.isArray(rows)) return at === '' ? 'the composition must be a top-level list of plugin rows' : `group ${at} must hold a list of plugin rows`
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`
    const { name, group, config } = row as CompositionRow
    if (typeof name !== 'string' || name === '') return `${label} names no plugin (a "name" string is required)`
    if (group === true) {
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
}

function parseCompositionRows(text: string): CompositionRow[] {
  const roots: CompositionRow[] = []
  const stack: Array<{ indent: number; row: CompositionRow; kind: 'row' | 'config' }> = []
  const attach = (indent: number, row: CompositionRow) => {
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (!parent) roots.push(row)
    else if (parent.kind === 'config') {
      const list = Array.isArray(parent.row.config) ? parent.row.config as CompositionRow[] : []
      list.push(row)
      parent.row.config = list
    }
    stack.push({ indent, row, kind: 'row' })
  }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (trimmed.startsWith('- id:')) {
      attach(indent, { id: trimmed.slice('- id:'.length).trim() })
      continue
    }
    const current = stack[stack.length - 1]?.row as Record<string, unknown> | undefined
    if (!current) continue
    if (trimmed === 'config:' || trimmed === 'config: |' || trimmed === 'config: |-') {
      current.config = []
      stack.push({ indent, row: current, kind: 'config' })
      continue
    }
    const pair = trimmed.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!pair) continue
    const [, key, value] = pair
    if (key === 'config') {
      current.config = []
      stack.push({ indent, row: current, kind: 'config' })
      continue
    }
    current[key] = value === 'true' ? true : value === 'false' ? false : value
  }
  return roots
}

async function skillDirectoryNames(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function unquoteYaml(value: unknown): unknown {
  return typeof value === 'string' && /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value
}

function topLevelPluginRows(text: string): Array<{ id?: string; name?: unknown }> {
  return parseCompositionRows(text).map((row) => ({ id: row.id, name: unquoteYaml(row.name) }))
}

function parseSkillDocument(text: string): { name: string; description: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error('skill is missing YAML frontmatter')
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !description) throw new Error('skill frontmatter needs name and description')
  return { name, description }
}

async function runtimeFixture(version = 'one', executableNode = false): Promise<{ root: string; resources: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'node'), { recursive: true })
  await mkdir(join(resources, 'dsh', 'lib'), { recursive: true })
  await mkdir(join(resources, 'profile-template'), { recursive: true })
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  if (executableNode) await copyFile(process.execPath, join(resources, 'node', nodeName))
  else await writeFile(join(resources, 'node', nodeName), `node-${version}`)
  await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), `dsh-${version}`)
  await writeFile(join(resources, 'profile-template', 'package.json'), `{"version":"${version}"}`)
  const [node, dsh, profile] = await Promise.all([
    treeDigest(join(resources, 'node')),
    treeDigest(join(resources, 'dsh')),
    treeDigest(join(resources, 'profile-template')),
  ])
  await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
    format: 1, platform: `${process.platform}-${process.arch}`,
    node: { version: '24.16.0', ...node }, dsh: { version: '0.1.7-rc.2', ...dsh }, profile,
  }))
  return { root, resources }
}

describe('DSH URL trust root', () => {
  it('accepts only the exact DSH loopback readiness line', () => {
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823')?.href).toBe('http://127.0.0.1:41823/')
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823/?token=gHI0qXC8OK_Dj3IxxA-WS8vyyI1QwewJrWOKJWJHEmE')?.href)
      .toBe('http://127.0.0.1:41823/?token=gHI0qXC8OK_Dj3IxxA-WS8vyyI1QwewJrWOKJWJHEmE')
    expect(parseDshWebUrl('dsh web: http://127.0.0.1:41823 (LAN: http://10.0.0.1:41823)')?.port).toBe('41823')
    for (const line of [
      'http://127.0.0.1:8080',
      'dsh web: http://localhost:8080',
      'dsh web: https://127.0.0.1:8080',
      'dsh web: http://127.0.0.1:8080/path',
      'dsh web: http://127.0.0.1:0',
      'dsh web: http://127.0.0.1:41823/?token=',
      'dsh web: http://127.0.0.1:41823/?token=bad/value',
      'dsh web: http://127.0.0.1:41823/?token=abc&extra=1',
      'dsh web: http://127.0.0.1:41823/?other=abc',
    ]) expect(parseDshWebUrl(line)).toBeUndefined()
  })
  it('does not allow origin spoofing or port changes', () => {
    const expected = new URL('http://127.0.0.1:41823/')
    expect(isAllowedNavigation('http://127.0.0.1:41823/settings', expected)).toBe(true)
    expect(isAllowedNavigation('http://127.0.0.1.evil.example:41823/', expected)).toBe(false)
    expect(isAllowedNavigation('http://127.0.0.1:41824/', expected)).toBe(false)
  })
})

describe('desktop clipboard IPC trust', () => {
  const expected = new URL('http://127.0.0.1:41823/')
  const trusted = {
    owned: true,
    destroyed: false,
    isMainFrame: true,
    url: 'http://127.0.0.1:41823/',
    expected,
  }

  it('accepts only an owned main frame on the expected DSH URL', () => {
    expect(isTrustedClipboardSender(trusted)).toBe(true)
    expect(isTrustedClipboardSender({ ...trusted, owned: false })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, destroyed: true })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, isMainFrame: false })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, expected: undefined })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, url: 'http://127.0.0.1:41824/' })).toBe(false)
    expect(isTrustedClipboardSender({ ...trusted, url: 'https://evil.example/' })).toBe(false)
    expect(clipboardWritePayload('plain')).toBe('plain')
    expect(clipboardWritePayload({ html: '<b>' })).toBeUndefined()
  })

  it('reads and writes only after trust checks', () => {
    const store = { text: 'existing' }
    const api = {
      readText: () => store.text,
      writeText: (text: string) => { store.text = text },
    }
    expect(readTrustedClipboardText(api, trusted)).toBe('existing')
    writeTrustedClipboardText(api, trusted, 'next')
    expect(store.text).toBe('next')
    expect(() => writeTrustedClipboardText(api, { ...trusted, owned: false }, 'nope')).toThrow(/denied/)
    expect(store.text).toBe('next')
    expect(() => writeTrustedClipboardText(api, trusted, { html: 'x' })).toThrow(/string/)
  })

  it('rejects a silent clipboard write failure so cut cannot delete the manuscript', () => {
    const api = { readText: () => 'old', writeText: (_text: string) => {} }
    expect(() => writeTrustedClipboardText(api, trusted, 'new')).toThrow('clipboard write failed')
  })

  it('keeps navigation permission denial and exposes a narrow preload clipboard', async () => {
    const navigation = await readFile(join(import.meta.dirname, '..', 'src', 'navigation.ts'), 'utf8')
    const preload = await readFile(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8')
    const main = await readFile(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
    expect(navigation).toContain('callback(false)')
    expect(navigation).not.toContain('clipboard')
    expect(preload).toContain("invoke('dsh-window:clipboard-read-text')")
    expect(preload).toContain("invoke('dsh-window:clipboard-write-text'")
    expect(main).toContain("'dsh-window:clipboard-read-text'")
    expect(main).toContain("'dsh-window:clipboard-write-text'")
  })

  it('wires the startup error retry button through preload IPC', async () => {
    const preload = await readFile(join(import.meta.dirname, '..', 'preload.cjs'), 'utf8')
    const main = await readFile(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8')
    expect(main).toContain('data-dsh-startup-retry')
    expect(main).toContain('onclick="window.dshWindow.retry()"')
    expect(main).toContain('onclick="window.dshWindow.close()"')
    expect(main).toContain('>关闭</button>')
    expect(main).toContain("script-src 'unsafe-inline'")
    expect(main).not.toContain('dsh-editor://retry')
    expect(main).toContain("'dsh-window:retry'")
    expect(main).toContain("if (!trust.url.includes('data-dsh-startup-retry')) return")
    expect(preload).toContain("send('dsh-window:retry')")
    expect(preload).toContain('retry: () => ipcRenderer.send')
    expect(preload).toContain("send('dsh-window:close')")
  })
})

describe('desktop branding assets', () => {
  it('keeps the source icon, window icon, and Windows package icon wired together', async () => {
    const repo = join(import.meta.dirname, '..', '..', '..')
    const build = join(repo, 'apps', 'desktop', 'build')
    const [svg, mark, sourcePng, png, ico, mascot, shellMascot, main, loadingPage, preload, builder, afterPack, identity] = await Promise.all([
      readFile(join(build, 'icon.svg'), 'utf8'),
      readFile(join(build, 'icon-mark.svg'), 'utf8'),
      readFile(join(build, 'icon-source.png')),
      readFile(join(build, 'icon.png')),
      readFile(join(build, 'icon.ico')),
      readFile(join(build, 'mascot.webp')),
      readFile(join(repo, 'packages', 'dsh-editor-shell', 'src', 'client', 'assets', 'mascot.webp')),
      readFile(join(repo, 'apps', 'desktop', 'src', 'main.ts'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'src', 'loading-page.ts'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'preload.cjs'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
      readFile(join(repo, 'scripts', 'after-pack-desktop.cjs'), 'utf8'),
      readFile(join(repo, 'apps', 'desktop', 'src', 'app-identity.ts'), 'utf8'),
    ])
    expect(svg).toContain('<title>DSH Editor</title>')
    expect(svg).toContain('icon-source.png')
    expect(mark).toContain('<title>DSH Editor</title>')
    expect(mark).toContain('#1a7ff0')
    expect(sourcePng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(sourcePng.readUInt32BE(16)).toBe(1024)
    expect(sourcePng.readUInt32BE(20)).toBe(1024)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(png.equals(sourcePng)).toBe(true)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(7)
    expect(main).toContain("'icon.ico'")
    expect(main).toContain("'icon.png'")
    expect(main).toContain('setAppUserModelId')
    expect(main).toContain('shouldMaterializePackagedRuntime')
    expect(main).toContain('runtimeFromResources')
    expect(mascot.subarray(0, 4).toString()).toBe('RIFF')
    expect(mascot.equals(shellMascot)).toBe(true)
    expect(main).toContain("'mascot.webp'")
    expect(loadingPage).toContain('首次启动正在复制本地写作环境')
    expect(loadingPage).toContain('class="mascot"')
    expect(loadingPage).toContain("img-src data:")
    expect(loadingPage).not.toContain('class="mark"')
    expect(builder).toContain('- "build/mascot.webp"')
    expect(identity).toContain("com.dsh-editor.desktop")
    expect(builder).toContain('appId: com.dsh-editor.desktop')
    expect(builder).toContain('icon: build/icon.ico')
    expect(builder).toContain('installerIcon: build/icon.ico')
    expect(builder).toContain('- "build/icon.ico"')
    expect(builder).toContain('signAndEditExecutable: false')
    expect(afterPack).toContain("electron-winstaller/vendor/rcedit.exe")
    expect(afterPack).toContain('FileDescription')
    expect(afterPack).toContain('ProductName')
    // About / update page wiring: the renderer is locked behind a strict CSP
    // that blocks api.github.com, so the main process owns the round-trip and
    // the preload bridge exposes invoke-style methods.
    expect(main).toContain('if (!isAllowedExternalUrl(url)) return')
    expect(main).toContain("'dsh-window:get-app-info'")
    expect(main).toContain("'dsh-window:check-update'")
    // Startup check: same round-trip kicked off in the background at launch,
    // cached for the renderer to pull once its UI is up.
    expect(main).toContain("'dsh-window:startup-update'")
    expect(main).toContain('checkLatest(desktopVersion)')
    expect(main).toContain('readDesktopVersion')
    expect(main).not.toContain('version: app.getVersion()')
    expect(main).toContain('assertTrustedIpcSender')
    expect(main).toContain('updateIdFrom(payload)')
    expect(main).not.toContain('downloadUpdate(asset, event.sender)')
    expect(main).not.toContain('installUpdate(String(payload?.path')
    expect(preload).toContain("invoke('dsh-window:download-update', { updateId })")
    expect(preload).toContain("invoke('dsh-window:install-update', { updateId })")
    expect(preload).not.toContain('downloadUpdate: (asset)')
    expect(main).toContain('timeoutMs: 120_000')
    expect(main).toContain("join(process.env.DSH_HOME.trim(), 'electron-user-data')")
    expect(main).toContain("app.setName('dsh-editor-dev')")
  })
})

describe('profile deployment', () => {
  it('keeps the conversation domain enabled for the custom chat projection', async () => {
    const patch = await readFile(join(import.meta.dirname, '..', 'resources', 'profile', 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toMatch(/- id: ui-conversation\s+disabled: true/)
  })
  it('honors DSH_HOME and otherwise isolates desktop state from the default DSH home', () => {
    expect(resolveDshHome({ DSH_HOME: 'D:/custom' }, 'D:/Users/example')).toBe('D:/custom')
    expect(resolveDshHome({ DSH_HOME: '   ' }, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
    expect(resolveDshHome({}, 'D:/Users/example')).toBe(join('D:/Users/example', '.dsh-editor'))
  })
  it('strips leftover host-locked plugin overrides before DSH boots', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-locked-overrides-'))
    await writeFile(join(home, 'dsh-plugins.json'), `${JSON.stringify({
      schema: 1,
      overrides: {
        'editor-novel-kernel': true,
        'editor-workbench-tools': true,
        proofread: true,
        zhihu: false,
      },
      presets: { 'dsh-editor-novel': true },
      installed: [],
    }, null, 2)}\n`)
    await writeFile(join(home, 'cordis.patch.yml'), [
      '# managed-by: dsh-editor-plugins',
      '- id: editor-novel-kernel',
      '  disabled: false',
      '- id: editor-workbench-tools',
      '  disabled: false',
      '- id: proofread',
      '  disabled: false',
      '- id: zhihu',
      '  disabled: true',
      '',
    ].join('\n'))
    await sanitizeHostLockedPluginOverrides(home)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toMatchObject({
      overrides: { zhihu: false },
      presets: { 'dsh-editor-novel': true },
    })
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toBe([
      '# managed-by: dsh-editor-plugins',
      '- id: zhihu',
      '  disabled: true',
      '',
    ].join('\n'))
  })
  it('fails closed on an unmarked collision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const profile = join(root, 'profiles', 'dsh-editor')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{}')
    await expect(deployProfile(root, profile)).rejects.toBeInstanceOf(ProfileCollisionError)
  })
  it('stages an owned profile update and leaves no staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const existing = join(root, 'profiles', 'dsh-editor')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"version":2}')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    await writeFile(join(existing, 'package.json'), '{"version":1}')
    const installed = await deployProfile(root, template)
    expect(await readFile(join(installed, 'package.json'), 'utf8')).toContain('2')
    expect(existsSync(join(installed, PROFILE_MARKER))).toBe(true)
    expect((await (await import('node:fs/promises')).readdir(join(root, 'profiles'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('relinks user-installed plugins after replacing the owned profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-theme')
    await mkdir(plugin, { recursive: true })
    await writeFile(join(plugin, 'package.json'), '{"name":"community-theme","version":"1.0.0"}')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: {},
      installed: [{ name: 'community-theme', spec: 'github:acme/community-theme', version: '1.0.0' }],
    }))
    const installed = await deployProfile(root, template)
    expect(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).dsh.profile.bundles).toContain('community-theme')
    expect(existsSync(join(installed, 'node_modules', 'community-theme', 'package.json'))).toBe(true)
  })
  it('points the agent preset default at generic writing and keeps the legacy preset compatible', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const patch = await readFile(join(profileResources, 'cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor-writing/)
    expect(patch).not.toMatch(/- id: agent-preset-registry\s+config:\s+default: dsh-editor\s*$/m)
    expect(patch).toMatch(/- id: editor-workbench-tools\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-novel-kernel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    const legacy = await readFile(join(profileResources, 'agent-presets', 'dsh-editor', 'agent.cordis.yml'), 'utf8')
    expect(legacy).toContain('dsh-tool-ask-user')
    expect(legacy).toContain('dsh-tool-fs')
    expect(legacy).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
    expect(legacy).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
    expect(legacy).not.toMatch(/dsh-tool-(web|todo|goal|subagent|workflow|ralph|skill)/)
    expect(legacy).not.toContain('dsh-plan-mode')
    expect(topLevelPluginRows(legacy)).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
      { id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' },
      { id: 'editor-novel-kernel', name: 'dsh-editor-novel-kernel' },
      { id: 'compaction', name: 'cordis:group' },
    ])
    expect(legacy).toMatch(/- id: editor-novel-kernel\r?\n  name: dsh-editor-novel-kernel\r?\n  config:\r?\n    mode: legacy/)
    expect(legacy).not.toContain('knowledge-only')
    expect(existsSync(join(profileResources, 'agent-presets', 'dsh-editor', 'skills'))).toBe(false)
  })
  it('ships five writing presets from app template and first-party packages with parseable compositions and uncrossed skills', async () => {
    const profileResources = join(import.meta.dirname, '..', 'resources', 'profile')
    const presetRoot = join(profileResources, 'agent-presets')
    const ids = (await readdir(presetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    /* 模板源只保留核心通用写作与 legacy；另外三个由第一方包提供。 */
    expect(ids).toEqual(['dsh-editor', 'dsh-editor-writing'])
    const repoRoot = join(import.meta.dirname, '..', '..', '..')
    const presetSource = (id: string) => {
      if (id === 'dsh-editor' || id === 'dsh-editor-writing') return join(presetRoot, id)
      if (id === 'dsh-editor-novel') return join(repoRoot, 'packages', 'dsh-editor-novel-kernel', 'presets', id)
      return join(repoRoot, 'packages', 'dsh-editor-writing-presets', 'presets', id)
    }
    const allIds = ['dsh-editor', 'dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical', 'dsh-editor-writing']

    const writingIds = ['dsh-editor-writing', 'dsh-editor-novel', 'dsh-editor-article', 'dsh-editor-technical'] as const
    const writingLabels = {
      'dsh-editor-writing': '通用写作',
      'dsh-editor-novel': '小说创作',
      'dsh-editor-article': '文章与自媒体',
      'dsh-editor-technical': '技术文档',
    } as const
    const professionalSkill = {
      'dsh-editor-writing': undefined,
      'dsh-editor-novel': 'novel-writing',
      'dsh-editor-article': 'article-writing',
      'dsh-editor-technical': 'technical-writing',
    } as const
    const scopedTools = {
      'dsh-editor-writing': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
      'dsh-editor-novel': [
        { id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' },
        { id: 'editor-novel-kernel', name: 'dsh-editor-novel-kernel' },
      ],
      'dsh-editor-article': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
      'dsh-editor-technical': [{ id: 'editor-workbench-tools', name: 'dsh-editor-workbench/tools' }],
    } as const
    const descriptions = new Map<string, string>()

    for (const id of allIds) {
      const directory = presetSource(id)
      expect(existsSync(join(directory, 'preset.yml'))).toBe(true)
      expect(existsSync(join(directory, 'agent.cordis.yml'))).toBe(true)
      /* 包内源目录不带 marker；owner marker 由 configureProfile 在物化模板时写入。 */
      if (ids.includes(id)) {
        expect(JSON.parse(await readFile(join(directory, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
      } else {
        expect(existsSync(join(directory, PROFILE_MARKER))).toBe(false)
      }
      const composition = await readFile(join(directory, 'agent.cordis.yml'), 'utf8')
      expect(compositionProblem(composition)).toBeUndefined()
    }

    for (const id of writingIds) {
      const presetYml = await readFile(join(presetSource(id), 'preset.yml'), 'utf8')
      expect(presetYml.match(/^name:\s*(.+)$/m)?.[1]?.trim()).toBe(writingLabels[id])
      const composition = await readFile(join(presetSource(id), 'agent.cordis.yml'), 'utf8')
      expect(composition).toContain('dsh-tool-ask-user')
      expect(composition).toContain('dsh-tool-fs')
      expect(composition).toContain('dsh-skill-filesystem')
      expect(composition).toContain('dsh-tool-skill')
      expect(composition).toContain("new URL('skills/', baseUrl)")
      expect(composition).toContain('writing_propose')
      expect(composition).toContain('作者确认')
      expect(composition).toMatch(/不创建|不建目录/)
      expect(composition).toMatch(/- id: tool-bash\r?\n  name: '@deepseek-ai\/dsh-tool-bash'\r?\n  disabled: true/)
      expect(composition).toMatch(/- id: tool-pwsh\r?\n  name: '@deepseek-ai\/dsh-tool-pwsh'\r?\n  disabled: true/)
      expect(composition).not.toMatch(/dsh-tool-(web|todo|goal|subagent|workflow|ralph)(?!-)/)
      expect(composition).not.toContain('dsh-plan-mode')
      expect(topLevelPluginRows(composition)).toEqual([
        { id: 'persona', name: '@deepseek-ai/dsh-persona' },
        { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
        { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
        { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
        ...scopedTools[id],
        { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
        { id: 'compaction', name: 'cordis:group' },
      ])
      // Four new presets exclude legacy novel write/index/scratch tools:
      // writing/article/technical omit the kernel; novel mounts it knowledge-only.
      if (id === 'dsh-editor-novel') {
        expect(composition).toMatch(/- id: editor-novel-kernel\r?\n  name: dsh-editor-novel-kernel\r?\n  config:\r?\n    mode: knowledge-only/)
      } else {
        expect(composition).not.toContain('dsh-editor-novel-kernel')
        expect(composition).not.toContain('knowledge-only')
      }
      const skillNames = await skillDirectoryNames(join(presetSource(id), 'skills'))
      const expected = professionalSkill[id] ? ['prose-revision', professionalSkill[id]] : ['prose-revision']
      expect(skillNames).toEqual(expected.sort())
      for (const name of skillNames) {
        const skill = parseSkillDocument(await readFile(join(presetSource(id), 'skills', name, 'SKILL.md'), 'utf8'))
        expect(skill.name).toBe(name)
        expect(skill.description.length).toBeGreaterThan(0)
        descriptions.set(`${id}:${name}`, skill.description)
      }
    }

    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-novel:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-article:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toBe(descriptions.get('dsh-editor-technical:prose-revision'))
    expect(descriptions.get('dsh-editor-writing:prose-revision')).toContain('当前 Preset 的专业工作流（若有）')
    expect(descriptions.get('dsh-editor-writing:prose-revision')).not.toMatch(/novel-writing|article-writing|technical-writing/)
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toBe(descriptions.get('dsh-editor-article:article-writing'))
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toBe(descriptions.get('dsh-editor-technical:technical-writing'))
    expect(descriptions.get('dsh-editor-article:article-writing')).not.toBe(descriptions.get('dsh-editor-technical:technical-writing'))
    expect(descriptions.get('dsh-editor-novel:novel-writing')).not.toContain('article-writing 用于小说')
    for (const [key, description] of descriptions) {
      if (key.endsWith(':novel-writing')) expect(description).toMatch(/不要用于文章|不要用于.*技术/)
      if (key.endsWith(':article-writing')) expect(description).toMatch(/不要用于小说|不要用于.*技术/)
      if (key.endsWith(':technical-writing')) expect(description).toMatch(/不要用于小说|不要用于.*文章/)
    }

    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const composition = await desktopComposition('desktop')
    const materialized = await mkdtemp(join(tmpdir(), 'dsh-template-'))
    /* 与 prepare 脚本同序：先复制资源模板（含两个 app-owned preset），再由 configureProfile 补进第一方包的三个。 */
    await (await import('node:fs/promises')).cp(profileResources, materialized, { recursive: true })
    await configureProfile(materialized, composition)
    /* 物化模板重新集齐五个 preset，且全部由模板通道写入 app-owned marker。 */
    const templateIds = (await readdir(join(materialized, 'agent-presets'))).sort()
    expect(templateIds).toEqual(allIds)
    for (const id of allIds) {
      expect(JSON.parse(await readFile(join(materialized, 'agent-presets', id, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1 })
    }

    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    await deployProfile(root, materialized)
    const deployed = (await readdir(join(root, '.agent-presets'))).sort()
    expect(deployed).toEqual(allIds)
    expect(await skillDirectoryNames(join(root, '.agent-presets', 'dsh-editor-writing', 'skills'))).toEqual(['prose-revision'])
    expect(await skillDirectoryNames(join(root, '.agent-presets', 'dsh-editor-novel', 'skills'))).toEqual(['novel-writing', 'prose-revision'])
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-writing', 'skills', 'novel-writing'))).toBe(false)
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor', 'skills'))).toBe(false)

    /* 作者停用第一方模式后，重启部署跳过并清掉它的 app-owned 目录。 */
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: {},
      presets: { 'dsh-editor-novel': false },
      installed: [],
    }))
    await deployProfile(root, materialized)
    const afterDisable = (await readdir(join(root, '.agent-presets'))).sort()
    expect(afterDisable).toEqual(allIds.filter((id) => id !== 'dsh-editor-novel'))
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({ schema: 1, overrides: {}, presets: {}, installed: [] }))
    await deployProfile(root, materialized)
    expect((await readdir(join(root, '.agent-presets'))).sort()).toEqual(allIds)
  }, 15000)
  it('keeps scoped tools disabled after preparing the full composition', async () => {
    const { configureProfile, desktopComposition } = await import('../../../scripts/desktop-compositions.mjs')
    const aliases = ['basic', 'smart', 'full'] as const
    const resolved = await Promise.all(aliases.map((id) => desktopComposition(id)))
    const stripped = resolved.map(({ id: _id, label: _label, ...rest }) => rest)
    expect(stripped[0]).toEqual(stripped[1])
    expect(stripped[1]).toEqual(stripped[2])
    for (const item of resolved) {
      expect(item.features).toEqual(['assistant', 'completion', 'zhihu', 'zhihu-tools', 'overview-panel', 'proofread-panel', 'writing-presets', 'web-search'])
      expect(item.features).toContain('proofread-panel')
      expect(item.features).not.toContain('cards')
      expect(item.features).not.toContain('memory-panel')
      expect(item.packages).toContain('dsh-editor-proofread-panel')
      expect(item.packages).toContain('dsh-editor-writing-presets')
      expect(item.packages).not.toContain('dsh-editor-cards')
      expect(item.packages).not.toContain('dsh-editor-memory-panel')
      expect(item.extraInserts.map((row: { id: string }) => row.id)).not.toContain('editor-workbench-tools')
      expect(item.extraInserts.map((row: { id: string }) => row.id)).not.toContain('editor-novel-kernel')
    }
    const composition = resolved[2]!

    const destination = await mkdtemp(join(tmpdir(), 'dsh-prepared-'))
    await writeFile(join(destination, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: [] } },
    }))
    await configureProfile(destination, composition)
    const patch = await readFile(join(destination, 'node_modules', 'dsh-editor-profile-config', 'base.patch.yml'), 'utf8')
    expect(patch).toMatch(/- id: editor-workbench-tools\r?\n  disabled: true/)
    expect(patch).toMatch(/- id: editor-novel-kernel\r?\n  disabled: true/)
    expect(patch).not.toMatch(/- id: editor-cards\r?\n/)
    expect(patch).not.toMatch(/- id: editor-workbench-tools\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-novel-kernel\r?\n  disabled: false/)
    expect(patch).not.toMatch(/- id: editor-workbench\r?\n  disabled: true/)
    for (const id of ['web-search-deepseek', 'web-fetch-http', 'tool-web']) {
      expect(patch).toMatch(new RegExp(`- id: ${id}\\r?\\n  disabled: true`))
    }
    for (const id of ['dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical']) {
      const agent = await readFile(join(destination, 'agent-presets', id, 'agent.cordis.yml'), 'utf8')
      expect(agent.match(/name: "@klarkxy\/dsh-web-search-manager\/tools"/g)).toHaveLength(1)
    }
  })
  it('deploys app-owned agent presets into the harness-home user preset root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const preset = join(template, 'agent-presets', 'dsh-editor')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(preset, PROFILE_MARKER), '{"app":"dsh-editor","schema":1}')
    await deployProfile(root, template)
    const deployed = join(root, '.agent-presets', 'dsh-editor')
    expect(await readFile(join(deployed, 'agent.cordis.yml'), 'utf8')).toBe('[]\n')
    await writeFile(join(preset, 'agent.cordis.yml'), '# v2\n')
    await deployProfile(root, template)
    expect(await readFile(join(deployed, 'agent.cordis.yml'), 'utf8')).toBe('# v2\n')
    expect((await (await import('node:fs/promises')).readdir(join(root, '.agent-presets'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('keeps template package junctions as links so desktop restarts do not recopy plugin bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const pkg = join(root, 'packages', 'dsh-editor-shell')
    await mkdir(join(pkg, 'lib'), { recursive: true })
    await writeFile(join(pkg, 'lib', 'index.js'), 'export {}\n')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), '{}')
    await symlink(pkg, join(template, 'node_modules', 'dsh-editor-shell'), 'junction')
    const installed = await deployProfile(root, template)
    const linked = join(installed, 'node_modules', 'dsh-editor-shell', 'lib', 'index.js')
    expect(await readFile(linked, 'utf8')).toBe('export {}\n')
    await writeFile(join(pkg, 'lib', 'index.js'), 'export const live = 1\n')
    expect(await readFile(linked, 'utf8')).toBe('export const live = 1\n')
    expect((await lstat(join(installed, 'node_modules', 'dsh-editor-shell'))).isSymbolicLink()).toBe(true)
  })
  it('fails closed when a preset id is occupied by an unmarked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'agent-presets', 'dsh-editor'), { recursive: true })
    const occupied = join(root, '.agent-presets', 'dsh-editor')
    await mkdir(occupied, { recursive: true })
    await writeFile(join(occupied, 'agent.cordis.yml'), '[]\n')
    await expect(deployProfile(root, template)).rejects.toBeInstanceOf(ProfileCollisionError)
  })
  it('deploys plugin-declared presets on restore and reclaims them once the plugin is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: [] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-preset')
    await mkdir(join(plugin, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(plugin, 'package.json'), JSON.stringify({
      name: 'community-preset',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(plugin, 'agent-presets', 'team-style', 'preset.yml'), 'name: 团队风格\n')
    await writeFile(join(plugin, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-preset', spec: 'github:acme/community-preset', version: '1.0.0' }],
    }))
    await deployProfile(root, template)
    const deployed = join(root, '.agent-presets', 'team-style')
    expect(await readFile(join(deployed, 'preset.yml'), 'utf8')).toBe('name: 团队风格\n')
    expect(JSON.parse(await readFile(join(deployed, PROFILE_MARKER), 'utf8'))).toEqual({ app: 'dsh-editor', schema: 1, plugin: 'community-preset' })
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({ schema: 1, installed: [] }))
    await deployProfile(root, template)
    expect(existsSync(deployed)).toBe(false)
    expect((await (await import('node:fs/promises')).readdir(join(root, '.agent-presets'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('never deploys presets for bundles that are not marketplace installs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const bundled = join(template, 'node_modules', 'first-party-pack')
    await mkdir(join(bundled, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(bundled, 'package.json'), JSON.stringify({
      name: 'first-party-pack',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(bundled, 'agent-presets', 'team-style', 'preset.yml'), 'name: 内置\n')
    await writeFile(join(bundled, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['first-party-pack'] } },
    }))
    /* 第一方 bundle 不在 dsh-plugins.json 的 installed 里，社区 preset 通道跳过它。 */
    await deployProfile(root, template)
    expect(existsSync(join(root, '.agent-presets', 'team-style'))).toBe(false)
    /* 另一个名字、登记为市集安装的包，同样声明才会部署。 */
    const installedSource = join(root, 'user-plugins', 'community-pack')
    await mkdir(join(installedSource, 'agent-presets', 'team-style'), { recursive: true })
    await writeFile(join(installedSource, 'package.json'), JSON.stringify({
      name: 'community-pack',
      version: '1.0.0',
      dshEditor: { presets: [{ id: 'team-style', path: 'agent-presets/team-style' }] },
    }))
    await writeFile(join(installedSource, 'agent-presets', 'team-style', 'preset.yml'), 'name: 市集\n')
    await writeFile(join(installedSource, 'agent-presets', 'team-style', 'agent.cordis.yml'), '[]\n')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-pack', spec: 'github:acme/community-pack', version: '1.0.0' }],
    }))
    await deployProfile(root, template)
    expect(await readFile(join(root, '.agent-presets', 'team-style', 'preset.yml'), 'utf8')).toBe('name: 市集\n')
  })
  it('reuses an owned profile when the packaged deploy identity still matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const runtime = join(root, 'runtime', 'node_modules', '@deepseek-ai')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await mkdir(join(runtime, 'dsh-tools'), { recursive: true })
    await mkdir(join(runtime, 'dsh-llm'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
    await mkdir(join(template, 'node_modules', 'dsh-editor-shell'), { recursive: true })
    await writeFile(join(template, 'node_modules', 'dsh-editor-shell', 'package.json'), '{"name":"dsh-editor-shell"}')
    const id = deployIdentity({ nodePath: join(root, 'node.exe'), cliPath: join(root, 'dsh', 'lib', 'bin.js') })
    const first = await deployOwnedProfile(root, template, join(root, 'runtime', 'node_modules'), id)
    expect(first.reused).toBe(false)
    const sentinel = join(first.path, 'node_modules', 'sentinel.txt')
    await writeFile(sentinel, 'keep')
    const marker = JSON.parse(await readFile(join(first.path, PROFILE_MARKER), 'utf8')) as { deploy?: unknown }
    expect(marker.deploy).toEqual({
      algorithm: PROFILE_DEPLOY_ALGORITHM,
      profileSha256: id.profileSha256,
      dsh: id.dsh,
      nodePath: id.nodePath,
      cliPath: id.cliPath,
    })
    const second = await deployOwnedProfile(root, template, join(root, 'runtime', 'node_modules'), id)
    expect(second.reused).toBe(true)
    expect(await readFile(sentinel, 'utf8')).toBe('keep')
    expect((await readdir(join(root, 'profiles'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it('restages when the template digest, runtime path, or required files change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"version":1}')
    await writeFile(join(template, 'cordis.patch.yml'), '[]\n')
    const id = deployIdentity()
    const first = await deployOwnedProfile(root, template, undefined, id)
    await mkdir(join(first.path, 'node_modules'), { recursive: true })
    await writeFile(join(first.path, 'node_modules', 'sentinel.txt'), 'keep')
    const digestChanged = await deployOwnedProfile(root, template, undefined, deployIdentity({ profileSha256: 'other' }))
    expect(digestChanged.reused).toBe(false)
    expect(existsSync(join(digestChanged.path, 'node_modules', 'sentinel.txt'))).toBe(false)
    await mkdir(join(digestChanged.path, 'node_modules'), { recursive: true })
    await writeFile(join(digestChanged.path, 'node_modules', 'sentinel.txt'), 'keep')
    const pathChanged = await deployOwnedProfile(root, template, undefined, deployIdentity({ nodePath: 'D:/other/node.exe' }))
    expect(pathChanged.reused).toBe(false)
    await writeFile(join(pathChanged.path, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const oldMarker = await deployOwnedProfile(root, template, undefined, id)
    expect(oldMarker.reused).toBe(false)
    await rm(join(oldMarker.path, 'package.json'))
    const missing = await deployOwnedProfile(root, template, undefined, id)
    expect(missing.reused).toBe(false)
    expect(existsSync(join(missing.path, 'package.json'))).toBe(true)
  })
  it('still sanitizes locked overlays and preset toggles on a stamp hit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const novel = join(template, 'agent-presets', 'dsh-editor-novel')
    await mkdir(novel, { recursive: true })
    await writeFile(join(template, 'package.json'), '{"name":"dsh-editor-profile"}')
    await writeFile(join(template, 'composition.json'), JSON.stringify({ presets: [{ id: 'dsh-editor-novel' }] }))
    await writeFile(join(novel, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(novel, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const id = deployIdentity()
    await deployOwnedProfile(root, template, undefined, id)
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-novel'))).toBe(true)
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      overrides: { 'editor-novel-kernel': true, zhihu: false },
      presets: { 'dsh-editor-novel': false },
      installed: [],
    }))
    const second = await deployOwnedProfile(root, template, undefined, id)
    expect(second.reused).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'dsh-plugins.json'), 'utf8')).overrides).toEqual({ zhihu: false })
    expect(existsSync(join(root, '.agent-presets', 'dsh-editor-novel'))).toBe(false)
  })
  it('relinks a community plugin already listed in profile bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    await mkdir(join(template, 'node_modules'), { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({
      name: 'dsh-editor-profile',
      dsh: { profile: { bundles: ['dsh-editor-shell'] } },
    }))
    const plugin = join(root, 'user-plugins', 'community-theme')
    await mkdir(plugin, { recursive: true })
    await writeFile(join(plugin, 'package.json'), '{"name":"community-theme","version":"1.0.0"}')
    await writeFile(join(root, 'dsh-plugins.json'), JSON.stringify({
      schema: 1,
      installed: [{ name: 'community-theme', spec: 'github:acme/community-theme', version: '1.0.0' }],
    }))
    const id = deployIdentity()
    const first = await deployOwnedProfile(root, template, undefined, id)
    expect(JSON.parse(await readFile(join(first.path, 'package.json'), 'utf8')).dsh.profile.bundles).toContain('community-theme')
    const linked = join(first.path, 'node_modules', 'community-theme')
    await writeFile(join(root, 'user-plugins', 'community-theme', 'package.json'), '{"name":"community-theme","version":"1.0.1"}')
    await rm(linked, { recursive: true, force: true })
    const second = await deployOwnedProfile(root, template, undefined, id)
    expect(second.reused).toBe(true)
    expect(JSON.parse(await readFile(join(linked, 'package.json'), 'utf8')).version).toBe('1.0.1')
  })
  it('skips recopying an unchanged app-owned preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-'))
    const template = join(root, 'template')
    const preset = join(template, 'agent-presets', 'dsh-editor')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '[]\n')
    await writeFile(join(preset, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    const id = deployIdentity()
    await deployOwnedProfile(root, template, undefined, id)
    const deployed = join(root, '.agent-presets', 'dsh-editor', 'agent.cordis.yml')
    const before = (await stat(deployed)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 40))
    await deployOwnedProfile(root, template, undefined, id)
    expect((await stat(deployed)).mtimeMs).toBe(before)
  })
})

function deployIdentity(partial: Partial<ProfileDeployIdentity> = {}): ProfileDeployIdentity {
  return {
    algorithm: PROFILE_DEPLOY_ALGORITHM,
    profileSha256: 'sha-template',
    dsh: '@deepseek-ai/dsh@0.1.7-rc.2',
    nodePath: 'C:/runtime/node.exe',
    cliPath: 'C:/runtime/dsh/lib/bin.js',
    ...partial,
  }
}

describe('persistent packaged runtime cache', () => {
  it('copies the packaged runtime only for portable executables', () => {
    expect(shouldMaterializePackagedRuntime({})).toBe(false)
    expect(shouldMaterializePackagedRuntime({ PORTABLE_EXECUTABLE_FILE: '  ' })).toBe(false)
    expect(shouldMaterializePackagedRuntime({ PORTABLE_EXECUTABLE_FILE: 'C:\\Apps\\DSH Editor.exe' })).toBe(true)
    const runtime = runtimeFromResources(join('D:', 'Program Files', 'DSH Editor', 'resources'))
    expect(runtime.cliPath).toBe(join('D:', 'Program Files', 'DSH Editor', 'resources', 'dsh', 'lib', 'bin.js'))
  })
  it('does not hash the runtime tree after copy or when the marker already matches', async () => {
    const source = await readFile(join(import.meta.dirname, '..', 'src', 'runtime-cache.ts'), 'utf8')
    expect(source).toContain('copyMatchesManifest')
    expect(source).toContain('treeMeasure')
    expect(source).toContain('cacheReady')
    expect(source).not.toContain('await treeDigest(')
    expect(source).not.toContain('await validate(')
  })
  it('reads profile deploy identity from the runtime manifest without hashing the template', async () => {
    const { resources } = await runtimeFixture()
    const identity = readProfileDeployIdentity(resources, { nodePath: 'n', cliPath: 'c' })
    expect(identity).toEqual({
      algorithm: PROFILE_DEPLOY_ALGORITHM,
      profileSha256: identity.profileSha256,
      dsh: '@deepseek-ai/dsh@0.1.7-rc.2',
      nodePath: 'n',
      cliPath: 'c',
    })
    expect(identity.profileSha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('copies and verifies the bundled runtime outside the portable extraction tree', async () => {
    const { root, resources } = await runtimeFixture()
    const runtime = await materializePackagedRuntime(join(root, 'home'), resources)
    expect(runtime.cliPath).toContain(join('home', 'runtime', 'dsh-editor-runtime'))
    expect(runtime.cliPath).not.toContain(resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-one')
    expect(existsSync(join(root, 'home', 'runtime', 'dsh-editor-runtime', '.dsh-editor-runtime.json'))).toBe(true)
    expect(hasPackagedRuntimeCache(join(root, 'home'))).toBe(true)
  })
  it('rejects a bundled runtime manifest built for a different platform', async () => {
    const { root, resources } = await runtimeFixture()
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: 'unsupported-platform', node: { version: '24.16.0', ...node }, dsh: { version: '0.1.7-rc.2', ...dsh }, profile,
    }))
    await expect(materializePackagedRuntime(join(root, 'home'), resources)).rejects.toThrow('unsupported identity')
  })
  it('atomically replaces an owned cache when the bundled manifest changes', async () => {
    const { root, resources } = await runtimeFixture('one')
    const home = join(root, 'home')
    await materializePackagedRuntime(home, resources)
    await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh-two')
    const [node, dsh, profile] = await Promise.all([
      treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
    ])
    await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
      format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '24.16.0', ...node }, dsh: { version: '0.1.7-rc.2', ...dsh }, profile,
    }))
    const runtime = await materializePackagedRuntime(home, resources)
    expect(await readFile(runtime.cliPath, 'utf8')).toBe('dsh-two')
    expect((await (await import('node:fs/promises')).readdir(join(home, 'runtime'))).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false)
  })
  it.runIf(process.platform === 'win32')('starts from the committed runtime while an old Node executable still locks its backup', async () => {
    const { root, resources } = await runtimeFixture('one', true)
    const home = join(root, 'home')
    const first = await materializePackagedRuntime(home, resources)
    const oldRuntime = spawn(first.nodePath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    // 'spawn' precedes executable loading on Windows; wait until the old runtime is actually running.
    await once(oldRuntime.stdout!, 'data')
    try {
      await writeFile(join(resources, 'dsh', 'lib', 'bin.js'), 'dsh-two')
      const [node, dsh, profile] = await Promise.all([
        treeDigest(join(resources, 'node')), treeDigest(join(resources, 'dsh')), treeDigest(join(resources, 'profile-template')),
      ])
      await writeFile(join(resources, 'runtime-manifest.json'), JSON.stringify({
        format: 1, platform: `${process.platform}-${process.arch}`, node: { version: '24.16.0', ...node }, dsh: { version: '0.1.7-rc.2', ...dsh }, profile,
      }))

      const committed = await materializePackagedRuntime(home, resources)
      expect(await readFile(committed.cliPath, 'utf8')).toBe('dsh-two')
      const runtimeParent = join(home, 'runtime')
      const lockedBackup = (await readdir(runtimeParent)).find((name) => name.includes('.backup-'))
      expect(lockedBackup).toBeTruthy()
      expect(existsSync(join(runtimeParent, lockedBackup!, 'dsh', 'lib', 'bin.js'))).toBe(true)

      const exited = once(oldRuntime, 'exit')
      oldRuntime.kill('SIGTERM')
      await exited
      await materializePackagedRuntime(home, resources)
      expect((await readdir(runtimeParent)).some((name) => name.includes('.backup-'))).toBe(false)
    } finally {
      if (oldRuntime.exitCode === null && oldRuntime.signalCode === null) {
        const exited = once(oldRuntime, 'exit')
        oldRuntime.kill('SIGTERM')
        await exited
      }
    }
  }, 30_000)
  it('never replaces an unowned runtime cache path', async () => {
    const { root, resources } = await runtimeFixture()
    const target = join(root, 'home', 'runtime', 'dsh-editor-runtime')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'user-file.txt'), 'do not touch')
    await expect(materializePackagedRuntime(join(root, 'home'), resources)).rejects.toThrow('unowned desktop runtime cache')
    expect(await readFile(join(target, 'user-file.txt'), 'utf8')).toBe('do not touch')
  })
  it('never removes an unmarked directory that resembles a stale backup', async () => {
    const { root, resources } = await runtimeFixture()
    const home = join(root, 'home')
    await materializePackagedRuntime(home, resources)
    const collision = join(home, 'runtime', '.dsh-editor-runtime.backup-user')
    await mkdir(collision)
    await writeFile(join(collision, 'user-file.txt'), 'do not touch')
    await materializePackagedRuntime(home, resources)
    expect(await readFile(join(collision, 'user-file.txt'), 'utf8')).toBe('do not touch')
  })
})

describe('child supervision', () => {
  const launch = { nodePath: 'node.exe', cliPath: 'dsh/lib/bin.js', home: 'D:/home', env: {}, timeoutMs: 25 }
  it('waits for readiness and reports an unexpected post-ready exit', async () => {
    const child = new FakeChild()
    const unexpected = vi.fn()
    const supervisor = new DshSupervisor({ spawn: () => child, onUnexpectedExit: unexpected })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await expect(ready).resolves.toMatchObject({ port: '43111' })
    child.exit(23)
    expect(unexpected).toHaveBeenCalledOnce()
  })
  it('includes DSH output when the child exits before readiness', async () => {
    const child = new FakeChild()
    const supervisor = new DshSupervisor({ spawn: () => child, gracefulStopMs: 1 })
    const ready = supervisor.start(launch)
    child.stderr.write('dsh: plugin tree failed to load: editor-novel-kernel requires an explicit mode\n')
    child.exit(1)
    await expect(ready).rejects.toThrow(/exited before readiness[\s\S]*editor-novel-kernel requires an explicit mode/)
  })

  it('rejects a readiness timeout', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1 })
    await expect(supervisor.start(launch)).rejects.toThrow('Timed out waiting 25ms')
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
  })
  it('uses graceful stop before exact process-tree fallback', async () => {
    const child = new FakeChild()
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 1 })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).toHaveBeenCalledWith(8123)
  })
  it('does not force-kill a child that exits during graceful shutdown', async () => {
    const child = new FakeChild()
    child.kill = (signal?: NodeJS.Signals | number) => { child.killedWith = signal; queueMicrotask(() => child.exit()); return true }
    const forceKillTree = vi.fn(async () => undefined)
    const supervisor = new DshSupervisor({ spawn: () => child, forceKillTree, gracefulStopMs: 25 })
    const ready = supervisor.start(launch)
    child.stdout.write('dsh web: http://127.0.0.1:43111\n')
    await ready
    await supervisor.stop()
    expect(child.killedWith).toBe('SIGTERM')
    expect(forceKillTree).not.toHaveBeenCalled()
  })
  it('relaunches when the random port is restricted by Chromium', async () => {
    const blocked = new FakeChild()
    blocked.kill = (signal?: NodeJS.Signals | number) => { blocked.killedWith = signal; queueMicrotask(() => blocked.exit()); return true }
    const usable = new FakeChild()
    const children = [blocked, usable]
    const spawn = vi.fn(() => children.shift()!)
    const supervisor = new DshSupervisor({ spawn, gracefulStopMs: 25 })
    const ready = supervisor.start({ ...launch, timeoutMs: 5_000 })
    blocked.stdout.write('dsh web: http://127.0.0.1:6665\n')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    usable.stdout.write('dsh web: http://127.0.0.1:43112\n')
    await expect(ready).resolves.toMatchObject({ port: '43112' })
    expect(blocked.killedWith).toBe('SIGTERM')
  })
})

describe('BrowserWindow policy', () => {
  it('blocks popups, permissions, and non-DSH navigation', () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let popup: (() => { action: 'deny' }) | undefined
    let permission: ((_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void) | undefined
    const policy = installNavigationPolicy({
      on: (_event, listener) => { navigate = listener },
      setWindowOpenHandler: (handler) => { popup = handler },
      session: { setPermissionRequestHandler: (handler) => { permission = handler } },
    }, new URL('http://127.0.0.1:43111/'))
    const preventDefault = vi.fn()
    navigate?.({ preventDefault }, 'https://example.com')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(popup?.()).toEqual({ action: 'deny' })
    const callback = vi.fn()
    permission?.({}, 'notifications', callback)
    expect(callback).toHaveBeenCalledWith(false)
    policy.setExpected(new URL('http://127.0.0.1:43112/'))
    preventDefault.mockClear()
    navigate?.({ preventDefault }, 'http://127.0.0.1:43111/settings')
    expect(preventDefault).toHaveBeenCalledOnce()
    preventDefault.mockClear()
    navigate?.({ preventDefault }, 'http://127.0.0.1:43112/settings')
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

class FakeSession {
  downloadListeners: Array<(event: { preventDefault(): void }, item: { getFilename(): string; setSavePath(path: string): void }, contents?: unknown) => void> = []
  on(event: string, listener: (event: { preventDefault(): void }, item: { getFilename(): string; setSavePath(path: string): void }, contents?: unknown) => void): void {
    if (event === 'will-download') this.downloadListeners.push(listener)
  }
  setPermissionRequestHandler(): void { /* session policy is installed per window via the real helper */ }
}

class FakeWindow implements EditorWindow {
  loaded: string[] = []
  shown = false
  private readonly closedListeners: Array<() => void> = []
  private readonly navigateListeners: Array<(event: { preventDefault(): void }, url: string) => void> = []
  private readonly inputListeners: Array<(event: { preventDefault(): void }, input: EditorInput) => void> = []
  readonly webContents: EditorWindow['webContents']
  constructor(session: FakeSession) {
    const window = this
    this.webContents = {
      session,
      on(event, listener) {
        if (event === 'will-navigate') window.navigateListeners.push(listener as (event: { preventDefault(): void }, url: string) => void)
        if (event === 'before-input-event') window.inputListeners.push(listener as (event: { preventDefault(): void }, input: EditorInput) => void)
      },
      setWindowOpenHandler() { /* popup denial is covered by installNavigationPolicy */ },
    }
  }
  async loadURL(url: string): Promise<void> { this.loaded.push(url) }
  show(): void { this.shown = true }
  on(event: 'closed', listener: () => void): this {
    if (event === 'closed') this.closedListeners.push(listener)
    return this
  }
  close(): void { for (const listener of this.closedListeners) listener() }
  emitInput(input: EditorInput): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    for (const listener of this.inputListeners) listener(event, input)
    return event
  }
}

function fakeApp(lock: boolean) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    requestSingleInstanceLock: vi.fn(() => lock),
    quit: vi.fn(),
    whenReady: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
    }),
    handlers,
  }
}

function multiWindowHarness() {
  const session = new FakeSession()
  const windows: FakeWindow[] = []
  const contents = new Map<EditorWindow['webContents'], FakeWindow>()
  let starts = 0
  let stops = 0
  let supervisors = 0
  let unexpected: ((reason: Error) => void) | undefined
  const showSaveDialog = vi.fn((window: EditorWindow | undefined, suggested: string) => `saved:${suggested}:${window ? windows.indexOf(window as FakeWindow) : -1}`)
  const deploy = vi.fn(async () => 'profile')
  const deps: DesktopLifecycleDeps = {
    createBrowserWindow: () => {
      const window = new FakeWindow(session)
      windows.push(window)
      contents.set(window.webContents, window)
      return window
    },
    fromWebContents: (candidate) => contents.get(candidate as EditorWindow['webContents']),
    showSaveDialog,
    resolveRuntime: async () => ({ nodePath: 'node.exe', cliPath: 'dsh/lib/bin.js', template: 'template' }),
    deployProfile: deploy,
    createSupervisor: (options) => {
      supervisors += 1
      unexpected = options.onUnexpectedExit
      return {
        start: async () => {
          starts += 1
          await new Promise((resolve) => setTimeout(resolve, 15))
          return new URL('http://127.0.0.1:43111/')
        },
        stop: async () => { stops += 1 },
      }
    },
    errorHtml: (error) => `error:${error instanceof Error ? error.message : String(error)}`,
    loadingHtml: () => 'loading:',
    getHomePath: () => 'D:/home',
    env: { DSH_HOME: 'D:/custom-home' },
    timeoutMs: 20_000,
  }
  return {
    session, windows, deps, deploy, showSaveDialog,
    counts: () => ({ starts, stops, supervisors, windows: windows.length }),
    unexpected: () => unexpected,
  }
}

describe('controlled multi-window', () => {
  it('starts and deploys the backend once for concurrent window creation', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow(), lifecycle.createWindow()])
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 3 })
    expect(harness.deploy).toHaveBeenCalledOnce()
    expect(harness.windows.every((window) => window.loaded.at(-1) === 'http://127.0.0.1:43111/')).toBe(true)
  })

  it('creates a second-instance window without starting another backend', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    lifecycle.handleSecondInstance()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    await vi.waitFor(() => expect(harness.windows[1]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledOnce()
  })

  it('opens a window only for the focused Ctrl+Shift+N shortcut', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    const accepted = harness.windows[0]!.emitInput({ type: 'keyDown', key: 'N', control: true, shift: true, alt: false, meta: false })
    expect(accepted.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    for (const input of [
      { type: 'keyUp', key: 'N', control: true, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'n', control: true, shift: false, alt: false, meta: false },
      { type: 'keyDown', key: 'T', control: true, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'N', control: true, shift: true, alt: true, meta: false },
      { type: 'keyDown', key: 'N', control: false, shift: true, alt: false, meta: false },
      { type: 'keyDown', key: 'N', control: true, shift: true, alt: false, meta: true },
    ] satisfies EditorInput[]) {
      const ignored = harness.windows[0]!.emitInput(input)
      expect(ignored.preventDefault).not.toHaveBeenCalled()
    }
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
  })

  it('keeps the backend running when one window closes and stops it once on shutdown', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    harness.windows[0]!.close()
    expect(harness.counts()).toMatchObject({ starts: 1, stops: 0, windows: 2 })
    expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    await lifecycle.shutdown()
    await lifecycle.shutdown()
    expect(harness.counts().stops).toBe(1)
  })

  it('waits for an in-flight backend start before completing shutdown', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve })
    const harness = multiWindowHarness()
    const stop = vi.fn(async () => undefined)
    harness.deps.createSupervisor = () => ({
      async start() {
        await startGate
        return new URL('http://127.0.0.1:43111/')
      },
      stop,
    })
    const lifecycle = createDesktopLifecycle(harness.deps)
    const opening = lifecycle.createWindow()
    await vi.waitFor(() => expect(lifecycle.needsGracefulShutdown()).toBe(true))
    let shutdownFinished = false
    const shutdown = lifecycle.shutdown().then(() => { shutdownFinished = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shutdownFinished).toBe(false)
    releaseStart()
    await Promise.all([opening, shutdown])
    expect(shutdownFinished).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('broadcasts unexpected backend exit and deduplicates concurrent retries across windows', async () => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    harness.unexpected()?.(new Error('DSH exited unexpectedly (code 23, signal none)'))
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 23, signal none)')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('error:DSH exited unexpectedly (code 23, signal none)')
    })
    void lifecycle.retry()
    void lifecycle.retry()
    await vi.waitFor(() => {
      expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
      expect(harness.windows[1]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    })
    expect(harness.windows[0]!.loaded.filter((url) => url === 'loading:')).toHaveLength(2)
    expect(harness.counts()).toEqual({ starts: 2, stops: 1, supervisors: 1, windows: 2 })
    expect(harness.deploy).toHaveBeenCalledTimes(2)
  })

  it('retries a failed first start from the error page', async () => {
    const harness = multiWindowHarness()
    let fail = true
    harness.deps.createSupervisor = () => ({
      async start() {
        if (fail) throw new Error('backend missing')
        return new URL('http://127.0.0.1:43111/')
      },
      async stop() { /* first start never reached a running child */ },
    })
    const lifecycle = createDesktopLifecycle(harness.deps)
    await lifecycle.createWindow()
    expect(harness.windows[0]!.loaded.at(-1)).toBe('error:backend missing')
    fail = false
    await lifecycle.retry()
    expect(harness.windows[0]!.loaded.at(-1)).toBe('http://127.0.0.1:43111/')
    expect(harness.windows[0]!.loaded).toEqual(['loading:', 'error:backend missing', 'loading:', 'http://127.0.0.1:43111/'])
  })

  it.each(['md', 'txt', 'docx', 'epub', 'DOCX', 'EPUB'])('routes %s exports to the initiating window and blocks executable downloads', async (extension) => {
    const harness = multiWindowHarness()
    const lifecycle = createDesktopLifecycle(harness.deps)
    await Promise.all([lifecycle.createWindow(), lifecycle.createWindow()])
    expect(harness.session.downloadListeners).toHaveLength(1)
    const allowed = { path: undefined as string | undefined, getFilename: () => `chapter.${extension}`, setSavePath(path: string) { this.path = path } }
    harness.session.downloadListeners[0]!({ preventDefault: vi.fn() }, allowed, harness.windows[1]!.webContents)
    expect(harness.showSaveDialog).toHaveBeenCalledWith(harness.windows[1], `chapter.${extension}`)
    expect(allowed.path).toBe(`saved:chapter.${extension}:1`)
    const blocked = { preventDefault: vi.fn() }
    harness.session.downloadListeners[0]!(blocked, { getFilename: () => 'payload.exe', setSavePath: vi.fn() }, harness.windows[0]!.webContents)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(harness.showSaveDialog).toHaveBeenCalledOnce()
  })

  it('quits a secondary process without registering startup handlers or starting the backend', async () => {
    const harness = multiWindowHarness()
    const app = fakeApp(false)
    const lifecycle = createDesktopLifecycle(harness.deps)
    expect(claimPrimaryInstance(app, lifecycle)).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
    expect(harness.counts()).toEqual({ starts: 0, stops: 0, supervisors: 0, windows: 0 })
    expect(harness.deploy).not.toHaveBeenCalled()
  })

  it('lets a primary second-instance event create a window after ready', async () => {
    const harness = multiWindowHarness()
    const app = fakeApp(true)
    const lifecycle = createDesktopLifecycle(harness.deps)
    expect(claimPrimaryInstance(app, lifecycle)).toBe(true)
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1))
    await vi.waitFor(() => expect(harness.windows[0]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    app.handlers.get('second-instance')![0]!()
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2))
    await vi.waitFor(() => expect(harness.windows[1]?.loaded.at(-1)).toBe('http://127.0.0.1:43111/'))
    expect(harness.counts()).toEqual({ starts: 1, stops: 0, supervisors: 1, windows: 2 })
    const event = { preventDefault: vi.fn() }
    app.handlers.get('before-quit')![0]!(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(harness.counts().stops).toBe(1))
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
  })
})


describe('external repository links', () => {
  it('allows search provider signup URLs without allowing lookalike or unsafe URLs', () => {
    for (const url of [
      'https://platform.deepseek.com/api_keys', 'https://dashboard.exa.ai/api-keys',
      'https://api.search.brave.com', 'https://open.bochaai.com', 'https://serper.dev',
      'https://www.firecrawl.dev', 'https://app.tavily.com',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(true)
      const parsed = new URL(url)
      expect(isAllowedExternalUrl(url.replace('https:', 'http:'))).toBe(false)
      expect(isAllowedExternalUrl(`https://${parsed.hostname}.evil.test${parsed.pathname}`)).toBe(false)
      expect(isAllowedExternalUrl(`https://user@${parsed.hostname}${parsed.pathname}`)).toBe(false)
      expect(isAllowedExternalUrl(`https://${parsed.hostname}:8443${parsed.pathname}`)).toBe(false)
    }
  })
  it('allows marketplace repos and existing help URLs but rejects other destinations', () => {
    expect(isAllowedExternalUrl('https://github.com/V1ki/dsh-plugin-subscriptions')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/klarkxy/dsh-editor/releases')).toBe(true)
    expect(isAllowedExternalUrl('https://developer.zhihu.com')).toBe(true)
    for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://user@github.com/a/b', 'https://github.com:8443/a/b', 'https://github.com/login', 'file:///tmp/x', 'javascript:alert(1)', null]) {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
  })
})


describe('Tavily integration upgrade', () => {
  it('retires the old bundle and managed entry with backups, preserving user data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-tavily-upgrade-'))
    const template = join(home, 'template')
    await mkdir(template, { recursive: true })
    await writeFile(join(template, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@klarkxy/dsh-web-search-manager'] } } }))
    const target = join(home, 'profiles', 'dsh-editor')
    await mkdir(join(target, 'node_modules', 'dsh-web-search-tavily'), { recursive: true })
    await writeFile(join(target, PROFILE_MARKER), JSON.stringify({ app: 'dsh-editor', schema: 1 }))
    await writeFile(join(target, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@klarkxy/dsh-web-search-manager', 'dsh-web-search-tavily'] } } }))
    const source = join(home, 'user-plugins', 'dsh-web-search-tavily')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'dsh-web-search-tavily' }))
    const oldState = JSON.stringify({ schema: 1, overrides: { 'web-search-tavily': true, zhihu: false }, presets: { 'dsh-editor-novel': false }, installed: [{ name: 'dsh-web-search-tavily', spec: 'old-tavily', version: '0.1.0' }] })
    const oldPatch = '# managed-by: dsh-editor-plugins\n- id: web-search-tavily\n  disabled: false\n- id: zhihu\n  disabled: true\n'
    await writeFile(join(home, 'dsh-plugins.json'), oldState)
    await writeFile(join(home, 'cordis.patch.yml'), oldPatch)
    await writeFile(join(home, '.credentials.yaml'), 'fixture credentials remain byte-for-byte')
    const deployed = await deployProfile(home, template)
    expect(JSON.parse(await readFile(join(deployed, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual(['@klarkxy/dsh-web-search-manager'])
    expect(existsSync(join(deployed, 'node_modules', 'dsh-web-search-tavily'))).toBe(false)
    expect(existsSync(join(source, 'package.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(home, 'dsh-plugins.json'), 'utf8'))).toMatchObject({ overrides: { zhihu: false }, presets: { 'dsh-editor-novel': false }, installed: [] })
    expect(await readFile(join(home, 'dsh-plugins.json.before-tavily-merge'), 'utf8')).toBe(oldState)
    expect(await readFile(join(home, 'cordis.patch.yml.before-tavily-merge'), 'utf8')).toBe(oldPatch)
    expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).not.toContain('web-search-tavily')
    expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).toBe('fixture credentials remain byte-for-byte')
    await deployProfile(home, template)
    expect(await readFile(join(home, 'dsh-plugins.json.before-tavily-merge'), 'utf8')).toBe(oldState)
  })
})

describe('manuscript export save filters', () => {
  it.each([['md', 'Markdown'], ['txt', '纯文本'], ['docx', 'Word 文档'], ['epub', 'EPUB 电子书']]) ('preserves %s format in the native save dialog', (extension, name) => {
    expect(exportFileFilter(`作品.${extension.toUpperCase()}`)).toEqual({ name, extensions: [extension] })
  })
  it.each(['payload.exe', 'document.docx.exe', 'untitled', 'book.epub.bak']) ('does not offer a save filter for %s', (filename) => {
    expect(exportFileFilter(filename)).toBeUndefined()
  })
})
