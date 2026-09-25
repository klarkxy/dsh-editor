// Real desktop UI with upstream style ownership/disposal replay; this does not test SSE transport.
// Run SETTINGS_LIFECYCLE_STAGE=lifecycle-before first, then lifecycle-after.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.SETTINGS_LIFECYCLE_STAGE || 'lifecycle-after'
const baseline = stage === 'lifecycle-before'
const output = resolve(root, 'e2e/out/settings-ui', stage)
const home = resolve(root, '.dev', 'settings-ui-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2/lib/bin.js'),
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

  const sample=async label=>{
    await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
    const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.waitFor()
    for(const tab of ['知乎资料','网络搜索','插件']){
      await dialog.locator('.settings-nav').getByRole('tab',{name:tab,exact:true}).click()
      if(tab==='知乎资料')await dialog.getByRole('textbox',{name:'Access Secret',exact:true}).waitFor()
      if(tab==='网络搜索')await dialog.getByTestId('web-search-settings').waitFor()
      if(tab==='插件')await dialog.getByTestId('plugins-writing-presets').waitFor()
      await page.waitForTimeout(150)
      const data=await page.evaluate(()=>({styles:[...document.querySelectorAll('style')].map(s=>({attrs:s.getAttributeNames(),owner:s.getAttribute('data-plugin'),length:s.textContent.length})), switch:[...document.querySelectorAll('.settings-content.is-active [role="switch"]')].map(e=>({cls:e.className,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),lists:[...document.querySelectorAll('.settings-content.is-active ol')].map(e=>({cls:e.className,display:getComputedStyle(e).display}))}))
      report.pages.push({label,tab,...data});console.log(label,tab,JSON.stringify({...data,styles:data.styles.filter(s=>s.attrs.some(a=>a.startsWith('data-dsh')))}));await dialog.screenshot({path:resolve(output,label+'-'+tab+'.jpg'),quality:85})
    }
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
  }
  await sample('home')
  await page.getByRole('button',{name:'新建',exact:true}).first().click()
  const create=page.getByRole('dialog',{name:'新建作品'});await create.getByLabel('作品名称').fill('settings-lifecycle');await create.getByRole('button',{name:'创建',exact:true}).click();await page.locator('.tree').waitFor({timeout:30000})
  await sample('project')

  // Replay the runtime's ownership cleanup using the same bundled function.
  const hmrSource=await (await import('node:fs/promises')).readFile(resolve(root,'.dev/desktop-dsh-runtime-0.1.7-rc.2/node_modules/@deepseek-ai/dsh-client-hmr/lib/client.js'),'utf8')
  const cleanup=hmrSource.match(/function removeOwnedStyles\(id\) \{[\s\S]*?\n\t\t\}/)[0]

  const ids=['dsh-editor-plugins','@klarkxy/dsh-web-search-manager','@klarkxy/dsh-zhihu']
  const selectors=['style[data-dsh-plugins-styles]','style[data-dsh-web-search]','style[data-dsh-zhihu-styles]']
  const modulesSource=await (await import('node:fs/promises')).readFile(resolve(root,'.dev/desktop-dsh-runtime-0.1.7-rc.2/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js'),'utf8')
  const claim=modulesSource.match(/const claimStyles = \(id\) => \{[\s\S]*?\n\t\t\};/)[0]
  report.fixture=baseline?'Remove the three ownership declarations to reproduce the pre-fix injection contract.':'Unmodified product styles.'
  await page.evaluate(({code,selectors,baseline})=>{
    if(baseline)for(const selector of selectors)document.querySelector(selector).removeAttribute('data-plugin')
    new Function(code+';claimStyles("unrelated-late-plugin")')()
  },{code:claim,selectors,baseline})
  const owners=await page.evaluate(selectors=>selectors.map(s=>document.querySelector(s)?.getAttribute('data-plugin')),selectors)
  report.owners=owners
  if(baseline){assert.ok(owners.every((owner,i)=>owner&&owner!==ids[i]))}
  else assert.deepEqual(owners,ids)
  const oldReport=baseline?report:JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root,'e2e/out/settings-ui/lifecycle-before/report.json'),'utf8'))
  report.cleanupOwners=[...new Set(oldReport.owners)]
  // Use the upstream HMR disposer itself. Other resources belonging to the
  // rebuilt module are restored, as a successful module reload would do.
  await page.evaluate(({code,owners,selectors})=>{
    const protectedNodes=new Set(selectors.map(s=>document.querySelector(s)))
    const other=[...document.querySelectorAll('style[data-plugin]')].filter(s=>owners.includes(s.getAttribute('data-plugin'))&&!protectedNodes.has(s))
    const remove=new Function(code+';return removeOwnedStyles')()
    for(const owner of owners)remove(owner)
    for(const node of other)document.head.append(node)
  },{code:cleanup,owners:report.cleanupOwners,selectors})
  await sample('after-owner-cleanup')
  const remaining=await page.evaluate(selectors=>selectors.map(s=>document.querySelectorAll(s).length),selectors)
  assert.deepEqual(remaining,baseline?[0,0,0]:[1,1,1])
  const controls=report.pages.filter(p=>p.label==='after-owner-cleanup').flatMap(p=>p.switch)
  assert.ok(controls.length>10)
  if(baseline)assert.ok(controls.every(s=>s.h<10))
  else assert.ok(controls.every(s=>s.w===36&&s.h===20))
  if(!baseline){
    await sample('reopen')
    const all=report.pages.flatMap(p=>p.switch);assert.ok(all.every(s=>s.w===36&&s.h===20))
  }
  report.ok=true
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await app?.close()}
