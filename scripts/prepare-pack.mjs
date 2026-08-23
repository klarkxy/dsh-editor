import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packDir = path.resolve(root, '.pack')
const relative = path.relative(root, packDir)

if (relative !== '.pack' || path.dirname(packDir) !== root) {
  throw new Error(`refusing to reset unexpected pack directory: ${packDir}`)
}

fs.rmSync(packDir, { recursive: true, force: true })
fs.mkdirSync(packDir, { recursive: true })
console.log(`prepared ${path.relative(root, packDir)}`)
