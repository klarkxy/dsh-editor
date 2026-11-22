/** Click-through DeepSeek account sign-out on the models row; no live credentials. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const localRequire = createRequire(resolve(root, 'package.json'))
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
const viteRequire = createRequire(createRequire(localRequire.resolve('vitest/package.json')).resolve('vite/package.json'))
const { build } = viteRequire('esbuild')
const output = resolve(root, 'e2e/out', 'account-logout', 'after')
await mkdir(output, { recursive: true })

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { UiRoot } from './packages/dsh-editor-shell/src/ui/root.tsx'
import { useDeepseekAccount, useDeepseekAccountControls } from './packages/dsh-editor-shell/src/client/settings-models-account.tsx'
import { tokenStyles } from './packages/dsh-editor-shell/src/design-system/tokens.ts'
import { collectStyles, defineStyles } from './packages/dsh-editor-shell/src/design-system/layers.ts'
import './packages/dsh-editor-shell/src/client/base.styles.ts'
import './packages/dsh-editor-shell/src/client/dialogs.styles.ts'
import './packages/dsh-editor-shell/src/app/settings/settings.styles.ts'
import { S } from './helpers/selectors.mjs'
defineStyles('dsh.tokens','fixture-tokens',tokenStyles)
const shellCss=collectStyles()
const LINKS={usageUrl:'https://platform.deepseek.com/usage',topUpUrl:'https://platform.deepseek.com/top-up'}
const view=(status,attempt)=>({status,links:LINKS,attempt:attempt??null})
const items=[], waiters=[]
let current=view('credential-stored')
let disposed=false
const stream={
  disposed:false,
  push(next){items.push(next);for(const wake of waiters.splice(0))wake()},
  dispose(){this.disposed=true;disposed=true;for(const wake of waiters.splice(0))wake()},
  [Symbol.asyncIterator](){
    return {async next(){
      for(;;){
        const item=items.shift()
        if(item!==undefined) return {value:item,done:false}
        if(disposed) return {value:undefined,done:true}
        await new Promise(resolve=>waiters.push(resolve))
      }
    }}
  },
}
const calls={signOut:0,hasRunningAccountTasks:0}
const remote={
  getState:async()=>({ok:true,value:current}),
  startSignIn:async()=>({ok:true,value:current}),
  cancelSignIn:async()=>({ok:true,value:current}),
  signOut:async()=>{
    calls.signOut++
    current=view('signed-out')
    stream.push({type:'credentials-changed',state:current})
    return {ok:true,value:current}
  },
  getProfile:async()=>({ok:true,value:{status:'ready',value:{id:'u1',name:'作者甲',contact:'masked@example.com'}}}),
  hasRunningAccountTasks:async()=>{calls.hasRunningAccountTasks++;return {ok:true,value:false}},
  watch:()=>stream,
}
const ctx={remote:{account:remote},on:()=>()=>{}}
window.dshWindow={openExternal:()=>{},getAppInfo:async()=>({name:'DSH Editor',version:'9.9.9',platform:'linux',portable:false})}
window.accountFixture={calls,generation:1}
function AccountRow(){
  const account=useDeepseekAccount(ctx)
  const controls=useDeepseekAccountControls(ctx,account,true)
  return <div data-testid="dsh-models-account-fixture" data-generation={window.accountFixture.generation} className="models-row-actions" style={{padding:24,maxWidth:720}}>
    {controls.actions}{controls.detail}
  </div>
}
createRoot(document.getElementById('root')).render(<div className="shell-theme radix-themes light"><UiRoot theme="light"><style>{shellCss}</style><AccountRow/></UiRoot></div>)
`

const bundle = await build({
  stdin: { contents: fixture, loader: 'tsx', resolveDir: root },
  bundle: true,
  write: false,
  alias: { 'react-dom/client': shellRequire.resolve('react-dom/client') },
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text', '.webp': 'dataurl' },
})
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': req.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))

let browser
const report = {
  ok: false,
  stage: 'after',
  checks: [],
  errors: [],
  output,
  contract: 'Models account row: click 退出登录, confirm, consume credentials-changed without remounting.',
}
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.locator(S.modelsAccountFixture).waitFor()
  await page.locator(S.modelsAccountSignOut).waitFor()
  assert.equal(await page.locator(S.modelsAccountSignIn).count(), 0)
  report.checks.push('signed-in row shows 退出登录 and no 登录')
  await page.locator(S.modelsAccountSignOut).click()
  const dialog = page.getByRole('alertdialog', { name: '退出 DeepSeek 账号？' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.locator(S.modelsAccountSignIn).waitFor()
  assert.equal(await page.locator(S.modelsAccountSignOut).count(), 0)
  assert.equal(await page.evaluate(() => window.accountFixture.calls.signOut), 1)
  assert.equal(await page.evaluate(() => window.accountFixture.calls.hasRunningAccountTasks), 1)
  assert.equal(await page.locator(S.modelsAccountFixture).getAttribute('data-generation'), '1')
  report.checks.push('confirming 退出登录 calls signOut, consumes credentials-changed, and restores 登录 without remounting')
  await page.screenshot({ path: resolve(output, 'after-signout.png') })
  assert.deepEqual(report.errors, [])
  report.ok = true
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
