import { describe, it, expect } from 'vitest'
import { withWorkspaceWrite } from '../host.ts'
import { withWorkspaceWrite as sharedWrite } from '../host-api.ts'
describe('Host workspace mutation ordering',()=>{
  it('serializes competing file saves and multi-file operations across the public seam',async()=>{
    let release!:()=>void
    const held=new Promise<void>(resolve=>{release=resolve})
    const order:string[]=[]
    const first=withWorkspaceWrite('root',async()=>{order.push('rollback');await held;order.push('rollback-end')})
    const second=sharedWrite('root',async()=>{order.push('save')})
    await Promise.resolve();await Promise.resolve()
    expect(order).toEqual(['rollback'])
    await sharedWrite('other-root',async()=>{order.push('independent')})
    release();await Promise.all([first,second])
    expect(order).toEqual(['rollback','independent','rollback-end','save'])
  })
  it('releases a failed operation without poisoning later writes',async()=>{
    await expect(withWorkspaceWrite('failure',async()=>{throw new Error('failed')})).rejects.toThrow('failed')
    await expect(sharedWrite('failure',async()=>42)).resolves.toBe(42)
  })
})
