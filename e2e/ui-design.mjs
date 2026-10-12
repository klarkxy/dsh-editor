import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { S } from './helpers/selectors.mjs'

async function paint(page, selector) {
  return page.locator(selector).first().evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, fg: style.color, disabled: el.matches(':disabled') }
  })
}

async function assertPrimaryButtons(page, expected) {
  await page.waitForFunction(expected => {
    const adopt = [...document.querySelectorAll('button')].find(el => el.textContent === '采用')
    return adopt && getComputedStyle(adopt).backgroundColor === expected.enabled && getComputedStyle(adopt).color === expected.enabledText
  }, expected)
  const adopt = await page.getByRole('button', { name: '采用', exact: true }).evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, fg: style.color, disabled: el.disabled }
  })
  assert.equal(adopt.disabled, false)
  assert.equal(adopt.bg, expected.enabled)
  assert.equal(adopt.fg, expected.enabledText)
  const held = await page.getByRole('button', { name: '暂不采用', exact: true }).evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, fg: style.color, disabled: el.disabled }
  })
  assert.equal(held.disabled, true)
  assert.equal(held.bg, expected.disabled)
  assert.equal(held.fg, expected.disabledText)
  assert.notEqual(held.bg, expected.enabled)
}

/*
 * Buttons transition background-color for --dsh-ui-duration-fast (120ms), so a
 * fixed sleep reads a mid-transition frame rather than the resting fill. Poll
 * on animation frames and only return once the expected value has been held for
 * several consecutive frames, which proves the transition settled instead of
 * merely passing through the target. The counter lives on the element so a
 * re-render that swaps the node restarts the wait rather than reusing a frame
 * count earned by the previous node.
 */
const SETTLE_FRAMES = 5

async function waitForSettledBackground(page, name, expected) {
  await page.waitForFunction(({ name, expected, frames }) => {
    const el = [...document.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === name || button.textContent === name)
    if (!el) { return false }
    if (getComputedStyle(el).backgroundColor !== expected) { el.__dshSettle = 0; return false }
    el.__dshSettle = (el.__dshSettle ?? 0) + 1
    return el.__dshSettle >= frames
  }, { name, expected, frames: SETTLE_FRAMES }, { timeout: 5000 })
}

async function assertRoundShapes(page) {
  assert.equal(await page.evaluate(() => CSS.supports('corner-shape', 'superellipse(1.5)')), true)
  const shapes = await page.evaluate(() => {
    const read = selector => {
      const el = document.querySelector(selector)
      if (!el) return { selector, missing: true }
      return { selector, shape: getComputedStyle(el).cornerShape }
    }
    return ['.activity-dots i', '.assistant-launcher', '.models-credential-dot', '.preset-badge'].map(read)
  })
  for (const item of shapes) {
    assert.equal(item.missing, undefined, item.selector)
    assert.equal(item.shape, 'round', `${item.selector} ${item.shape}`)
  }
  assert.equal(await page.locator(S.composer).evaluate(el => getComputedStyle(el).cornerShape), 'superellipse(1.5)')
  assert.notEqual(await page.locator(S.pluginSentinel).evaluate(el => getComputedStyle(el).cornerShape), 'superellipse(1.5)')
}

const root = fileURLToPath(new URL('../', import.meta.url))
const build = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('tsdown/run')), '--config', 'e2e/ui-design.config.ts'], { cwd: root, stdio: 'inherit' })
if (build.error) throw build.error
if (build.status !== 0) throw new Error(`UI preview build failed (${build.status})`)
const out = new URL('../.artifacts/ui-design/', import.meta.url)
await mkdir(out, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DSH UI contract fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/preview.js"></script></html>')
    } else if (/^\/[\w.-]+\.js$/.test(path)) {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end(await readFile(new URL(path.slice(1), out)))
    } else { res.writeHead(404); res.end() }
  } catch (error) { res.writeHead(500); res.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.locator(S.dshUiHtml).waitFor()
  const paper = page.getByRole('textbox', { name: 'Manuscript fixture' })
  await paper.fill('保留的正文，切换主题不应丢失。')
  await paper.evaluate(el => { window.__paperNode = el; el.setSelectionRange(2, 5) })
  assert.equal(await page.locator(S.chat).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 235, 230)')
  // 插件隔离：插件表面的按钮不受官方组件样式影响。
  assert.equal(await page.locator(S.pluginSentinel).evaluate(el => getComputedStyle(el).borderRadius), '2px')
  const readingType = await page.locator(S.chatMarkdown).evaluate(el => {
    const paragraph = getComputedStyle(el.querySelector('p'))
    return {size:paragraph.fontSize,weight:paragraph.fontWeight,lineHeight:paragraph.lineHeight,heading:getComputedStyle(el.querySelector('h2')).fontSize,listSpacing:getComputedStyle(el.querySelector('li')).marginTop}
  })
  assert.equal(readingType.size,'17px')
  assert.equal(readingType.weight,'400')
  assert(parseFloat(readingType.lineHeight) >= 28)
  assert(parseFloat(readingType.heading) > parseFloat(readingType.size))
  assert.equal(readingType.listSpacing,'8px')
  await assertRoundShapes(page)
  // 主按钮固定 原稿 黛蓝 brand；不存在自选主题色。
  await assertPrimaryButtons(page, {
    enabled: 'rgb(46, 79, 122)',
    enabledText: 'rgb(255, 255, 255)',
    disabled: 'rgba(30, 36, 32, 0.06)',
    disabledText: 'rgb(92, 101, 94)',
  })
  // 浅色：Settings 对话框（portal、遮罩、焦点返回）。
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const lightDialog = page.getByRole('dialog', { name: 'Writing settings' })
  await lightDialog.waitFor()
  // portal 继承所在主题：对话框与遮罩渲染在 dsh-root 的 portal-root 内。
  assert(await lightDialog.evaluate((el, sel) => !!el.closest(sel), S.dshPortalRoot), 'dialog must render inside the dsh portal root')
  assert.equal(await lightDialog.evaluate(el => el.closest('[data-dsh-theme]')?.getAttribute('data-dsh-theme')), 'light')
  // 遮罩为黑色 scrim，不模糊。
  const lightOverlay = await page.locator(S.dshOverlay).evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, blur: style.backdropFilter }
  })
  assert.equal(lightOverlay.bg, 'rgba(16, 20, 18, 0.48)')
  assert.equal(lightOverlay.blur, 'none')
  // Switch 整行可点击且行高不小于 40px。
  const switchRow = page.locator(S.dshSwitchRow)
  const switchBox = await switchRow.boundingBox()
  assert(switchBox && switchBox.height >= 40, `switch row height ${switchBox?.height} < 40`)
  assert.equal(await page.locator(S.dshSwitch).getAttribute('aria-checked'), 'true')
  await switchRow.locator('.dsh-switch-row__label').click()
  assert.equal(await page.locator(S.dshSwitch).getAttribute('aria-checked'), 'false', 'clicking the row label must toggle the switch')
  await switchRow.locator('.dsh-switch-row__label').click()
  assert.equal(await page.locator(S.dshSwitch).getAttribute('aria-checked'), 'true')
  // Escape 关闭且焦点返回触发按钮。
  await page.keyboard.press('Escape')
  await lightDialog.waitFor({ state: 'hidden' })
  // 焦点恢复安排在卸载后的宏任务（focus-return.ts），等最终态而非赌时序。
  await page.waitForFunction(() => document.activeElement?.textContent === 'Settings')
  // 菜单为实色、不模糊，同样经 portal 继承主题。
  await page.getByRole('button', { name: /DSH Editor/ }).click()
  const menu = page.locator(S.dshMenu)
  await menu.waitFor()
  assert(await menu.evaluate((el, sel) => !!el.closest(sel), S.dshPortalRoot), 'menu must render inside the dsh portal root')
  const menuPaint = await menu.evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, blur: style.backdropFilter, border: style.borderTopWidth }
  })
  assert.equal(menuPaint.bg, 'rgb(255, 255, 255)')
  assert.equal(menuPaint.blur, 'none')
  assert.equal(menuPaint.border, '0px')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await page.screenshot({ path: fileURLToPath(new URL('light-1440.png', out)), fullPage: true })
  // 深色：主题切换不重建输入节点。
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.waitForFunction((sel) => {
    const chat = document.querySelector(sel)
    return chat && getComputedStyle(chat).backgroundColor === 'rgb(21, 24, 22)'
  }, S.chat)
  assert.equal(await page.locator(S.chat).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(21, 24, 22)')
  assert(await paper.evaluate(el => el === window.__paperNode), 'manuscript node must not be rebuilt on theme switch')
  assert.equal(await paper.inputValue(), '保留的正文，切换主题不应丢失。')
  await assertPrimaryButtons(page, {
    enabled: 'rgb(143, 176, 222)',
    enabledText: 'rgb(20, 24, 27)',
    disabled: 'rgba(218, 223, 214, 0.06)',
    disabledText: 'rgb(151, 160, 150)',
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Writing settings' })
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(el => el.closest('[data-dsh-theme]')?.getAttribute('data-dsh-theme')), 'dark')
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 42, 38)')
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '20px')
  const darkOverlay = await page.locator(S.dshOverlay).evaluate(el => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, blur: style.backdropFilter }
  })
  assert.equal(darkOverlay.bg, 'rgba(0, 0, 0, 0.55)')
  assert.equal(darkOverlay.blur, 'none')
  await page.screenshot({ path: fileURLToPath(new URL('dark-portal.png', out)), fullPage: true })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent === 'Settings')
  // 深色菜单实色。
  await page.getByRole('button', { name: /DSH Editor/ }).click()
  await menu.waitFor()
  assert.equal(await menu.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(37, 42, 38)')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  // 设计系统 gallery（Ctrl+Alt+Shift+D）：新组件库的 Dialog。
  await page.keyboard.press('Control+Alt+Shift+KeyD')
  await page.getByRole('dialog', { name: 'DSH UI · 原稿设计系统' }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('live-design-system.png', out)), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'DSH UI · 原稿设计系统' }).waitFor({ state: 'hidden' })
  // 禁用的发送键：disabled 语义 + 去掉 brand 实色。
  await page.getByRole('textbox', { name: 'Chat input', exact: true }).fill('')
  const send = page.getByRole('button', { name: 'Send message' })
  await waitForSettledBackground(page, 'Send message', 'rgba(0, 0, 0, 0)')
  assert(await send.isDisabled())
  const disabledBg = await send.evaluate(el => getComputedStyle(el).backgroundColor)
  assert.equal(disabledBg, 'rgba(0, 0, 0, 0)', 'disabled send bg')
  assert.notEqual(disabledBg, 'rgb(143, 176, 222)', 'disabled send must not show the brand primary')
  await page.getByRole('textbox', { name: 'Chat input', exact: true }).fill('Test draft')
  await waitForSettledBackground(page, 'Send message', 'rgb(143, 176, 222)')
  assert.equal(await send.isDisabled(), false)
  assert.equal(await send.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(143, 176, 222)', 'enabled send bg')
  await send.click()
  await page.getByRole('status').filter({ hasText: 'Fixture message submitted' }).waitFor()
  // 四档宽度无横向溢出。
  for (const width of [1440, 1024, 760, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`)
    const box = await page.locator(S.composer).boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= width + 1, `composer at ${width}`)
    await page.screenshot({ path: fileURLToPath(new URL(`dark-${width}.png`, out)), fullPage: true })
  }
  // 减少动态效果。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator(S.composer).evaluate(el => getComputedStyle(el).transitionDuration), '0s')
  await page.emulateMedia({ reducedMotion: null })
  // forced-colors：焦点与选中状态仍可见（系统色描边）。Switch 只在对话框打开时挂载。
  await page.emulateMedia({ forcedColors: 'active' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const fcDialog = page.getByRole('dialog', { name: 'Writing settings' })
  await fcDialog.waitFor()
  assert.equal(await page.locator(S.dshSwitch).evaluate(el => getComputedStyle(el).borderTopWidth), '1px', 'switch needs a border in forced-colors')
  await page.keyboard.press('Escape')
  await fcDialog.waitFor({ state: 'hidden' })
  // 键盘 focus-visible 下按钮必须有可见描边。
  await page.keyboard.press('Tab')
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement
    const style = el ? getComputedStyle(el) : null
    return { tag: el?.tagName, outline: style?.outlineStyle, width: style?.outlineWidth }
  })
  assert.equal(focusVisible.tag, 'BUTTON')
  assert.notEqual(focusVisible.outline, 'none', 'focused control must show an outline in forced-colors')
  assert.notEqual(focusVisible.width, '0px', 'focused control outline must be non-zero in forced-colors')
  const selectedRow = await page.locator(`${S.treeRow}[aria-current="page"]`).evaluate(el => {
    const style = getComputedStyle(el)
    return { outline: style.outlineStyle, width: style.outlineWidth }
  })
  assert.notEqual(selectedRow.outline, 'none', 'selected row must be visible in forced-colors')
  await page.emulateMedia({ forcedColors: null })
  assert.deepEqual(errors, [])
  console.log('UI browser contracts passed. This is a component fixture, not a full Electron/runtime acceptance test.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
