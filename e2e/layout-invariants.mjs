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
      container: rect(composerEl.closest('.dsh-aux-rail, .dsh-drawer, .dsh-pane')),
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
    if (m.composer.container && Math.abs(m.composer.container.bottom - m.composer.rect.bottom) > 24) {
      fail(`composer bottom ${m.composer.rect.bottom.toFixed(1)} not within 24px of container bottom ${m.composer.container.bottom.toFixed(1)}`)
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

  // Create the work through the real dialog, seed a manuscript, reopen it.
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
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
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--dsh-ui-brand)'
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const accent = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { disabled: btn.disabled, bg: getComputedStyle(btn).backgroundColor, accent }
  })
  if (!sendState) failures.push('partner-send: .send button missing')
  else {
    if (sendState.disabled) failures.push('partner-send: disabled while a filled draft is submittable')
    if (sendState.bg !== sendState.accent) failures.push(`partner-send: bg ${sendState.bg} != accent ${sendState.accent}`)
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
