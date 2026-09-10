import { describe, expect, it } from 'vitest'
import { createMemoryContext } from './test-helpers.ts'
import { compileContext } from './context.ts'
import { parseProjectContextEnvelope } from './contracts.ts'

describe('task-only context compilation', () => {
  it('does not read or embed project materials, global preferences, or the active document', async () => {
    const files=createMemoryContext({'AGENTS.md':'root rules','项目总览.md':'SECRET_OVERVIEW','世界书/设定总汇.md':'SECRET_WORLD','正文/001.md':'SECRET_PROSE'})
    const result=await compileContext(files,'继续','正文/001.md','GLOBAL_PREF','GLOBAL_MEMORY')
    expect(JSON.parse(result.serialized)).toEqual({schema:'dsh-editor.project-context',version:3,user_request:'继续',active_path:'正文/001.md'})
    expect(result.receipt).toEqual({sources:[]})
    expect((files.fs as unknown as {readPaths:string[]}).readPaths).toEqual(['/workspace/AGENTS.md'])
    expect(parseProjectContextEnvelope(result.serialized)).toEqual(result.envelope)
  })
  it('allows old projects without a rules file and avoids all worldbook scans', async () => {
    const files=createMemoryContext(Object.fromEntries(Array.from({length:1000},(_,i)=>['世界书/'+i+'.md','unrelated'])))
    expect((await compileContext(files,'改一句话')).envelope.version).toBe(3)
    expect((files.fs as unknown as {readPaths:string[]}).readPaths).toEqual([])
  })
  it('fails explicitly when root rule filenames conflict', async () => { await expect(compileContext(createMemoryContext({'AGENTS.md':'a','Agents.md':'b'}),'继续')).rejects.toThrow('多个') })
  it('rejects forged locations instead of silently attaching another path', async () => { await expect(compileContext(createMemoryContext({}),'继续','../outside.md')).rejects.toThrow('路径') })
})
