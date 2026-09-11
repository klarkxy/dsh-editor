import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile, readFile, readdir, realpath, cp } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const composition = process.env.DSH_EDITOR_COMPOSITION || 'full'
const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, `entry-disable-projects`)
const home = resolve(devRoot, `entry-disable-home`)
const output = resolve(root, 'e2e', 'out', `entry-disable`)
const targetWorkspace = resolve(projectsRoot, 'core-loop-workspace')

for (const target of [projectsRoot, home, output, targetWorkspace]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'entry-disable-template')
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

await rm(home,{recursive:true,force:true});await rm(projectsRoot,{recursive:true,force:true});await mkdir(output,{recursive:true});await rm(template,{recursive:true,force:true});await cp(resolve(devRoot,'desktop-profile-template'),template,{recursive:true});
await writeFile(resolve(template,'cordis.patch.yml'),(await readFile(resolve(template,'cordis.patch.yml'),'utf8'))+'\n- id: proofread\n  disabled: true\n');
await deployProfile(home,template,resolve(runtime,'node_modules'));
const report={ok:false,checks:[]};let page;
try{
 const started=await startDsh({...process.env,DSH_HOME:home,DSH_EDITOR_PROJECTS_ROOT:projectsRoot,DSH_TELEMETRY_DISABLED:'1',SSH_CONNECTION:'entry-disable'});dshChild=started.child;
 browser=await chromium.launch({headless:true});page=await browser.newPage({locale:'zh-CN'});let sessionId;page.on('request',request=>{try{const body=request.postDataJSON();if(body?.payload?.sessionId)sessionId=body.payload.sessionId}catch{}});
 await page.goto(started.url.href);await page.locator('.shell').waitFor({timeout:45000});await dismissNativeOnboarding(page);
 if(await page.getByTestId('proofread-open').count())throw new Error('disabled proofread UI still mounted');
 const absent=await fetch(new URL('/proofread/text.check',started.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'absent',method:'text.check',payload:{text:'以经'}})});const fallback=await fetch(new URL('/no-such-plugin/text.check',started.url),{method:'POST'});if(absent.status!==fallback.status||![404,405].includes(absent.status))throw new Error('disabled proofread RPC did not match absent route');
 const boot=await page.evaluate(()=>globalThis.__DSH_BOOT__?.entries?.map(entry=>entry.id)||[]);if(boot.some(id=>id==='dsh-proofread'||id==='proofread'))throw new Error('disabled Client entry remained in boot');
 report.absentRouteStatus=absent.status;
 await page.getByTestId('zhihu-open').click();await page.getByTestId('zhihu-panel').waitFor();await page.getByTestId('zhihu-panel').press('Escape');report.checks.push('disabled proofread contributes neither Host route nor Client; Zhihu still works');
 await page.getByRole('button',{name:'新建',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'新建作品'});await dialog.getByLabel('作品名称').fill('core-loop-workspace');await dialog.getByRole('button',{name:'创建',exact:true}).click();await page.locator('.tree').waitFor({timeout:30000});await waitFor(()=>Boolean(sessionId),'real session',10000);
 await mkdir(resolve(targetWorkspace,'正文'),{recursive:true});await writeFile(resolve(targetWorkspace,'正文','001.md'),'我们以经做好准备。');
 const checked=await fetch(new URL('/dsh-editor-workbench/proofread.scan',started.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'engine',method:'proofread.scan',payload:{sessionId,scope:'document',path:'正文/001.md'}})}).then(r=>r.json());if(!checked.result?.ok||!JSON.stringify(checked.result.value).includes('已经'))throw new Error('retained workbench engine failed '+JSON.stringify(checked));
 report.checks.push('workbench retains required engine and scans real workspace while optional entry is disabled');await page.screenshot({path:resolve(output,'page.png')});report.ok=true;
}catch(error){report.error=String(error);await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{})}finally{await browser?.close();await stop(dshChild)}
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
