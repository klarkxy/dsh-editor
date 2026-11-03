import { describe, expect, it } from 'vitest'
import { installViewOf, refusalProblem } from './plugin-install-flow.ts'

const idle = { phase: 'idle', log: '' } as const

describe('plugin install dialog derivation', () => {
  it('starts at input and inspects through to the checked states', () => {
    expect(installViewOf(idle, undefined).kind).toBe('input')
    expect(installViewOf(idle, { status: 'accepted', kind: 'npm', name: '@klarkxy/dsh-mood', bundle: true, registry: null }).kind).toBe('inspected')
    const refused = installViewOf(idle, { status: 'refused', problem: 'not-found', reason: '404' })
    expect(refused.kind).toBe('refused')
    if (refused.kind === 'refused') expect(refused.problem).toBe('not-found')
  })

  it('maps refused problems to message keys', () => {
    expect(refusalProblem('already-installed')).toBe('already-installed')
    expect(refusalProblem('timeout')).toBe('network')
    expect(refusalProblem('weird')).toBe('unknown')
  })

  it('hands the phase to the store once an install is running or settled', () => {
    const running = installViewOf({ phase: 'running', log: '', progress: { requestId: 'r', phase: 'installing', attempt: { registry: 'npm', index: 1, total: 2 } } }, undefined)
    expect(running).toMatchObject({ kind: 'installing' })
    const settled = installViewOf({ phase: 'settled', log: '', result: { changed: true, application: 'applied', bundle: 'pkg', version: '1.0' } }, { status: 'accepted', kind: 'npm', bundle: true, registry: null })
    expect(settled).toMatchObject({ kind: 'result', result: 'applied', bundle: 'pkg' })
    const failed = installViewOf({ phase: 'settled', log: '', result: { changed: false, application: 'failed', error: { diagnostic: 'build blocked' }, pendingBuilds: ['esnext'] } }, undefined)
    expect(failed).toMatchObject({ kind: 'result', result: 'failed', pendingBuilds: ['esnext'] })
    const cancelled = installViewOf({ phase: 'settled', log: '', result: { changed: false, application: 'cancelled' } }, undefined)
    expect(cancelled).toMatchObject({ kind: 'result', result: 'cancelled' })
    const unknown = installViewOf({ phase: 'unknown', log: '' }, undefined)
    expect(unknown.kind).toBe('unknown')
  })
})
