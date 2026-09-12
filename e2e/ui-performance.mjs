/**
 * Isolated UI-overhaul performance harness.
 *
 * Compares frozen baseline vs current profile clients: gzip of wrapped
 * client.js, DSH process-ready vs browser-to-shell load, and observed
 * input→next-paint latency on a ~100k Chinese manuscript.
 *
 * Fixtures: `.dev/ui-performance-*`. Output: `e2e/out/ui-performance`.
 * Never mutates the immutable baseline copy or the shared current template.
 * Never calls an external model. Does not build or sync profiles.
 *
 * Input method: Playwright browser keystrokes, then capture the `input`
 * event timestamp and wait two `requestAnimationFrame` callbacks
 * (`browser-input-then-2raf`). Not synthetic CodeMirror dispatch.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const output = resolve(root, 'e2e', 'out', 'ui-performance')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
const packagesRoot = resolve(root, 'packages')

const immutableBaseline = resolve(devRoot, 'ui-overhaul-01a08f87', 'baseline', 'desktop-profile-template')
const sharedCurrentTemplate = resolve(devRoot, 'desktop-profile-template')
const baselineTemplate = resolve(devRoot, 'ui-performance-before-profile-template')
const currentTemplate = resolve(devRoot, 'ui-performance-profile-template')

const SAMPLE_COUNT = 3
const KEYSTROKE_COUNT = 40
const TYPED = 'thequickbrownfoxjumpsoverthelazydog1abcd'
const TARGET_CHARS = 100_000
const INPUT_METHOD = 'browser-input-then-2raf'
const EVIDENCE_CLASSES = {
  'preliminary-harness-validation': 'Unset or E2E_UI_PERF_EVIDENCE_CLASS=preliminary-harness-validation: M1-candidate harness validation, not a final M2/M3 integrated-build result.',
  'final-integrated': 'E2E_UI_PERF_EVIDENCE_CLASS=final-integrated: primary rerun against the final integrated build.',
}

const CLIENT_PACKAGES = [
  { id: 'shell', name: 'dsh-editor-shell', public: false },
  { id: 'manuscript', name: 'dsh-manuscript', public: true },
  { id: 'proofread', name: 'dsh-proofread', public: true },
  { id: 'zhihu', name: 'dsh-zhihu', public: true },
]

const clients = {
  baseline: {
    id: 'baseline',
    template: baselineTemplate,
    sourceTemplate: immutableBaseline,
    home: resolve(devRoot, 'ui-performance-before-home'),
    workspace: resolve(devRoot, 'ui-performance-before-workspace'),
    projects: resolve(devRoot, 'ui-performance-before-projects'),
  },
  current: {
    id: 'current',
    template: currentTemplate,
    sourceTemplate: sharedCurrentTemplate,
    home: resolve(devRoot, 'ui-performance-home'),
    workspace: resolve(devRoot, 'ui-performance-workspace'),
    projects: resolve(devRoot, 'ui-performance-projects'),
  },
}

const owned = [
  output,
  baselineTemplate,
  currentTemplate,
  ...Object.values(clients).flatMap((item) => [item.home, item.workspace, item.projects]),
]
const forbidden = [immutableBaseline, sharedCurrentTemplate, runtime]

const startedAt = new Date().toISOString()
const failures = []
const notes = []

function note(label, detail = '') {
  notes.push({ label, detail, at: new Date().toISOString() })
  console.log(`[ui-performance] ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(message) {
  failures.push(message)
  console.error(`[ui-performance] ${message}`)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function rel(target) {
  return target.startsWith(`${root}${sep}`) ? target.slice(root.length + 1) : target
}

function assertOwned(target) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
  for (const locked of forbidden) {
    if (target === locked || target.startsWith(`${locked}${sep}`)) {
      throw new Error(`refusing to mutate immutable path: ${target}`)
    }
  }
}

async function guardedRm(target) {
  assertOwned(target)
  await rm(target, { recursive: true, force: true })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return { count: 0, min: null, max: null, median: null, range: null }
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median, range: sorted[sorted.length - 1] - sorted[0] }
}

function ratio(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return null
  return Number((current / baseline).toFixed(4))
}

function git(args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) return null
  return result.stdout.trim()
}

function liveRequireIds(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  const ids = new Set()
  const pattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of stripped.matchAll(pattern)) ids.add(match[1])
  return [...ids].sort()
}

function inspectWrapper(source) {
  const requires = liveRequireIds(source)
  const reactRequires = requires.filter((id) => id === 'react' || id.startsWith('react/'))
  const uiRequireCandidates = requires.filter((id) => (
    id.startsWith('@radix-ui/')
    || id === 'cmdk'
    || id === 'motion'
    || id.startsWith('motion/')
    || id === 'framer-motion'
  ))
  const nodeShims = requires.filter((id) => ['buffer', 'stream', 'util', 'events'].includes(id))
  const fingerprints = {
    reactProductionBanner: source.includes('react.production.min.js'),
    reactDomProductionBanner: source.includes('react-dom.production.min.js'),
    secretInternals: source.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'),
  }
  return {
    requires,
    reactRequires,
    uiRequireCandidates,
    nodeShims,
    fingerprints,
    proof: 'string-scan-of-wrapped-factory-only',
    note: 'Require IDs and React fingerprints are inspection notes, not a module-graph proof of duplicate React or unresolved imports.',
  }
}

async function pathKind(target) {
  const info = await lstat(target)
  return {
    path: rel(target),
    symbolicLink: info.isSymbolicLink(),
    file: info.isFile(),
    directory: info.isDirectory(),
  }
}

async function assertNotWorkspaceLink(target, label) {
  const kind = await pathKind(target)
  if (kind.symbolicLink) throw new Error(`${label} is a symlink/junction: ${target}`)
  const resolved = await realpath(target)
  if (resolved === packagesRoot || resolved.startsWith(`${packagesRoot}${sep}`)) {
    throw new Error(`${label} resolved into workspace packages/: ${resolved}`)
  }
  if (target.startsWith(`${baselineTemplate}${sep}`) || target === baselineTemplate) {
    if (resolved === sharedCurrentTemplate || resolved.startsWith(`${sharedCurrentTemplate}${sep}`)) {
      throw new Error(`${label} resolved into the current shared template: ${resolved}`)
    }
  }
  return { ...kind, realpath: rel(resolved) }
}

function clientJsPath(template, name) {
  return resolve(template, 'node_modules', name, 'lib', 'client.js')
}

async function measureClientFile(template, pkg) {
  const file = clientJsPath(template, pkg.name)
  const bytes = await readFile(file)
  return {
    id: pkg.id,
    name: pkg.name,
    public: pkg.public,
    file: rel(file),
    wrappedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
    sha256: sha256(bytes),
    inspection: inspectWrapper(bytes.toString('utf8')),
  }
}

async function snapshotTemplate(source, destination, label) {
  if (!existsSync(source)) throw new Error(`${label} source template missing: ${source}`)
  await guardedRm(destination)
  await cp(source, destination, { recursive: true, dereference: false })
  const packages = []
  for (const pkg of CLIENT_PACKAGES) {
    const sourceFile = clientJsPath(source, pkg.name)
    const destFile = clientJsPath(destination, pkg.name)
    await assertNotWorkspaceLink(resolve(destination, 'node_modules', pkg.name), `${label} ${pkg.name}`)
    await assertNotWorkspaceLink(destFile, `${label} ${pkg.name} client.js`)
    const sourceBytes = await readFile(sourceFile)
    const destBytes = await readFile(destFile)
    const sourceHash = sha256(sourceBytes)
    const destHash = sha256(destBytes)
    if (sourceHash !== destHash) {
      throw new Error(`${label} ${pkg.name} copy hash mismatch (source ${sourceHash} dest ${destHash})`)
    }
    packages.push({ name: pkg.name, sha256: destHash, wrappedBytes: destBytes.byteLength })
  }
  note(`copied ${label} template`, rel(destination))
  return packages
}

function makeManuscript() {
  const header = '# 长稿性能测试\n\n'
  const unit = '雾比灯先到，把码头的广播塔切成一段一段的影子。潮水拍岸，像有人在远处数着心跳。'
  const parts = [header]
  let count = [...header].length
  while (count < TARGET_CHARS) {
    parts.push(unit, '\n')
    count += [...unit].length + 1
  }
  return [...parts.join('')].slice(0, TARGET_CHARS).join('')
}

async function seedWorkspace(workspace, manuscript) {
  await guardedRm(workspace)
  await mkdir(resolve(workspace, '正文'), { recursive: true })
  await writeFile(resolve(workspace, '正文', '001.md'), manuscript, 'utf8')
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolveKill())
      killer.once('exit', () => resolveKill())
    })
  }
}

function envFor(client) {
  const env = {
    ...process.env,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_DESKTOP_NODE_PATH: process.execPath,
    DSH_DESKTOP_CLI_PATH: cli,
    DSH_DESKTOP_PROFILE_TEMPLATE: client.template,
    DSH_HOME: client.home,
    DSH_EDITOR_PROJECTS_ROOT: client.projects,
    DSH_DESKTOP_USER_DATA_DIR: resolve(client.home, 'electron-user-data'),
    SSH_CONNECTION: process.env.SSH_CONNECTION || `dsh-editor-ui-performance-${client.id}`,
    DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
  }
  delete env.DSH_EDITOR_CUSTOM_API_KEY
  return env
}

async function startDsh(env) {
  const logs = []
  const spawnedAt = Date.now()
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolveReady, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolveReady(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('').slice(-4_000)}`)))
  })
  const url = await Promise.race([
    ready,
    delay(60_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('').slice(-4_000)}`) }),
  ])
  return { child, url, processReadyMs: Date.now() - spawnedAt, logs }
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    const visible = await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!visible) break
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await configureLater.click()
  }
}

async function openSeededWorkspace(page, workspace) {
  const pathInput = page.locator('.path-fallback input')
  if (!(await pathInput.isVisible().catch(() => false))) {
    const card = page.locator('.home-stage .home-actions button.home-entry-card').first()
    if (await card.count()) await card.click()
    else fail('home open-work control (.home-entry-card) missing')
  }
  await pathInput.waitFor({ state: 'visible', timeout: 10_000 })
  await pathInput.fill(workspace)
  await page.locator('.path-fallback button[type="submit"]').click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
}

async function openLongManuscript(page, expectedChars) {
  const manuscript = page.locator('.tree .tree-row', { has: page.getByText('正文', { exact: true }) }).first()
  await manuscript.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await manuscript.getAttribute('aria-expanded')) !== 'true') await manuscript.click()
  await page.locator('.tree .tree-row', { hasText: '001.md' }).first().click()
  await page.locator('[data-testid="paper-editor"] .cm-content').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction((count) => {
    const el = document.querySelector('[data-testid="paper-editor"]')
    const view = el && /** @type {any} */ (el).__cmView
    return Boolean(view && view.state.doc.length >= count)
  }, expectedChars, { timeout: 60_000 })
}

async function measureInput(page, manuscript, typed) {
  const expectedDoc = `${manuscript}${typed}`
  const content = page.locator('[data-testid="paper-editor"] .cm-content')
  await content.click()
  await page.keyboard.press('Control+End')
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="paper-editor"]')
    const cmContent = host?.querySelector('.cm-content')
    if (!host || !cmContent) throw new Error('paper editor content missing')
    const state = {
      method: 'browser-input-then-2raf',
      samples: [],
      animationStarts: 0,
      editor: host,
      cmEditor: host.querySelector('.cm-editor'),
      cmContent,
    }
    cmContent.addEventListener('input', () => {
      const start = performance.now()
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          state.samples.push({ inputToPaintMs: performance.now() - start })
        })
      })
    }, true)
    host.addEventListener('animationstart', () => {
      state.animationStarts += 1
    }, true)
    globalThis.__dshUiPerf = state
  })

  for (let index = 0; index < typed.length; index += 1) {
    const expected = index + 1
    await page.keyboard.type(typed[index], { delay: 0 })
    await page.waitForFunction((count) => globalThis.__dshUiPerf?.samples?.length >= count, expected, { timeout: 5_000 })
  }

  return page.evaluate((expectedDoc) => {
    const state = globalThis.__dshUiPerf
    const host = document.querySelector('[data-testid="paper-editor"]')
    const view = host && /** @type {any} */ (host).__cmView
    const doc = view ? view.state.doc.toString() : ''
    let firstDiff = -1
    const limit = Math.max(doc.length, expectedDoc.length)
    for (let index = 0; index < limit; index += 1) {
      if (doc[index] !== expectedDoc[index]) {
        firstDiff = index
        break
      }
    }
    return {
      method: state?.method || null,
      samples: state?.samples || [],
      animationStarts: state?.animationStarts ?? null,
      sameEditor: host === state?.editor,
      sameCmEditor: host?.querySelector('.cm-editor') === state?.cmEditor,
      sameCmContent: host?.querySelector('.cm-content') === state?.cmContent,
      docLength: doc.length,
      expectedLength: expectedDoc.length,
      docEqualsExpected: doc === expectedDoc,
      firstDiff,
    }
  }, expectedDoc)
}

async function prepareFreshSample(client, manuscript) {
  await guardedRm(client.home)
  await guardedRm(client.projects)
  await seedWorkspace(client.workspace, manuscript)
  await mkdir(resolve(client.home, 'electron-user-data'), { recursive: true })
  const deployStarted = Date.now()
  await deployProfile(client.home, client.template, resolve(runtime, 'node_modules'))
  return Date.now() - deployStarted
}

async function runSample(client, sampleIndex, manuscript) {
  let browser
  let dshChild
  const sample = { index: sampleIndex, ok: false }
  try {
    sample.deployMs = await prepareFreshSample(client, manuscript)
    const started = await startDsh(envFor(client))
    dshChild = started.child
    sample.processReadyMs = started.processReadyMs

    const launchStarted = Date.now()
    browser = await chromium.launch({ headless: true })
    sample.chromiumLaunchMs = Date.now() - launchStarted
    sample.chromiumVersion = browser.version()

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15_000)
    page.on('pageerror', (error) => fail(`${client.id}#${sampleIndex} pageerror: ${error.message}`))

    const navigationStarted = Date.now()
    await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')),
      undefined,
      { timeout: 45_000 },
    )
    sample.browserLoadToShellMs = Date.now() - navigationStarted

    await dismissNativeOnboarding(page)
    await dismissNativeOnboarding(page)
    if (!(await page.locator('.shell').isVisible())) fail(`${client.id}#${sampleIndex}: shell not visible after load`)

    await openSeededWorkspace(page, client.workspace)
    await openLongManuscript(page, manuscript.length)
    const measured = await measureInput(page, manuscript, TYPED)
    const expectedLength = manuscript.length + TYPED.length
    sample.input = {
      method: measured.method,
      keystrokes: TYPED.length,
      latencyMs: stats(measured.samples.map((item) => item.inputToPaintMs)),
      samples: measured.samples,
      animationStarts: measured.animationStarts,
      sameEditor: measured.sameEditor,
      sameCmEditor: measured.sameCmEditor,
      sameCmContent: measured.sameCmContent,
      docLength: measured.docLength,
      expectedLength,
      docEqualsExpected: measured.docEqualsExpected,
      firstDiff: measured.firstDiff,
    }

    if (measured.method !== INPUT_METHOD) fail(`${client.id}#${sampleIndex}: input method ${measured.method}`)
    if (measured.samples.length !== TYPED.length) fail(`${client.id}#${sampleIndex}: expected ${TYPED.length} input samples, got ${measured.samples.length}`)
    if (measured.docLength !== expectedLength || measured.expectedLength !== expectedLength || !measured.docEqualsExpected) {
      fail(`${client.id}#${sampleIndex}: document !== original manuscript + typed suffix (length ${measured.docLength} vs ${expectedLength}, firstDiff=${measured.firstDiff})`)
    }
    if (!measured.sameEditor || !measured.sameCmEditor || !measured.sameCmContent) {
      fail(`${client.id}#${sampleIndex}: editor DOM was replaced during typing`)
    }
    if (measured.animationStarts > 0) fail(`${client.id}#${sampleIndex}: editor animation restarted ${measured.animationStarts} time(s) during typing`)
    sample.ok = failures.filter((item) => item.startsWith(`${client.id}#${sampleIndex}`)).length === 0
  } catch (error) {
    sample.error = error instanceof Error ? error.stack || error.message : String(error)
    fail(`${client.id}#${sampleIndex}: ${sample.error}`)
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    if (dshChild) await stop(dshChild)
  }
  return sample
}

if (TYPED.length !== KEYSTROKE_COUNT) throw new Error(`TYPED length ${TYPED.length} != ${KEYSTROKE_COUNT}`)
if (!/^[A-Za-z0-9]+$/.test(TYPED)) throw new Error('TYPED must be Latin browser keys (A-Za-z0-9)')
for (const target of owned) assertOwned(target)
if (TYPED.length !== 40) throw new Error('keystroke count drifted')

const rawEvidenceClass = (process.env.E2E_UI_PERF_EVIDENCE_CLASS || '').trim()
const evidenceClass = rawEvidenceClass || 'preliminary-harness-validation'
if (!Object.hasOwn(EVIDENCE_CLASSES, evidenceClass)) {
  throw new Error(`E2E_UI_PERF_EVIDENCE_CLASS must be preliminary-harness-validation or final-integrated, got ${JSON.stringify(rawEvidenceClass)}`)
}
const evidenceClassProvenance = EVIDENCE_CLASSES[evidenceClass]

resolveDshInstallation('0.1.5-rc.2')
if (!existsSync(cli)) throw new Error(`DSH runtime CLI missing: ${cli}`)

const baselineRevision = existsSync(resolve(devRoot, 'ui-overhaul-01a08f87', 'baseline', 'revision.txt'))
  ? (await readFile(resolve(devRoot, 'ui-overhaul-01a08f87', 'baseline', 'revision.txt'), 'utf8')).trim()
  : null

await guardedRm(output)
await mkdir(output, { recursive: true })

note('snapshot templates', 'copy baseline and current into dedicated fixtures; never write the immutable baseline')
const copiedBaseline = await snapshotTemplate(immutableBaseline, baselineTemplate, 'baseline')
const copiedCurrent = await snapshotTemplate(sharedCurrentTemplate, currentTemplate, 'current')
for (const pkg of CLIENT_PACKAGES) {
  const baselineHash = copiedBaseline.find((item) => item.name === pkg.name)?.sha256
  const currentHash = copiedCurrent.find((item) => item.name === pkg.name)?.sha256
  const liveBaseline = sha256(await readFile(clientJsPath(immutableBaseline, pkg.name)))
  if (baselineHash !== liveBaseline) fail(`baseline copy for ${pkg.name} does not match immutable source`)
  if (baselineHash === currentHash && liveBaseline !== sha256(await readFile(clientJsPath(sharedCurrentTemplate, pkg.name)))) {
    fail(`${pkg.name}: baseline copy silently matches a different current artifact`)
  }
}

const bundles = {
  baseline: [],
  current: [],
}
for (const pkg of CLIENT_PACKAGES) {
  bundles.baseline.push(await measureClientFile(baselineTemplate, pkg))
  bundles.current.push(await measureClientFile(currentTemplate, pkg))
}

const manuscript = makeManuscript()
const manuscriptChars = [...manuscript].length
if (manuscriptChars !== TARGET_CHARS) fail(`manuscript char count ${manuscriptChars}, expected ${TARGET_CHARS}`)

const runs = {}
for (const client of Object.values(clients)) {
  const samples = []
  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    note(`${client.id} sample ${index}/${SAMPLE_COUNT}`, 'fresh home/workspace/deploy; frozen templates reused')
    samples.push(await runSample(client, index, manuscript))
  }
  runs[client.id] = { samples }
}

function collect(clientId, field) {
  return (runs[clientId]?.samples || []).map((sample) => sample[field]).filter((value) => Number.isFinite(value))
}

function collectInputMedians(clientId) {
  return (runs[clientId]?.samples || []).map((sample) => sample.input?.latencyMs?.median).filter((value) => Number.isFinite(value))
}

function collectInputAll(clientId) {
  return (runs[clientId]?.samples || []).flatMap((sample) => (sample.input?.samples || []).map((item) => item.inputToPaintMs))
}

const deploy = { baseline: stats(collect('baseline', 'deployMs')), current: stats(collect('current', 'deployMs')) }
const processReady = { baseline: stats(collect('baseline', 'processReadyMs')), current: stats(collect('current', 'processReadyMs')) }
const browserLoad = { baseline: stats(collect('baseline', 'browserLoadToShellMs')), current: stats(collect('current', 'browserLoadToShellMs')) }
const inputSession = { baseline: stats(collectInputMedians('baseline')), current: stats(collectInputMedians('current')) }
const inputPooled = { baseline: stats(collectInputAll('baseline')), current: stats(collectInputAll('current')) }

const bundleRows = CLIENT_PACKAGES.map((pkg) => {
  const baseline = bundles.baseline.find((item) => item.name === pkg.name)
  const current = bundles.current.find((item) => item.name === pkg.name)
  return {
    id: pkg.id,
    name: pkg.name,
    public: pkg.public,
    baseline: { wrappedBytes: baseline.wrappedBytes, gzipBytes: baseline.gzipBytes, sha256: baseline.sha256 },
    current: { wrappedBytes: current.wrappedBytes, gzipBytes: current.gzipBytes, sha256: current.sha256 },
    ratios: {
      wrapped: ratio(current.wrappedBytes, baseline.wrappedBytes),
      gzip: ratio(current.gzipBytes, baseline.gzipBytes),
    },
  }
})

const report = {
  ok: failures.length === 0,
  failures,
  notes,
  startedAt,
  finishedAt: new Date().toISOString(),
  versions: {
    node: process.versions.node,
    dsh: '0.1.5-rc.2',
    electronPinned: '37.2.6',
    playwright: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).devDependencies?.playwright || null,
    gitHead: git(['rev-parse', 'HEAD']),
    gitDirty: Boolean(git(['status', '--porcelain', '--untracked-files=normal'])),
    baselineRevision,
    workspaceHeadExpected: 'd298584d6216595bb5405abcaed25d963fab1b2f',
  },
  methodology: {
    input: INPUT_METHOD,
    inputDetail: 'Playwright keyboard.type of 40 Latin keystrokes into focused [data-testid=paper-editor] .cm-content; each input event starts performance.now(), then two rAF callbacks mark next painted frame. Caret moved with Control+End. Document text is read from __cmView only after typing, not used to inject characters. Correctness requires the full document to equal the original 100k manuscript plus the typed suffix, at that exact length.',
    startup: 'Each sample resets home, workspace, and deployed profile (frozen templates reused). deployMs is that reset+deploy and is excluded from process/browser clocks. processReadyMs is spawn→DSH URL in logs. chromiumLaunchMs is independent. browserLoadToShellMs is page.goto→title DSH Editor and .shell.',
    samples: SAMPLE_COUNT,
    keystrokes: KEYSTROKE_COUNT,
    manuscriptChars,
    gzip: 'zlib.gzipSync default (matches prior wrapped/gzip evidence: shell 2786896/651454).',
    selectors: 'Structural/testid: .shell, .home-stage, .home-entry-card, .path-fallback, .tree, [data-testid=paper-editor], .cm-content. Fixture folder 正文/001.md. Native DSH onboarding still uses host button names.',
    noTimingPassFail: true,
    wrapperInspection: 'Live require("…") IDs after comment strip; UI/React notes are not module-graph proof.',
    evidenceClass,
    evidenceClassProvenance,
  },
  limitations: [
    evidenceClassProvenance,
    'Headless Playwright Chromium against DSH web, not the Electron desktop wrapper.',
    'Latin keystrokes, not IME composition.',
    'Two rAF is a paint-adjacent proxy, not a traced vsync/compositor timestamp.',
    'Wrapper inspection cannot prove duplicate React from string matches alone.',
    'Timing ratios are evidence only; this harness does not fail on latency or gzip thresholds.',
    'Does not build, profile-sync, or call external models. Assumes existing desktop-dsh-runtime and profile templates.',
  ],
  fixtures: {
    immutableBaseline: rel(immutableBaseline),
    sharedCurrentTemplate: rel(sharedCurrentTemplate),
    baselineTemplate: rel(baselineTemplate),
    currentTemplate: rel(currentTemplate),
    output: rel(output),
  },
  bundles: bundleRows,
  wrapperInspection: {
    baseline: Object.fromEntries(bundles.baseline.map((item) => [item.id, item.inspection])),
    current: Object.fromEntries(bundles.current.map((item) => [item.id, item.inspection])),
  },
  startup: {
    deployMs: { ...deploy, ratio: ratio(deploy.current.median, deploy.baseline.median) },
    processReadyMs: { ...processReady, ratio: ratio(processReady.current.median, processReady.baseline.median) },
    browserLoadToShellMs: { ...browserLoad, ratio: ratio(browserLoad.current.median, browserLoad.baseline.median) },
  },
  input: {
    method: INPUT_METHOD,
    sessionMediansMs: { ...inputSession, ratio: ratio(inputSession.current.median, inputSession.baseline.median) },
    pooledKeystrokesMs: { ...inputPooled, ratio: ratio(inputPooled.current.median, inputPooled.baseline.median) },
  },
  runs,
}

await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  ok: report.ok,
  failures: report.failures,
  evidenceClass,
  evidenceClassProvenance,
  bundles: bundleRows,
  startup: report.startup,
  input: {
    method: report.input.method,
    sessionMediansMs: report.input.sessionMediansMs,
    pooledKeystrokesMs: report.input.pooledKeystrokesMs,
  },
}, null, 2))
if (!report.ok) process.exitCode = 1
