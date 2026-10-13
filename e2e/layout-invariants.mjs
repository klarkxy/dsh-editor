/**
 * Pixel-geometry invariants for the Phase-4 workbench shell.
 *
 * Boots the pinned DSH runtime against an isolated DSH_HOME / projects root
 * (same isolated boot as e2e/core-loop.mjs), creates a real workspace with a
 * document, opens it, then sweeps the viewport through 1440 / 1024 / 760 /
 * 390 in light theme and asserts the layout geometry the spec promises:
 * full-height frame, 44px topbar, paper reaching the viewport bottom,
 * docked rails matching viewport − topbar, one rendered tabpanel per
 * tablist, composer anchored to the bottom of its container, a usable
 * CodeMirror surface, the assistant launcher inside the paper quadrant, and
 * no horizontal overflow.
 *
 * This is the permanent gate for Phase 4; run it on any shell change:
 *   node e2e/layout-invariants.mjs
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
import { S } from './helpers/selectors.mjs'
import { toggleTheme } from './helpers/theme.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'layout-invariants-projects')
const home = resolve(devRoot, 'layout-invariants-home')
const output = resolve(root, 'e2e', 'out', 'layout-invariants')
const targetWorkspace = resolve(projectsRoot, 'layout-inv')

for (const target of [projectsRoot, home, output]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.2.0-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime-0.2.0-rc.2')
const cli = resolve(runtime, 'lib', 'bin.js')

const failures = []
const report = { viewports: [], failures }
let browser
let dshChild

function note(label, detail = '') {
  console.log(`[layout-invariants] ${label}${detail ? ` — ${detail}` : ''}`)
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((r) => child.once('exit', () => r(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((r) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => r()); killer.once('exit', () => r())
    })
  }
}

async function exists(target) { return stat(target).then(() => true, () => false) }

async function waitFor(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(120)
  }
  throw new Error(`timed out: ${label}`)
}

async function startDsh(env) {
  const logs = []
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const ready = new Promise((res, rej) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      void writeFile(output + '/host.log', logs.join('')).catch(() => undefined)
      buffer += text
      const m = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (m) res(new URL(m[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', rej)
    child.once('exit', (code) => rej(new Error(`DSH exited (${code}): ${logs.join('').slice(-4_000)}`)))
  })
  const url = await Promise.race([ready, delay(60_000).then(() => { throw new Error(`DSH readiness timeout: ${logs.join('').slice(-4_000)}`) })])
  return { child, url }
}

async function dismissNativeOnboarding(page) {
  const cont = page.getByRole('button', { name: '继续', exact: true })
  for (let i = 0; i < 6; i += 1) {
    if (!(await cont.isVisible({ timeout: 800 }).catch(() => false))) break
    await cont.click(); await page.waitForTimeout(220)
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible({ timeout: 2_000 }).catch(() => false)) await later.click()
}

function makePng() {
  // Tiny valid PNG used only to exercise the official resource preview.
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPA4Y5c+ZwwgAAdiEFhWkR5bIAAAAASUVORK5CYII=', 'base64')
}

function seedWorkspace() {
  return Promise.all([
    mkdir(resolve(targetWorkspace, '正文'), { recursive: true }),
    mkdir(resolve(targetWorkspace, '资料'), { recursive: true }),
    writeFile(resolve(targetWorkspace, '正文', '第一章.md'),
      '# 第一章 青石镇的雨\n\n' + '雨落了一整夜。\n'.repeat(200), 'utf8'),
    writeFile(resolve(targetWorkspace, '资料', 'map.png'), makePng()),
    writeFile(resolve(targetWorkspace, '大纲.md'), '# 全书大纲\n\n- 第一章：雨日归家\n', 'utf8'),
  ])
}

// ---------------------------------------------------------- geometry probe
async function measure(page) {
  return page.evaluate((SEL) => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left }
    }
    const visible = (r) => Boolean(r && r.w > 0.5 && r.h > 0.5)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const shell = document.querySelector(SEL.shellLayout)
    const topbar = document.querySelector(SEL.topbar)
    const paperCell = document.querySelector('.editor-cell')
    const dockedSlots = [...document.querySelectorAll(`${SEL.filesPane}, ${SEL.auxPane}`)]
      .map((el) => ({ testid: el.getAttribute('data-testid'), rect: rect(el) }))
      .filter((item) => visible(item.rect))
    const tabRoots = [...document.querySelectorAll(`${SEL.shellFrame} .dsh-tabs, ${SEL.dshDrawer} .dsh-tabs`)]
      .map((root) => {
        const rootRect = rect(root)
        if (!visible(rootRect)) return null
        const panels = [...root.querySelectorAll('[role="tabpanel"]')]
          .filter((panel) => panel.closest('.dsh-tabs') === root)
          .map((panel) => ({
            state: panel.getAttribute('data-state'),
            rect: rect(panel),
            rendered: visible(rect(panel)),
          }))
        return { rect: rootRect, panels }
      })
      .filter(Boolean)
    const composerEl = [...document.querySelectorAll(SEL.composer)].find((el) => visible(rect(el)))
    const composer = composerEl ? {
      rect: rect(composerEl),
      /* Prefer the real chrome container over the adopted pane: an
         unstretched .dsh-pane would mask a floating composer (C35). */
      container: rect(composerEl.closest(SEL.dshDrawer) ?? composerEl.closest('.dsh-aux-rail') ?? composerEl.closest('.dsh-pane')),
      inDrawer: Boolean(composerEl.closest(SEL.dshDrawer)),
      thread: rect(composerEl.closest('.chat')?.querySelector('.chat-history')),
    } : null
    const cm = rect(document.querySelector('.cm-content'))
    const launcher = rect(document.querySelector(SEL.launcher))
    const paperInput = document.querySelector('.paper-input')
    const footer = rect(document.querySelector('.editor-tools'))
    const topbarOverflow = topbar
      ? [...topbar.querySelectorAll('*')].some((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)
        })
      : false
    return {
      vw, vh,
      shell: rect(shell),
      topbar: rect(topbar),
      paper: rect(paperCell),
      dockedSlots,
      tabRoots,
      composer,
      cm,
      launcher,
      footer,
      rulesHidden: paperInput ? paperInput.hasAttribute('data-rules-hidden') : null,
      topbarOverflow,
      scrollWidth: document.documentElement.scrollWidth,
      scrollLeft: document.documentElement.scrollLeft || document.body?.scrollLeft || 0,
    }
  }, { shellLayout: S.shellLayout, topbar: S.topbar, filesPane: S.filesPane, auxPane: S.auxPane, shellFrame: '[data-testid="dsh-shell-frame"]', dshDrawer: S.dshDrawer, composer: S.composer, launcher: S.launcher })
}

function assertProbe(label, m) {
  const fail = (msg) => failures.push(`${label}: ${msg}`)
  const approx = (a, b, tol = 1) => Math.abs(a - b) <= tol

  if (!m.shell) return fail('workbench root (.shell.layout-shell) not rendered')
  if (!approx(m.shell.h, m.vh)) fail(`workbench root height ${m.shell.h.toFixed(1)} != viewport ${m.vh}`)
  if (!approx(m.shell.top, 0)) fail(`workbench root top ${m.shell.top.toFixed(1)} != 0`)
  if (!m.topbar) fail('topbar missing')
  else if (!approx(m.topbar.h, 44)) fail(`topbar height ${m.topbar.h.toFixed(1)} != 44`)
  if (!m.paper) fail('paper column missing')
  else if (!approx(m.paper.bottom, m.vh)) fail(`paper bottom ${m.paper.bottom.toFixed(1)} != viewport bottom ${m.vh}`)

  for (const slot of m.dockedSlots) {
    if (!approx(slot.rect.h, m.vh - 44)) {
      fail(`docked ${slot.testid} height ${slot.rect.h.toFixed(1)} != viewport-44 ${(m.vh - 44).toFixed(0)}`)
    }
    if (!approx(slot.rect.top, 44)) {
      fail(`docked ${slot.testid} top ${slot.rect.top.toFixed(1)} != 44`)
    }
  }

  for (const [index, tabs] of m.tabRoots.entries()) {
    const rendered = tabs.panels.filter((p) => p.rendered)
    if (rendered.length !== 1) {
      fail(`tablist #${index} shows ${rendered.length} tabpanels (${tabs.panels.map((p) => p.state).join(',')}), expected exactly 1`)
    }
    for (const panel of tabs.panels) {
      if (panel.state === 'inactive' && panel.rendered) {
        fail(`tablist #${index} inactive tabpanel has a rendered box ${panel.rect.w}x${panel.rect.h}`)
      }
    }
  }

  if (m.composer) {
    const anchorLimit = m.composer.inDrawer ? 12 : 24
    if (m.composer.container && Math.abs(m.composer.container.bottom - m.composer.rect.bottom) > anchorLimit) {
      fail(`composer bottom ${m.composer.rect.bottom.toFixed(1)} not within ${anchorLimit}px of container bottom ${m.composer.container.bottom.toFixed(1)}`)
    }
    if (m.composer.thread && !(m.composer.rect.top > m.composer.thread.top)) {
      fail(`composer top ${m.composer.rect.top.toFixed(1)} not below thread top ${m.composer.thread.top.toFixed(1)}`)
    }
  }

  if (!m.cm || m.cm.h <= 200) fail(`cm-content height ${m.cm ? m.cm.h.toFixed(1) : 'absent'} <= 200`)
  if (!m.cm || m.cm.w <= 0) fail('cm-content not rendered')

  if (m.launcher && m.paper) {
    const cx = m.launcher.left + m.launcher.w / 2
    const cy = m.launcher.top + m.launcher.h / 2
    const inside = m.launcher.right <= m.paper.right + 1 && m.launcher.bottom <= m.paper.bottom + 1
      && m.launcher.left >= m.paper.left - 1 && m.launcher.top >= m.paper.top - 1
    if (!inside) fail(`launcher ${JSON.stringify(m.launcher)} not inside paper column ${JSON.stringify(m.paper)}`)
    if (!(cx > (m.paper.left + m.paper.right) / 2 && cy > (m.paper.top + m.paper.bottom) / 2)) {
      fail(`launcher centre (${cx.toFixed(0)},${cy.toFixed(0)}) not in paper bottom-right quadrant`)
    }
    if (m.topbar && m.launcher.top < m.topbar.bottom - 0.5) {
      fail(`launcher top ${m.launcher.top.toFixed(1)} intersects topbar bottom ${m.topbar.bottom.toFixed(1)}`)
    }
    if (m.footer
      && m.launcher.left < m.footer.right - 0.5 && m.launcher.right > m.footer.left + 0.5
      && m.launcher.top < m.footer.bottom - 0.5 && m.launcher.bottom > m.footer.top + 0.5) {
      fail(`launcher ${JSON.stringify(m.launcher)} intersects paper footer ${JSON.stringify(m.footer)}`)
    }
  }

  // §4 版心线:有页边距的宽度画出两根线;390 贴边时两根都隐藏。
  if (m.rulesHidden !== null) {
    if (m.vw >= 760 && m.rulesHidden) fail(`margin rules hidden at ${m.vw}px (gap should be >= 32px)`)
    if (m.vw < 760 && !m.rulesHidden) fail(`margin rules drawn at ${m.vw}px but content gap is < 32px`)
  }

  if (m.topbarOverflow) fail('topbar element overflows viewport horizontally')
  if (m.scrollWidth > m.vw + 1) fail(`horizontal page scroll: scrollWidth ${m.scrollWidth} > ${m.vw}`)
}

// ---------------------------------------------------------------- run
await rm(projectsRoot, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-layout-invariants',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY

const profileRoot = await deployProfile(home, template, resolve(runtime, 'node_modules'))
const templateComposition = JSON.parse(await readFile(resolve(template, 'composition.json'), 'utf-8'))
const { configureProfile } = await import('../scripts/desktop-compositions.mjs')
const { syncPresetDeclarations } = await import('../apps/desktop/dist/preset-config.js')
await configureProfile(profileRoot, {
  ...templateComposition,
  disabledEntries: templateComposition.disabledEntries.filter((id) => id !== 'editor-memory-panel'),
  enabledEntries: ['editor-memory-panel'],
})
await syncPresetDeclarations(home, profileRoot)

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 760, height: 900 },
  { width: 390, height: 844 },
]

try {
  const started = await startDsh(env)
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`) })

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    ({ SHELL }) => document.title === 'DSH Editor' && Boolean(document.querySelector(SHELL)),
    { SHELL: S.shell }, { timeout: 60_000 },
  )
  await dismissNativeOnboarding(page)

  // ---- home (§6)：无作品空态下四档宽度都无横向溢出；钩子唯一 ------------------
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp)
    await page.waitForTimeout(600)
    const label = `home ${vp.width}x${vp.height}`
    const probe = await page.evaluate((sel) => {
      const stage = document.querySelectorAll(sel.homeStage).length
      const recent = document.querySelectorAll(sel.homeRecent).length
      const scroller = document.scrollingElement
      return {
        stage, recent,
        docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        bodyOverflow: scroller ? scroller.scrollWidth > window.innerWidth + 1 : false,
      }
    }, { homeStage: S.homeStage, homeRecent: S.homeRecent })
    if (probe.stage !== 1) fail(`${label}: .home-stage matched ${probe.stage} elements (hook must be unique)`)
    if (probe.recent !== 1) fail(`${label}: .home-recent matched ${probe.recent} elements`)
    if (probe.docOverflow || probe.bodyOverflow) fail(`${label}: home overflows horizontally`)
    report.viewports.push({ label, metrics: { home: probe } })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)

  // Create the work through the real dialog, seed a manuscript, reopen it.
  await page.getByRole('button', { name: '新建作品' }).first().click()
  const newProject = page.getByRole('dialog', { name: '新建作品' })
  await newProject.waitFor({ state: 'visible' })
  await newProject.getByLabel('作品名称').fill('layout-inv')
  await newProject.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(async () => exists(targetWorkspace), 'workspace directory created')
  await seedWorkspace()

  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  // ---- home 目录式行：题名（楷体）+ 点线 + 右对齐信息，第二行时间/章节分列 ----
  const rowProbe = await page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(`${sel.homeRecent} ${sel.homeRow}`)]
    const row = rows[0]
    if (!row) return { rows: 0 }
    const title = row.querySelector(sel.homeRowTitle)
    const leader = row.querySelector(sel.homeRowLeader)
    const info = row.querySelector(sel.homeRowInfo)
    const metas = [...row.querySelectorAll(sel.homeRowMeta)]
    const box = leader?.getBoundingClientRect()
    return {
      rows: rows.length,
      titleFont: title ? getComputedStyle(title).fontFamily : '',
      leaderVisible: Boolean(box && box.width > 0 && getComputedStyle(leader).display !== 'none'),
      infoText: info?.textContent ?? '',
      metaCount: metas.length,
    }
  }, { homeRecent: S.homeRecent, homeRow: S.homeRow, homeRowTitle: S.homeRowTitle, homeRowLeader: S.homeRowLeader, homeRowInfo: S.homeRowInfo, homeRowMeta: S.homeRowMeta })
  if (rowProbe.rows < 1) fail('home recents: no .dsh-home-row after returning home')
  else {
    if (!rowProbe.titleFont.toLowerCase().includes('kai')) fail(`home row title not display font: ${rowProbe.titleFont}`)
    if (!rowProbe.leaderVisible) fail('home row dot leader not rendered at 1440')
    if (rowProbe.metaCount < 1) fail('home row second line has no meta spans')
  }
  await page.locator(S.homeRecent).getByRole('button', { name: /layout-inv/ }).first().click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })

  // Open 第一章 (expand 正文 if collapsed).
  const chapter = page.locator('[data-tree-path="正文/第一章.md"]')
  if (!(await chapter.isVisible().catch(() => false))) {
    await page.locator('[data-tree-path="正文"]').first().click()
    await page.waitForTimeout(500)
  }
  await chapter.click()
  await page.locator('.cm-content').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(800)

  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp)
    await page.waitForTimeout(900)
    const label = `${vp.width}x${vp.height}`
    const m = await measure(page)
    report.viewports.push({ label, metrics: m })
    assertProbe(label, m)
    await page.screenshot({ path: resolve(output, `probe-${vp.width}.png`) })
    note(label, `shell=${m.shell?.h.toFixed(0)} topbar=${m.topbar?.h.toFixed(0)} paper-bottom=${m.paper?.bottom.toFixed(0)} docked=${m.dockedSlots.length} tabs=${m.tabRoots.length} cm=${m.cm ? m.cm.h.toFixed(0) : '-'} launcher=${m.launcher ? 'yes' : 'no'}`)
  }

  // ---- C40 editor identity: theme + font-size changes must not remount
  // the CodeMirror view (same __cmView instance and same .cm-editor node).
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(700)
  const editorLoc = page.locator(S.paperEditor)
  const captureCm = () => editorLoc.evaluate((el) => {
    window.__cmViewProbe = el.__cmView
    window.__cmDomProbe = el.querySelector('.cm-editor')
    return Boolean(el.__cmView && el.querySelector('.cm-editor'))
  })
  const verifyCm = (label) => editorLoc.evaluate((el, lbl) => {
    const sameView = el.__cmView === window.__cmViewProbe
    const sameDom = el.querySelector('.cm-editor') === window.__cmDomProbe
    return { label: lbl, sameView, sameDom }
  }, label).then((r) => {
    if (!r.sameView) failures.push(`identity/${r.label}: CodeMirror view object was remounted`)
    if (!r.sameDom) failures.push(`identity/${r.label}: .cm-editor DOM node was replaced`)
    return r
  })
  if (await captureCm()) {
    const beforeTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await toggleTheme(page)
    await page.waitForFunction((prev) => document.documentElement.getAttribute('data-theme') !== prev, beforeTheme, { timeout: 10_000 })
    const r1 = await verifyCm('theme')
    note('identity', `theme toggle: sameView=${r1.sameView} sameDom=${r1.sameDom}`)
    // font-size change via the 写作 settings slider
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settingsNav = page.locator(S.settingsNav)
    await settingsNav.getByRole('tab', { name: '写作', exact: true }).click()
    const fontSlider = page.locator(S.fontSizeSlider)
    const oldSize = await fontSlider.getAttribute('aria-valuenow')
    await fontSlider.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(({ old, sel }) => document.querySelector(sel)?.getAttribute('aria-valuenow') !== old,
      { old: oldSize, sel: S.fontSizeSlider })
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    const r2 = await verifyCm('font-size')
    note('identity', `font-size change: sameView=${r2.sameView} sameDom=${r2.sameDom}`)
    report.identity = { theme: r1, fontSize: r2 }
  } else {
    failures.push('identity: __cmView or .cm-editor not found on paper editor')
  }

  // ---- §4 margin rules: every .cm-line lies strictly between the two
  // rule x positions with >= 8px clearance. Rules are measured off the
  // .cm-content content box; check at 1440 and 1024 and (where the
  // 写作 scope Select cooperates) across narrow / medium / wide.
  const marginRuleCheck = async (label) => {
    const m = await page.evaluate(() => {
      const paper = document.querySelector('.paper-input')
      if (!paper) return null
      const rect = paper.getBoundingClientRect()
      const leftRule = parseFloat(getComputedStyle(paper).getPropertyValue('--paper-rule-left'))
      const rightRule = parseFloat(getComputedStyle(paper).getPropertyValue('--paper-rule-right'))
      const ruleL = rect.left + leftRule
      const ruleR = rect.left + rightRule
      const lines = [...paper.querySelectorAll('.cm-line')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ left: r.left, right: r.right }))
      return { ruleL, ruleR, lines }
    })
    if (!m) return failures.push(`margin-rules/${label}: .paper-input missing`)
    if (!Number.isFinite(m.ruleL) || !Number.isFinite(m.ruleR)) {
      return failures.push(`margin-rules/${label}: --paper-rule-left/right not measured`)
    }
    if (!(m.ruleR - m.ruleL > 40)) failures.push(`margin-rules/${label}: rules only ${(m.ruleR - m.ruleL).toFixed(0)}px apart`)
    for (const [index, line] of m.lines.entries()) {
      if (line.left - m.ruleL < 8) {
        failures.push(`margin-rules/${label}: .cm-line #${index} left ${line.left.toFixed(1)} is only ${(line.left - m.ruleL).toFixed(1)}px right of left rule ${m.ruleL.toFixed(1)}`)
      }
      if (m.ruleR - line.right < 8) {
        failures.push(`margin-rules/${label}: .cm-line #${index} right ${line.right.toFixed(1)} is only ${(m.ruleR - line.right).toFixed(1)}px left of right rule ${m.ruleR.toFixed(1)}`)
      }
    }
    note('margin-rules', `${label}: ${m.lines.length} lines between ${m.ruleL.toFixed(0)} and ${m.ruleR.toFixed(0)}`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(900)
  await marginRuleCheck('1440/medium')

  // paperWidth variants through the real 写作 settings Select.
  const setPaperWidth = async (label, optionText) => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const nav = page.locator(S.settingsNav)
    await nav.getByRole('tab', { name: '写作', exact: true }).click()
    await page.locator(S.combobox('稿纸宽度')).click()
    await page.getByRole('option', { name: optionText, exact: true }).click()
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.waitForTimeout(900)
    await marginRuleCheck(`1440/${label}`)
  }
  await setPaperWidth('narrow', '窄栏')
  await setPaperWidth('wide', '通栏')
  await setPaperWidth('medium', '中栏')

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(900)
  await marginRuleCheck('1024/medium')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(700)

  // ---- rightbar regression: clicking a resource must open the official
  // preview in the aux 资料 tab (slot stays mounted), with no error notice.
  const mapRow = page.locator('[data-tree-path="资料/map.png"]')
  if (!(await mapRow.isVisible().catch(() => false))) {
    await page.locator('[data-tree-path="资料"]').first().click()
    await page.waitForTimeout(500)
  }
  await page.locator('[data-tree-path="资料/map.png"]').click()
  await waitFor(async () => {
    const preview = await page.locator(`${S.referencePanel} ${S.officialResourcePanelVisible}`).evaluate(
      (el) => el.getBoundingClientRect().width > 0 && el.children.length > 0,
    ).catch(() => false)
    return preview
  }, 'official resource preview mounted in 资料 tab', 15_000)
  const alerts = await page.locator(`${S.filesRail} [role="alert"]`).count()
  if (alerts > 0) failures.push(`rightbar preview: ${alerts} alert(s) in files rail after opening map.png`)

  // Containment: the preview must live INSIDE the aux 资料 panel — inside
  // the aux rail box, below the tab strip, never intersecting the paper.
  const contain = await page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom }
    }
    const intersects = (a, b) => Boolean(a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5)
    const panel = document.querySelector('[data-sidebar-right-panel]')
    const aux = document.querySelector('.dsh-pane--aux')
    const strip = document.querySelector('.dsh-aux-rail__tabs')
    const cm = document.querySelector('.cm-content')
    const media = panel ? [...panel.querySelectorAll('img,canvas')].find((el) => el.getBoundingClientRect().width > 0) : null
    return {
      panel: rect(panel),
      aux: rect(aux),
      strip: rect(strip),
      stripVisible: Boolean(strip && strip.getBoundingClientRect().height > 0),
      hitsStrip: intersects(rect(panel), rect(strip)),
      hitsCm: intersects(rect(panel), rect(cm)),
      media: rect(media),
    }
  })
  if (!contain.panel || !contain.aux) failures.push('rightbar contain: panel or aux rail not rendered')
  else {
    if (contain.panel.left < contain.aux.left - 1 || contain.panel.right > contain.aux.right + 1
      || contain.panel.top < contain.aux.top - 1 || contain.panel.bottom > contain.aux.bottom + 1) {
      failures.push(`rightbar contain: preview ${JSON.stringify(contain.panel)} escapes aux rail ${JSON.stringify(contain.aux)}`)
    }
    if (!contain.stripVisible) failures.push('rightbar contain: aux tab strip not visible')
    if (contain.hitsStrip) failures.push('rightbar contain: preview intersects the aux tab strip')
    if (contain.hitsCm) failures.push('rightbar contain: preview intersects .cm-content (covers the paper)')
    if (!contain.media) failures.push('rightbar contain: no rendered img/canvas inside preview')
  }
  note('rightbar', `map.png preview mounted in 资料 tab, no alerts, contained=${JSON.stringify(contain.panel)}`)

  // ---- §5 partner rail: suggestion fill/focus/no-send + C17 draft guard ----
  // The aux rail is open on 资料 after the preview probe; switch to 搭档.
  await page.getByRole('tab', { name: '搭档', exact: true }).click()
  await page.locator(S.chatRail).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(600)

  const suggest = page.locator(`${S.chatRail} .dsh-partner__suggest`)
  const suggestCount = await suggest.count()
  if (suggestCount !== 3) failures.push(`partner-empty: expected 3 suggestions, found ${suggestCount}`)
  const nodesBefore = await page.locator(S.chatRail).getAttribute('data-chat-nodes')
  const titleBefore = await page.locator(`${S.chatRail} .dsh-partner__title-text`).innerText().catch(() => '')
  if (suggestCount > 0) {
    const wanted = (await suggest.first().innerText()).trim()
    await suggest.first().click()
    await page.waitForTimeout(400)
    const composerEl = page.locator(S.composerInputInner).first()
    const filled = await composerEl.inputValue().catch(() => '')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    if (filled !== wanted) failures.push(`partner-empty: suggestion click filled '${filled}' != '${wanted}'`)
    if (focused !== '输入消息') failures.push(`partner-empty: suggestion click did not focus composer (active=${focused})`)
    const nodesAfter = await page.locator(S.chatRail).getAttribute('data-chat-nodes')
    if (nodesAfter !== nodesBefore) failures.push('partner-empty: suggestion click sent a message (transcript changed)')
    const userRows = await page.locator(`${S.chatRail} .chat-row.user`).count()
    if (userRows !== 0) failures.push('partner-empty: suggestion click produced a user row (sent)')
  }

  // §5 send affordance: filled draft → enabled filled-accent button.
  const sendState = await page.evaluate(() => {
    const btn = document.querySelector('aside.chat .composer-actions .send')
    if (!btn) return null
    /* 探针必须挂在 token 作用域内（html[data-dsh-ui] 下的 .radix-themes/
       [data-dsh-theme] 子树）；挂 document.body 上 var() 无法解析，会得到
       transparent，和坏按钮的透明背景"相等"造成空断言。 */
    const scope = document.querySelector('.radix-themes, [data-dsh-theme]') ?? document.documentElement
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--dsh-ui-accent)'
    probe.style.display = 'none'
    scope.appendChild(probe)
    const accent = getComputedStyle(probe).backgroundColor
    probe.remove()
    const glyph = getComputedStyle(btn).color
    return { disabled: btn.disabled, bg: getComputedStyle(btn).backgroundColor, accent, glyph }
  })
  const WHITEISH = /rgba?\(25[0-9],\s*25[0-9],\s*25[0-9]/
  const TRANSPARENT = 'rgba(0, 0, 0, 0)'
  if (!sendState) failures.push('partner-send: .send button missing')
  else {
    if (sendState.disabled) failures.push('partner-send: disabled while a filled draft is submittable')
    if (sendState.accent === TRANSPARENT) failures.push('partner-send: --dsh-ui-accent probe did not resolve (scoped to body?)')
    if (sendState.bg !== sendState.accent) failures.push(`partner-send: bg ${sendState.bg} != accent ${sendState.accent}`)
    if (sendState.bg === TRANSPARENT || WHITEISH.test(sendState.bg)) failures.push(`partner-send: enabled bg is transparent/white (${sendState.bg})`)
  }

  // C17: with a draft, 新对话 must prompt; cancel keeps place and draft.
  const newChat = page.locator(`${S.chatRail} button.dsh-split__main`)
  await newChat.click()
  const draftDialog = page.locator('#discard-message-draft, [role="alertdialog"]:has-text("放弃")')
  if (await draftDialog.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.waitForTimeout(400)
    const keptDraft = await page.locator(S.composerInputInner).first().inputValue().catch(() => '')
    const titleAfter = await page.locator(`${S.chatRail} .dsh-partner__title-text`).innerText().catch(() => '')
    if (!keptDraft.trim()) failures.push('C17: draft lost after cancelling the leave confirm')
    if (titleAfter !== titleBefore) failures.push(`C17: conversation switched despite cancel ('${titleBefore}' -> '${titleAfter}')`)
    note('partner', `C17 cancel keeps draft (${keptDraft.length} chars) on '${titleAfter}'`)
    // Clear the draft again for downstream steps.
    await page.locator(S.composerInputInner).first().fill('').catch(() => undefined)
    await page.waitForTimeout(300)
    const sendAfterClear = await page.evaluate(() => document.querySelector('aside.chat .composer-actions .send')?.disabled)
    if (sendAfterClear !== true) failures.push('partner-send: should be disabled once the composer is empty')
  } else {
    failures.push('C17: leaving with a draft did not show the discard-draft confirm')
  }

  // §4 margin rules: both 版心竖线 must draw in the same margin-rule colour
  // (a stray grey/different element over the right rule once showed up).
  const ruleColors = await page.evaluate(() => {
    const paper = document.querySelector('.paper-input')
    if (!paper) return null
    return {
      left: getComputedStyle(paper, '::before').backgroundColor,
      right: getComputedStyle(paper, '::after').backgroundColor,
    }
  })
  if (!ruleColors) failures.push('margin-rules/color: .paper-input missing')
  else if (ruleColors.left !== ruleColors.right) {
    failures.push(`margin-rules/color: left rule ${ruleColors.left} != right rule ${ruleColors.right}`)
  } else {
    note('margin-rules/color', `both rules ${ruleColors.left}`)
  }

  // ---- §5 composer toolbar stays one row at 1440 (rail still open). ----
  {
    const t = await page.evaluate(() => {
      const toolbar = document.querySelector('aside.chat .composer-toolbar')
      const send = document.querySelector('aside.chat .composer-actions .send')
      if (!toolbar || !send) return null
      const ts = toolbar.getBoundingClientRect()
      /* 单行判定：所有可见子项共享同一条横向带（align=center 下不同高度
         的子项 top 本来就不同，不能比 top）。换行时新行子项的 top 会
         越过其他子项的 bottom。 */
      const kids = [...toolbar.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      return {
        wrap: kids.length > 1 && Math.max(...kids.map((k) => k.top)) >= Math.min(...kids.map((k) => k.bottom)) - 1,
        rightGap: ts.right - send.getBoundingClientRect().right,
      }
    })
    if (!t) failures.push('toolbar/1440: composer toolbar missing')
    else {
      if (t.wrap) failures.push('toolbar/1440: composer toolbar wrapped to a second row')
      if (Math.abs(t.rightGap) > 2) failures.push(`toolbar/1440: send right edge ${t.rightGap.toFixed(1)}px off toolbar right`)
    }
  }

  // ---- Partner Drawer at 760 / 390: C35 anchor (empty state), one-row
  // toolbar, tab strip as the top row with the close button at its end,
  // accessible name kept, no horizontal overflow. The long-thread variant
  // is covered by the fixture shots (.dev/redesign/shoot-p44.mjs). ----
  const describeActive = () => page.evaluate(() => {
    const el = document.activeElement
    return el ? `${el.tagName}.${el.className?.toString().slice(0, 40) || ''}${el.dataset?.testid ? '#' + el.dataset.testid : ''}` : 'none'
  })
  const openPartnerDrawer = async () => {
    for (let i = 0; i < 8; i += 1) {
      /* 宽度换档瞬间会闪挂一帧抽屉：要「稳定」可见才算开。 */
      if (await page.locator(S.dshDrawer).isVisible().catch(() => false)) {
        await page.waitForTimeout(1_400)
        if (await page.locator(S.dshDrawer).isVisible().catch(() => false)
          && await page.locator(`${S.dshDrawer} ${S.chatRail}`).isVisible().catch(() => false)) return 'already'
      }
      const launcher = page.locator(S.launcher)
      const target = (await launcher.isVisible().catch(() => false)) ? launcher : page.locator(S.auxToggle)
      await target.click().catch(() => undefined)
      await page.locator(S.dshDrawer).waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined)
    }
    return (await page.locator(S.dshDrawer).isVisible().catch(() => false)) ? 'clicked' : null
  }
  const drawerProbe = async (label) => {
    const d = await page.evaluate(() => {
      const drawer = document.querySelector('.dsh-drawer')
      if (!drawer) return null
      const chat = drawer.querySelector('aside.chat')
      const composer = chat?.querySelector(':scope > .composer')
      const toolbar = chat?.querySelector('.composer-toolbar')
      const send = chat?.querySelector('.composer-actions .send')
      const strip = drawer.querySelector('.dsh-aux-rail__tabs')
      const header = drawer.querySelector('.dsh-drawer__header')
      const close = drawer.querySelector('.dsh-drawer__close')
      const dr = drawer.getBoundingClientRect()
      const stripRect = strip?.getBoundingClientRect()
      const closeRect = close?.getBoundingClientRect()
      return {
        drawerBottom: dr.bottom, drawerRight: dr.right, innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        composerBottom: composer ? composer.getBoundingClientRect().bottom : null,
        toolbarWrap: toolbar
          ? (() => {
              const kids = [...toolbar.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
              return kids.length > 1 && Math.max(...kids.map((k) => k.top)) >= Math.min(...kids.map((k) => k.bottom)) - 1
            })()
          : null,
        sendRightGap: toolbar && send ? toolbar.getBoundingClientRect().right - send.getBoundingClientRect().right : null,
        stripTop: stripRect ? stripRect.top - dr.top : null,
        closeInStrip: Boolean(stripRect && closeRect
          && closeRect.top >= stripRect.top - 1 && closeRect.bottom <= stripRect.bottom + 1
          && closeRect.right <= dr.right + 1),
        headerVisible: Boolean(header && header.getBoundingClientRect().height > 0),
        named: Boolean(drawer.getAttribute('aria-label') || drawer.getAttribute('aria-labelledby')),
      }
    })
    if (!d) return failures.push(`drawer/${label}: .dsh-drawer not mounted`)
    if (d.composerBottom == null) failures.push(`drawer/${label}: composer not rendered`)
    else if (Math.abs(d.drawerBottom - d.composerBottom) > 12) {
      failures.push(`drawer/${label}: composer bottom ${d.composerBottom.toFixed(1)} not within space-3 of drawer bottom ${d.drawerBottom.toFixed(1)} (C35)`)
    }
    if (d.toolbarWrap) failures.push(`drawer/${label}: composer toolbar wrapped to a second row`)
    if (d.sendRightGap == null) failures.push(`drawer/${label}: send button missing`)
    else if (Math.abs(d.sendRightGap) > 2) failures.push(`drawer/${label}: send right edge ${d.sendRightGap.toFixed(1)}px off toolbar right`)
    if (d.scrollWidth > d.innerWidth) failures.push(`drawer/${label}: scrollWidth ${d.scrollWidth} > innerWidth ${d.innerWidth}`)
    if (d.drawerRight > d.innerWidth + 1) failures.push(`drawer/${label}: drawer right ${d.drawerRight.toFixed(1)} > innerWidth ${d.innerWidth}`)
    if (d.headerVisible) failures.push(`drawer/${label}: visible .dsh-drawer__header still rendered`)
    if (d.stripTop == null || d.stripTop > 4) failures.push(`drawer/${label}: tab strip is not the drawer top row (offset ${d.stripTop})`)
    if (!d.closeInStrip) failures.push(`drawer/${label}: close button not on the tab-strip row`)
    if (!d.named) failures.push(`drawer/${label}: dialog has no accessible name`)
  }
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.waitForTimeout(1_000)
    /* 换档时 aux.open 可能让抽屉自动挂载——那时焦点捕到的不是触发控件。
       先确保关干净，再由「搭档」launcher 点开，焦点返回才有确定目标。 */
    if (await page.locator(S.dshDrawer).isVisible().catch(() => false)) {
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(800)
    }
    const openHow = await openPartnerDrawer()
    if (openHow) {
      note(`drawer/${width}`, `open=${openHow} activeAfterOpen=${await describeActive()}`)
      await drawerProbe(String(width))
      /* Escape 仍要关闭并把焦点还给触发它的控件。 */
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(700)
      if (await page.locator(S.dshDrawer).isVisible().catch(() => false)) {
        failures.push(`drawer/${width}: Escape did not close the drawer`)
      }
      const focusBack = await page.evaluate(() => {
        const el = document.activeElement
        return el?.closest?.('[data-testid="dsh-shell-launcher"], [data-testid="dsh-shell-aux-toggle"]') ? 'control' : (el?.tagName ?? 'none')
      })
      if (focusBack !== 'control') failures.push(`drawer/${width}: focus returned to ${await describeActive()}, not the launcher/toggle (open=${openHow})`)
    } else {
      failures.push(`drawer/${width}: partner drawer did not open`)
    }
  }
} catch (error) {
  failures.push(`fatal: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await browser?.close().catch(() => undefined)
  await stop(dshChild)
}

await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

if (failures.length) {
  console.error(`[layout-invariants] ${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
note(`all invariants hold across ${VIEWPORTS.length} viewports`)
