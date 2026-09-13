/**
 * Speed up wait / typing segments from demo-record timeline, then lay VO on top.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'e2e', 'out', 'demo')
const rawDir = resolve(output, 'raw')
const workDir = resolve(output, 'work')
const voDir = resolve(output, 'vo')
const rates = { wait: 10, type: 2, action: 1, hold: 1, scene: 1, vo: 1 }

const timeline = JSON.parse(await readFile(resolve(output, 'timeline.json'), 'utf8'))
const events = timeline.events
if (!Array.isArray(events) || !events.length) throw new Error('timeline.events missing')

const videos = (await readdir(rawDir).catch(() => [])).filter((name) => /\.(webm|mp4)$/i.test(name))
if (!videos.length) throw new Error(`no raw video in ${rawDir}`)
const rawVideo = resolve(rawDir, videos.sort()[0])

await rm(workDir, { recursive: true, force: true })
await mkdir(workDir, { recursive: true })

function run(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${bin} exited ${code}`)))
  })
}

function probe(file) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let text = ''
    child.stdout.on('data', (chunk) => { text += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      const duration = Number(text.trim())
      if (code === 0 && Number.isFinite(duration)) resolvePromise(duration)
      else reject(new Error(`ffprobe failed for ${file}: ${text}`))
    })
  })
}

function segmentsFromTimeline(endAt) {
  const ordered = [...events].sort((a, b) => a.t - b.t)
  const parts = []
  let cursor = 0
  let rate = 1
  for (const event of ordered) {
    const t = Math.max(0, Math.min(event.t, endAt))
    if (t > cursor + 0.05) parts.push({ start: cursor, end: t, rate })
    cursor = t
    rate = rates[event.kind] ?? 1
  }
  if (endAt > cursor + 0.05) parts.push({ start: cursor, end: endAt, rate })
  const merged = []
  for (const part of parts) {
    if (part.end - part.start < 0.12) {
      if (merged.length) merged[merged.length - 1].end = part.end
      continue
    }
    const last = merged[merged.length - 1]
    if (last && last.rate === part.rate) last.end = part.end
    else merged.push({ ...part })
  }
  return merged
}

function remap(rawT, parts) {
  let out = 0
  for (const part of parts) {
    if (rawT <= part.start) return out
    const used = Math.min(rawT, part.end) - part.start
    out += used / part.rate
    if (rawT <= part.end) return out
  }
  return out
}

const rawDuration = await probe(rawVideo)
const parts = segmentsFromTimeline(Math.min(rawDuration, events[events.length - 1].t + 1))
const list = []

for (const [index, part] of parts.entries()) {
  const file = resolve(workDir, `seg-${String(index).padStart(3, '0')}.mp4`)
  const filters = ['fps=30', 'scale=1920:1080:flags=lanczos', `setpts=PTS/${part.rate}`]
  await run('ffmpeg', [
    '-y', '-ss', part.start.toFixed(3), '-to', part.end.toFixed(3),
    '-i', rawVideo,
    '-an',
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
    file,
  ])
  list.push(`file '${file.replaceAll('\\', '/')}'`)
}

const sped = resolve(workDir, 'sped.mp4')
await writeFile(resolve(workDir, 'concat.txt'), `${list.join('\n')}\n`, 'utf8')
await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', resolve(workDir, 'concat.txt'), '-c', 'copy', sped])
const spedDuration = await probe(sped)

const voMarks = events.filter((event) => event.kind === 'vo' && event.note)
const audioInputs = []
const labels = []
let nextStart = 0
const placed = []

for (const mark of voMarks) {
  const file = resolve(voDir, `${mark.note}.mp3`)
  const duration = await probe(file).catch(() => 0)
  if (!duration) continue
  let start = Math.max(remap(mark.t, parts), nextStart)
  if (start + duration > spedDuration + 1.5) start = Math.max(0, spedDuration - duration)
  placed.push({ file, start, duration, id: mark.note })
  nextStart = start + duration + 0.35
  audioInputs.push('-i', file)
  const delay = Math.round(start * 1000)
  const label = `a${labels.length}`
  labels.push(`[${audioInputs.length / 2}:a]adelay=${delay}|${delay},volume=1.0[${label}]`)
}

const final = resolve(output, 'dsh-editor-demo.mp4')
if (!labels.length) {
  await run('ffmpeg', ['-y', '-i', sped, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-an', final])
} else {
  const mix = labels.map((_, index) => `[a${index}]`).join('')
  const filter = `${labels.join(';')};${mix}amix=inputs=${labels.length}:normalize=0:duration=longest[a]`
  await run('ffmpeg', [
    '-y', '-i', sped, ...audioInputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    final,
  ])
}

await writeFile(resolve(output, 'assemble.json'), `${JSON.stringify({
  rawVideo,
  rawDuration,
  spedDuration,
  parts,
  placed,
  final,
}, null, 2)}\n`, 'utf8')

console.log(`[demo-assemble] ${final}`)
console.log(`[demo-assemble] raw ${rawDuration.toFixed(1)}s → sped ${spedDuration.toFixed(1)}s, vo clips ${placed.length}`)
