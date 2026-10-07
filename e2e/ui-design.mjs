import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

async function buttonPaint(page, name) {
  return page.getByRole('button', { name, exact: true }).evaluate(el => {
    const style = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.backgroundColor = style.getPropertyValue('--accent-9')
    el.appendChild(probe)
    const accent = getComputedStyle(probe).backgroundColor
    probe.remove()
    return {
      bg: style.backgroundColor,
      fg: style.color,
      accent,
      accentAttr: el.getAttribute('data-accent-color'),
      disabled: el.matches(':disabled'),
    }
  })
}

async function assertNamedAccent(page, name, colorName, brand) {
  const painted = await page.getByRole('button', { name, exact: true }).evaluate((el, colorName) => {
    const style = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.backgroundColor = `var(--${colorName}-9)`
    el.appendChild(probe)
    const scale = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { bg: style.backgroundColor, accentAttr: el.getAttribute('data-accent-color'), scale }
  }, colorName)
  assert.equal(painted.accentAttr, colorName)
  assert.equal(painted.bg, painted.scale)
  assert.notEqual(painted.bg, brand)
  assert.notEqual(painted.bg, 'rgb(65, 118, 230)')
}

async function assertPrimaryButtons(page, expected) {
  await page.waitForFunction(expected => {
    const adopt = [...document.querySelectorAll('button')].find(el => el.textContent === '采用')
    return adopt && getComputedStyle(adopt).backgroundColor === expected.enabled && getComputedStyle(adopt).color === expected.enabledText
  }, expected)
  const adopt = await buttonPaint(page, '采用')
  assert.equal(adopt.accentAttr, '')
  assert.equal(adopt.disabled, false)
  assert.equal(adopt.bg, expected.enabled)
  assert.equal(adopt.fg, expected.enabledText)
  assert.notEqual(adopt.bg, adopt.accent)
  const held = await buttonPaint(page, '暂不采用')
  assert.equal(held.accentAttr, '')
  assert.equal(held.disabled, true)
  assert.equal(held.bg, expected.disabled)
  assert.equal(held.fg, expected.disabledText)
  assert.notEqual(held.bg, expected.enabled)
  await assertNamedAccent(page, '撤回', 'red', expected.enabled)
  await assertNamedAccent(page, '归档', 'gray', expected.enabled)
}

/*
 * The primary action must follow the saved accent, not stay neutral. Switching
 * the Theme's accentColor is exactly what the settings dialog does, so drive
 * the same attribute and read the real painted fill back. These are the pinned
 * ACCENT_SOLIDS fills, not Radix's accent-9, which cannot carry a white label.
 */
async function assertAccentRepaintsPrimary(page, colorName, expected) {
  await page.evaluate(name => {
    document.querySelector('html[data-dsh-ui] .radix-themes').setAttribute('data-accent-color', name)
  }, colorName)
  // Buttons transition background-color, so the first frame after the swap is
  // still the previous accent. Wait for the fill to settle before reading it.
  await page.waitForFunction(expected => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === '采用')
    return button && getComputedStyle(button).backgroundColor === expected
  }, expected, { timeout: 5000 })
  const painted = await page.getByRole('button', { name: '采用', exact: true })
    .evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }))
  assert.equal(painted.bg, expected, `${colorName} primary fill`)
  // A filled button with no readable label is the failure this guards against.
  assert.notEqual(painted.fg, expected, `${colorName} primary label`)
}

/*
 * Buttons transition background-color for --dsh-ui-duration-base (200ms), so a
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
    return ['.accent-swatch', '.activity-dots i', '.assistant-launcher', '.models-credential-dot', '.preset-badge'].map(read)
  })
  for (const item of shapes) {
    assert.equal(item.missing, undefined, item.selector)
    assert.equal(item.shape, 'round', `${item.selector} ${item.shape}`)
  }
  assert.equal(await page.locator('.composer').evaluate(el => getComputedStyle(el).cornerShape), 'superellipse(1.5)')
  assert.notEqual(await page.locator('.plugin-sentinel').evaluate(el => getComputedStyle(el).cornerShape), 'superellipse(1.5)')
}

async function assertSave(page, background, text) {
  await page.waitForFunction(({ background, text }) => {
    const save = [...document.querySelectorAll('button')].find(el => el.textContent === 'Save')
    if (!save) return false
    const style = getComputedStyle(save)
    return style.backgroundColor === background && style.color === text
  }, { background, text })
  const save = await buttonPaint(page, 'Save')
  assert.equal(save.accentAttr, '')
  assert.equal(save.disabled, false)
  assert.equal(save.bg, background)
  assert.equal(save.fg, text)
  assert.notEqual(save.bg, save.accent)
  assert.notEqual(save.bg, 'rgb(65, 118, 230)')
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
  await page.locator('html[data-dsh-ui="dsh-official"]').waitFor()
  const paper = page.getByRole('textbox', { name: 'Manuscript fixture' })
  await paper.fill('保留的正文，切换主题不应丢失。')
  await paper.evaluate(el => { window.__paperNode = el; el.setSelectionRange(2, 5) })
  assert.equal(await page.locator('.chat').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(239, 240, 242)')
  assert.equal(await page.locator('.plugin-sentinel').evaluate(el => getComputedStyle(el).borderRadius), '2px')
  const readingType = await page.locator('.chat-markdown').evaluate(el => {
    const paragraph = getComputedStyle(el.querySelector('p'))
    return {size:paragraph.fontSize,weight:paragraph.fontWeight,lineHeight:paragraph.lineHeight,heading:getComputedStyle(el.querySelector('h2')).fontSize,listSpacing:getComputedStyle(el.querySelector('li')).marginTop}
  })
  assert.equal(readingType.size,'17px')
  assert.equal(readingType.weight,'400')
  assert(parseFloat(readingType.lineHeight) >= 28)
  assert(parseFloat(readingType.heading) > parseFloat(readingType.size))
  assert.equal(readingType.listSpacing,'8px')
  await assertRoundShapes(page)
  // The primary action follows the saved accent. The fixture theme is blue, so
  // these are ACCENT_SOLIDS.blue light, not the old neutral black.
  await assertPrimaryButtons(page, {
    enabled: 'rgb(72, 104, 178)',
    enabledText: 'rgb(255, 255, 255)',
    disabled: 'rgb(230, 232, 235)',
    disabledText: 'rgb(92, 97, 102)',
  })
  // amber and crimson are the two extremes of the saved set: the lightest and
  // the most saturated. If either fails, the accent table needs a new value.
  await assertAccentRepaintsPrimary(page, 'amber', 'rgb(171, 100, 0)')
  await assertAccentRepaintsPrimary(page, 'crimson', 'rgb(203, 29, 99)')
  await assertAccentRepaintsPrimary(page, 'blue', 'rgb(72, 104, 178)')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const lightDialog = page.getByRole('dialog', { name: 'Writing settings' })
  await lightDialog.waitFor()
  await assertSave(page, 'rgb(72, 104, 178)', 'rgb(255, 255, 255)')
  await page.keyboard.press('Escape')
  await lightDialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /DSH Editor/ }).click()
  const menu = page.locator('.rt-DropdownMenuContent')
  await menu.waitFor()
  assert.match(await menu.evaluate(el => getComputedStyle(el).backdropFilter), /blur/)
  assert.equal(await menu.evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await page.screenshot({ path: fileURLToPath(new URL('light-1440.png', out)), fullPage: true })
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.waitForFunction(() => {
    const chat = document.querySelector('.chat')
    return chat && getComputedStyle(chat).backgroundColor === 'rgb(30, 30, 32)'
  })
  assert.equal(await page.locator('.chat').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(30, 30, 32)')
  assert(await paper.evaluate(el => el === window.__paperNode))
  assert.equal(await paper.inputValue(), '保留的正文，切换主题不应丢失。')
  await assertPrimaryButtons(page, {
    enabled: 'rgb(122, 170, 255)',
    enabledText: 'rgb(15, 17, 21)',
    disabled: 'rgba(255, 255, 255, 0.12)',
    disabledText: 'rgb(173, 178, 184)',
  })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Writing settings' })
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(42, 42, 44)')
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderTopLeftRadius), '28px')
  assert.equal(await page.locator('.rt-BaseDialogOverlay').evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none')
  await assertSave(page, 'rgb(122, 170, 255)', 'rgb(15, 17, 21)')
  await page.screenshot({ path: fileURLToPath(new URL('dark-portal.png', out)), fullPage: true })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Settings')
  await page.keyboard.press('Control+Alt+Shift+KeyD')
  await page.getByRole('dialog', { name: 'DSH UI / Design system' }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('live-design-system.png', out)), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'DSH UI / Design system' }).waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: 'Chat input', exact: true }).fill('')
  const send = page.getByRole('button', { name: 'Send message' })
  // Disabled pins `background: transparent` plus an inset hairline, so the send
  // key must drop the brand primary entirely: a resting brand fill here would
  // read as clickable. Wait for the 200ms transition to settle, not a fixed
  // sleep, or this catches an in-between frame instead of the resting state.
  await waitForSettledBackground(page, 'Send message', 'rgba(0, 0, 0, 0)')
  assert(await send.isDisabled())
  const disabledBg = await send.evaluate(el => getComputedStyle(el).backgroundColor)
  assert.equal(disabledBg, 'rgba(0, 0, 0, 0)', 'disabled send bg')
  assert.notEqual(disabledBg, 'rgb(122, 170, 255)', 'disabled send must not show the brand primary')
  await page.getByRole('textbox', { name: 'Chat input', exact: true }).fill('Test draft')
  // Enabled must land on the full ACCENT_SOLIDS blue dark fill. Anything less
  // opaque is a transition frame, not the settled contract.
  await waitForSettledBackground(page, 'Send message', 'rgb(122, 170, 255)')
  assert.equal(await send.isDisabled(), false)
  const enabledBg = await send.evaluate(el => getComputedStyle(el).backgroundColor)
  assert.equal(enabledBg, 'rgb(122, 170, 255)', 'enabled send bg')
  await send.click()
  await page.getByRole('status').filter({ hasText: 'Fixture message submitted' }).waitFor()
  for (const width of [1440, 1024, 760, 390]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`)
    const box = await page.locator('.composer').boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= width + 1, `composer at ${width}`)
    await page.screenshot({ path: fileURLToPath(new URL(`dark-${width}.png`, out)), fullPage: true })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.composer').evaluate(el => getComputedStyle(el).transitionDuration), '0s')
  assert.deepEqual(errors, [])
  console.log('UI browser contracts passed. This is a component fixture, not a full Electron/runtime acceptance test.')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
