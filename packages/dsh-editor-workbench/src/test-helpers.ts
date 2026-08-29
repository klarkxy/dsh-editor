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

type Node = { type: 'file' | 'directory'; version: string; text?: string }

function normalized(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

class MemoryFileSystem implements FileSystemLike {
  readonly nodes = new Map<string, Node>([['/workspace', { type: 'directory', version: 'root' }]])
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
    return node ? { type: node.type, version: node.version, size: node.text?.length } : undefined
  }

  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    return this.stat(await this.resolve(value, opts))
  }

  async readText(target: FsTargetLike): Promise<string> {
    this.readPaths.push(target.targetKey)
    const node = this.nodes.get(target.targetKey)
    if (!node) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
    if (node.type !== 'file') throw Object.assign(new Error('not text'), { code: 'FS_NOT_TEXT' })
    return node.text ?? ''
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

export function createMemoryContext(files: Record<string, string>): WorkspaceFileContext {
  const fs = new MemoryFileSystem()
  for (const [relative, text] of Object.entries(files)) {
    const parts = relative.split('/')
    for (let index = 1; index < parts.length; index++) {
      fs.nodes.set(`/workspace/${parts.slice(0, index).join('/')}`, { type: 'directory', version: `dir-${index}` })
    }
    fs.nodes.set(`/workspace/${relative}`, { type: 'file', version: `initial-${relative}`, text })
  }
  return {
    fs,
    cwd: '/workspace',
    root: { targetKey: '/workspace', displayPath: '/workspace' },
    policy: { mode: 'workspace-write', workspaceRoot: '/workspace', sessionId: 'session-1' },
  }
}
