/** Real on-disk install and desktop uninstall, before and after loader restart. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'
import { installGitHubPlugin, defaultExtract, defaultLink, defaultNpmInstall } from '../packages/dsh-editor-plugins/src/install.ts'
import { readPluginState, persistPluginState } from '../packages/dsh-editor-plugins/src/index.ts'
import { resolvePluginPaths } from '../packages/dsh-editor-plugins/src/paths.ts'
import { parseGitHubSpec } from '../packages/dsh-editor-plugins/src/github.ts'

const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const home = resolve(root, '.dev', `plugin-uninstall-${nonce}`)
const output = resolve(root, 'e2e/out/plugin-uninstall', nonce)
const paths = resolvePluginPaths({ DSH_HOME: home }, [])
const packageName = 'dsh-plugin-uninstall-fixture'
const source = join(home, 'fixture-source', 'package')
const archive = join(home, 'fixture.tgz')
await mkdir(join(source, 'lib'), { recursive: true })
await mkdir(output, { recursive: true })
await writeFile(join(source, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', type: 'module', main: './lib/index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
await writeFile(join(source, 'lib/index.js'), `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
export const name = 'uninstall-fixture';
export const inject = ['loader'];
export function apply(ctx) {
  const entry = [...ctx.loader.entries()].find(item => item.options.name === 'dsh-plugin-uninstall-fixture');
  const log = value => appendFileSync(join(process.env.DSH_HOME, 'fixture-lifecycle.jsonl'), JSON.stringify(value) + '\\n');
  ctx.effect(() => {
    log({ phase: 'apply', id: entry?.id, localId: entry?.options.id, hasParent: Boolean(entry?.parent) });
    return () => log({ phase: 'dispose' });
  }, 'uninstall-fixture-lifecycle');
}`)
await writeFile(join(source, 'cordis.patch.yml'), '- insert:\n    - id: uninstall-fixture\n      name: dsh-plugin-uninstall-fixture\n')
await new Promise((done, reject) => {
  const process = spawn('tar', ['-czf', archive, '-C', join(home, 'fixture-source'), 'package'], { windowsHide: true, stdio: 'ignore' })
  process.on('error', reject); process.on('exit', code => code === 0 ? done() : reject(new Error(`tar ${code}`)))
})
const bytes = await readFile(archive)
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'), DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: join(home, 'electron-user-data'), DSH_EDITOR_PROJECTS_ROOT: join(home, 'projects') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY']) delete env[key]
const report = { ok: false, checks: [], errors: [], home }
const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(check) { const end = Date.now() + 15000; while (!await check()) { if (Date.now() > end) throw new Error('condition timeout'); await delay(50) } }
function passed(check) { report.checks.push(check); console.log(`[plugin-uninstall] ${check}`) }
let app, page, failureServer, releaseFailure
async function boot() {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'), args: [resolve(root, 'apps/desktop/dist/main.js')], env })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.locator('.shell').waitFor({ timeout: 90000 })
  for (let i = 0; i < 5; i++) { const next = page.getByRole('button', { name: '继续', exact: true }); if (!await next.isVisible()) break; await next.click() }
  const later = page.getByRole('button', { name: '稍后配置', exact: true }); if (await later.isVisible()) await later.click()
}
async function close() {
  if (!app) return
  const pid = app.process().pid
  const done = await Promise.race([app.close().then(() => true, () => false), delay(10000).then(() => false)])
  if (!done && pid) await new Promise(resolve => { const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve) })
  app = null
}
async function installFixture() {
  const result = await installGitHubPlugin(parseGitHubSpec('acme/uninstall-fixture'), paths, AbortSignal.timeout(60000), {
    fetch: async () => new Response(bytes), extract: defaultExtract, npmInstall: defaultNpmInstall, link: defaultLink,
  })
  const state = await readPluginState(paths)
  state.installed = [result]
  await persistPluginState(paths, state)
  assert((await readPluginState(paths)).installed.some(item => item.name === packageName))
}
async function openPlugins() {
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  await page.locator('.settings-dialog').getByRole('tab', { name: '插件', exact: true }).click()
  await page.getByTestId('plugins-tab-installed').click()
}
async function verifyRemoved() {
  assert(!(await readPluginState(paths)).installed.some(item => item.name === packageName))
  const manifest = JSON.parse(await readFile(join(paths.profileDir, 'package.json'), 'utf8'))
  assert(!manifest.dsh.profile.bundles.includes(packageName))
  assert.equal(manifest.dependencies?.[packageName], undefined)
  await assert.rejects(stat(join(paths.userPluginsDir, packageName)), { code: 'ENOENT' })
  await assert.rejects(stat(join(paths.profileDir, 'node_modules', packageName)), { code: 'ENOENT' })
  assert(manifest.dsh.profile.bundles.includes('dsh-editor-shell'))
}
try {
  await boot()
  await installFixture()
  await openPlugins()
  const card = () => page.getByTestId('plugins-settings').locator('article').filter({ hasText: packageName })
  const dialog = () => page.getByRole('dialog', { name: '卸载插件', exact: true })
  const confirm = () => dialog().getByRole('button', { name: '确认卸载', exact: true })
  await card().waitFor()
  assert.match(await card().innerText(), /待重启/)
  assert.equal(await card().getByRole('switch').count(), 0)
  await card().getByRole('button', { name: '卸载', exact: true }).click()
  await dialog().getByRole('button', { name: '取消', exact: true }).click()
  await dialog().waitFor({ state: 'hidden' })
  assert((await readPluginState(paths)).installed.length === 1)
  passed('newly installed plugin is visible before restart; cancel preserves files and registration')

  const failureGate = new Promise(done => { releaseFailure = done })
  let failuresReceived = 0
  failureServer = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw); failuresReceived++
    await failureGate
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    response.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'internal', message: '验收卸载失败', details: {} } } }))
  })
  await new Promise(done => failureServer.listen(0, '127.0.0.1', done))
  const endpoint = '**/dsh-editor-plugins/marketplace.uninstall'
  await page.route(endpoint, route => route.continue({ url: `http://127.0.0.1:${failureServer.address().port}/uninstall` }))
  await card().getByRole('button', { name: '卸载', exact: true }).click()
  await confirm().evaluate(button => { button.click(); button.click() })
  await until(() => failuresReceived === 1)
  await page.keyboard.press('Escape')
  assert(await dialog().isVisible())
  assert(await dialog().getByRole('button', { name: '取消', exact: true }).isDisabled())
  releaseFailure()
  await dialog().getByText('验收卸载失败', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'uninstall-error.png') })
  await page.unroute(endpoint)
  await page.route(endpoint, route => route.abort('failed'), { times: 1 })
  await confirm().click()
  await until(async () => await confirm().isEnabled())
  assert(await dialog().getByRole('alert').isVisible())
  await page.unroute(endpoint)
  passed('uninstall failure appears inside dialog; busy prevents duplicates/dismissal and transport failure can retry')

  await confirm().click()
  await dialog().waitFor({ state: 'hidden' })
  await card().waitFor({ state: 'hidden' })
  await verifyRemoved()
  passed('real uninstall RPC removes plugin files, profile link and installation registration before restart')
  await close()
  await installFixture()
  await boot()
  await openPlugins()
  await card().waitFor()
  assert.doesNotMatch(await card().innerText(), /待重启/)
  assert.equal(await card().getByRole('switch').count(), 1)
  await card().getByRole('button', { name: '卸载', exact: true }).click()
  await confirm().click()
  await dialog().waitFor({ state: 'hidden' })
  await card().waitFor({ state: 'hidden' })
  await verifyRemoved()
  passed('loaded plugin can also uninstall after a real host restart; bundled editor stays installed')
  await close()
  const beforeRestart = (await readFile(join(home, 'fixture-lifecycle.jsonl'), 'utf8')).split('"phase":"apply"').length
  await boot()
  await openPlugins()
  await page.getByText('正在读取已安装插件…').waitFor({ state: 'hidden' })
  assert.equal(await card().count(), 0)
  await verifyRemoved()
  const afterRestart = (await readFile(join(home, 'fixture-lifecycle.jsonl'), 'utf8')).split('"phase":"apply"').length
  assert.equal(afterRestart, beforeRestart)
  passed('after the required restart, the removed plugin is not loaded again')
  assert.deepEqual(report.errors, [])
  report.ok = true
} catch (error) {
  report.error = String(error); process.exitCode = 1
  report.lifecycle = await readFile(join(home, 'fixture-lifecycle.jsonl'), 'utf8').catch(() => '')
  if (page && !page.isClosed()) { report.visibleText = await page.locator('body').innerText().catch(() => ''); await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}) }
} finally {
  releaseFailure?.()
  await close()
  if (failureServer) { failureServer.closeAllConnections(); await new Promise(done => failureServer.close(done)) }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, visibleText: undefined, output }, null, 2))
}
