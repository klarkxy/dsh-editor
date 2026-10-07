import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = new URL('../../../.artifacts/shell-repairs/', import.meta.url)
const before = process.argv.includes('--before')
const build = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('tsdown/run')), '--config', 'packages/dsh-editor-shell/fixtures/shell-repairs.config.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, SHELL_REPAIRS_BEFORE: before ? '1' : '0' } })
assert.equal(build.status, 0, 'fixture build')
await mkdir(out, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/preview.js"></script></html>') }
    else { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL(req.url.slice(1), out))) }
  } catch (error) { res.writeHead(500); res.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
let page
const errors = []
try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1024, height: 960 } })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.getByRole('button', { name: /编辑.*Fixture provider/ }).click()
  await page.getByText('自定义设置', { exact: true }).click()
  const name = page.getByRole('textbox', { name: '显示名称', exact: true }).first()
  const key = page.locator('input[type=password]')
  await name.fill('保留未保存的作者输入')
  await key.fill('fixture-key-buffer')
  await name.evaluate(el => { window.savedNameNode = el })
  await page.screenshot({ path: fileURLToPath(new URL(`${before ? 'before' : 'after'}-light.png`, out)), fullPage: true })
  await page.getByRole('button', { name: 'Toggle fixture theme' }).click()
  await page.screenshot({ path: fileURLToPath(new URL(`${before ? 'before' : 'after'}-dark.png`, out)), fullPage: true })
  await page.evaluate(() => { window.shellRepairs.hold(); window.shellRepairs.refresh(2) })
  if (before) {
    await page.locator('.models-loading').waitFor()
    console.log('Before: background refresh unmounted the provider editor')
  } else {
    assert.equal(await name.inputValue(), '保留未保存的作者输入')
    assert.equal(await key.inputValue(), 'fixture-key-buffer')
    assert(await name.evaluate(el => el === window.savedNameNode))
  }
  await page.evaluate(() => window.shellRepairs.release())
  if (!before) {
    await page.getByRole('alert').filter({ hasText: '设置已被其它窗口修改' }).waitFor()
    assert.equal(await name.inputValue(), '保留未保存的作者输入')
    assert.equal(await key.inputValue(), 'fixture-key-buffer')
    await page.evaluate(() => { window.shellRepairs.fail(true); window.shellRepairs.refresh() })
    await page.getByRole('alert').filter({ hasText: 'Fixture refresh failed' }).waitFor()
    assert.equal(await name.inputValue(), '保留未保存的作者输入')
    assert.equal(await key.inputValue(), 'fixture-key-buffer')
    assert.equal((await page.evaluate(() => window.shellRepairs.calls)).length, 0, 'mounting and refresh never write settings or select a model')
    assert.equal(await page.getByRole('combobox', { name: '思考强度' }).count(), 0, 'missing reasoning capability offers no guessed levels')
    await page.evaluate(() => window.shellRepairs.catalog({ efforts: [{ id: 'brief', name: 'Brief custom' }, { id: 'deep', name: 'Deep custom' }], defaultEffort: 'brief' }))
    const reasoning = page.getByRole('combobox', { name: '思考强度' }); await reasoning.waitFor()
    assert.match(await reasoning.innerText(), /Brief custom/, 'catalogue default is displayed without selecting it')
    await reasoning.click(); await page.getByRole('option', { name: 'Deep custom' }).click()
    assert.equal((await page.evaluate(() => window.shellRepairs.calls)).filter(call => call[0] === 'select').length, 1)
    assert.equal((await page.evaluate(() => window.shellRepairs.calls)).filter(call => call[0] === 'settings').length, 0)
    await page.evaluate(() => { window.shellRepairs.fail(false); window.shellRepairs.removeProvider() })
    await page.getByRole('alert').filter({ hasText: 'Fixture refresh failed' }).waitFor({ state: 'hidden' })
    assert.equal(await name.inputValue(), '保留未保存的作者输入')
    assert.equal(await key.inputValue(), 'fixture-key-buffer')
    assert(await name.evaluate(el => el === window.savedNameNode))
    await page.getByRole('button', { name: '保存', exact: true }).click()
    assert.equal((await page.evaluate(() => window.shellRepairs.calls)).filter(call => call[0] === 'settings' || call[0] === 'key').length, 0, 'a stale editor never writes the key or profile')
    await page.evaluate(() => window.shellRepairs.catalog(false))
    await reasoning.waitFor({ state: 'hidden' })
    assert.equal((await page.evaluate(() => window.shellRepairs.calls)).filter(call => call[0] === 'select').length, 1, 'explicitly disabled reasoning stays disabled on refresh')
    await page.screenshot({ path: fileURLToPath(new URL('after-refresh-conflict.png', out)), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('PASS: provider nodes/draft/key survive event refresh and failure; revision conflict visible; catalog picker has no mount writes and accepts custom efforts')
    await page.reload()
    await page.getByRole('button', { name: /编辑.*Fixture provider/ }).click()
    const credentialOnlyKey = page.locator('input[type=password]')
    await credentialOnlyKey.fill('fixture-credential-only-buffer')
    await page.evaluate(() => { window.shellRepairs.fail(true); window.shellRepairs.removeProvider() })
    await page.getByRole('alert').filter({ hasText: 'Fixture refresh failed' }).waitFor()
    const credentialSave = page.getByRole('button', { name: '保存', exact: true })
    assert(await credentialSave.isDisabled(), 'an unverifiable refresh blocks credential-only save')
    assert.equal(await credentialOnlyKey.inputValue(), 'fixture-credential-only-buffer')
    assert.deepEqual(await page.evaluate(() => window.shellRepairs.calls), [])
    await page.evaluate(() => { window.shellRepairs.fail(false); window.shellRepairs.restoreProvider() })
    await page.getByRole('alert').filter({ hasText: 'Fixture refresh failed' }).waitFor({ state: 'hidden' })
    assert(!(await credentialSave.isDisabled()), 'a successful refresh restores save availability')
    await credentialSave.click()
    await credentialOnlyKey.waitFor({ state: 'hidden' })
    assert.deepEqual((await page.evaluate(() => window.shellRepairs.calls)).map(call => call[0]), ['key'], 'the recovered credential-only save never writes a profile')
    assert.deepEqual(errors, [])
    console.log('PASS: refresh failure blocks credential-only writes while retaining the key buffer; successful refresh restores saving')
  }
} catch (error) {
  const state = page ? await page.evaluate(() => ({ text: document.body.innerText, calls: window.shellRepairs?.calls, inputs: [...document.querySelectorAll('input')].map(input => ({ name: input.getAttribute('aria-label'), type: input.type, value: input.type === 'password' ? '[fixture buffer]' : input.value })) })).catch(() => null) : null
  await writeFile(new URL(`${before ? 'before' : 'after'}-failure.json`, out), JSON.stringify({ stack: String(error.stack), errors, state }, null, 2))
  await page?.screenshot({ path: fileURLToPath(new URL(`${before ? 'before' : 'after'}-failure.png`, out)), fullPage: true }).catch(() => {})
  throw error
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
