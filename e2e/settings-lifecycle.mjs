// Real desktop UI with upstream style ownership/disposal replay; this does not test SSE transport.
// Self-contained regression: no historical report or pre-fix DOM mutation is required.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { assertDefaultPluginPage, closePluginsPage, openPluginsPage, openWebSearchSettings, openWritingPresets } from './helpers/plugin-page.mjs'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.SETTINGS_LIFECYCLE_STAGE || 'lifecycle-after'
const output = resolve(root, 'e2e/out/settings-ui', stage)
const home = resolve(root, '.dev', 'settings-ui-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
let app
const report = { stage, pages: [], errors: [] }
try {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'),
    args: [resolve(root, 'apps/desktop/dist/main.js')], env })
  const page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.waitForSelector(S.shell, { timeout: 90000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  for (let i = 0; i < 5; i++) {
    const button = page.getByRole('button', { name: '继续', exact: true })
    if (!await button.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)) break
    await button.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await later.click()
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('dsh-window:check-update')
    ipcMain.handle('dsh-window:check-update',()=>({status:'latest',currentVersion:'0.3.6'}))
  })

  const sample = async label => {
    const plugins = await openPluginsPage(page)
    await assertDefaultPluginPage(page, plugins)
    await openWritingPresets(plugins)
    const switches = await plugins.locator(S.pluginsCatalogPresetToggleAny).evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => ({
      id: element.getAttribute('data-testid'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
    })))
    assert.ok(switches.length > 0, 'writing mode controls must be visible after expanding their group')
    assert.ok(switches.every(control => control.width === 35 && control.height === 20), JSON.stringify(switches))
    await openWebSearchSettings(plugins)
    const styles = await page.locator(S.dshPluginStyles).evaluateAll(elements => elements.map(element => ({
      owner: element.getAttribute('data-plugin'), length: element.textContent.length,
    })))
    report.pages.push({ label, switches, styles })
    await plugins.screenshot({ path: resolve(output, label + '.jpg'), quality: 85 })
    await closePluginsPage(page)
  }
  await sample('home')
  await page.getByRole('button',{name:'新建作品'}).first().click()
  const create=page.getByRole('dialog',{name:'新建作品'});await create.getByLabel('作品名称').fill('settings-lifecycle');await create.getByRole('button',{name:'创建',exact:true}).click();await page.locator(S.tree).waitFor({timeout:30000})
  await sample('project')

  // Exercise the pinned upstream owner/cleanup functions, including a real
  // unrelated style. Correctly owned application styles must survive both steps.
  const runtimeModules = resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2/node_modules')
  const modulesSource = await readFile(resolve(runtimeModules, '@deepseek-ai/dsh-client-modules/lib/client.js'), 'utf8')
  const cleanup = modulesSource.match(/function removeOwnedStyles\(id\) \{[\s\S]*?\n\t\t\}/)?.[0]
  const claim = modulesSource.match(/const claimStyles = \(id\) => \{[\s\S]*?\n\t\t\};/)?.[0]
  assert.ok(cleanup && claim, 'pinned DSH style ownership implementation must be available')
  const ids = ['dsh-editor-plugins', '@klarkxy/dsh-web-search-manager']
  const selectors = [S.stylePlugins, S.styleWebSearch]
  const ownership = await page.evaluate(({ claim, cleanup, selectors }) => {
    const before = selectors.map(selector => {
      const matches = document.querySelectorAll(selector)
      if (matches.length !== 1) throw Error(selector + ': expected exactly one style')
      return { node: matches[0], owner: matches[0].getAttribute('data-plugin'), text: matches[0].textContent }
    })
    const sentinel = document.createElement('style')
    sentinel.textContent = '.test-unrelated-style { display: block; }'
    document.head.append(sentinel)
    new Function(claim + ';claimStyles("unrelated-late-plugin")')()
    const claimed = sentinel.getAttribute('data-plugin')
    new Function(cleanup + ';removeOwnedStyles("unrelated-late-plugin")')()
    return {
      owners: before.map(entry => entry.owner), claimed, unrelatedRemoved: !sentinel.isConnected,
      retained: before.map((entry, index) => document.querySelector(selectors[index]) === entry.node && entry.node.isConnected
        && entry.node.getAttribute('data-plugin') === entry.owner && entry.node.textContent === entry.text),
    }
  }, { claim, cleanup, selectors })
  assert.deepEqual(ownership.owners, ids)
  assert.equal(ownership.claimed, 'unrelated-late-plugin')
  assert.equal(ownership.unrelatedRemoved, true)
  assert.deepEqual(ownership.retained, [true, true])
  report.ownership = ownership
  await sample('after-owner-cleanup')
  await sample('reopen')
  assert.deepEqual(report.errors, [])
  report.ok=true
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await app?.close()}
