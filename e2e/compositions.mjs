import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile, readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const composition = process.env.DSH_EDITOR_COMPOSITION || 'full'
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

resolveDshInstallation('0.1.1-rc.2')
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
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer)
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
 const rpc=async(channel,method,payload)=>{const response=await fetch(new URL(channel+'/'+method,started.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:Math.random().toString(36),method,payload})});const result=(await response.json()).result;if(!result?.ok)throw new Error(method+': '+JSON.stringify(result));return result.value};
 const capabilities=await rpc('/dsh-editor-shell','capabilities.get',{});
 if(capabilities.assistant!==(composition!=='basic')||capabilities.completion!==(composition!=='basic')||capabilities.zhihu!==(composition==='full'))throw new Error('capability mismatch '+JSON.stringify(capabilities));
 evidence.capabilities=capabilities;
 const known=['dsh-manuscript','dsh-proofread','dsh-editor-workbench','dsh-editor-novel-kernel','dsh-zhihu','dsh-editor-shell','dsh-editor-plugins'];
 const installed=(await readdir(resolve(runtime,'node_modules'))).filter(name=>known.includes(name)).sort();
 const expected=known.filter(name=>!(composition==='basic'&&name==='dsh-editor-novel-kernel')&&!(composition!=='full'&&name==='dsh-zhihu')).sort();
 if(JSON.stringify(installed)!==JSON.stringify(expected))throw new Error('installed package set mismatch '+installed.join(','));evidence.installed=installed;
 if(process.env.DSH_EDITOR_COPY_PACKAGES==='1'){
   for(const name of installed)if((await realpath(resolve(runtime,'node_modules',name))).startsWith(resolve(root,'packages')))throw new Error('repository link in copied composition '+name);
   evidence.delivery='copied package artifacts; no workspace package links';
 }

 await page.getByTestId('proofread-open').click();await page.getByTestId('proofread-input').fill('我们以经做好准备。');await page.getByTestId('proofread-input').press('Control+Enter');await page.getByTestId('proofread-result').getByText('建议：已经',{exact:true}).waitFor();await page.getByTestId('proofread-input').press('Escape');evidence.checks.push('same proofreading text in custom Shell');

 if(composition==='full'){
   await page.getByTestId('proofread-open').click();
   await page.route('**/proofread/text.check',async route=>{const response=await route.fetch();const body=await response.json();body.result={ok:false,error:{code:'internal',message:'校对测试错误',details:{}}};await route.fulfill({response,json:body})});
   await page.getByTestId('proofread-input').fill('错误状态');await page.getByTestId('proofread-check').click();await page.getByRole('alert').filter({hasText:'校对测试错误'}).waitFor();await page.unroute('**/proofread/text.check');
   await page.route('**/proofread/text.check',async route=>{const response=await route.fetch();await delay(450);await route.fulfill({response}).catch(()=>{})});
   await page.getByTestId('proofread-input').fill('按装');await page.getByTestId('proofread-check').click();await page.getByRole('status').filter({hasText:'正在校对'}).waitFor();await page.getByTestId('proofread-input').fill('这是一段新文本。');await delay(650);
   if(await page.getByTestId('proofread-result').count())throw new Error('old result survived input edit');if(!(await page.getByTestId('proofread-check').isEnabled()))throw new Error('input edit left loading stuck');await page.unroute('**/proofread/text.check');
   await page.getByTestId('proofread-check').click();await page.getByTestId('proofread-result').waitFor();await page.getByTestId('proofread-input').press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='proofread-open');
   evidence.checks.push('proofreading loading/error/retry/stale suppression/keyboard focus');
 }
 if(composition==='full'){await page.getByTestId('zhihu-open').click();await page.getByTestId('zhihu-panel').waitFor();await page.getByTestId('zhihu-panel').press('Escape')}else if(await page.getByTestId('zhihu-open').count())throw new Error('unexpected Zhihu entry');
 await page.getByRole('button',{name:'新建',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'新建作品'});await dialog.getByLabel('作品名称').fill('core-loop-workspace');await dialog.getByRole('button',{name:'创建',exact:true}).click();await page.locator('.tree').waitFor({timeout:30000});
 // Create the document via the actual product command; the ordinary flow must work without AI.
 await page.locator('.tree-row').filter({hasText:'正文'}).first().hover();await page.getByRole('button',{name:'在 正文 中新建文件',exact:true}).click();const create=page.getByRole('dialog',{name:'新建文件'});await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001');await create.getByRole('button',{name:'创建',exact:true}).click();
 const editor=page.locator('[data-testid="paper-editor"] .cm-content');await editor.waitFor({timeout:30000});await editor.click();await page.keyboard.insertText('我们以经做好准备。组合保存验证。');await page.keyboard.press('Control+s');await page.locator('[data-testid="paper-save-state"]',{hasText:'已保存'}).waitFor();
 const saved=await readFile(resolve(targetWorkspace,'正文','001.md'),'utf8');if(!saved.includes('组合保存验证'))throw new Error('disk save missing');evidence.checks.push('create project/document and save through UI');
 const sessionId=calls.map(x=>x.body?.payload?.sessionId).filter(Boolean).at(-1);if(!sessionId)throw new Error('no real session captured');
 const found=await rpc('/manuscript','search.text',{sessionId,query:'组合保存验证'});if(!JSON.stringify(found).includes('组合保存验证'))throw new Error('search did not find saved text');
 const scan=await rpc('/dsh-editor-workbench','proofread.scan',{sessionId,scope:'document',path:'正文/001.md'});if(!JSON.stringify(scan).includes('已经'))throw new Error('workspace proofread missing finding');
 await rpc('/dsh-editor-workbench','cards.create',{sessionId,kind:'character',title:'组合角色',fields:{}});
 await rpc('/dsh-editor-workbench','snapshot.create',{sessionId,label:'组合验收'});evidence.checks.push('live-session search/workspace proofread/card/snapshot');

 const panelColors=[];
 for(const theme of ['paper','ink']){
   if(theme==='ink')await page.locator('.chrome .theme-toggle').click();
   await page.getByTestId('proofread-open').click();panelColors.push(await page.getByTestId('proofread-panel').evaluate(el=>getComputedStyle(el).backgroundColor));await page.screenshot({path:resolve(output,'proofread-'+theme+'.png')});await page.getByTestId('proofread-input').press('Escape');
   if(composition==='full'){await page.getByTestId('zhihu-open').click();await page.screenshot({path:resolve(output,'zhihu-'+theme+'.png')});await page.getByTestId('zhihu-panel').press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='zhihu-open')}
 }
 if(panelColors[0]===panelColors[1])throw new Error('proofread theme did not adapt');
 await page.locator('.chrome .theme-toggle').click();evidence.checks.push('paper/ink panels and focus restoration');

 if(composition==='basic'){
   await editor.click();await page.keyboard.insertText(' 无模型自动任务。');await page.waitForTimeout(2500);await page.keyboard.press('Control+s');
   if(await page.locator('aside.chat').count())throw new Error('Chat mounted in basic');
   const unexpected=calls.filter(x=>/fim.complete|patch.complete|project.prepareIndex/.test(x.url)||/session.send/.test(JSON.stringify(x.body)));if(unexpected.length)throw new Error('basic initiated AI '+JSON.stringify(unexpected));
   evidence.checks.push('no Chat/FIM/patch/auto-index/turn requests while writing');
 } else { const launcher=page.getByRole('button',{name:'打开写作搭档'});if(await launcher.isVisible().catch(()=>false))await launcher.click();await page.locator('aside.chat').waitFor();evidence.checks.push('optional Chat mounts'); }
 await page.reload();await page.locator('.shell').waitFor();await dismissNativeOnboarding(page);if(await page.getByTestId('proofread-open').count()!==1)throw new Error('duplicate proofread contribution after reload');
 if(errors.length)throw new Error('browser errors '+errors.join('|'));await page.screenshot({path:resolve(output,'final.png')});evidence.checks.push('reload has one contribution and no browser errors');
} catch(error){evidence.failures.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page?.content().catch(()=> '')||'');}
finally{await browser?.close();await stop(dshChild)}
evidence.ok=evidence.failures.length===0;await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));if(!evidence.ok)process.exitCode=1;

