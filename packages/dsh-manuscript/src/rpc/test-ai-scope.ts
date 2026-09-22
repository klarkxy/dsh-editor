import { collectInsertText, type StreamChunkLike } from './completion.ts'
export function testAiScope(stream: (options: any) => AsyncIterable<StreamChunkLike>) {
  return { signal: new AbortController().signal, async run(request: any) {
    const text = await collectInsertText(stream({ system: request.system, messages: [{ role: 'user', content: [{ type: 'text', text: request.input }] }] }), { signal: request.signal, maxChars: request.insert?.maxChars ?? 100000 })
    return { text, receipt: { status: 'success' } }
  } }
}
