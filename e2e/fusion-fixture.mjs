/** A local OpenAI-compatible provider that records and executes native tool turns. */
import { createServer } from 'node:http'

const contentText = value => typeof value === 'string' ? value
  : Array.isArray(value) ? value.map(item => item?.text ?? item?.content ?? '').join('\n') : ''

export class FusionModelFixture {
  constructor() {
    this.calls = []
    this.toolCalls = []
    this.responder = () => ({ text: 'Fusion fixture idle.' })
    this.server = createServer((req, res) => this.handle(req, res))
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    return `http://127.0.0.1:${this.server.address().port}/v1`
  }

  async close() {
    this.server.closeAllConnections()
    await new Promise(resolve => this.server.close(resolve))
  }

  async handle(req, res) {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [
        { id: 'fixture-lead', object: 'model', owned_by: 'local-test' },
        { id: 'fixture-child', object: 'model', owned_by: 'local-test' },
      ] }))
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    let request
    try { request = JSON.parse(raw) } catch { res.writeHead(400); res.end('invalid JSON'); return }
    const call = {
      model: request.model,
      stream: Boolean(request.stream),
      tools: (request.tools ?? []).map(tool => tool.function?.name ?? tool.name).filter(Boolean),
      toolSchemas: Object.fromEntries((request.tools ?? []).map(tool => [tool.function?.name ?? tool.name, tool.function?.parameters ?? tool.parameters])),
      messages: (request.messages ?? []).map(message => ({
        role: message.role,
        text: contentText(message.content),
        name: message.name,
        toolCallId: message.tool_call_id,
        toolCalls: message.tool_calls?.map(item => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments })),
      })),
    }
    this.calls.push(call)
    let answer
    try { answer = await this.responder(call) } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(error) } }))
      return
    }
    answer ??= { text: 'Fusion fixture idle.' }
    const id = `fusion-local-${this.calls.length}`
    const usage = { prompt_tokens: 24, completion_tokens: 16, total_tokens: 40 }
    const tool = answer.tool && {
      id: `fusion-tool-${this.toolCalls.length + 1}`,
      type: 'function',
      function: { name: answer.tool, arguments: JSON.stringify(answer.arguments ?? {}) },
    }
    if (tool) this.toolCalls.push({ model: call.model, name: tool.function.name, arguments: answer.arguments, id: tool.id })
    if (!request.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', content: answer.text ?? null, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }], usage }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const event = (delta, finishReason = null, finalUsage) => ({ id, object: 'chat.completion.chunk', created: 1, model: request.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }], ...(finalUsage ? { usage: finalUsage } : {}) })
    if (tool) {
      res.write(`data: ${JSON.stringify(event({ role: 'assistant', tool_calls: [{ index: 0, ...tool }] }))}\n\n`)
      res.write(`data: ${JSON.stringify(event({}, 'tool_calls', usage))}\n\n`)
    } else {
      res.write(`data: ${JSON.stringify(event({ role: 'assistant', content: answer.text ?? '' }))}\n\n`)
      res.write(`data: ${JSON.stringify(event({}, 'stop', usage))}\n\n`)
    }
    res.end('data: [DONE]\n\n')
  }
}
