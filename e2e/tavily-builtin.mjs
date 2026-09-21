import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const stage = 'tavily-builtin'
const output = resolve(root, 'e2e/out/settings-ui', stage)
const home = resolve(root, '.dev', 'settings-ui-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'),
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
  await page.waitForSelector('.shell', { timeout: 90000 })
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


  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const settings=page.getByRole('dialog',{name:'设置',exact:true});await settings.waitFor()
  await settings.locator('.settings-nav').getByRole('tab',{name:'网络搜索',exact:true}).click()
  const row=settings.getByTestId('web-search-rank-tavily');await row.waitFor()
  assert.equal(await row.count(),1)
  const toggle=row.getByRole('switch');assert.equal(await toggle.getAttribute('aria-checked'),'false')
  report.tavily={count:await row.count(),enabled:await toggle.getAttribute('aria-checked'),text:await row.innerText()}
  await row.scrollIntoViewIfNeeded();await settings.screenshot({path:resolve(output,'network-search.jpg'),quality:85})
  await settings.locator('.settings-nav').getByRole('tab',{name:'插件',exact:true}).click()
  await settings.getByTestId('plugins-writing-presets').waitFor()
  const pluginText=await settings.getByTestId('plugins-settings').innerText()
  assert.ok(!pluginText.includes('Tavily'))
  assert.ok(pluginText.includes('网络搜索'))
  report.separatePlugin=false
  await settings.screenshot({path:resolve(output,'plugins.jpg'),quality:85})
  const readFile=(await import('node:fs/promises')).readFile
  const manifest=JSON.parse(await readFile(resolve(home,'profiles/dsh-editor/package.json'),'utf8'))
  assert.ok(manifest.dsh.profile.bundles.includes('@klarkxy/dsh-web-search-manager'))
  assert.ok(!manifest.dsh.profile.bundles.includes('dsh-web-search-tavily'))
  report.bundles=manifest.dsh.profile.bundles.filter(name=>name.includes('web-search'))
  assert.deepEqual(report.errors,[])
  report.ok=true;console.log(JSON.stringify(report))
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await app?.close()}
