// Production React + CodeMirror regression fixture. It does not open a real
// workspace or request a model. Run from the repository root with Node.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../../..')
const baseline = process.argv.includes('--baseline')
const localRequire = createRequire(resolve(root, 'package.json'))
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
const viteRequire = createRequire(createRequire(localRequire.resolve('vitest/package.json')).resolve('vite/package.json'))
const { build } = viteRequire('esbuild')
const output = resolve(import.meta.dirname, '.artifacts', baseline ? 'before' : 'after')
await mkdir(output, { recursive: true })

const source = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorCore, editorCoreStyles } from './packages/dsh-manuscript/src/client/editor-core/index.ts'
import { apply as applyStandalone } from './packages/dsh-manuscript/src/client/index.tsx'
import { ManuscriptTheme, radixThemesStyles } from './packages/dsh-manuscript/src/client/themes.tsx'
const params = new URLSearchParams(location.search), standalone = params.has('standalone')
const calls=[], pending=[], reads=[], suggestions=[], saved=[], notices=[], disk={
  'a.md':{text:'第一篇原稿',version:'v1'}, 'b.md':{text:'第二篇原稿',version:'v1'},
  'metadata.md':{text:'---\\nmeta: 1\\n---\\n正文保持不变',version:'v1'},
}
let handle, setRender, hostDraft=null, callbackRevision=-1
let holdWrites=false, failWrite='', holdReadPath=''
const invoke=async (_channel, endpoint, payload, signal) => {
  calls.push({endpoint,payload:structuredClone(payload)})
  if(endpoint==='capabilities.get') return {ok:true,value:{completion:false}}
  if(endpoint==='tree.list') return {ok:true,value:{entries:Object.keys(disk).map(name=>({name,type:'file'}))}}
  if(endpoint==='file.read') {
    const result={ok:true,value:{...disk[payload.path]}}
    return holdReadPath===payload.path ? new Promise(resolve=>reads.push(()=>resolve(result))) : result
  }
  if(endpoint==='file.write') {
    const finish=()=>{ if(failWrite) return {ok:false,error:{message:failWrite}};disk[payload.path]={text:payload.text,version:'v'+(Number(disk[payload.path].version.slice(1))+1)};return {ok:true,value:{version:disk[payload.path].version}} }
    return holdWrites ? new Promise(resolve=>pending.push(()=>resolve(finish()))) : finish()
  }
  if(endpoint==='draft.get') return {ok:true,value:{draft:hostDraft}}
  if(endpoint==='draft.list') return {ok:true,value:{drafts:[]}}
  if(endpoint==='draft.put') {hostDraft=payload;return {ok:true,value:{}}}
  if(endpoint==='draft.delete') {hostDraft=null;return {ok:true,value:{}}}
  if(endpoint==='fim.complete'||endpoint==='patch.complete') return new Promise(resolve=>suggestions.push({signal,finish:text=>resolve({ok:true,value:{text}})}))
  throw Error('Unexpected endpoint '+endpoint)
}
const sessionKey='dsh-editor:draft:'+encodeURIComponent('/fixture'+String.fromCharCode(0)+'a.md')
if(params.has('legacy')) sessionStorage.setItem(sessionKey,JSON.stringify({sessionId:'old',path:'a.md',text:'旧记录保留的稿件',version:params.has('conflict')?'old-version':'v1'}))
const observable = snapshot=>({getSnapshot:()=>snapshot,subscribe:()=>()=>{}})
let Standalone
const ctx={
  connection:{rpc:{call:invoke}},sessions:{list:observable({byId:{s:{cwd:'/fixture'}}})},
  uiWorkspace:{current:observable({sessionId:'s'})},uiSession:{adapter:{current:observable({key:'s'})}},
  slots:{inject(_name,fn){fn();return()=>{}},register(_spec,render){Standalone=render;return()=>{}}},
}
if(standalone) applyStandalone(ctx)
window.fixture={calls,pending,reads,suggestions,saved,notices,disk,sessionKey,handle:()=>handle,callbackRevision:()=>callbackRevision,
  hold:()=>{holdWrites=true},release:()=>{holdWrites=false;const run=pending.shift();if(!run)throw Error('No pending write');run()},
  holdRead:path=>{holdReadPath=path},releaseRead:()=>{holdReadPath='';reads.shift()()},
  fail:message=>{failWrite=message},finishSuggestion:text=>suggestions.shift().finish(text),
  rerender:()=>setRender(state=>({...state,revision:state.revision+1})),
  mode:mode=>setRender(state=>({...state,mode})),path:path=>setRender(state=>({...state,path})),
  reload:()=>setRender(state=>({...state,externalRevision:state.externalRevision+1})),
  mount:mounted=>setRender(state=>({...state,mounted})),
  appearance:appearance=>{document.documentElement.dataset.theme=appearance;setRender(state=>({...state,appearance}))},
  view:()=>document.querySelector('[data-testid="'+(standalone?'manuscript':'paper')+'-editor"]')?.__cmView,
}
const projection={
  project(path,text){const offset=path==='metadata.md'?text.indexOf('\\n---\\n')+5:0;return {text:text.slice(offset),offset}},
  replace(path,text,paper){const offset=this.project(path,text).offset;return text.slice(0,offset)+paper},
}
function App(){
 const [state,setState]=useState({mode:'session',path:'a.md',revision:0,externalRevision:0,mounted:true,appearance:'light'});setRender=setState
 const draft=state.mode==='none'?undefined:state.mode==='host'?{kind:'host',call:(endpoint,payload)=>invoke('/draft',endpoint,payload)}:{kind:'session',cwd:'/fixture'}
 return <ManuscriptTheme><style>{radixThemesStyles}{editorCoreStyles}</style><main style={{height:'80vh'}}>{standalone?<Standalone/>:state.mounted?<EditorCore sessionId="s" cwd="/fixture" path={state.path} rpc={{call:invoke}} draft={draft} autoSaveDelayMs={params.has('autosave')?30:60000} externalRevision={state.externalRevision} completionEnabled={!params.has('no-completion')} enablePatch paperProjection={projection} onHandle={next=>{handle=next}} onSaved={()=>saved.push(state.path)} onNotice={message=>{callbackRevision=state.revision;notices.push(message)}} onError={message=>{callbackRevision=state.revision;notices.push(message)}}/>:null}</main></ManuscriptTheme>
}
createRoot(document.getElementById('root')).render(<App/>)
`

const bundle = await build({
  stdin: { contents: source, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  alias: { 'react-dom/client': shellRequire.resolve('react-dom/client') },
  platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'text' },
  plugins: baseline ? [{ name: 'task-start-source', setup(builder) {
    builder.onLoad({ filter: /dsh-manuscript[\\/]src[\\/]client[\\/](?:editor-core[\\/]editor|index)\.tsx$/ }, args => ({
      contents: execFileSync('git', ['show', '4b4e21ad17a70e49788ee4c393fc742a26064733:' + args.path.slice(root.length + 1).replaceAll('\\', '/')], { cwd: root, encoding: 'utf8' }),
      loader: 'tsx',
    }))
  } }] : [],
})
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': request.url === '/fixture.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
let page
const report = { ok: false, baseline, checks: [], errors: [], output, evidence: 'Production EditorCore and standalone overlay with a deterministic RPC fixture; no live filesystem, model, Electron, or physical IME.' }
try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1024, height: 720 } })
  page.on('pageerror', error => report.errors.push(error.message))
  const open = async query => {
    // Each scenario starts a separate author session. Same-origin navigation
    // keeps sessionStorage, so explicitly clear the previous scenario's draft.
    if (page.url().startsWith('http:')) await page.evaluate(() => sessionStorage.clear())
    await page.goto('http://127.0.0.1:' + server.address().port + '/?' + query)
    if (query.includes('standalone')) {
      await page.getByTestId('manuscript-open').click()
      await page.getByRole('button', { name: 'a.md', exact: true }).click()
    }
    await page.waitForFunction(() => window.fixture.view()?.state.doc.length > 0)
  }
  const state = () => page.evaluate(() => {
    const view = window.fixture.view()
    return { text: view.state.doc.toString(), selection: { from: view.state.selection.main.from, to: view.state.selection.main.to }, reads: window.fixture.calls.filter(call => call.endpoint === 'file.read').length }
  })
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await open('')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('。作者输入')
  await page.evaluate(() => window.fixture.view().dispatch({ selection: { anchor: 2, head: 5 } }))
  const typed = await state()
  for (const appearance of ['light', 'dark']) {
    await page.evaluate(appearance => window.fixture.appearance(appearance), appearance)
    await tick()
    await page.waitForFunction(() => document.querySelector('[data-testid="paper-wordcount"]')?.textContent === window.fixture.view().state.doc.toString().replace(/\s/g, '').length + ' 字')
    await page.screenshot({ path: resolve(output, appearance + '-rerender.png') })
  }
  await page.evaluate(() => window.fixture.rerender())
  await tick()
  const rerendered = await state()
  if (baseline) {
    report.observed = { before: typed, after: rerendered }
    report.checks.push('recorded task-start input/selection behavior after a parent render')
  } else {
    assert.deepEqual(rerendered, typed)
    report.checks.push('parent and theme renders preserve typed text, selection, and file.read count')
    assert.equal(await page.evaluate(() => window.fixture.handle().undo()), true)
    await tick()
    assert.equal((await state()).text, '第一篇原稿')
    assert.equal(await page.evaluate(() => window.fixture.handle().redo()), true)
    report.checks.push('ordinary renders preserve CodeMirror undo and redo history')

    for (const mode of ['none', 'host', 'session']) {
      await page.evaluate(mode => window.fixture.mode(mode), mode)
      await tick()
      await page.waitForFunction(() => window.fixture.handle()?.getCommandState().loaded)
      await page.evaluate(() => window.fixture.view().dispatch({ changes: { from: 0, to: 0, insert: '新字' }, selection: { anchor: 1, head: 2 } }))
      const before = await state()
      await page.evaluate(() => window.fixture.rerender())
      await tick()
      assert.deepEqual(await state(), before)
    }
    report.checks.push('omitted draft, session draft, and recreated host draft/transport callbacks retain the same document')
    await page.evaluate(async () => { await window.fixture.handle().save() })
    assert.equal(await page.evaluate(() => window.fixture.callbackRevision()), 4)
    report.checks.push('stable reporting callbacks still invoke the latest host render callback')

    await open('legacy')
    assert.equal((await state()).text, '旧记录保留的稿件')
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem(window.fixture.sessionKey)).cwd === '/fixture')
    await page.evaluate(() => window.fixture.mount(false)); await tick()
    await page.evaluate(() => window.fixture.mount(true)); await tick()
    await page.waitForFunction(() => window.fixture.handle()?.getCommandState().loaded)
    assert.equal((await state()).text, '旧记录保留的稿件')
    report.checks.push('legacy drafts without cwd restore, write the scoped format, and survive remount')

    await open('legacy&conflict')
    assert.equal((await state()).text, '旧记录保留的稿件')
    await page.waitForFunction(() => window.fixture.handle()?.getCommandState().conflict)
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem(window.fixture.sessionKey)).cwd === '/fixture')
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem(window.fixture.sessionKey)).version), 'old-version')
    await page.evaluate(() => window.fixture.reload()); await tick()
    await page.waitForFunction(() => window.fixture.handle()?.getCommandState().conflict)
    assert.equal((await state()).text, '旧记录保留的稿件')
    report.checks.push('conflicting restored drafts keep their original base version through sync and explicit reload')

    await open('autosave')
    await page.evaluate(() => window.fixture.view().dispatch({ changes: { from: 0, insert: '即时' } }))
    await page.waitForFunction(() => window.fixture.disk['a.md'].text === '即时第一篇原稿')
    assert.equal(await page.getByTestId('paper-wordcount').textContent(), '7 字')
    report.checks.push('autosave flushes the immediate buffer before the 150ms React text debounce')

    await open('')
    await page.evaluate(() => { window.fixture.holdRead('a.md'); window.fixture.reload() })
    await page.waitForFunction(() => window.fixture.reads.length === 1)
    await page.evaluate(() => window.fixture.path('b.md'))
    await page.waitForFunction(() => window.fixture.handle().getDocument()?.path === 'b.md')
    await page.evaluate(() => window.fixture.releaseRead()); await tick()
    assert.equal((await state()).text, '第二篇原稿')
    report.checks.push('a delayed read from the old document cannot replace the new document')

    await open('')
    await page.evaluate(() => {
      window.fixture.view().dispatch({ changes: { from: 0, insert: '待存' } })
      window.fixture.hold()
      window.fixture.handle().save().then(result=>{window.fixture.lastSave=result})
    })
    await page.waitForFunction(() => window.fixture.pending.length === 1)
    await page.evaluate(() => window.fixture.path('b.md'))
    await page.waitForFunction(() => window.fixture.handle().getDocument()?.path === 'b.md')
    await page.evaluate(() => window.fixture.release()); await tick()
    assert.equal(await page.evaluate(() => window.fixture.lastSave), false)
    assert.deepEqual(await page.evaluate(() => window.fixture.saved), [])
    assert.equal((await state()).text, '第二篇原稿')
    report.checks.push('a delayed write acknowledgement cannot publish success into another document')

    await open('')
    await page.evaluate(() => {
      window.fixture.view().dispatch({ changes: { from: 0, insert: '保留' } })
      window.fixture.fail('STALE changed on disk')
    })
    assert.equal(await page.evaluate(() => window.fixture.handle().save()), false)
    await page.waitForFunction(() => window.fixture.handle().getCommandState().conflict)
    const writesBefore = await page.evaluate(() => window.fixture.calls.filter(call=>call.endpoint==='file.write').length)
    assert.equal(await page.evaluate(() => window.fixture.handle().save()), false)
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(call=>call.endpoint==='file.write').length), writesBefore)
    assert.equal((await state()).text, '保留第一篇原稿')
    report.checks.push('stale disk writes preserve the draft and conflict blocks a repeated save')

    await open('')
    await page.evaluate(() => window.fixture.path('metadata.md'))
    await page.waitForFunction(() => window.fixture.handle().getDocument()?.path === 'metadata.md')
    assert.equal((await state()).text, '正文保持不变')
    assert.equal(await page.evaluate(() => {
      const editor=window.fixture.handle()
      return editor.saveMetadataText(editor.getText().replace('meta: 1','meta: 2'),editor.captureTarget())
    }), true)
    assert.equal((await state()).text, '正文保持不变')
    const metadataWrites = await page.evaluate(() => window.fixture.calls.filter(call=>call.endpoint==='file.write').length)
    assert.equal(await page.evaluate(() => {
      const editor=window.fixture.handle()
      return editor.saveMetadataText(editor.getText()+'正文变化',editor.captureTarget())
    }), false)
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(call=>call.endpoint==='file.write').length), metadataWrites)
    await page.evaluate(() => {
      const editor=window.fixture.handle()
      window.fixture.target=editor.captureTarget()
      window.fixture.hold()
      editor.saveMetadataText(editor.getText().replace('meta: 2','meta: 3'),window.fixture.target).then(result=>{window.fixture.lastSave=result})
    })
    await page.waitForFunction(() => window.fixture.pending.length === 1)
    assert.equal(await page.evaluate(() => {
      const editor=window.fixture.handle()
      return editor.saveMetadataText(editor.getText().replace('meta: 3','meta: 4'),editor.captureTarget())
    }), false)
    await page.evaluate(() => window.fixture.release()); await tick()
    await page.evaluate(() => {
      const editor=window.fixture.handle()
      window.fixture.target=editor.captureTarget()
      window.fixture.reload()
    })
    await tick()
    await page.waitForFunction(() => window.fixture.handle().getCommandState().loaded)
    assert.equal(await page.evaluate(() => {
      const editor=window.fixture.handle()
      return editor.saveMetadataText(editor.getText().replace('meta: 3','meta: 4'),window.fixture.target)
    }), false)
    report.checks.push('metadata shares acknowledged saving, preserves projected body, and rejects in-flight/stale targets')

    await open('')
    await page.evaluate(() => {
      const editor=window.fixture.handle(),view=window.fixture.view()
      view.dispatch({selection:{anchor:1,head:3}})
      window.fixture.target=editor.captureTarget()
      view.dispatch({changes:{from:0,insert:'新'}})
    })
    assert.equal(await page.evaluate(() => window.fixture.handle().replaceSelection('误贴',window.fixture.target)), false)
    await page.evaluate(() => {window.fixture.target=window.fixture.handle().captureTarget();window.fixture.reload()})
    await tick()
    await page.waitForFunction(() => window.fixture.handle().getCommandState().loaded)
    assert.equal(await page.evaluate(() => window.fixture.handle().restoreTarget(window.fixture.target)), false)
    report.checks.push('clipboard targets reject changed revisions and same-path reload generations')

    await open('')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.evaluate(() => window.fixture.handle().requestCompletion())
    await page.waitForFunction(() => window.fixture.suggestions.length === 1)
    await page.evaluate(() => window.fixture.finishSuggestion('续写建议'))
    await page.getByTestId('paper-ghost').waitFor()
    await page.keyboard.press('Tab'); await tick()
    assert.equal((await state()).text, '第一篇原稿续写建议')
    await page.evaluate(() => window.fixture.handle().requestCompletion())
    await page.waitForFunction(() => window.fixture.suggestions.length === 1)
    await page.evaluate(() => window.fixture.view().dispatch({changes:{from:0,insert:'键入'}}))
    assert.equal(await page.evaluate(() => window.fixture.suggestions[0].signal.aborted), true)
    await page.evaluate(() => window.fixture.finishSuggestion('迟到建议')); await tick()
    assert.equal(await page.getByTestId('paper-ghost').count(), 0)
    report.checks.push('ghost acceptance uses the live view and typing cancels/ignores a late completion')

    await page.evaluate(() => window.fixture.view().dispatch({selection:{anchor:0,head:2}}))
    await page.evaluate(() => window.fixture.handle().requestRewrite())
    await page.waitForFunction(() => window.fixture.suggestions.length === 1)
    await page.evaluate(() => window.fixture.finishSuggestion('改写'))
    await page.getByRole('button', {name:'应用修改',exact:true}).click(); await tick()
    assert.ok((await state()).text.startsWith('改写'))
    await page.evaluate(() => {
      window.fixture.view().dispatch({selection:{anchor:0,head:2}})
      window.fixture.handle().requestRewrite()
    })
    await page.waitForFunction(() => window.fixture.suggestions.length === 1)
    await page.evaluate(() => window.fixture.mount(false)); await tick()
    assert.equal(await page.evaluate(() => window.fixture.suggestions[0].signal.aborted), true)
    await page.evaluate(() => window.fixture.finishSuggestion('卸载后迟到')); await tick()
    assert.equal(await page.locator('.cm-content').count(), 0)
    assert.equal(await page.evaluate(() => window.fixture.handle()), null)
    report.checks.push('selection rewrite applies through the existing buffer and unmount aborts/disposes pending work')

    await open('standalone')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('。新稿')
    await page.getByRole('button', { name: 'b.md', exact: true }).click()
    await page.getByTestId('manuscript-switch-guard').waitFor()
    await page.evaluate(() => window.fixture.hold())
    report.stage = 'standalone-first-save'
    await page.getByRole('button', { name: '保存后切换', exact: true }).click()
    await page.waitForFunction(() => window.fixture.pending.length === 1)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('。保存期间继续输入')
    await page.evaluate(() => window.fixture.release()); await tick()
    report.stage = 'standalone-typing-guard'
    assert.equal(await page.getByTestId('manuscript-path').textContent(), 'a.md')
    assert.ok((await state()).text.endsWith('保存期间继续输入'))
    await page.getByTestId('manuscript-switch-guard').waitFor()
    await page.getByRole('button', { name: '保存后切换', exact: true }).click()
    report.stage = 'standalone-second-save-switch'
    await page.waitForFunction(() => document.querySelector('[data-testid="manuscript-path"]')?.textContent === 'b.md')
    assert.ok(await page.evaluate(() => window.fixture.disk['a.md'].text.endsWith('保存期间继续输入')))
    report.checks.push('standalone save-and-switch stays on fresh typing and switches after the complete buffer is saved')
    assert.deepEqual(report.errors, [])
  }
  report.ok = true
} catch (error) {
  report.failure = error.stack ?? String(error)
  report.state = await page?.evaluate(() => ({
    text: window.fixture?.view()?.state.doc.toString(),
    path: document.querySelector('[data-testid="manuscript-path"]')?.textContent,
    pending: window.fixture?.pending.length,
    calls: window.fixture?.calls,
    disk: window.fixture?.disk,
    guard: document.querySelector('[data-testid="manuscript-switch-guard"]')?.textContent,
  })).catch(() => null)
  await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
