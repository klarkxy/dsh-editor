import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyTools } from './tools.ts'
import { createZhihuService } from './index.ts'
import { createZhihuUsageRecorder, type ZhihuUsageTableLike } from './usage.ts'
import { createZhihuSearchTool } from './tool-definitions.ts'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'
const signal = () => new AbortController().signal
function fixture(fetcher: ZhihuSearchFetcher) {
  const rows = new Map<string, ReturnType<ZhihuUsageTableLike['get']>>()
  const usage = createZhihuUsageRecorder({get: key => rows.get(key), async put(key,value) { await Promise.resolve(); rows.set(key,value) }})
  return createZhihuService({fetcher,env:{ZHIHU_ACCESS_TOKEN:'fixture-token-only'}},usage)
}
const empty: ZhihuSearchFetcher = async () => ({ok:true,status:200,async text(){return ''},async json(){return {Code:0,Data:{Items:[]}}}})
describe('independent Zhihu service', () => {
  it('serializes one count per concurrent RPC and Tool call in the existing usage domain',async () => {
    const service=fixture(empty)
    const tool=createZhihuSearchTool(service.toolOptions) as unknown as {execute(args:unknown,ctx:{signal:AbortSignal}):Promise<unknown>}
    const results=await Promise.all(Array.from({length:12},()=>service.call('search',{query:'普通资料'},signal())))
    await tool.execute({query:'工具查询'},{signal:signal()})
    expect(results.every(result=>result.ok)).toBe(true)
    const summary=await service.usageSummary(1)
    expect(summary.days).toEqual([expect.objectContaining({calls:13,failures:0,results:0})])
    await service.dispose()
  })
  it('reports network errors distinctly from successful empty results',async () => {
    const service=fixture(async () => ({ok:false,status:503,async text(){return 'unavailable'},async json(){return null}}))
    expect(await service.call('search',{query:'普通资料'},signal())).toMatchObject({ok:false,error:{code:'http-error'}})
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({calls:1,failures:1})])
    await service.dispose()
  })
  it('aborts active RPC on disposal and flushes its failure before completing disposal',async () => {
    let started!:()=>void
    const ready=new Promise<void>(resolve=>{started=resolve})
    const service=fixture(async (_url,init) => {
      started()
      return await new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}))
    })
    const call=service.call('search',{query:'普通资料'},signal())
    await ready
    await service.dispose()
    expect(await call).toMatchObject({ok:false,error:{code:'cancelled'}})
    expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({calls:1,failures:1})])
    expect(await service.call('search',{query:'关闭后'},signal())).toMatchObject({ok:false,error:{code:'cancelled'}})
  })
})

it('tracks optional Tool execution through service unload and flushes its one failed count',async()=>{
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve});let requests=0;
 const service=fixture(async (_url,init)=>{requests++;started();return await new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}))});
 const tools:Array<{name:string;execute(args:unknown,ctx:{signal:AbortSignal}):Promise<unknown>}>=[];
 applyTools({zhihu:service,tools:{register:(tool:typeof tools[number])=>tools.push(tool)}} as unknown as Context);
 const tool=tools.find(tool=>tool.name==='zhihu_search')!;
 const outcome=tool.execute({query:'卸载中的工具'},{signal:signal()}).then(()=>null,error=>error);
 await ready;await service.dispose();expect(await outcome).toBeInstanceOf(Error);
 expect((await service.usageSummary(1)).days).toEqual([expect.objectContaining({calls:1,failures:1})]);
 await expect(tool.execute({query:'关闭后工具'},{signal:signal()})).rejects.toBeDefined();expect(requests).toBe(1);
});
