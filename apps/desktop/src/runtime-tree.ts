import { createHash } from 'node:crypto'
import { cp, lstat, readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface TreeMeasure { files: number; bytes: number }
export interface TreeDigest extends TreeMeasure { sha256: string }

function assertRuntimeEntry(path: string, entry: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }): void {
  if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in desktop runtime resources: ${path}`)
  if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Unsupported desktop runtime entry: ${path}`)
}

async function measure(root: string, hash?: ReturnType<typeof createHash>): Promise<TreeMeasure> {
  let files = 0
  let bytes = 0
  const rootEntry = await lstat(root)
  assertRuntimeEntry(root, rootEntry)
  if (!rootEntry.isDirectory()) throw new Error(`Desktop runtime tree must be a directory: ${root}`)
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      assertRuntimeEntry(path, entry)
      if (entry.isDirectory()) { await visit(path); continue }
      if (hash) {
        const data = await readFile(path)
        hash.update(relative(root, path).replaceAll('\\', '/'))
        hash.update('\0')
        hash.update(createHash('sha256').update(data).digest('hex'))
        hash.update('\n')
        bytes += data.byteLength
      } else {
        bytes += (await lstat(path)).size
      }
      files += 1
    }
  }
  await visit(root)
  return { files, bytes }
}

/** Preparation, final-package validation and portable copies share one policy.
 * This applies only to node/dsh/profile resource trees, not Electron frameworks. */
export async function treeDigest(root: string): Promise<TreeDigest> {
  const hash = createHash('sha256')
  const size = await measure(root, hash)
  return { sha256: hash.digest('hex'), ...size }
}

export async function treeMeasure(root: string): Promise<TreeMeasure> {
  return measure(root)
}

export async function copyRuntimeTree(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: async (path) => {
      assertRuntimeEntry(path, await lstat(path))
      return true
    },
  })
}
