/**
 * Delivery matrix for the two independent plugins.
 *
 * Uses the real DSH `web` template under a fresh DSH_HOME, installs only the
 * current tarballs, exercises both removal directions, boots every material
 * state, and leaves a report under e2e/out/plugin-matrix.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'e2e', 'out', 'plugin-matrix')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-matrix-'))
const dshHome = path.join(runRoot, 'home')
const staging = path.join(runRoot, 'packages')
const profile = 'web'
const basePort = Number(process.env.E2E_MATRIX_PORT || 8790)
const dshInstallation = resolveDshInstallation()
const dshBin = dshInstallation.cliPath
const report = {
  dshHome: '<temporary>',
  profile,
  dsh: {
    version: dshInstallation.version,
    source: dshInstallation.source,
  },
  states: [],
  transitions: [],
  issues: [],
}

function assertSafeOutput(target) {
  const relative = path.relative(path.join(root, 'e2e', 'out'), path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to reset non-output path: ${target}`)
  }
}

function resetOutput() {
  assertSafeOutput(out)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  fs.mkdirSync(staging, { recursive: true })
}

function childEnv(extra = {}) {
  return {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    ...extra,
  }
}

function manifestFor(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'))
}

function stageTarball(name) {
  const manifest = manifestFor(name)
  const source = path.join(root, '.pack', `${name}-${manifest.version}.tgz`)
  if (!fs.existsSync(source)) throw new Error(`missing current tarball: ${source}`)
  const target = path.join(staging, path.basename(source))
  fs.copyFileSync(source, target)
  return target.replaceAll('\\', '/')
}

function runDsh(args, options = {}) {
  const result = spawnSync(process.execPath, [dshBin, ...args], {
    cwd: root,
    env: childEnv(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`dsh ${args.join(' ')} failed (${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`)
  }
  return result
}

function transition(kind, name, spec) {
  const args = ['plugin', '--profile', profile, kind, spec || name]
  const result = runDsh(args)
  report.transitions.push({ kind, name, ok: true, stderr: String(result.stderr || '').trim().split(/\r?\n/).slice(-4) })
}

function readProfileManifest() {
  return JSON.parse(fs.readFileSync(path.join(dshHome, 'profiles', profile, 'package.json'), 'utf8'))
}

function hasEntry(config, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?id:\\s*["']?${escaped}["']?\\s*(?:$|\\n)`, 'm').test(config)
}

function assertEqualSet(actual, expected, label) {
  const left = [...actual].sort()
  const right = [...expected].sort()
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${label}: expected ${right.join(', ') || '<none>'}; got ${left.join(', ') || '<none>'}`)
  }
}

function inspectState(name, expectedPlugins) {
  const manifest = readProfileManifest()
  const dependencies = Object.keys(manifest.dependencies || {}).filter((item) => item.startsWith('dsh-'))
  const bundles = manifest.dsh?.profile?.bundles || []
  const pluginBundles = bundles.filter((item) => item === 'dsh-manuscript' || item === 'dsh-grill')
  assertEqualSet(dependencies, expectedPlugins, `${name} dependencies`)
  assertEqualSet(pluginBundles, expectedPlugins, `${name} bundles`)

  const config = runDsh(['--profile', profile, '--dump-config']).stdout
  const expectedEntries = {
    manuscript: expectedPlugins.includes('dsh-manuscript'),
    'grill-tools': expectedPlugins.includes('dsh-grill'),
    'grill-workflow': expectedPlugins.includes('dsh-grill'),
  }
  for (const [id, expected] of Object.entries(expectedEntries)) {
    const actual = hasEntry(config, id)
    if (actual !== expected) throw new Error(`${name} config entry ${id}: expected ${expected}, got ${actual}`)
  }

  const snapshot = { name, dependencies, bundles, entries: expectedEntries }
  report.states.push(snapshot)
  fs.writeFileSync(path.join(out, `${name}.manifest.json`), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(path.join(out, `${name}.config.yml`), config, 'utf8')
  return snapshot
}

async function waitReady(port, child) {
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`DSH exited ${child.exitCode} before ${base} became ready`)
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return base
    } catch {
      // Keep polling until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`DSH did not become ready at ${base}`)
}

async function stopTree(child) {
  if (!child?.pid || child.exitCode != null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))])
  if (child.exitCode == null && process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10_000,
    })
  }
  child.stdout?.destroy()
  child.stderr?.destroy()
}

async function probeWeb(browser, name, expectedPlugins, index) {
  const workspace = path.join(out, 'workspaces', name)
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, '交付验证.md'), '# 交付验证\n', 'utf8')
  const port = basePort + index
  const stdout = []
  const stderr = []
  const child = spawn(
    process.execPath,
    [dshBin, '--profile', profile, '--no-open', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: workspace,
      env: childEnv({ SSH_CONNECTION: 'dsh-editor-matrix' }),
      stdio: 'pipe',
      windowsHide: true,
    },
  )
  child.stdout?.on('data', (chunk) => stdout.push(String(chunk)))
  child.stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  const pageErrors = []
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    const base = await waitReady(port, child)
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_000)
    await page.waitForFunction(() => document.body !== null && document.body.children.length > 0)
    const onboardingContinue = page.getByRole('button', { name: '继续', exact: true })
    for (let step = 0; step < 5 && await onboardingContinue.isVisible({ timeout: 1_000 }).catch(() => false); step += 1) {
      await onboardingContinue.click()
      await page.waitForTimeout(500)
    }
    const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
    if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await configureLater.click()
      await page.waitForTimeout(500)
    }
    const overlay = page.getByTestId('manuscript-overlay')
    const expectsManuscript = expectedPlugins.includes('dsh-manuscript')
    if (expectsManuscript) {
      await overlay.waitFor({ state: 'visible', timeout: 15_000 })
      if ((await overlay.getAttribute('data-state')) !== 'closed') throw new Error(`${name}: manuscript drawer did not start closed`)
      const openButton = page.getByTestId('manuscript-open')
      await openButton.waitFor({ state: 'visible', timeout: 5_000 })
      await openButton.click({ timeout: 5_000 })
      await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-overlay"]')?.getAttribute('data-state') === 'open')
    } else {
      await page.waitForTimeout(3_000)
      if (await overlay.count()) throw new Error(`${name}: manuscript UI remained after removal`)
    }
    if (pageErrors.length) throw new Error(`${name}: browser errors: ${pageErrors.join(' | ')}`)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    report.states.find((item) => item.name === name).web = {
      ready: true,
      manuscriptOverlay: expectsManuscript,
      pageErrors,
    }
  } catch (error) {
    await page.screenshot({ path: path.join(out, `${name}.failure.png`) }).catch(() => {})
    const html = await page.content().catch(() => '')
    fs.writeFileSync(path.join(out, `${name}.failure.html`), html, 'utf8')
    throw error
  } finally {
    await page.close().catch(() => {})
    await stopTree(child)
    fs.writeFileSync(path.join(out, `${name}.stdout.log`), stdout.join(''), 'utf8')
    fs.writeFileSync(path.join(out, `${name}.stderr.log`), stderr.join(''), 'utf8')
  }
}

function safeCleanup() {
  const base = path.resolve(os.tmpdir())
  const target = path.resolve(runRoot)
  const relative = path.relative(base, target)
  if (!path.basename(target).startsWith('dsh-editor-matrix-') || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to clean unexpected matrix temp path: ${target}`)
  }
  fs.rmSync(target, { recursive: true, force: true })
}

resetOutput()
const manuscriptTarball = stageTarball('dsh-manuscript')
const grillTarball = stageTarball('dsh-grill')
const browser = await chromium.launch({ headless: true })

try {
  transition('add', 'dsh-manuscript', `file:${manuscriptTarball}`)
  inspectState('01-manuscript-only', ['dsh-manuscript'])
  await probeWeb(browser, '01-manuscript-only', ['dsh-manuscript'], 0)

  transition('add', 'dsh-grill', `file:${grillTarball}`)
  inspectState('02-both', ['dsh-manuscript', 'dsh-grill'])
  await probeWeb(browser, '02-both', ['dsh-manuscript', 'dsh-grill'], 1)

  transition('remove', 'dsh-manuscript')
  inspectState('03-grill-only-after-remove-manuscript', ['dsh-grill'])
  await probeWeb(browser, '03-grill-only-after-remove-manuscript', ['dsh-grill'], 2)

  transition('add', 'dsh-manuscript', `file:${manuscriptTarball}`)
  inspectState('04-both-restored', ['dsh-manuscript', 'dsh-grill'])

  transition('remove', 'dsh-grill')
  inspectState('05-manuscript-only-after-remove-grill', ['dsh-manuscript'])
  await probeWeb(browser, '05-manuscript-only-after-remove-grill', ['dsh-manuscript'], 3)
} catch (error) {
  report.issues.push(error instanceof Error ? error.stack || error.message : String(error))
} finally {
  await browser.close().catch(() => {})
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  safeCleanup()
}

console.log(`matrix report ${path.relative(root, path.join(out, 'report.json'))}`)
console.log(`states ${report.states.length}`)
console.log(`transitions ${report.transitions.length}`)
console.log(`issues ${report.issues.length}`)
if (report.issues.length) process.exitCode = 1
