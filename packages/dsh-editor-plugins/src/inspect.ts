import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  type InspectEntry,
  type InspectFinding,
  type InspectSeverity,
  type InspectVerdict,
  type PluginInspectReport,
} from './contracts.ts'
import { isProtectedPackage, isSafeEntryId, isSafePackageName, type RuntimeCatalog } from './core.ts'
import { inspectPluginPresets } from './presets.ts'

export const PINNED_DSH = '0.1.7-rc.2'
export const PINNED_CORDIS = '4.0.4'
export type { InspectEntry, InspectFinding, InspectSeverity, InspectVerdict, PluginInspectReport }

type Manifest = {
  name?: unknown
  version?: unknown
  main?: unknown
  exports?: unknown
  engines?: { node?: unknown }
  scripts?: Record<string, unknown>
  dependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
  dsh?: { bundle?: { patch?: unknown }; client?: { platform?: unknown } }
}

const NATIVE_PACKAGES = new Set(['node-gyp', 'node-addon-api', 'bindings', 'prebuild-install', 'node-gyp-build'])

function finding(code: string, severity: InspectSeverity, message: string): InspectFinding {
  return { code, severity, message }
}

function verdictOf(findings: readonly InspectFinding[]): InspectVerdict {
  if (findings.some((item) => item.severity === 'error')) return 'blocked'
  if (findings.some((item) => item.severity === 'warning')) return 'warn'
  return 'ready'
}

export function blockedReason(report: PluginInspectReport): string {
  const errors = report.findings.filter((item) => item.severity === 'error').map((item) => item.message)
  return errors.join('；') || '该插件未通过静态检查，安装后不会生效'
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  for (const key of ['default', 'import', 'require', 'node']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key]
  }
  return undefined
}

export function resolveInside(root: string, rel: string): string | undefined {
  const cleaned = rel.replaceAll('\\', '/').trim()
  if (!cleaned || isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned) || cleaned.includes('://')) return undefined
  const target = resolve(root, cleaned)
  const relToRoot = relative(root, target)
  if (!relToRoot || relToRoot.startsWith('..') || isAbsolute(relToRoot)) return undefined
  return target
}

export function resolveEntryFile(manifest: Manifest, moduleName: string): string | undefined {
  const name = typeof manifest.name === 'string' ? manifest.name : ''
  const exportsMap = manifest.exports && typeof manifest.exports === 'object' && !Array.isArray(manifest.exports)
    ? manifest.exports as Record<string, unknown>
    : undefined
  if (moduleName === name) {
    return exportTarget(exportsMap?.['.']) || (typeof manifest.main === 'string' ? manifest.main : undefined) || './index.js'
  }
  if (name && moduleName.startsWith(`${name}/`)) {
    const sub = `./${moduleName.slice(name.length + 1)}`
    return exportTarget(exportsMap?.[sub]) || `${sub}.js`
  }
  return undefined
}

export function parseBundlePatch(text: string): { inserts: InspectEntry[]; empty: boolean; hasJs: boolean; parseError?: string } {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { inserts: [], empty: true, hasJs: false, parseError: 'cordis.patch.yml 为空' }
  if (trimmed === '[]') return { inserts: [], empty: true, hasJs: false }
  const hasJs = /!!js\b/.test(trimmed)
  const inserts: InspectEntry[] = []
  let inInsert = false
  let current: Partial<InspectEntry> | undefined
  const flush = () => {
    if (current?.id && current.name) inserts.push({ id: current.id, name: current.name })
    current = undefined
  }
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '$1')
    if (!line.trim()) continue
    if (/^-\s*insert:\s*$/.test(line)) {
      flush()
      inInsert = true
      continue
    }
    if (/^-\s/.test(line) && !/^\s/.test(line) && !/^-\s*insert:/.test(line)) {
      flush()
      inInsert = false
      continue
    }
    if (!inInsert) continue
    const id = line.match(/^\s+-\s+id:\s+["']?([A-Za-z0-9._-]+)["']?\s*$/)
    if (id) {
      flush()
      current = { id: id[1] }
      continue
    }
    const name = line.match(/^\s+name:\s+["']?([^"'#]+?)["']?\s*$/)
    if (name && current) current.name = name[1].trim()
  }
  flush()
  return { inserts, empty: inserts.length === 0, hasJs }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('-')
  const pb = b.split('-')
  const na = pa[0].split('.').map(Number)
  const nb = pb[0].split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0)
  }
  const prea = pa.slice(1).join('-')
  const preb = pb.slice(1).join('-')
  if (prea === preb) return 0
  if (!prea) return 1
  if (!preb) return -1
  const sa = prea.split('.')
  const sb = preb.split('.')
  for (let i = 0; i < Math.max(sa.length, sb.length); i += 1) {
    if (sa[i] === undefined) return -1
    if (sb[i] === undefined) return 1
    const xa = /^\d+$/.test(sa[i]) ? +sa[i] : null
    const xb = /^\d+$/.test(sb[i]) ? +sb[i] : null
    if (xa !== null && xb !== null && xa !== xb) return xa - xb
    if (xa !== null && xb === null) return -1
    if (xa === null && xb !== null) return 1
    if (xa === null && xb === null && sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1
  }
  return 0
}

function caretUpperBound(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('-')[0].split('.')
  if (+major > 0) return `${+major + 1}.0.0`
  if (+minor > 0) return `0.${+minor + 1}.0`
  return `0.0.${+patch + 1}`
}

function tildeUpperBound(version: string): string {
  const parts = version.split('-')[0].split('.')
  if (parts.length < 2) return `${+parts[0] + 1}.0.0`
  return `${parts[0]}.${+parts[1] + 1}.0`
}

function comparatorAllows(comparator: string, pinned: string): boolean | 'unknown' {
  const match = /^(>=|<=|>|<|=)?\s*(\^|~)?\s*(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/.exec(comparator)
  if (!match) return 'unknown'
  const [, op = '', expand = '', raw] = match
  const cmp = compareVersions(pinned, raw)
  if (expand === '^') return cmp >= 0 && compareVersions(pinned, caretUpperBound(raw)) < 0
  if (expand === '~') return cmp >= 0 && compareVersions(pinned, tildeUpperBound(raw)) < 0
  if (op === '>=') return cmp >= 0
  if (op === '<=') return cmp <= 0
  if (op === '>') return cmp > 0
  if (op === '<') return cmp < 0
  return cmp === 0
}

export function peerAllows(range: string, pinned: string): boolean | 'unknown' {
  const text = range.trim()
  if (!text) return 'unknown'
  if (text.includes('workspace:')) return false
  const groups = text.split('||').map((group) => group.trim()).filter(Boolean)
  let sawUnknown = false
  for (const group of groups) {
    let ok = true
    for (const comparator of group.split(/\s+/)) {
      const allowed = comparatorAllows(comparator, pinned)
      if (allowed === 'unknown') { sawUnknown = true; ok = false; break }
      if (!allowed) { ok = false; break }
    }
    if (ok) return true
  }
  return sawUnknown ? 'unknown' : false
}

function looksLikeSourceOnly(pkgDir: string): boolean {
  return ['src/index.ts', 'src/index.js', 'src/index.tsx', 'index.ts'].some((file) => existsSync(join(pkgDir, file)))
}

function looksLikeClientLoader(source: string): boolean {
  return /window\.__ModuleLoader__\.load\s*\(/.test(source)
}

function claimsRootSlot(source: string): boolean {
  return /name\s*:\s*['"]root['"]/.test(source) || /name\s*:\s*`root`/.test(source)
}

/** Seats a client bundle may register into: official Web overlay plus every Shell seat (see dsh-editor-seats). */
export const EDITOR_SEATS = [
  'shell.overlay',
  'dsh-editor.extensions',
  'dsh-editor.settings.plugins',
  'dsh-editor.sidebar.tools',
  'dsh-editor.center.overlays',
] as const

function claimsEditorSeat(source: string): boolean {
  return EDITOR_SEATS.some((seat) => source.includes(seat))
}

async function fileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function collectDeps(manifest: Manifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]
}

export async function inspectPluginPackage(pkgDir: string, catalog?: RuntimeCatalog): Promise<PluginInspectReport> {
  const findings: InspectFinding[] = []
  const report: PluginInspectReport = { verdict: 'blocked', entries: [], hasClient: false, findings }
  let manifest: Manifest
  try {
    manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as Manifest
  } catch {
    findings.push(finding('package-json', 'error', '没有可读的 package.json'))
    report.verdict = verdictOf(findings)
    return report
  }
  if (typeof manifest.name !== 'string' || !isSafePackageName(manifest.name)) {
    findings.push(finding('package-name', 'error', '插件未声明有效的包名'))
    report.verdict = verdictOf(findings)
    return report
  }
  report.name = manifest.name
  report.version = typeof manifest.version === 'string' ? manifest.version : undefined
  if (isProtectedPackage(manifest.name, catalog?.bundles ?? [])) {
    findings.push(finding('protected-package', 'error', '不能覆盖系统核心插件'))
  }
  const patchRel = typeof manifest.dsh?.bundle?.patch === 'string' ? manifest.dsh.bundle.patch.trim() : ''
  if (!patchRel) {
    findings.push(finding('bundle-patch', 'error', '不是可安装的 DSH 插件（缺少 dsh.bundle.patch）'))
    report.verdict = verdictOf(findings)
    return report
  }
  const patchPath = resolveInside(pkgDir, patchRel)
  if (!patchPath) {
    findings.push(finding('bundle-patch', 'error', 'dsh.bundle.patch 路径不安全'))
    report.verdict = verdictOf(findings)
    return report
  }
  let patchText: string
  try {
    patchText = await readFile(patchPath, 'utf8')
  } catch {
    findings.push(finding('patch-missing', 'error', `找不到 ${patchRel}，Loader 不会挂上这个包`))
    report.verdict = verdictOf(findings)
    return report
  }
  const parsed = parseBundlePatch(patchText)
  if (parsed.parseError) findings.push(finding('patch-parse', 'error', parsed.parseError))
  if (parsed.hasJs) findings.push(finding('patch-js', 'warning', 'patch 含有 !!js 表达式，静态检查无法证明启动时一定成功'))
  if (parsed.empty) findings.push(finding('patch-empty', 'error', 'cordis.patch.yml 没有 insert 入口，装上也不会多出插件'))
  const seenIds = new Set<string>()
  for (const entry of parsed.inserts) {
    if (!isSafeEntryId(entry.id)) {
      findings.push(finding('entry-id', 'error', `入口 id 无效：${entry.id}`))
      continue
    }
    if (seenIds.has(entry.id)) findings.push(finding('entry-id', 'error', `入口 id 重复：${entry.id}`))
    seenIds.add(entry.id)
    const catalogRow = catalog?.entries[entry.id]
    if (catalogRow?.locked || entry.name === 'dsh-editor-shell' || entry.id === 'root') {
      findings.push(finding('entry-collision-core', 'error', `入口 ${entry.id} 会与写作核心冲突，装上会抢占或打坏现有界面`))
    } else if (catalogRow) {
      findings.push(finding('entry-collision-optional', 'warning', `入口 ${entry.id} 已有同名写作扩展，可能互相覆盖`))
    }
    const fileRel = resolveEntryFile(manifest, entry.name)
    if (!fileRel) {
      findings.push(finding('entry-name', 'error', `入口模块 ${entry.name} 不是本包导出，重启后 Loader 解析会失败`))
      continue
    }
    const filePath = resolveInside(pkgDir, fileRel)
    if (!filePath || !(await fileExists(filePath))) {
      const sourceOnly = looksLikeSourceOnly(pkgDir)
      const hasPrepare = typeof manifest.scripts?.prepare === 'string' || typeof manifest.scripts?.build === 'string'
      findings.push(finding('entry-file', 'error', sourceOnly
        ? `只有源码，没有 ${fileRel}。本编辑器安装时不运行 prepare/build，这个插件不会挂上`
        : `入口文件不存在：${fileRel}`))
      if (sourceOnly && hasPrepare) {
        findings.push(finding('source-only', 'info', '仓库声明了构建脚本，但安装过程故意不执行脚本'))
      }
      continue
    }
    report.entries.push(entry)
  }

  const workspaceDeps = Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
  if (workspaceDeps.length) {
    findings.push(finding('workspace-dep', 'error', `含有未发布的 workspace 依赖：${workspaceDeps.map(([name]) => name).join('、')}，安装后无法解析`))
  }

  const peers = manifest.peerDependencies ?? {}
  for (const [name, range] of Object.entries(peers)) {
    if (typeof range !== 'string') continue
    if (name === '@deepseek-ai/cordis') {
      const allowed = peerAllows(range, PINNED_CORDIS)
      if (allowed === false) findings.push(finding('peer-cordis', 'error', `需要 cordis ${range}，当前宿主是 ${PINNED_CORDIS}`))
      else if (allowed === 'unknown') findings.push(finding('peer-cordis', 'warning', `cordis 版本范围 ${range} 无法静态确认是否兼容 ${PINNED_CORDIS}`))
    } else if (name.startsWith('@deepseek-ai/dsh')) {
      const allowed = peerAllows(range, PINNED_DSH)
      if (allowed === false) findings.push(finding('peer-dsh', 'error', `需要 ${name} ${range}，当前宿主是 DSH ${PINNED_DSH}`))
      else if (allowed === 'unknown') findings.push(finding('peer-dsh', 'warning', `${name} ${range} 无法静态确认是否兼容 DSH ${PINNED_DSH}`))
    }
  }

  const engine = manifest.engines?.node
  if (typeof engine === 'string' && /(?:<|<=)\s*22\b/.test(engine) && !/>=\s*22\b/.test(engine) && !engine.includes('24')) {
    findings.push(finding('engine-node', 'warning', `声明的 Node 引擎是 ${engine}，桌面运行时是 24`))
  }

  if (collectDeps(manifest).some((name) => NATIVE_PACKAGES.has(name))) {
    findings.push(finding('native-addon', 'warning', '依赖原生模块；安装时不编译，Windows 便携版上可能加载失败'))
  }

  const client = manifest.dsh?.client
  if (client) {
    report.hasClient = true
    if (client.platform !== undefined && client.platform !== 'web') {
      findings.push(finding('client-platform', 'error', `client.platform 是 ${String(client.platform)}，写作界面只加载 web 客户端`))
    }
    const clientRel = resolveEntryFile(manifest, `${manifest.name}/client`) || exportTarget((manifest.exports as Record<string, unknown> | undefined)?.['./client'])
    const clientPath = clientRel ? resolveInside(pkgDir, clientRel) : undefined
    if (!clientPath || !(await fileExists(clientPath))) {
      findings.push(finding('client-file', 'error', '声明了 dsh.client 但没有 ./client 产物，浏览器半侧不会出现'))
    } else {
      const source = await readFile(clientPath, 'utf8')
      if (!looksLikeClientLoader(source)) {
        findings.push(finding('client-loader', 'error', '客户端不是 DSH lazy-CJS（缺少 window.__ModuleLoader__.load），Web 运行时不会执行它'))
      }
      if (claimsRootSlot(source)) {
        findings.push(finding('client-root', 'error', '客户端试图注册 root，会与写作界面冲突，不能安装'))
      } else if (!claimsEditorSeat(source)) {
        findings.push(finding('client-slot', 'warning', `客户端没有挂到任何座位（${EDITOR_SEATS.join(' / ')}），装上后工作台里可能看不到界面`))
      }
    }
  } else if (report.entries.length > 0) {
    findings.push(finding('host-only', 'info', '这是 Host-only 插件：没有自有界面，只会在宿主进程里挂工具或服务'))
  }

  try {
    const names = await readdir(pkgDir)
    if (names.some((name) => name.endsWith('.node'))) {
      findings.push(finding('native-addon', 'warning', '包内含有 .node 原生文件，当前安装路径不会为其编译'))
    }
  } catch { /* listing is advisory */ }

  const presetScan = await inspectPluginPresets(pkgDir)
  for (const problem of presetScan.problems) findings.push(finding(problem.code, 'error', problem.message))
  if (presetScan.presets.length) {
    report.presets = presetScan.presets.map(({ id, path }) => ({ id, path }))
    findings.push(finding('presets', 'info', `提供对话 preset：${presetScan.presets.map((item) => item.id).join('、')}（重启后在新对话的模式列表中可选）`))
  }

  report.verdict = verdictOf(findings)
  return report
}
