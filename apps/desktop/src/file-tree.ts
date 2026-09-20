import { existsSync } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** True when `link` is a symlink/junction to `target`. */
export async function linkPointsTo(link: string, target: string): Promise<boolean> {
  try {
    const info = await lstat(link)
    if (!info.isSymbolicLink()) return false
    return resolve(join(link, '..'), await readlink(link)) === resolve(target)
  } catch {
    return false
  }
}

/**
 * Compare two directory trees. Files and junctions must match.
 * Names in `destExtras` may exist only on the destination (owner markers).
 */
export async function sameFileTree(source: string, dest: string, destExtras: ReadonlySet<string> = new Set()): Promise<boolean> {
  if (!existsSync(source) || !existsSync(dest)) return false
  return walk(source, dest, destExtras)
}

async function walk(source: string, dest: string, destExtras: ReadonlySet<string>): Promise<boolean> {
  let fromEntries: import('node:fs').Dirent[]
  let toEntries: import('node:fs').Dirent[]
  try {
    fromEntries = await readdir(source, { withFileTypes: true })
    toEntries = await readdir(dest, { withFileTypes: true })
  } catch {
    return false
  }
  const fromNames = new Set(fromEntries.map((entry) => entry.name))
  for (const entry of toEntries) {
    if (!fromNames.has(entry.name) && !destExtras.has(entry.name)) return false
  }
  for (const entry of fromEntries) {
    const from = join(source, entry.name)
    const to = join(dest, entry.name)
    let fromStat: import('node:fs').Stats
    let toStat: import('node:fs').Stats
    try {
      fromStat = await lstat(from)
      toStat = await lstat(to)
    } catch {
      return false
    }
    if (fromStat.isSymbolicLink() || toStat.isSymbolicLink()) {
      if (!fromStat.isSymbolicLink() || !toStat.isSymbolicLink()) return false
      if (resolve(source, await readlink(from)) !== resolve(dest, await readlink(to))) return false
      continue
    }
    if (fromStat.isDirectory()) {
      if (!toStat.isDirectory()) return false
      if (!await walk(from, to, destExtras)) return false
      continue
    }
    if (!fromStat.isFile() || !toStat.isFile()) return false
    const [left, right] = await Promise.all([readFile(from), readFile(to)])
    if (!left.equals(right)) return false
  }
  return true
}
