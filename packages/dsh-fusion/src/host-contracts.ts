import type { FusionActor, FusionCandidate, FusionTarget } from './contracts.ts'

/** Implemented by the Editor Host; the standalone plugin has no manuscript dependency. */
export interface FusionWritingHost {
  matches(header: { agentPreset?: string }): boolean
  /** Exact native names, checked again by the execution guard, never just hidden from the model. */
  readonly writerTools: readonly string[]
  allowLeadTool(name: string, args: unknown): boolean
  capture(actor: FusionActor, input: unknown, signal: AbortSignal): Promise<FusionTarget>
  /** Holds the existing workspace write lock, including dirty-draft and version checks. */
  transact<T>(actor: FusionActor, target: FusionTarget, candidate: FusionCandidate, signal: AbortSignal,
    run: (access: FusionApplicationAccess) => Promise<T>): Promise<T>
}
export interface FusionApplicationPreview {
  path: string
  before: string
  after: string
  /** Empty only for an exclusive create whose destination does not exist. */
  version: string
}
export interface FusionApplicationAccess {
  /** Read without requiring the old baseline, for reconciling an already persisted intent. */
  inspect(): Promise<{ text: string; version: string } | undefined>
  /** Revalidates original target and basis and refuses any unsaved author draft. */
  prepare(): Promise<FusionApplicationPreview>
  /** Must repeat relevant checks immediately before a version-checked write. */
  commit(expectedVersion: string): Promise<{ path: string; version: string }>
}
