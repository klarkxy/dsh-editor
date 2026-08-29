import { beforeEach, describe, expect, it } from 'vitest'
import type {
  FileSystemLike,
  FsDirEntryLike,
  FsInfoLike,
  FsPathInfoLike,
  FsTargetLike,
  FsWriteIntentLike,
  SandboxExecutionPolicyLike,
} from '../host.ts'
import { createTextFile, FileOpError, listDir, MAX_TEXT_BYTES, readTextFile, readTextFileLimited, writeTextFile, type WorkspaceFileContext } from './files.ts'
import { PathConfineError } from './paths.ts'

type Node = { type: 'file' | 'directory' | 'other'; version: string; text?: string }

function normalize(path: string): string {
  const absolute = path.replace(/\\/g, '/')
  const prefix = absolute.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return prefix + parts.join('/')
}

class FakeFileSystem implements FileSystemLike {
  readonly nodes = new Map<string, Node>()
  readonly symlinks = new Map<string, string>()
  readonly writes: Array<{ target: string; expected?: FsWriteIntentLike; policy?: SandboxExecutionPolicyLike }> = []
  raceCreate = false
  private counter = 10

  absolute(path: string, cwd = '/workspace'): string {
    return normalize(path.startsWith('/') ? path : `${cwd}/${path}`)
  }

  canonical(path: string): string {
    const link = [...this.symlinks.entries()]
      .sort((a, b) => b[0].length - a[0].length)
      .find(([source]) => path === source || path.startsWith(`${source}/`))
    if (!link) return path
    return normalize(link[1] + path.slice(link[0].length))
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const displayPath = this.absolute(path, opts?.cwd)
    return { displayPath, targetKey: this.canonical(displayPath) }
  }

  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
  }

  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    const node = this.nodes.get(target.targetKey)
    return node ? { type: node.type, version: node.version, size: node.text === undefined ? undefined : new TextEncoder().encode(node.text).byteLength } : undefined
  }

  async lstat(path: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    const absolute = this.absolute(path, opts?.cwd)
    if (this.symlinks.has(absolute)) return { type: 'symlink', version: 'link-1' }
    const node = this.nodes.get(absolute)
    return node ? { type: node.type, version: node.version, size: node.text?.length } : undefined
  }

  async readText(target: FsTargetLike): Promise<string> {
    const node = this.nodes.get(target.targetKey)
    if (!node) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
    if (node.type !== 'file' || node.text === undefined) throw Object.assign(new Error('not text'), { code: 'FS_NOT_TEXT' })
    return node.text
  }

  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const prefix = `${target.targetKey}/`
    const entries: FsDirEntryLike[] = []
    for (const [path, node] of this.nodes) {
      if (!path.startsWith(prefix)) continue
      const name = path.slice(prefix.length)
      if (!name || name.includes('/')) continue
      entries.push({ name, type: node.type, target: { targetKey: path, displayPath: path }, version: node.version })
    }
    return entries
  }

  async writeText(
    target: FsTargetLike,
    content: string,
    expected?: FsWriteIntentLike,
    _signal?: AbortSignal,
    policy?: SandboxExecutionPolicyLike,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    this.writes.push({ target: target.targetKey, expected, policy })
    if (this.raceCreate) {
      this.raceCreate = false
      this.nodes.set(target.targetKey, { type: 'file', version: 'racer', text: 'racer wins' })
    }
    const existing = this.nodes.get(target.targetKey)
    if (expected?.kind === 'createIfAbsent' && existing) {
      throw Object.assign(new Error('already exists'), { code: 'FS_NOT_OBSERVED' })
    }
    if (expected?.kind === 'replaceIfVersion' && (!existing || existing.version !== expected.version)) {
      throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    }
    const before = existing?.text ?? null
    const version = `v${++this.counter}`
    this.nodes.set(target.targetKey, { type: 'file', version, text: content })
    return { operation: existing ? 'update' : 'create', version, before, after: content }
  }
}

let fs: FakeFileSystem
let policy: SandboxExecutionPolicyLike
let context: WorkspaceFileContext

beforeEach(async () => {
  fs = new FakeFileSystem()
  fs.nodes.set('/workspace', { type: 'directory', version: 'root' })
  fs.nodes.set('/workspace/notes', { type: 'directory', version: 'dir-1' })
  fs.nodes.set('/workspace/notes/a.md', { type: 'file', version: 'opaque-a', text: 'hello' })
  policy = { mode: 'workspace-write', workspaceRoot: '/workspace', sessionId: 'session-1' }
  context = { fs, cwd: '/workspace', root: await fs.resolve('/workspace'), policy }
})

describe('manuscript files through the DSH filesystem', () => {
  it('lists and reads without exposing backend target identity', async () => {
    expect(await listDir(context, '.')).toEqual([{ name: 'notes', type: 'directory' }])
    expect(await readTextFile(context, 'notes/a.md')).toEqual({ text: 'hello', version: 'opaque-a' })
  })

  it('creates only below an existing directory with an atomic absent guard', async () => {
    const created = await createTextFile(context, 'notes/b.md', 'next')
    expect(created.version).toBe('v11')
    expect(fs.nodes.get('/workspace/notes/b.md')?.text).toBe('next')
    expect(fs.writes[0]).toEqual({
      target: '/workspace/notes/b.md',
      expected: { kind: 'createIfAbsent' },
      policy,
    })
    await expect(createTextFile(context, 'missing/c.md', 'nope')).rejects.toMatchObject({ code: 'PARENT_MISSING' })
    expect(fs.nodes.has('/workspace/missing')).toBe(false)
  })

  it('preserves a concurrent creator instead of overwriting it', async () => {
    fs.raceCreate = true
    await expect(createTextFile(context, 'notes/race.md', 'ours')).rejects.toMatchObject({ code: 'EXISTS' })
    expect(fs.nodes.get('/workspace/notes/race.md')?.text).toBe('racer wins')
  })

  it('version-guards an atomic replacement and passes the session policy', async () => {
    const first = await readTextFile(context, 'notes/a.md')
    const written = await writeTextFile(context, 'notes/a.md', 'hello world', first.version)
    expect(written.version).toBe('v11')
    expect(fs.writes[0]?.expected).toEqual({ kind: 'replaceIfVersion', version: 'opaque-a' })
    expect(fs.writes[0]?.policy).toBe(policy)
    await expect(writeTextFile(context, 'notes/a.md', 'stale', first.version)).rejects.toMatchObject({ code: 'STALE' })
    expect(fs.nodes.get('/workspace/notes/a.md')?.text).toBe('hello world')
  })

  it('fails closed under a read-only session policy', async () => {
    context = { ...context, policy: { ...policy, mode: 'read-only' } }
    await expect(createTextFile(context, 'notes/b.md', 'no')).rejects.toMatchObject({ code: 'DENIED' })
    await expect(writeTextFile(context, 'notes/a.md', 'no', 'opaque-a')).rejects.toMatchObject({ code: 'DENIED' })
    expect(fs.writes).toHaveLength(0)
  })

  it('rejects a final symbolic link even when it points inside', async () => {
    fs.symlinks.set('/workspace/notes/link.md', '/workspace/notes/a.md')
    await expect(readTextFile(context, 'notes/link.md')).rejects.toMatchObject({ code: 'SYMLINK' })
  })

  it('rejects every ancestor link before canonical resolution can traverse it', async () => {
    fs.nodes.set('/outside', { type: 'directory', version: 'outside' })
    fs.symlinks.set('/workspace/link', '/outside')
    await expect(createTextFile(context, 'link/new.md', 'escape')).rejects.toMatchObject({ code: 'SYMLINK' })
    fs.symlinks.set('/workspace/inside-link', '/workspace/notes')
    await expect(readTextFile(context, 'inside-link/a.md')).rejects.toMatchObject({ code: 'SYMLINK' })
    expect(fs.writes).toHaveLength(0)
  })

  it('rejects lexical escapes before touching the filesystem', async () => {
    await expect(readTextFile(context, '../secret.md')).rejects.toBeInstanceOf(PathConfineError)
    await expect(createTextFile(context, 'C:/secret.md', 'x')).rejects.toBeInstanceOf(PathConfineError)
  })

  it('rejects oversized text on both read and write', async () => {
    fs.nodes.set('/workspace/notes/big.md', { type: 'file', version: 'big', text: 'x'.repeat(MAX_TEXT_BYTES + 1) })
    await expect(readTextFile(context, 'notes/big.md')).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await expect(createTextFile(context, 'notes/new.md', 'x'.repeat(MAX_TEXT_BYTES + 1))).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('applies a smaller caller-specific ceiling before returning text', async () => {
    await expect(readTextFileLimited(context, 'notes/a.md', 4)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    await expect(readTextFileLimited(context, 'notes/a.md', 5)).resolves.toEqual({ text: 'hello', version: 'opaque-a' })
  })

})
