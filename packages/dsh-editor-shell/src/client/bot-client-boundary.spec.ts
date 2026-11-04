import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* Host-only packages must never reach the client bundle: the profile's module
   table does not materialize them, so importing one fails the whole shell boot
   (seen as 'missed the module table' at launch). */
const HOST_ONLY = ['@deepseek-ai/schemastery']

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.spec.ts') || entry.endsWith('.spec.tsx')) continue
    const file = resolve(dir, entry)
    if (statSync(file).isDirectory()) yield* sources(file)
    else if (/\.(ts|tsx)$/.test(entry)) yield file
  }
}

describe('client boundary', () => {
  for (const area of ['client', 'model']) {
    it(`${area}/ modules do not import host-only packages`, () => {
      const offenders: string[] = []
      for (const file of sources(resolve(src, area))) {
        const text = readFileSync(file, 'utf8')
        for (const pkg of HOST_ONLY) {
          if (new RegExp(`from ['"]${pkg.replace('/', '\/')}`).test(text)) offenders.push(`${file}: ${pkg}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }
})
