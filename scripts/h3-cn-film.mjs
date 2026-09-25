import { loadEnvFile } from 'node:process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Production-only helper. Keys stay in this process and are never written to receipts.
try { loadEnvFile(resolve('.env')) } catch (e) { if (e.code !== 'ENOENT') throw e }
const key = process.env.MINIMAX_H3_CN_KEY
if (!key) throw new Error('MINIMAX_H3_CN_KEY is missing from .env')
const base = 'https://api.minimax.cn'
const out = resolve('e2e/out/film-20260924/h3')
await mkdir(out, { recursive: true })
const exists = path => access(path).then(() => true, () => false)
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}: ${JSON.stringify(result).replaceAll(key, '[redacted]')}`)
  return result
}
const [action = 'check', name] = process.argv.slice(2)
if (action === 'check') {
  const result = await api('/v2/query/video_generation?page_num=1&page_size=1')
  console.log(JSON.stringify({ authenticated: true, host: base, responseFields: Object.keys(result) }))
} else if (action === 'submit') {
  if (!/^[a-z0-9-]+$/.test(name || '')) throw new Error('Provide a shot name')
  const receiptPath = resolve(out, `${name}.receipt.json`)
  if (await exists(receiptPath)) throw new Error('Receipt already exists; query it instead of resubmitting')
  const request = JSON.parse(await readFile(resolve(out, `${name}.request.json`), 'utf8'))
  if (request.model !== 'MiniMax-H3' || !['2K', '768P'].includes(request.resolution)) throw new Error('Unexpected film model or resolution')
  const receipt = { name, host: base, submittedAt: new Date().toISOString(), requestSha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'), state: 'submitting' }
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2))
  try {
    const result = await api('/v2/video_generation', request)
    if (!result.task_id) throw new Error('Task creation response has no task_id')
    await writeFile(receiptPath, JSON.stringify({ ...receipt, state: 'submitted', taskId: result.task_id }, null, 2))
    console.log(JSON.stringify({ shot: name, taskId: result.task_id, state: 'submitted' }))
  } catch (e) {
    // Keep ambiguous submissions on disk. Never automatically buy the same shot twice.
    await writeFile(receiptPath, JSON.stringify({ ...receipt, state: 'submission-error', error: e.message }, null, 2))
    throw e
  }
} else if (action === 'query') {
  if (!/^[a-z0-9-]+$/.test(name || '')) throw new Error('Provide a shot name')
  const receipt = JSON.parse(await readFile(resolve(out, `${name}.receipt.json`), 'utf8'))
  if (!receipt.taskId) throw new Error('Submission needs reconciliation; no task ID recorded')
  const result = await api(`/v2/query/video_generation/${encodeURIComponent(receipt.taskId)}`)
  await writeFile(resolve(out, `${name}.status.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ shot: name, taskId: receipt.taskId, status: result.task?.status, duration: result.task?.duration, resolution: result.task?.resolution }))
  if (result.task?.status === 'succeeded') {
    const target = resolve(out, `${name}.mp4`)
    if (!(await exists(target))) {
      const url = new URL(result.task.content.url)
      if (url.protocol !== 'https:') throw new Error('Unexpected download URL')
      const media = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!media.ok) throw new Error(`Download HTTP ${media.status}`)
      await writeFile(target, Buffer.from(await media.arrayBuffer()))
      console.log(`Saved ${name}.mp4`)
    }
  }
} else throw new Error('Use check, submit <shot>, or query <shot>')
