import type { ChildProcess } from 'node:child_process'

export interface ChildLike {
  pid?: number
  exitCode: number | null
  stdout?: NodeJS.ReadableStream | null
  stderr?: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type SpawnChild = (command: string, args: string[], options: {
  cwd?: string
  env: NodeJS.ProcessEnv
  stdio: ['ignore', 'pipe', 'pipe']
  windowsHide: boolean
}) => ChildLike

export const asChildLike = (child: ChildProcess): ChildLike => child as ChildLike
