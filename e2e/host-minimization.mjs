/** Isolated, real DSH profile probes for the two distinct host-minimization questions. */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'
import os from 'node:os'
import { chromium } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dsh = resolveDshInstallation()
const runtimeRequire = createRequire(join(dsh.packageRoot, 'package.json'))
const distIndex = runtimeRequire.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
const output = resolve(root, 'e2e/out/host-minimization')
const report = { dsh: dsh.version, experiments: [] }
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const port = () => new Promise((yes, no) => { const server = net.createServer(); server.once('error', no); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => yes(p)) }) })
const delay = ms => new Promise(r => setTimeout(r, ms))
function childEnv(home) { return { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SSH_CONNECTION: 'dsh-plugin-probe' } }
async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise(r => child.once('exit', r)), delay(3000)])
  if (child.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  child.stdout?.destroy(); child.stderr?.destroy()
}
try {
for (const mode of ['without-web-bundle', 'without-agent-services']) {
  const caseRoot = join(output, mode)
  await fs.mkdir(caseRoot, { recursive: true })
  const home = await fs.mkdtemp(join(os.tmpdir(), 'dsh-profile-probe-'))
  const profile = join(home, 'profiles', 'proofread-probe')
  await fs.mkdir(profile, { recursive: true })
  const archive = join(home, 'dsh-proofread-0.1.0.tgz')
  await fs.copyFile(resolve(root,'.pack/dsh-proofread-0.1.0.tgz'), archive)
  const chosenPort = await port()
  const bundles = mode === 'without-web-bundle' ? ['@deepseek-ai/dsh-base', 'dsh-proofread'] : ['dsh-proofread']
  await fs.writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'proofread-host-probe', private: true, dependencies: { 'dsh-proofread': `file:${archive.replaceAll('\\','/')}` }, dsh: { profile: { bundles } } }, null, 2))
  // The real plugin installer resolves the local archive; the final profile excludes the Web bundle.
  const installed = spawnSync(process.execPath, [dsh.cliPath, 'plugin', '--profile', 'proofread-probe', 'add', `file:${archive.replaceAll('\\','/')}`], { cwd: caseRoot, env: childEnv(home), encoding: 'utf8', windowsHide: true, timeout: 120000 })
  if (installed.status !== 0) throw new Error(`probe install failed: ${installed.stdout}\n${installed.stderr}`)
  const entry = (id, name, config) => ({ id, name, ...(config ? { config } : {}) })
  const rows = [
    entry('probe-webserver','@deepseek-ai/dsh-host-webserver',{host:'127.0.0.1',port:chosenPort}),
    entry('probe-static','@deepseek-ai/dsh-host-frontend-static',{distIndex}),
    entry('probe-storage','@deepseek-ai/dsh-storage'),
    entry('probe-storage-json','@deepseek-ai/dsh-storage-json',{root:join(home,'storages')}),
    entry('probe-storage-domain','@deepseek-ai/dsh-storage-domain',{backend:'json'}),
    entry('probe-workspace','@deepseek-ai/dsh-workspace'),
    entry('probe-picker','@deepseek-ai/dsh-host-directory-picker-browse'),
    entry('probe-api','@deepseek-ai/dsh-host-apiproxy'),
    entry('probe-host-runner','@deepseek-ai/dsh-cordis-host-runner'),
    entry('probe-modules','@deepseek-ai/dsh-client-modules'),
    entry('probe-connection','@deepseek-ai/dsh-client-connection'),
    entry('probe-remotes','@deepseek-ai/dsh-api-remotes'),
    entry('probe-client-runner','@deepseek-ai/dsh-cordis-client-runner'),
    entry('probe-settings','@deepseek-ai/dsh-client-ui-settings'),
    entry('probe-theme','@deepseek-ai/dsh-client-ui-theme'),
    entry('probe-locale','@deepseek-ai/dsh-client-locale'),
    entry('probe-layout','@deepseek-ai/dsh-client-ui-layout'),
    entry('probe-renderer','@deepseek-ai/dsh-client-ui-renderer'),
  ]
  const diagnostic = join(caseRoot, 'diagnostic.mjs')
  await fs.writeFile(diagnostic, `export const inject=['connection','webServer'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/probe',handler:async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');const value={services:Object.fromEntries(['agent','agents','sessions','llm','tools','systemPrompt','workspaceRegistry','connection'].map(name=>[name,ctx.get(name)!==undefined])),plugins:[...ctx.registry.values()].flatMap(runtime=>[...runtime.fibers].map(fiber=>({name:runtime.name,state:fiber.state})))};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({type:'server-response',rpcId:body.rpcId??'probe-call',result:{ok:true,value}}))}}))}`)
  rows.push(entry('probe-diagnostic',pathToFileURL(diagnostic).href))
  const patches = [{ insert: rows }]
  if (mode === 'without-web-bundle') patches.unshift({ id: 'hmr', disabled: true })
  await fs.writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patches, null, 2))
  const result = { mode, bundles, businessPackage: 'dsh-proofread', ready: false, rpc: false, ui: false, failure: null, runtime: null }
  const child = spawn(process.execPath, [dsh.cliPath,'--profile','proofread-probe'], {cwd:caseRoot,env:childEnv(home),windowsHide:true,stdio:['ignore','pipe','pipe']})
  let stdout='', stderr=''
  child.stdout.on('data',x=>{stdout+=String(x)});child.stderr.on('data',x=>{stderr+=String(x)})
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'zh-CN'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  try {
    const deadline=Date.now()+30000
    while(Date.now()<deadline && child.exitCode===null){
      try { const res=await fetch(`http://127.0.0.1:${chosenPort}/`,{signal:AbortSignal.timeout(1000)}); if(res.ok){result.ready=true;break} } catch {}
      await delay(200)
    }
    if(!result.ready)throw new Error(`profile not ready; exit=${child.exitCode}`)
    const call=(channel,method,payload)=>fetch(`http://127.0.0.1:${chosenPort}${channel}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'probe-call',method,payload}),signal:AbortSignal.timeout(3000)}).then(r=>r.json())
    const checked=await call('/proofread','text.check',{text:'我们以经做好准备。',kinds:['typo']})
    if(!checked.result?.ok || checked.result.value.findings[0]?.suggestion!=='已经')throw new Error('text RPC did not return expected finding')
    result.rpc=true
    result.runtime=(await call('/probe','inspect',{})).result.value
    await page.goto(`http://127.0.0.1:${chosenPort}/`,{waitUntil:'domcontentloaded'})
    await page.getByTestId('proofread-open').waitFor({timeout:12000})
    await page.getByTestId('proofread-open').click()
    await page.getByTestId('proofread-input').fill('我们以经做好准备。')
    await page.getByTestId('proofread-check').click()
    await page.getByTestId('proofread-result').getByText('建议：已经',{exact:true}).waitFor({timeout:6000})
    await page.reload({waitUntil: 'domcontentloaded'})
    await page.getByTestId('proofread-open').waitFor({timeout:12000})
    if(await page.getByTestId('proofread-open').count()!==1)throw new Error('duplicate entry after reconnect')
    result.reconnect=true
    result.ui=true
    result.pageErrors=errors
    await page.screenshot({path:join(caseRoot,'page.png')})
  } catch(error) {
    result.failure=String(error)
    result.pageErrors=errors
    result.bootText=await page.locator('body').innerText().catch(()=> '')
    await page.screenshot({path:join(caseRoot,'failure.png')}).catch(()=>{})
  } finally {
    await page.close();await stop(child)
    await fs.writeFile(join(caseRoot,'stdout.log'),stdout)
    await fs.writeFile(join(caseRoot,'stderr.log'),stderr)
    result.exitCode=child.exitCode
    result.diagnostics=stderr.slice(-12000)
    report.experiments.push(result)
    const rel = relative(os.tmpdir(), home)
    if (!rel || rel.startsWith('..') || !rel.startsWith('dsh-profile-probe-')) throw new Error('unsafe probe cleanup path')
    await fs.rm(home, { recursive: true, force: true })
  }
}
} finally { await browser.close() }
await fs.writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
