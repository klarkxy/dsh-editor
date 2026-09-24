import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

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
  await page.locator('html[data-dsh-ui="kimi-web"]').waitFor()
  const paper = page.getByRole('textbox', { name: 'Manuscript fixture' })
  await paper.fill('保留的正文，切换主题不应丢失。')
  await paper.evaluate(el => { window.__paperNode = el; el.setSelectionRange(2, 5) })
  assert.equal(await page.locator('.chat').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
  assert.equal(await page.locator('.plugin-sentinel').evaluate(el => getComputedStyle(el).borderRadius), '2px')
  await page.screenshot({ path: fileURLToPath(new URL('light-1440.png', out)), fullPage: true })
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await page.waitForFunction(() => {
    const chat = document.querySelector('.chat')
    return chat && getComputedStyle(chat).backgroundColor === 'rgb(13, 17, 23)'
  })
  assert.equal(await page.locator('.chat').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(13, 17, 23)')
  assert(await paper.evaluate(el => el === window.__paperNode))
  assert.equal(await paper.inputValue(), '保留的正文，切换主题不应丢失。')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Writing settings' })
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(28, 33, 40)')
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
  assert(await page.getByRole('button', { name: 'Send message' }).isDisabled())
  await page.getByRole('textbox', { name: 'Chat input', exact: true }).fill('Test draft')
  await page.getByRole('button', { name: 'Send message' }).click()
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
