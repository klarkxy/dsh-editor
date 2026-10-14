/** Mounted production controls over the native SettingsScope contract; no live credentials. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export async function runModelRoutes({ editorModels = false } = {}) {
 const root = resolve(import.meta.dirname, '..')
 const localRequire = createRequire(resolve(root, 'package.json'))
 const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
 const viteRequire = createRequire(createRequire(localRequire.resolve('vitest/package.json')).resolve('vite/package.json'))
 const { build } = viteRequire('esbuild')
 const output = resolve(root, 'e2e/out', editorModels ? 'editor-models' : 'writing-routes', 'after')
 await mkdir(output, { recursive: true })
 const fixture = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ${editorModels ? 'EditorModelSettings' : 'WritingModelRoutes'} as Routes } from './packages/dsh-editor-shell/src/client/writing-model-routes.tsx'
import { ShellTheme } from './packages/dsh-editor-shell/src/client/ui/theme-root.tsx'
import { tokenStyles } from './packages/dsh-editor-shell/src/design-system/tokens.ts'
import { collectStyles, defineStyles } from './packages/dsh-editor-shell/src/design-system/layers.ts'
import './packages/dsh-editor-shell/src/client/base.styles.ts'
import './packages/dsh-editor-shell/src/client/dialogs.styles.ts'
import './packages/dsh-editor-shell/src/client/select.styles.ts'
import './packages/dsh-editor-shell/src/app/settings/settings.styles.ts'
import { S } from './helpers/selectors.mjs'
defineStyles('dsh.tokens','fixture-tokens',tokenStyles)
const shellCss=collectStyles()
const catalog=[{provider:'fixture',model:'alpha',label:'Fixture · Alpha',efforts:[{id:'off',name:'Off'},{id:'high',name:'High'}]},{provider:'fixture',model:'beta',label:'Fixture · Beta',efforts:[{id:'off',name:'Off'},{id:'low',name:'Low'}]}]
const clone=x=>structuredClone(x), calls=[], held=new Set(), pending=[]
const records=Object.fromEntries(['a','b'].map(id=>[id,{completionModel:{provider:'fixture',model:id==='a'?'alpha':'beta',...(id==='a'?{reasoningEffort:'high'}:{})},chatModel:{provider:'',model:''},rewriteModel:{provider:'',model:''},authorPreferences:'保留作者偏好',fontSize:20}]))
const scopes=Object.fromEntries(['a','b'].map(id=>{
 let revision=1,snapshot={status:'ready',value:clone(records[id]),user:clone(records[id]),revision,writable:true,mode:'host'}
 const listeners=new Set(),publish=()=>{snapshot={...snapshot,value:clone(records[id]),user:clone(records[id]),revision};for(const listener of listeners)listener()}
 const scope={getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},mutate(ops,expectedRevision){
  calls.push({id,method:'mutate',ops:clone(ops),expectedRevision})
  const commit=error=>{if(error||expectedRevision!==revision){publish();return false}for(const op of ops){if(op.op==='set')records[id][op.path[0]]=clone(op.value);else delete records[id][op.path[0]]}revision++;publish();return true}
  if(held.has(id))return new Promise((resolve,reject)=>pending.push({id,settle:error=>{try{resolve(commit(error))}catch(e){reject(e)}}}))
  return Promise.resolve().then(()=>commit())
 },set(field,value){return scope.mutate([{op:'set',path:[field],value}],revision)},unset(field){return scope.mutate([{op:'unset',path:[field]}],revision)}}
 return[id,{scope,external:patch=>{Object.assign(records[id],clone(patch));revision++;publish()},capture:()=>clone(snapshot),readback:old=>{if(old.revision>=revision){snapshot=old;for(const listener of listeners)listener()}}}]
}))
let renderState
window.routeFixture={calls,records,hold:id=>held.add(id),release:(id,error)=>{held.delete(id);const index=pending.findIndex(item=>item.id===id);if(index<0)throw Error('No pending '+id);pending.splice(index,1)[0].settle(error)},pending:()=>pending.map(x=>x.id),switch:id=>renderState(x=>({...x,id})),mount:mounted=>renderState(x=>({...x,mounted})),theme:appearance=>renderState(x=>({...x,appearance})),external:(id,patch)=>scopes[id].external(patch),capture:id=>scopes[id].capture(),readback:(id,old)=>scopes[id].readback(old)}
function App(){const[state,setState]=useState({id:'a',mounted:true,appearance:'light'});renderState=setState;return <ShellTheme appearance={state.appearance}><style>{shellCss}</style><main className="settings-content is-active" style={{padding:24,maxWidth:800}}>{state.mounted?<Routes scope={scopes[state.id].scope} catalog={catalog} writable={true}/>:null}</main></ShellTheme>}
createRoot(document.getElementById('root')).render(<App/>)
`
 const bundle = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  alias: { 'react-dom/client': shellRequire.resolve('react-dom/client'), 'dsh-editor-workspace-kit/frontmatter': resolve(root, 'packages/dsh-editor-workspace-kit/src/frontmatter.ts') },
  platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'text' } })
 const server = createServer((req,res)=>{res.writeHead(200,{'content-type':req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8'});res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script></html>')})
 await new Promise(done=>server.listen(0,'127.0.0.1',done))
 let browser
 const report={ok:false,stage:'after',checks:[],errors:[],output,contract:'Native SettingsScope field mutations, user layer and expectedRevision; native settings service refresh ownership is represented by its observable fixture.'}
 try {
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:1024,height:720}})
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto('http://127.0.0.1:'+server.address().port)
  const route=page.getByRole('combobox',{name:'补全模型',exact:true})
  const enabled=()=>page.waitForFunction(sel=>!document.querySelector(sel).disabled,S.completionModel)
  const value=async model=>{await route.filter({hasText:model}).waitFor();await enabled()}
  const choose=async model=>{await route.click();await page.getByRole('option',{name:'Fixture · '+model,exact:true}).click()}
  await value('Alpha')
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>window.routeFixture.theme(theme),theme)
   for(const width of [1024,760]){await page.setViewportSize({width,height:720});await page.screenshot({path:resolve(output,theme+'-'+width+'.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'route overflow at '+width)}
  }
  assert.ok((await page.getByRole('combobox',{name:'对话模型',exact:true}).textContent()).includes('DSH 默认模型'))
  assert.equal(await page.locator(S.tier).count(),0)
  assert.equal(await page.getByRole('spinbutton',{name:'并发数',exact:true}).count(),0)
  report.checks.push('three native routes render in light/dark at 1024/760; native fallbacks replace retired global tiers and bounds')
  await choose('Beta');await value('Beta')
  assert.equal(await page.evaluate(()=>window.routeFixture.records.a.completionModel.reasoningEffort),undefined)
  assert.deepEqual(await page.evaluate(()=>[window.routeFixture.records.a.authorPreferences,window.routeFixture.records.a.fontSize]),['保留作者偏好',20])
  report.checks.push('one-field native writes preserve author settings and drop unsupported reasoning effort')
  const effort=page.getByRole('combobox',{name:'补全模型 · 思考强度',exact:true})
  await effort.click();await page.getByRole('option',{name:'关',exact:true}).click();await enabled()
  assert.equal(await page.evaluate(()=>window.routeFixture.records.a.completionModel.reasoningEffort),'off')
  await choose('Alpha');await value('Alpha')
  assert.equal(await page.evaluate(()=>window.routeFixture.records.a.completionModel.reasoningEffort),'off')
  report.checks.push('explicit thinking off survives a compatible route change')
  await page.evaluate(()=>window.routeFixture.hold('a'));await choose('Beta')
  await page.waitForFunction(()=>window.routeFixture.pending().includes('a'))
  await page.evaluate(()=>window.routeFixture.switch('b'));await value('Beta')
  await page.evaluate(()=>window.routeFixture.hold('b'));await choose('Alpha')
  await page.waitForFunction(()=>window.routeFixture.pending().includes('b'))
  await page.evaluate(()=>window.routeFixture.release('a'))
  assert.equal(await route.isDisabled(),true)
  await page.evaluate(()=>window.routeFixture.release('b'));await value('Alpha')
  report.checks.push('a late old-connection save cannot overwrite or unlock another connection save')
  const old=await page.evaluate(()=>window.routeFixture.capture('b'))
  await choose('Beta');await value('Beta')
  await page.evaluate(old=>window.routeFixture.readback('b',old),old);await value('Beta')
  report.checks.push('controls follow native observable publication; an older native readback cannot replace a newer save')
  await page.evaluate(()=>window.routeFixture.hold('b'));await choose('Alpha')
  await page.waitForFunction(()=>window.routeFixture.pending().includes('b'))
  await page.evaluate(()=>{window.routeFixture.external('b',{rewriteModel:{provider:'fixture',model:'beta'}});window.routeFixture.release('b')})
  await page.getByRole('alert').filter({hasText:'模型选择未能保存'}).waitFor();await value('Beta')
  assert.equal(await page.evaluate(()=>window.routeFixture.records.b.rewriteModel.model),'beta')
  await choose('Alpha');await value('Alpha')
  report.checks.push('native revision refusal gives a visible save error after recovery and preserves other fields; a new selection recovers')
  await page.evaluate(()=>window.routeFixture.hold('b'));await choose('Beta')
  await page.waitForFunction(()=>window.routeFixture.pending().includes('b'))
  await page.evaluate(()=>window.routeFixture.release('b','storage unavailable'))
  await page.getByRole('alert').filter({hasText:'模型选择未能保存'}).waitFor();await value('Alpha')
  await page.getByRole('button',{name:'重试',exact:true}).click();await value('Beta')
  await page.evaluate(()=>window.routeFixture.mount(false));await route.waitFor({state:'detached'})
  await page.evaluate(()=>window.routeFixture.mount(true));await value('Beta')
  report.checks.push('a failed write retains the saved route and successful preferences persist across remount')
  await page.evaluate(()=>window.routeFixture.hold('b'));await choose('Alpha')
  await page.waitForFunction(()=>window.routeFixture.pending().includes('b'))
  await page.evaluate(()=>window.routeFixture.mount(false));await route.waitFor({state:'detached'})
  await page.evaluate(()=>{window.routeFixture.switch('a');window.routeFixture.mount(true)});await value('Beta')
  await page.evaluate(()=>window.routeFixture.release('b'));await value('Beta')
  report.checks.push('unmount and remount isolate late saves while native storage still commits the originating write')
  await route.click();await page.getByRole('option',{name:'跟随当前对话',exact:true}).click();await enabled()
  assert.deepEqual(await page.evaluate(()=>window.routeFixture.records.a.completionModel),{provider:'',model:'',reasoningEffort:''})
  report.checks.push('returning to the current session saves an explicit empty model route')
  await route.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await page.keyboard.press('Escape')
  await page.waitForFunction(sel=>document.querySelector(sel)===document.activeElement,S.completionModel)
  report.checks.push('keyboard opens the native dropdown and Escape returns focus')
  assert.deepEqual(report.errors,[]);report.ok=true
 } catch(error){report.failure=String(error);process.exitCode=1}
 finally {await browser?.close();await new Promise(done=>server.close(done));await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
 return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runModelRoutes({ editorModels: process.argv.includes('--editor-models') })
