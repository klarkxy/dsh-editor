import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile, readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { compositionInstallNames } from '../scripts/plugin-manifest.mjs'
import { DESKTOP_PACKAGE_NAMES, desktopComposition, configureProfile } from '../scripts/desktop-compositions.mjs'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const composition = process.env.DSH_EDITOR_COMPOSITION || 'desktop'
const CANONICAL_ID = 'desktop'
const ALIAS_IDS = ['basic', 'smart', 'full']
const EXPECTED_LABELS = { [CANONICAL_ID]: '桌面写作', basic: '基础写作', smart: '智能写作', full: '智能写作与资料' }
const WRITING_PRESETS = ['dsh-editor-writing', 'dsh-editor-novel', 'dsh-editor-article', 'dsh-editor-technical']
const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, `composition-${composition}-projects`)
const home = resolve(devRoot, `composition-${composition}-home`)
const toggleHome = resolve(devRoot, `composition-${composition}-toggle-home`)
const output = resolve(root, 'e2e', 'out', `composition-${composition}`)
const targetWorkspace = resolve(projectsRoot, 'core-loop-workspace')

for (const target of [projectsRoot, home, toggleHome, output, targetWorkspace]) {
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

function withoutIdentity(value) {
  const { id, label, ...rest } = value
  return rest
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function materializeAlias(id) {
  const resolved = await desktopComposition(id)
  if (resolved.id !== id) throw new Error(`resolved id drifted for ${id}`)
  if (resolved.label !== EXPECTED_LABELS[id]) throw new Error(`resolved label drifted for ${id}: ${resolved.label}`)
  const dest = resolve(output, `materialized-${id}`)
  await mkdir(dest, { recursive: true })
  await writeFile(resolve(dest, 'package.json'), await readFile(resolve(template, 'package.json')))
  await configureProfile(dest, resolved)
  return { id, label: resolved.label, resolved, dest }
}

async function readMaterialized(dest) {
  const compositionJson = JSON.parse(await readFile(resolve(dest, 'composition.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(resolve(dest, 'dsh-editor-catalog.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(dest, 'package.json'), 'utf8'))
  const patch = await readFile(resolve(dest, 'cordis.patch.yml'), 'utf8')
  return {
    identity: withoutIdentity(compositionJson),
    catalog,
    bundles: manifest.dsh?.profile?.bundles ?? [],
    patch,
    features: compositionJson.features,
    packages: compositionJson.packages,
    disabledEntries: compositionJson.disabledEntries,
    shellFeatures: compositionJson.shellFeatures,
  }
}

function assertAliasParity(aliases) {
  const [first, ...rest] = aliases
  const baseline = withoutIdentity(first.resolved)
  for (const item of rest) {
    if (!sameJson(withoutIdentity(item.resolved), baseline)) {
      throw new Error(`${item.id} capability set differs from ${first.id}`)
    }
  }
  const files = aliases.map((item) => item.files)
  for (let index = 1; index < files.length; index += 1) {
    const current = files[index]
    if (!sameJson(current.identity, files[0].identity)) throw new Error(`${aliases[index].id} materialized composition differs from ${aliases[0].id}`)
    if (!sameJson(current.catalog, files[0].catalog)) throw new Error(`${aliases[index].id} catalog/entries differ from ${aliases[0].id}`)
    if (!sameJson(current.bundles, files[0].bundles)) throw new Error(`${aliases[index].id} package bundles differ from ${aliases[0].id}`)
    if (current.patch !== files[0].patch) throw new Error(`${aliases[index].id} profile patch differs from ${aliases[0].id}`)
    if (!sameJson(current.features, files[0].features)) throw new Error(`${aliases[index].id} frontend features differ from ${aliases[0].id}`)
    if (!sameJson(current.packages, files[0].packages)) throw new Error(`${aliases[index].id} packages differ from ${aliases[0].id}`)
    if (!sameJson(current.disabledEntries, files[0].disabledEntries)) throw new Error(`${aliases[index].id} disabled entries differ from ${aliases[0].id}`)
    if (!sameJson(current.shellFeatures, files[0].shellFeatures)) throw new Error(`${aliases[index].id} shell features differ from ${aliases[0].id}`)
  }
  return baseline
}

async function assertWritingPresetsHealthy(profileRoot) {
  const presets = resolve(profileRoot, 'agent-presets')
  const names = await readdir(presets)
  if (names.some((name) => name.includes('.stage-') || name.includes('.backup-'))) {
    throw new Error(`preset stage/backup leftover: ${names.filter((name) => name.includes('.stage-') || name.includes('.backup-')).join(',')}`)
  }
  for (const id of WRITING_PRESETS) {
    const dir = resolve(presets, id)
    if (!(await exists(resolve(dir, 'preset.yml')))) throw new Error(`${id} missing preset.yml`)
    if (!(await exists(resolve(dir, 'agent.cordis.yml')))) throw new Error(`${id} missing agent.cordis.yml`)
    const marker = JSON.parse(await readFile(resolve(dir, '.dsh-editor-owner.json'), 'utf8'))
    if (marker.app !== 'dsh-editor' || marker.schema !== 1) throw new Error(`${id} owner marker is unhealthy`)
    const yml = await readFile(resolve(dir, 'agent.cordis.yml'), 'utf8')
    if (!yml.includes('- id:')) throw new Error(`${id} composition is not a plugin list`)
    if (!yml.includes('dsh-tool-ask-user') || !yml.includes('dsh-tool-fs')) throw new Error(`${id} is missing required writing tools`)
    const meta = await readFile(resolve(dir, 'preset.yml'), 'utf8')
    if (!/name:\s*\S/.test(meta)) throw new Error(`${id} preset.yml has no name`)
  }
  const patch = await readFile(resolve(profileRoot, 'cordis.patch.yml'), 'utf8')
  if (!/- id: agent-presets\s+config:\s+default: dsh-editor-writing/.test(patch)) {
    throw new Error('app-owned profile default is not dsh-editor-writing')
  }
  if (/- id: agent-presets\s+config:\s+default: dsh-editor\s*$/m.test(patch)) {
    throw new Error('app-owned profile still defaults to legacy dsh-editor')
  }
}

await rm(projectsRoot,{recursive:true,force:true});await rm(home,{recursive:true,force:true});await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const evidence={composition,checks:[],failures:[]};
const env={...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_EDITOR_PROJECTS_ROOT:projectsRoot,SSH_CONNECTION:'composition-test'};
await deployProfile(home,template,resolve(runtime,'node_modules'));
let page;
try {
 const aliases=[];
 for (const id of [CANONICAL_ID, ...ALIAS_IDS]) {
  const item=await materializeAlias(id);
  item.files=await readMaterialized(item.dest);
  aliases.push(item);
  note('materialized', id);
 }
 const shared=assertAliasParity(aliases);
 if(shared.features.includes('cards')||shared.packages.includes('dsh-editor-cards'))throw new Error('canonical composition still includes cards');
 evidence.aliases=aliases.map((item)=>({id:item.id,label:item.label}));
 evidence.capability=shared;
 evidence.checks.push('desktop/basic/smart/full materialize to one capability set except id/label');

 if(!/- id: agent-presets\s+config:\s+default: dsh-editor-writing/.test(aliases[0].files.patch))throw new Error('materialized profile default is not dsh-editor-writing');
 const sourcePresetIds=(await readdir(resolve(root,'apps','desktop','resources','profile','agent-presets'))).sort();
 if(JSON.stringify(sourcePresetIds)!==JSON.stringify(['dsh-editor','dsh-editor-writing']))throw new Error('template source must keep only the locked core and legacy presets: '+sourcePresetIds.join(','));
 await assertWritingPresetsHealthy(template);
 const deployedNames=(await readdir(resolve(home,'.agent-presets'))).sort();
 const expectedDeployed=['dsh-editor','dsh-editor-article','dsh-editor-novel','dsh-editor-technical','dsh-editor-writing'];
 if(JSON.stringify(deployedNames)!==JSON.stringify(expectedDeployed))throw new Error('deployed preset roster mismatch: '+deployedNames.join(','));
 for(const id of expectedDeployed){
  const marker=JSON.parse(await readFile(resolve(home,'.agent-presets',id,'.dsh-editor-owner.json'),'utf8'));
  if(marker.app!=='dsh-editor'||marker.schema!==1||marker.plugin!==undefined)throw new Error(id+' deployed marker is not app-owned');
 }
 /* 停用态：隔离 HOME 预写 dsh-plugins.json，部署应跳过并清除该 preset。 */
 await rm(toggleHome,{recursive:true,force:true});await mkdir(toggleHome,{recursive:true});
 await writeFile(resolve(toggleHome,'dsh-plugins.json'),JSON.stringify({schema:1,overrides:{},presets:{'dsh-editor-novel':false},installed:[]}));
 await deployProfile(toggleHome,template,resolve(runtime,'node_modules'));
 const toggledNames=(await readdir(resolve(toggleHome,'.agent-presets'))).sort();
 if(JSON.stringify(toggledNames)!==JSON.stringify(expectedDeployed.filter((id)=>id!=='dsh-editor-novel')))throw new Error('disabled preset was not skipped: '+toggledNames.join(','));
 const deployedPresets=resolve(home,'.agent-presets');
 if(await exists(deployedPresets)){
  const leftover=(await readdir(deployedPresets)).filter((name)=>name.includes('.stage-')||name.includes('.backup-'));
  if(leftover.length)throw new Error('preset stage/backup leftover: '+leftover.join(','));
 }
 const deployedProfiles=resolve(home,'profiles');
 if(await exists(deployedProfiles)){
  const leftover=(await readdir(deployedProfiles)).filter((name)=>name.includes('.stage-')||name.includes('.backup-'));
  if(leftover.length)throw new Error('profile stage/backup leftover: '+leftover.join(','));
 }
 evidence.writingPresets={ids:WRITING_PRESETS,default:'dsh-editor-writing',toggleable:['dsh-editor-novel','dsh-editor-article','dsh-editor-technical']};
 evidence.checks.push('template ships 5 presets (2 app-owned + 3 first-party plugin); deploy honors the disabled toggle');

 const started=await startDsh(env);dshChild=started.child;
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900},locale:'zh-CN'});page.setDefaultTimeout(15000);
 const calls=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',request=>{if(request.method()==='POST'){try{calls.push({url:request.url(),body:request.postDataJSON()})}catch{}}});
 await page.goto(started.url.href);await page.locator('.shell').waitFor({timeout:45000});await dismissNativeOnboarding(page);
 const rpc=async(channel,method,payload)=>{const response=await page.request.post(new URL(channel+'/'+method,started.url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}});if(!response.ok())throw new Error(method+': HTTP '+response.status());const result=(await response.json()).result;if(!result?.ok)throw new Error(method+': '+JSON.stringify(result));return result.value};
 const capabilities=await rpc('/dsh-editor-shell','capabilities.get',{});
 const expectedFeatures=Object.fromEntries(Object.entries(shared.shellFeatures).map(([feature])=>[feature,true]));
 const actualFeatures=capabilities.features&&typeof capabilities.features==='object'?capabilities.features:{};
 for(const feature of new Set([...Object.keys(expectedFeatures),...Object.keys(actualFeatures)])){
  if(actualFeatures[feature]!==expectedFeatures[feature])throw new Error('capability mismatch '+JSON.stringify(capabilities));
 }
 evidence.capabilities=capabilities;
 const installed=(await readdir(resolve(runtime,'node_modules'))).filter(name=>DESKTOP_PACKAGE_NAMES.includes(name)).sort();
 const expected=[...compositionInstallNames({packages:shared.packages,libraries:shared.libraries})].sort();
 if(JSON.stringify(installed)!==JSON.stringify(expected))throw new Error('installed package set mismatch '+installed.join(','));evidence.installed=installed;
 if(process.env.DSH_EDITOR_COPY_PACKAGES==='1'){
   for(const name of installed)if((await realpath(resolve(runtime,'node_modules',name))).startsWith(resolve(root,'packages')))throw new Error('repository link in copied composition '+name);
   evidence.delivery='copied package artifacts; no workspace package links';
 }

 if(await page.getByTestId('proofread-open').count())throw new Error('paused proofreading launcher is visible');
 if(await page.getByTestId('zhihu-open').count())throw new Error('Zhihu must not contribute a desktop launcher');
 const openSettings=async(tab)=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.settings-nav').getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(250)};
 const closeSettings=async()=>{await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.locator('.settings-dialog').waitFor({state:'hidden'})};
 await openSettings('知乎资料');await page.getByTestId('zhihu-capabilities').waitFor();await page.locator('.settings-content.is-active').getByText('Access Secret',{exact:false}).first().waitFor();await closeSettings();
 evidence.checks.push('proofreading paused; Zhihu configuration is inside settings');
 await page.getByRole('button',{name:'新建',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'新建作品'});await dialog.getByLabel('作品名称').fill('core-loop-workspace');await dialog.getByRole('button',{name:'创建',exact:true}).click();await page.locator('.tree').waitFor({timeout:30000});
 await page.locator('.tree-empty').waitFor({state:'visible',timeout:20000});
 const tree=page.locator('.tree');const treeBox=await tree.boundingBox();if(!treeBox)throw new Error('tree missing');
 await tree.click({button:'right',position:{x:16,y:Math.max(12,treeBox.height-18)}});
 await page.getByRole('menu',{name:'文档操作'}).getByRole('menuitem',{name:'新建文件夹'}).click();
 const createFolder=page.getByRole('dialog',{name:'新建文件夹'});await createFolder.getByLabel('文件夹名称').fill('正文');await createFolder.getByRole('button',{name:'创建',exact:true}).click();
 await page.locator('.tree-row').filter({hasText:'正文'}).first().waitFor({timeout:20000});
 // Create the document via the actual product command; the ordinary flow must work without AI.
 await page.locator('.tree-row').filter({hasText:'正文'}).first().hover();await page.getByRole('button',{name:'在 正文 中新建文件',exact:true}).click();const create=page.getByRole('dialog',{name:'新建文件'});await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001');await create.getByRole('button',{name:'创建',exact:true}).click();
 const editor=page.locator('[data-testid="paper-editor"] .cm-content');await editor.waitFor({timeout:30000});
 if(await page.locator('[aria-label="正文编辑区"]').count())throw new Error('manuscript paper still uses 正文编辑区');
 await page.locator('[aria-label="文稿编辑区"]').waitFor({state:'visible',timeout:10000});
 await editor.click();await page.keyboard.insertText('我们以经做好准备。组合保存验证。');await page.keyboard.press('Control+s');await page.locator('[data-testid="paper-save-state"]',{hasText:'已保存'}).waitFor();
 const saved=await readFile(resolve(targetWorkspace,'正文','001.md'),'utf8');if(!saved.includes('组合保存验证'))throw new Error('disk save missing');evidence.checks.push('create project/document and save through UI');
 const notesBox=await tree.boundingBox();if(!notesBox)throw new Error('tree missing after first file');
 await tree.click({button:'right',position:{x:16,y:Math.max(12,notesBox.height-18)}});
 await page.getByRole('menu',{name:'文档操作'}).getByRole('menuitem',{name:'新建文件夹'}).click();
 const notesFolder=page.getByRole('dialog',{name:'新建文件夹'});await notesFolder.getByLabel('文件夹名称').fill('资料');await notesFolder.getByRole('button',{name:'创建',exact:true}).click();
 await page.locator('.tree-row').filter({hasText:'资料'}).first().waitFor({timeout:20000});
 await page.locator('.tree-row').filter({hasText:'资料'}).first().hover();await page.getByRole('button',{name:'在 资料 中新建文件',exact:true}).click();
 const createTxt=page.getByRole('dialog',{name:'新建文件'});await createTxt.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('笔记.txt');await createTxt.getByRole('button',{name:'创建',exact:true}).click();
 await page.locator('[data-testid="paper-path"]',{hasText:'资料/笔记.txt'}).waitFor({timeout:20000});
 await page.locator('[aria-label="文稿编辑区"]').waitFor({state:'visible',timeout:10000});
 await editor.click();await page.keyboard.press('Control+A');await page.keyboard.insertText('组合普通文本验证。');await page.keyboard.press('Control+s');await page.locator('[data-testid="paper-save-state"]',{hasText:'已保存'}).waitFor();
 const savedTxt=await readFile(resolve(targetWorkspace,'资料','笔记.txt'),'utf8');if(!savedTxt.includes('组合普通文本验证。'))throw new Error('plain txt save missing');
 const chapterRow=page.locator('.tree-row.tree-main').filter({hasText:'001.md'}).first();
 if(!(await chapterRow.count())){const bodyDir=page.locator('.tree-row').filter({hasText:'正文'}).first();await bodyDir.click();}
 await page.locator('.tree-row.tree-main').filter({hasText:'001.md'}).first().click();
 await page.locator('[data-testid="paper-path"]',{hasText:'正文/001.md'}).waitFor({timeout:20000});
 const sessionId=calls.map(x=>x.body?.payload?.sessionId).filter(Boolean).at(-1);if(!sessionId)throw new Error('no real session captured');
 const found=await rpc('/manuscript','search.text',{sessionId,query:'组合保存验证'});if(!JSON.stringify(found).includes('组合保存验证'))throw new Error('search did not find saved markdown');
 const foundTxt=await rpc('/manuscript','search.text',{sessionId,query:'组合普通文本验证'});if(!JSON.stringify(foundTxt).includes('组合普通文本验证'))throw new Error('search did not find saved txt');
 const readMd=await rpc('/manuscript','file.read',{sessionId,path:'正文/001.md'});if(!JSON.stringify(readMd).includes('组合保存验证'))throw new Error('file.read missed markdown');
 const readTxt=await rpc('/manuscript','file.read',{sessionId,path:'资料/笔记.txt'});if(!JSON.stringify(readTxt).includes('组合普通文本验证'))throw new Error('file.read missed txt');
 await rpc('/dsh-editor-workbench','snapshot.create',{sessionId,label:'组合验收'});evidence.checks.push('live-session search/plain-files/snapshot');

 const panelColors=[];
 for(const theme of ['light','dark']){
   if(theme==='dark')await page.locator('.chrome .theme-toggle').click();
   await openSettings('通用设置');panelColors.push(await page.locator('.settings-dialog').evaluate(el=>getComputedStyle(el).backgroundColor));await page.screenshot({path:resolve(output,'settings-'+theme+'.png')});await closeSettings();
   await openSettings('知乎资料');await page.screenshot({path:resolve(output,'zhihu-settings-'+theme+'.png')});await closeSettings();
 }
 if(panelColors[0]===panelColors[1])throw new Error('settings theme did not adapt');
 await page.locator('.chrome .theme-toggle').click();evidence.checks.push('light/dark settings and embedded Zhihu configuration');

 const launcher=page.getByRole('button',{name:'打开写作搭档'});if(await launcher.isVisible().catch(()=>false))await launcher.click();await page.locator('aside.chat').waitFor();evidence.checks.push('optional Chat mounts');
 await page.reload();await page.locator('.shell').waitFor();await dismissNativeOnboarding(page);if(await page.getByTestId('proofread-open').count()||await page.getByTestId('zhihu-open').count())throw new Error('removed desktop launcher returned after reload');
 if(errors.length)throw new Error('browser errors '+errors.join('|'));await page.screenshot({path:resolve(output,'final.png')});evidence.checks.push('reload keeps desktop launchers absent and has no browser errors');
} catch(error){evidence.failures.push(String(error));await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page?.content().catch(()=> '')||'');}
finally{await browser?.close();await stop(dshChild)}
evidence.ok=evidence.failures.length===0;await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));if(!evidence.ok)process.exitCode=1;
