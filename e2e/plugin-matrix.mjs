/**
 * Delivery matrix for the three public business plugins.
 *
 * Uses the real DSH `web` template under a fresh DSH_HOME, installs only the
 * current tarballs, exercises both removal directions, boots every material
 * state, and leaves a report under e2e/out/plugin-matrix.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
import { loadPluginManifests, publicPackages } from '../scripts/plugin-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginManifests = loadPluginManifests(root)
const publicPluginPackages = publicPackages(pluginManifests)
const out = path.join(root, 'e2e', 'out', 'plugin-matrix')
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-matrix-'))
const dshHome = path.join(runRoot, 'home')
const staging = path.join(runRoot, 'packages')
const profile = 'web'
const configuredBasePort = process.env.E2E_MATRIX_PORT ? Number(process.env.E2E_MATRIX_PORT) : undefined
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
  const pluginBundles = bundles.filter((item) => publicPluginPackages.includes(item))
  assertEqualSet(dependencies, expectedPlugins, `${name} dependencies`)
  assertEqualSet(pluginBundles, expectedPlugins, `${name} bundles`)

  const config = runDsh(['--profile', profile, '--dump-config']).stdout
  const expectedEntries = {}
  for (const manifest of pluginManifests.filter((item) => publicPluginPackages.includes(item.name))) {
    const included = expectedPlugins.includes(manifest.name)
    for (const entry of manifest.entries) expectedEntries[entry.id] = included
    for (const insert of manifest.inserts) expectedEntries[insert.id] = false
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

function parseReadyUrl(buffer, port) {
  const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
  if (!match) return undefined
  const url = new URL(match[0])
  return Number(url.port) === port ? url : undefined
}

async function waitReady(port, child, stdout) {
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`DSH exited ${child.exitCode} before ${base} became ready`)
    const ready = parseReadyUrl(stdout.join(''), port)
    if (ready) {
      try {
        const response = await fetch(ready, { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
        // 0.1.5 exchanges ?token= for a cookie via 303; older hosts served `/` as 200.
        if (response.status === 303 || response.ok) return ready
      } catch {
        // Keep polling until the bounded deadline.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`DSH did not become ready at ${base}`)
}

async function freeLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
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

function contrastRatio(fg, bg) {
  const channel = (value) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const lum = (rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
  const a = lum(fg)
  const b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

async function sampleColors(locator) {
  return locator.evaluate((el) => {
    const parse = (value) => {
      const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
    }
    let node = el
    let background = getComputedStyle(node).backgroundColor
    while (node && background === 'rgba(0, 0, 0, 0)') {
      node = node.parentElement
      if (!node) break
      background = getComputedStyle(node).backgroundColor
    }
    const color = getComputedStyle(el).color
    return { color, background, fg: parse(color), bg: parse(background) }
  })
}

function assertThemeSample(sample, label, expectDark) {
  if (!sample?.fg || !sample?.bg) throw new Error(`${label}: missing computed colors ${JSON.stringify(sample)}`)
  const ratio = contrastRatio(sample.fg, sample.bg)
  if (ratio < 3) throw new Error(`${label}: contrast ${ratio.toFixed(2)} < 3 (${sample.color} on ${sample.background})`)
  const textIsLight = sample.fg[0] + sample.fg[1] + sample.fg[2] > 360
  if (expectDark && !textIsLight) throw new Error(`${label}: expected light text on ordinary DSH dark, got ${sample.color}`)
  if (!expectDark && textIsLight) throw new Error(`${label}: expected dark text on ordinary DSH light, got ${sample.color}`)
}

async function waitHostDarkAttr(page, expectDark, label) {
  // Installed ui-theme default is `system`; ThemePresenter writes body[data-ds-dark-theme].
  try {
    await page.waitForFunction(
      (dark) => document.body.hasAttribute('data-ds-dark-theme') === dark,
      expectDark,
      { timeout: 8_000 },
    )
  } catch {
    const actual = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
    throw new Error(`${label}: expected body[data-ds-dark-theme]=${expectDark}, got ${actual}`)
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
}

function assertServerResponseEnvelope(value) {
  // Installed dsh-client-connection parseConnectionResponse: type/rpcId/result only.
  const isRecord = (item) => typeof item === 'object' && item !== null && !Array.isArray(item)
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope')
  }
  const result = value.result
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result')
  if (result.ok === true) return
  if (result.ok !== false || !isRecord(result.error)) throw new TypeError('connection: invalid server-response result')
  const error = result.error
  if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
    throw new TypeError('connection: invalid server-response failure')
  }
}

async function fulfillRpc(route, result) {
  let rpcId = 'matrix'
  try {
    const posted = route.request().postDataJSON()
    if (posted && typeof posted.rpcId === 'string') rpcId = posted.rpcId
  } catch {
    // Synthetic browser stub; do not fetch the live plugin route.
  }
  const body = { type: 'server-response', rpcId, result }
  assertServerResponseEnvelope(body)
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function assertStandaloneThemes(page, name, samples) {
  const check = async (theme, expectDark) => {
    const darkAttr = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
    if (darkAttr !== expectDark) throw new Error(`${name} ${theme}: body[data-ds-dark-theme]=${darkAttr}`)
    for (const item of samples) {
      assertThemeSample(await sampleColors(item.locator), `${name} ${theme} ${item.label}`, expectDark)
    }
  }
  // emulateMedia is the OS scheme. Default preference is system, not an explicit user light write.
  await page.emulateMedia({ colorScheme: 'light' })
  await waitHostDarkAttr(page, false, `${name} system+prefers-light`)
  await check('system+prefers-light', false)
  await page.screenshot({ path: path.join(out, `${name}-light.png`) })
  await page.emulateMedia({ colorScheme: 'dark' })
  await waitHostDarkAttr(page, true, `${name} system+prefers-dark`)
  await check('system+prefers-dark', true)
  await page.screenshot({ path: path.join(out, `${name}-dark.png`) })
  await page.emulateMedia({ colorScheme: null })
  const state = report.states.find((item) => item.name === name)
  if (state) {
    state.ordinaryTheme = {
      method: 'host ui-theme default system; ThemePresenter body[data-ds-dark-theme] after prefers-color-scheme settle',
      defaultPreference: 'system',
      explicitUserLight: false,
      light: true,
      dark: true,
    }
  }
}

async function probeWeb(browser, name, expectedPlugins, index) {
  const workspace = path.join(out, 'workspaces', name)
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, '交付验证.md'), '# 交付验证\n', 'utf8')
  const port = configuredBasePort === undefined ? await freeLoopbackPort() : configuredBasePort + index
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
    const ready = await waitReady(port, child, stdout)
    const origin = ready.origin
    await page.goto(ready.href, { waitUntil: 'domcontentloaded' })
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
    if (expectsManuscript) await page.getByTestId('manuscript-close').click();
    const expectsProofread = expectedPlugins.includes('dsh-proofread');
    if (expectsProofread) {
      await page.getByTestId('proofread-open').click();
      await page.getByTestId('proofread-input').fill('我们以经做好准备。');
      await page.getByTestId('proofread-input').press('Control+Enter');
      await page.getByTestId('proofread-result').getByText('建议：已经',{exact:true}).waitFor();
      if (name === '06-proofread-only') {
        const panel = page.getByTestId('proofread-panel')
        await assertStandaloneThemes(page, name, [
          { label: 'finding-message', locator: panel.locator('.dsh-proofread-finding-message').first() },
          { label: 'result-summary', locator: panel.locator('.dsh-proofread-result-summary').first() },
          { label: 'input', locator: page.getByTestId('proofread-input') },
        ])
      }
      await page.getByTestId('proofread-input').fill('今天晴天。');
      await page.getByTestId('proofread-check').click();
      await page.getByTestId('proofread-result').waitFor();
      await page.getByTestId('proofread-input').press('Escape');
      await page.getByTestId('proofread-open').waitFor();
      if (await page.getByTestId('proofread-open').count() !== 1) throw new Error('duplicate proofread contribution');
    } else if (await page.getByTestId('proofread-open').count()) throw new Error('proofread entry survived removal');
    const expectsZhihu = expectedPlugins.includes('dsh-zhihu');
    if (expectsZhihu) {
      const callZhihu=async(method,payload)=>{const response=await page.request.post(`${origin}/zhihu/${method}`,{headers:{'content-type':'application/json'},data:{type:'client-request',rpcId:name,method,payload}});return (await response.json()).result};
      if(!report.zhihuUsageSeeded){
        // Filename validation fails before credentials/network access, but records the attempted operation.
        const rejected=await callZhihu('knowledge.upload',{fileName:'',contentBase64:'YQ=='});
        if(rejected.ok)throw new Error('invalid upload unexpectedly accepted');
        report.zhihuUsageSeeded=true;
      }
      const usage=await callZhihu('usage.summary',{days:1});
      if(!usage.ok||usage.value.days[0]?.calls!==1||usage.value.days[0]?.failures!==1)throw new Error('Zhihu usage lost or double-counted after restart/reinstall: '+JSON.stringify(usage));
      report.states.find(item=>item.name===name).zhihuUsageRetained=true;

      await page.getByTestId('zhihu-open').click();
      await page.getByTestId('zhihu-panel').waitFor();
      if (name === '12-zhihu-only') {
        await page.route('**/zhihu/search', (route) => fulfillRpc(route, {
          ok: true,
          value: { items: [{ title: '合成资料', type: '回答', url: 'https://www.zhihu.com/x', summary: '合成摘要', votes: 0, comments: 0, author: '测试', editTime: '' }] },
        }))
        try {
          const panel = page.getByTestId('zhihu-panel')
          await panel.getByTestId('zhihu-query').fill('合成查询')
          await panel.getByTestId('zhihu-search').click()
          await panel.getByTestId('zhihu-results').waitFor()
          await assertStandaloneThemes(page, name, [
            { label: 'result-title', locator: panel.locator('.zhihu-result-title').first() },
            { label: 'input', locator: panel.getByTestId('zhihu-query') },
            { label: 'results-summary', locator: panel.locator('.zhihu-results-summary').first() },
          ])
        } finally {
          await page.unroute('**/zhihu/search')
        }
      }
      await page.getByTestId('zhihu-panel').press('Escape');
      await page.getByTestId('zhihu-open').waitFor();
      if (await page.getByTestId('zhihu-open').count() !== 1) throw new Error('duplicate zhihu contribution');
    } else if (await page.getByTestId('zhihu-open').count()) throw new Error('zhihu entry survived removal');
    if (pageErrors.length) throw new Error(`${name}: browser errors: ${pageErrors.join(' | ')}`)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    report.states.find((item) => item.name === name).web = {
      ready: true,
      manuscriptOverlay: expectsManuscript,
      proofread: expectsProofread, zhihu: expectsZhihu,
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
const proofreadTarball = stageTarball('dsh-proofread')
const zhihuTarball = stageTarball('dsh-zhihu')
const browser = await chromium.launch({ headless: true })

try {
  transition('add', 'dsh-manuscript', `file:${manuscriptTarball}`)
  inspectState('01-manuscript-only', ['dsh-manuscript'])
  await probeWeb(browser, '01-manuscript-only', ['dsh-manuscript'], 0)
  transition('remove','dsh-manuscript');
  const states = [
    ['add','dsh-proofread',proofreadTarball,'06-proofread-only',['dsh-proofread']],
    ['add','dsh-zhihu',zhihuTarball,'07-proofread-then-zhihu',['dsh-proofread','dsh-zhihu']],
    ['remove','dsh-proofread',null,'08-zhihu-after-remove-proofread',['dsh-zhihu']],
    ['add','dsh-proofread',proofreadTarball,'09-zhihu-then-proofread',['dsh-proofread','dsh-zhihu']],
    ['remove','dsh-zhihu',null,'10-proofread-after-remove-zhihu',['dsh-proofread']],
    ['remove','dsh-proofread',null,'11-empty',[]],
    ['add','dsh-zhihu',zhihuTarball,'12-zhihu-only',['dsh-zhihu']],
  ];
  // Data outside package installation must survive both removal directions and restarts.
  const retained=path.join(dshHome,'storages','plugin-matrix-retained.txt');
  fs.mkdirSync(path.dirname(retained),{recursive:true});fs.writeFileSync(retained,'retained across package changes');
  for(const [kind,pkg,archive,name,expected] of states){
    transition(kind,pkg,archive ? 'file:'+archive : undefined);
    inspectState(name,expected);await probeWeb(browser,name,expected,report.states.length);
    if(fs.readFileSync(retained,'utf8')!=='retained across package changes')throw new Error('persistent data lost');
  }
  transition('add','dsh-proofread','file:'+proofreadTarball);
  transition('add','dsh-manuscript','file:'+manuscriptTarball);
  const all=['dsh-proofread','dsh-zhihu','dsh-manuscript'];
  inspectState('13-all-public',all);await probeWeb(browser,'13-all-public',all,13);

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
