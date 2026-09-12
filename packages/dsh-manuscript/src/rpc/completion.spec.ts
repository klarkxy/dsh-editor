import { describe, expect, it } from 'vitest'
import { collectInsertText, sanitizeInsert, type StreamChunkLike } from './completion.ts'

async function* chunks(items: StreamChunkLike[]): AsyncIterable<StreamChunkLike> {
  for (const item of items) yield item
}

describe('collectInsertText', () => {
  it('keeps only text-delta fragments and strips fences', async () => {
    const text = await collectInsertText(chunks([
      { type: 'block-start', text: 'ignore' },
      { type: 'reasoning-delta', text: 'thought' },
      { type: 'text-delta', text: '```md\n窗上的雾' },
      { type: 'text-delta', text: '还没散。\n```' },
      { type: 'finish' },
    ]))
    expect(text).toBe('窗上的雾还没散。')
  })

  it('discards output after abort', async () => {
    const signal = AbortSignal.abort()
    await expect(collectInsertText(chunks([{ type: 'text-delta', text: 'nope' }]), { signal })).resolves.toBe('')
  })

  it('discards output after a stream error', async () => {
    async function* boom(): AsyncIterable<StreamChunkLike> {
      yield { type: 'text-delta', text: 'partial' }
      throw new Error('provider')
    }
    await expect(collectInsertText(boom())).rejects.toThrow('provider')
  })

  it('caps insert length', async () => {
    const text = await collectInsertText(chunks([{ type: 'text-delta', text: 'abcdefghij' }]), { maxChars: 4 })
    expect(text).toBe('abcd')
  })
})

describe('sanitizeInsert', () => {
  it('drops leading labels', () => {
    expect(sanitizeInsert('插入内容：下一句')).toBe('下一句')
  })
})

describe('embedded reasoning in provider text',()=>{
 it('skips reasoning split across chunks before applying the visible-text cap',async()=>{
   const text=await collectInsertText(chunks([{type:'text-delta',text:'<thi'},{type:'text-delta',text:'nk>'+ 'hidden '.repeat(1000)},{type:'text-delta',text:'</th'},{type:'text-delta',text:'ink>雨落在窗台上。'}]),{maxChars:4});
   expect(text).toBe('雨落在窗');
 });
 it('never returns an unterminated reasoning block as an insert',async()=>{
   expect(await collectInsertText(chunks([{type:'text-delta',text:'<think>unfinished reasoning'}]))).toBe('');
 });
 it('keeps ordinary text and removes multiple reasoning blocks',async()=>{
   expect(await collectInsertText(chunks([{type:'text-delta',text:'前文<think>one</think>后文<think>two</think>。'}]))).toBe('前文后文。');
 });
});

it('preserves visible leading paragraph whitespace when filtering provider text',async()=>{
 expect(await collectInsertText(chunks([{type:'text-delta',text:'\n  下一句'}]))).toBe('\n  下一句');
});

it('surfaces the real runtime terminal failure and never accepts partial output', async () => {
  await expect(collectInsertText(chunks([
    { type: 'text-delta', text: 'partial' },
    { type: 'finish', reason: { kind: 'error', failure: { message: 'model not available' } } },
  ]))).rejects.toThrow('model not available')
  expect(await collectInsertText(chunks([
    { type: 'text-delta', text: 'partial' }, { type: 'finish', reason: { kind: 'aborted' } },
  ]))).toBe('')
})
