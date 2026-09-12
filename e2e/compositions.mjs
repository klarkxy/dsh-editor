import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile, readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { compositionInstallNames } from '../scripts/plugin-manifest.mjs'
import { DESKTOP_PACKAGE_NAMES, desktopComposition } from '../scripts/desktop-compositions.mjs'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const composition = process.env.DSH_EDITOR_COMPOSITION || 'full'
const resolved = await desktopComposition(composition)
const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, `composition-${composition}-projects`)
const home = resolve(devRoot, `composition-${composition}-home`)
const output = resolve(root, 'e2e', 'out', `composition-${composition}`)
const targetWorkspace = resolve(projectsRoot, 'core-loop-workspace')

for (const target of [projectsRoot, home, output, targetWorkspace]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

let browser
let dshChild

function note(label, detail = '') {
  console.log(`[core-loop] ${label}${detail ? ` — ${detail}` : ''}`)
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
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
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolve, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolve(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('').slice(-4_000)}`)))
  })
  const url = await Promise.race([
    ready,
    delay(60_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('').slice(-4_000)}`) }),
  ])
  return { child, url }
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    const visible = await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!visible) break
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await configureLater.click()
  }
}

await rm(projectsRoot,{recursive:true,force:true});await rm(home,{recursive:true,force:true});await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const evidence={composition,checks:[],failures:[]};
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_EDITOR_PROJECTS_ROOT:projectsRoot,SSH_CONNECTION:'composition-test'};
await deployProfile(home,template,resolve(runtime,'node_modules'));
let page;
try {
 const started=await startDsh(env);dshChild=started.child;
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900},locale:'zh-CN'});page.setDefaultTimeout(15000);
 const calls=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',request=>{if(request.method()==='POST'){try{calls.push({url:request.url(),body:request.postDataJSON()})}catch{}}});
 await page.goto(started.url.href);await page.locator('.shell').waitFor({timeout:45000});await dismissNativeOnboarding(page);
 const rpc=async(channel,method,payload)=>{const response=await page.request.post(new URL(channel+'/'+method,started.url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}});if(!response.ok())throw new Error(method+': HTTP '+response.status());const result=(await response.json()).result;if(!result?.ok)throw new Error(method+': '+JSON.stringify(result));return result.value};
 const capabilities=await rpc('/dsh-editor-shell','capabilities.get',{});
 const expectedFeatures=Object.fromEntries(Object.entries(resolved.shellFeatures).map(([feature])=>[feature,true]));
 const actualFeatures=capabilities.features&&typeof capabilities.features==='object'?capabilities.features:{};
 for(const feature of new Set([...Object.keys(expectedFeatures),...Object.keys(actualFeatures)])){
  if(actualFeatures[feature]!==expectedFeatures[feature])throw new Error('capability mismatch '+JSON.stringify(capabilities));
 }
 evidence.capabilities=capabilities;
 const installed=(await readdir(resolve(runtime,'node_modules'))).filter(name=>DESKTOP_PACKAGE_NAMES.includes(name)).sort();
 const expected=[...compositionInstallNames(resolved)].sort();
 if(JSON.stringify(installed)!==JSON.stringify(expected))throw new Error('installed package set mismatch '+installed.join(','));evidence.installed=installed;
 if(process.env.DSH_EDITOR_COPY_PACKAGES==='1'){
   for(const name of installed)if((await realpath(resolve(runtime,'node_modules',name))).startsWith(resolve(root,'packages')))throw new Error('repository link in copied composition '+name);
   evidence.delivery='copied package artifacts; no workspace package links';
 }

 if(await page.getByTestId('proofread-open').count())throw new Error('paused proofreading launcher is visible');
 if(await page.getByTestId('zhihu-open').count())throw new Error('Zhihu must not contribute a desktop launcher');
 const openSettings=async(tab)=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-nav').getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(250)};
 const closeSettings=async()=>{await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.locator('.settings-dialog').waitFor({state:'hidden'})};
 if(resolved.shellFeatures.zhihu){await openSettings('知乎资料');await page.locator('.settings-content.is-active').getByText('Access Secret',{exact:false}).first().waitFor();await closeSettings()}
 evidence.checks.push('proofreading paused; Zhihu configuration is inside settings');
 await page.getByRole('button',{name:'新建',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'新建作品'});await dialog.getByLabel('作品名称').fill('core-loop-workspace');await dialog.getByRole('button',{name:'创建',exact:true}).click();await page.locator('.tree').waitFor({timeout:30000});
 // Create the document via the actual product command; the ordinary flow must work without AI.
 await page.locator('.tree-row').filter({hasText:'正文'}).first().hover();await page.getByRole('button',{name:'在 正文 中新建文件',exact:true}).click();const create=page.getByRole('dialog',{name:'新建文件'});await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001');await create.getByRole('button',{name:'创建',exact:true}).click();
 const editor=page.locator('[data-testid="paper-editor"] .cm-content');await editor.waitFor({timeout:30000});await editor.click();await page.keyboard.insertText('我们以经做好准备。组合保存验证。');await page.keyboard.press('Control+s');await page.locator('[data-testid="paper-save-state"]',{hasText:'已保存'}).waitFor();
 const saved=await readFile(resolve(targetWorkspace,'正文','001.md'),'utf8');if(!saved.includes('组合保存验证'))throw new Error('disk save missing');evidence.checks.push('create project/document and save through UI');
 const sessionId=calls.map(x=>x.body?.payload?.sessionId).filter(Boolean).at(-1);if(!sessionId)throw new Error('no real session captured');
 const found=await rpc('/manuscript','search.text',{sessionId,query:'组合保存验证'});if(!JSON.stringify(found).includes('组合保存验证'))throw new Error('search did not find saved text');
 await rpc('/dsh-editor-cards','cards.create',{sessionId,kind:'character',title:'组合角色',fields:{}});
 await rpc('/dsh-editor-workbench','snapshot.create',{sessionId,label:'组合验收'});evidence.checks.push('live-session search/card/snapshot');

 const panelColors=[];
 for(const theme of ['paper','ink']){
   if(theme==='ink')await page.locator('.chrome .theme-toggle').click();
   await openSettings('通用设置');panelColors.push(await page.locator('.settings-dialog').evaluate(el=>getComputedStyle(el).backgroundColor));await page.screenshot({path:resolve(output,'settings-'+theme+'.png')});await closeSettings();
   if(resolved.shellFeatures.zhihu){await openSettings('知乎资料');await page.screenshot({path:resolve(output,'zhihu-settings-'+theme+'.png')});await closeSettings()}
 }
 if(panelColors[0]===panelColors[1])throw new Error('settings theme did not adapt');
 await page.locator('.chrome .theme-toggle').click();evidence.checks.push('paper/ink settings and embedded Zhihu configuration');

 if(!resolved.shellFeatures.assistant){
   await editor.click();await page.keyboard.insertText(' 无模型自动任务。');await page.waitForTimeout(2500);await page.keyboard.press('Control+s');
   if(await page.locator('aside.chat').count())throw new Error('Chat mounted in basic');
   const unexpected=calls.filter(x=>/fim.complete|patch.complete|project.prepareIndex/.test(x.url)||/session.send/.test(JSON.stringify(x.body)));if(unexpected.length)throw new Error('basic initiated AI '+JSON.stringify(unexpected));
   evidence.checks.push('no Chat/FIM/patch/auto-index/turn requests while writing');
 } else { const launcher=page.getByRole('button',{name:'打开写作搭档'});if(await launcher.isVisible().catch(()=>false))await launcher.click();await page.locator('aside.chat').waitFor();evidence.checks.push('optional Chat mounts'); }
 await page.reload();await page.locator('.shell').waitFor();await dismissNativeOnboarding(page);if(await page.getByTestId('proofread-open').count()||await page.getByTestId('zhihu-open').count())throw new Error('removed desktop launcher returned after reload');
 if(errors.length)throw new Error('browser errors '+errors.join('|'));await page.screenshot({path:resolve(output,'final.png')});evidence.checks.push('reload keeps desktop launchers absent and has no browser errors');
} catch(error){evidence.failures.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page?.content().catch(()=> '')||'');}
finally{await browser?.close();await stop(dshChild)}
evidence.ok=evidence.failures.length===0;await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));if(!evidence.ok)process.exitCode=1;

