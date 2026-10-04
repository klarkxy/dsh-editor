/** Mounted production route controls with deferred policy RPCs; no live credentials. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const localRequire = createRequire(resolve(root, 'package.json'))
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
const viteRequire = createRequire(createRequire(localRequire.resolve('vitest/package.json')).resolve('vite/package.json'))
const { build } = viteRequire('esbuild')
const baseline = process.env.WRITING_ROUTES_BASELINE === '1'
const probe = process.env.WRITING_ROUTES_PROBE === '1'
const stage = baseline ? (probe ? 'before-regression' : 'before') : 'after'
const output = resolve(root, 'e2e/out/writing-routes', stage)
await mkdir(output, { recursive: true })
const sourcePath = resolve(root, 'packages/dsh-editor-shell/src/client/writing-model-routes.tsx')
const baselineSource = baseline ? execFileSync('git', ['show', 'HEAD:packages/dsh-editor-shell/src/client/writing-model-routes.tsx'], { cwd: root, encoding: 'utf8' }) : null
const fixture = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WritingModelRoutes } from './packages/dsh-editor-shell/src/client/writing-model-routes.tsx'
import { ShellTheme, radixThemesStyles } from './packages/dsh-editor-shell/src/client/ui/theme-root.tsx'
import { redesignedStyles } from './packages/dsh-editor-shell/src/styles.ts'
const catalog = [
 {provider:'fixture',model:'alpha',label:'Fixture · Alpha',efforts:[{id:'off',name:'Off'},{id:'high',name:'High'}]},
 {provider:'fixture',model:'beta',label:'Fixture · Beta',efforts:[{id:'off',name:'Off'},{id:'low',name:'Low'}]},
]
const policies = Object.fromEntries(['a','b'].map(id=>[id,{revision:1,roles:{normal:{provider:'fixture',model:'alpha'}},purposes:{chat:{kind:'role',role:'normal'},'manuscript.completion':{kind:'model',provider:'fixture',model:id==='a'?'alpha':'beta',...(id==='a'?{reasoningEffort:'high'}:{})},'manuscript.rewrite':{kind:'role',role:'normal'}},limits:{concurrency:2,timeoutMs:30000,maxInputChars:10000,maxOutputTokens:2000,maxAttempts:1}}]))
const calls=[], held=new Set(), pending=[]
const clone=x=>structuredClone(x)
const connections=Object.fromEntries(['a','b'].map(id=>[id,{rpc:{call(channel,method,payload){
 calls.push({id,channel,method,payload:clone(payload)})
 const result=method==='status'?{ok:true,value:{policy:clone(policies[id])}}:{ok:true,value:{...clone(payload.policy),revision:policies[id].revision+1}}
 const publish=()=>{if(method==='update')policies[id]=clone(result.value);return result}
 if(held.has(id+':'+method))return new Promise(resolve=>pending.push({id,method,result,publish,resolve}))
 return Promise.resolve(publish())
}}}]))
let renderState
window.routeFixture={calls,policies,hold:(id,method)=>held.add(id+':'+method),release:(id,method,error)=>{held.delete(id+':'+method);const i=pending.findIndex(x=>x.id===id&&x.method===method);if(i<0)throw Error('No pending '+id+':'+method);const [item]=pending.splice(i,1);item.resolve(error?{ok:false,error:{message:error}}:item.publish())},pending:()=>pending.map(x=>({id:x.id,method:x.method})),switch:id=>renderState(x=>({...x,id})),mount:mounted=>renderState(x=>({...x,mounted})),theme:appearance=>renderState(x=>({...x,appearance}))}
function App(){const [state,setState]=useState({id:'a',mounted:true,appearance:'light'});renderState=setState;return <ShellTheme appearance={state.appearance} accent="blue"><style>{radixThemesStyles}{redesignedStyles}</style><main className="settings-content is-active" style={{padding:24,maxWidth:800}}>{state.mounted?<WritingModelRoutes connection={connections[state.id]} scope={{}} catalog={catalog} writable={true}/>:null}</main></ShellTheme>}
createRoot(document.getElementById('root')).render(<App/>)
`
const bundle = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: root }, bundle: true, write: false, alias: { 'react-dom/client': shellRequire.resolve('react-dom/client'), 'dsh-editor-workspace-kit/frontmatter': resolve(root, 'packages/dsh-editor-workspace-kit/src/frontmatter.ts') }, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'text' }, plugins: baseline ? [{ name: 'original-route-source', setup(b) { b.onLoad({ filter: /writing-model-routes\.tsx$/ }, args => args.path === sourcePath ? { contents: baselineSource, loader: 'tsx', resolveDir: resolve(sourcePath, '..') } : undefined) } }] : [] })
const server = createServer((req,res)=>{res.writeHead(200,{'content-type':req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8'});res.end(req.url==='/fixture.js'?bundle.outputFiles[0].text:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script></html>')})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
const report={ok:false,stage,checks:[],errors:[],output}
try {
 browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1024,height:720}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port)
 const route=page.getByRole('combobox',{name:'补全模型',exact:true})
 await route.filter({hasText:'Alpha'}).waitFor()
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>window.routeFixture.theme(theme),theme)
  for(const width of [1024,760]){await page.setViewportSize({width,height:720});await page.screenshot({path:resolve(output,theme+'-'+width+'.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'route overflow at '+width)}
 }
 report.checks.push('production controls render in light/dark and 1024/760 widths')
 if(!baseline || probe){
  const choose=async model=>{await route.click();await page.getByRole('option',{name:'Fixture · '+model,exact:true}).click()}
  const enabled=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="补全模型"]').disabled)
  const value=async model=>{await route.filter({hasText:model}).waitFor();await enabled()}
  await choose('Beta');await value('Beta')
  assert.equal(await page.evaluate(()=>window.routeFixture.policies.a.purposes['manuscript.completion'].reasoningEffort),undefined)
  report.checks.push('model switch clears unsupported previous reasoning effort')
  await page.evaluate(()=>window.routeFixture.hold('a','update'))
  await choose('Alpha');await page.waitForFunction(()=>window.routeFixture.pending().some(x=>x.id==='a'&&x.method==='update'))
  await page.evaluate(()=>window.routeFixture.switch('b'));await value('Beta')
  await page.evaluate(()=>window.routeFixture.release('a','update'));await value('Beta')
  report.checks.push('pending save from previous connection cannot block or overwrite new controls')
  await page.evaluate(()=>{window.routeFixture.hold('b','status');window.dispatchEvent(new Event('focus'))})
  await page.waitForFunction(()=>window.routeFixture.pending().some(x=>x.id==='b'&&x.method==='status'))
  await choose('Alpha');await value('Alpha')
  await page.evaluate(()=>window.routeFixture.release('b','status'));await value('Alpha')
  report.checks.push('late focus refresh cannot overwrite a newer successful save')
  await page.evaluate(()=>window.routeFixture.hold('b','update'))
  await choose('Beta');await page.waitForFunction(()=>window.routeFixture.pending().some(x=>x.id==='b'&&x.method==='update'))
  await page.evaluate(()=>window.routeFixture.release('b','update','revision conflict'))
  await page.getByRole('alert').filter({hasText:'revision conflict'}).waitFor();await enabled()
  await choose('Beta');await value('Beta')
  report.checks.push('conflict readback preserves server state and a subsequent save recovers')
  await page.evaluate(()=>window.routeFixture.hold('b','update'))
  await choose('Alpha');await page.waitForFunction(()=>window.routeFixture.pending().some(x=>x.id==='b'&&x.method==='update'))
  const oldStatusCalls = await page.evaluate(()=>window.routeFixture.calls.filter(x=>x.id==='b'&&x.method==='status').length)
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.evaluate(()=>window.routeFixture.mount(false));await route.waitFor({state:'detached'})
  await page.evaluate(()=>{window.routeFixture.switch('a');window.routeFixture.mount(true)})
  await value('Alpha');await page.evaluate(()=>window.routeFixture.release('b','update'));await value('Alpha')
  assert.equal(await page.evaluate(()=>window.routeFixture.calls.filter(x=>x.id==='b'&&x.method==='status').length), oldStatusCalls, 'disposed connection must not restart a deferred refresh')
  report.checks.push('unmount prevents late save publication and obsolete deferred refreshes')
  await route.focus();await page.keyboard.press('ArrowDown');await page.getByRole('listbox').waitFor();await page.keyboard.press('Escape')
  assert.equal(await route.evaluate(el=>el===document.activeElement),true)
  report.checks.push('keyboard opens dropdown and Escape returns focus')
 }
 assert.deepEqual(report.errors,[]);report.ok=true
} catch(error){report.failure=String(error);process.exitCode=1} finally {await browser?.close();await new Promise(done=>server.close(done));await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
