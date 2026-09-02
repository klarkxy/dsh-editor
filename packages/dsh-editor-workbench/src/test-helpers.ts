import type {
  FileSystemLike,
  FsDirEntryLike,
  FsInfoLike,
  FsPathInfoLike,
  FsTargetLike,
  FsWriteIntentLike,
  SandboxExecutionPolicyLike,
  WorkspaceFileContext,
} from 'dsh-manuscript/host-api'
import type { BinaryFileSystem } from './binary.ts'

type Node = { type: 'file' | 'directory'; version: string; text?: string; bytes?: Uint8Array }

function normalized(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

class MemoryFileSystem implements BinaryFileSystem {
  readonly nodes = new Map<string, Node>([['/workspace', { type: 'directory', version: 'root' }]])
  /** Absolute target keys that should be reported as symlinks by `lstat`. */
  readonly symlinks = new Set<string>()
  readonly readPaths: string[] = []
  private counter = 0

  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const path = normalized(value.startsWith('/') ? value : `${opts?.cwd ?? '/workspace'}/${value}`)
    return { targetKey: path, displayPath: path }
  }

  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
  }

  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    const node = this.nodes.get(target.targetKey)
    if (!node) return undefined
    if (node.type === 'directory') return { type: 'directory', version: node.version }
    const size = node.bytes ? node.bytes.byteLength : node.text ? new TextEncoder().encode(node.text).byteLength : 0
    return { type: 'file', version: node.version, size }
  }

  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    const target = await this.resolve(value, opts)
    if (this.symlinks.has(target.targetKey)) {
      return { type: 'symlink', version: 'symlink' }
    }
    return this.stat(target)
  }

  async readText(target: FsTargetLike): Promise<string> {
    this.readPaths.push(target.targetKey)
    const node = this.nodes.get(target.targetKey)
    if (!node) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
    if (node.type !== 'file') throw Object.assign(new Error('not text'), { code: 'FS_NOT_TEXT' })
    if (node.text !== undefined) return node.text
    if (node.bytes !== undefined) return new TextDecoder('utf-8', { fatal: true }).decode(node.bytes)
    return ''
  }

  async readBytes(target: FsTargetLike): Promise<Uint8Array> {
    this.readPaths.push(target.targetKey)
    const node = this.nodes.get(target.targetKey)
    if (!node) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
    if (node.type !== 'file') throw Object.assign(new Error('not a regular file'), { code: 'FS_NOT_TEXT' })
    if (node.bytes) return node.bytes
    if (node.text !== undefined) return new TextEncoder().encode(node.text)
    return new Uint8Array()
  }

  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const prefix = `${target.targetKey}/`
    return [...this.nodes.entries()].flatMap(([path, node]) => {
      if (!path.startsWith(prefix)) return []
      const name = path.slice(prefix.length)
      if (!name || name.includes('/')) return []
      return [{ name, type: node.type, target: { targetKey: path, displayPath: path }, version: node.version }]
    })
  }

  async writeText(
    target: FsTargetLike,
    content: string,
    expected?: FsWriteIntentLike,
    _signal?: AbortSignal,
    _policy?: SandboxExecutionPolicyLike,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const existing = this.nodes.get(target.targetKey)
    if (expected?.kind === 'createIfAbsent' && existing) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && existing?.version !== expected.version) {
      throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    }
    const version = `v${++this.counter}`
    this.nodes.set(target.targetKey, { type: 'file', version, text: content })
    return { operation: existing ? 'update' : 'create', version, before: existing?.text ?? null, after: content }
  }
}

export function createMemoryContext(files: Record<string, string | Uint8Array>): WorkspaceFileContext {
  const fs = new MemoryFileSystem()
  for (const [relative, content] of Object.entries(files)) {
    const parts = relative.split('/')
    for (let index = 1; index < parts.length; index++) {
      fs.nodes.set(`/workspace/${parts.slice(0, index).join('/')}`, { type: 'directory', version: `dir-${index}` })
    }
    const node: Node = typeof content === 'string'
      ? { type: 'file', version: `initial-${relative}`, text: content }
      : { type: 'file', version: `initial-${relative}`, bytes: content }
    fs.nodes.set(`/workspace/${relative}`, node)
  }
  return {
    fs,
    cwd: '/workspace',
    root: { targetKey: '/workspace', displayPath: '/workspace' },
    policy: { mode: 'workspace-write', workspaceRoot: '/workspace', sessionId: 'session-1' },
  }
}

export type { MemoryFileSystem }
export type BinaryFs = FileSystemLike & { readBytes: (target: FsTargetLike, signal?: AbortSignal) => Promise<Uint8Array> }
