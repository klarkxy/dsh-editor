/** Pure derivation of the add-plugin dialog view from the store snapshot and the
 * local inspection result — kept UI-free so it stays unit-testable. */
import type { InstallState, PluginSpecInspection, ManagerRegistry } from '../client/plugin-manager.ts'

export type RefusalProblem =
  | 'invalid-spec' | 'already-installed' | 'not-found' | 'not-a-package'
  | 'not-a-bundle' | 'network' | 'unknown'

/** Official problem codes → i18n keys (filled by the caller via t()). */
export const REFUSAL_PROBLEM_KEYS: Record<RefusalProblem, string> = {
  'invalid-spec': 'plugins.installRefuseInvalid',
  'already-installed': 'plugins.installRefuseInstalled',
  'not-found': 'plugins.installRefuseNotFound',
  'not-a-package': 'plugins.installRefuseNotPackage',
  'not-a-bundle': 'plugins.installRefuseNotBundle',
  'network': 'plugins.installRefuseNetwork',
  'unknown': 'plugins.installRefuseUnknown',
}

export function refusalProblem(problem: unknown): RefusalProblem {
  switch (problem) {
    case 'invalid-spec': return 'invalid-spec'
    case 'already-installed': return 'already-installed'
    case 'not-found': return 'not-found'
    case 'not-a-package': return 'not-a-package'
    case 'not-a-bundle': return 'not-a-bundle'
    case 'network': case 'timeout': case 'offline': return 'network'
    default: return 'unknown'
  }
}

export type InstallView =
  | { kind: 'input' }
  | { kind: 'inspected'; accepted: Extract<PluginSpecInspection, { status: 'accepted' }> }
  | { kind: 'refused'; refused: Extract<PluginSpecInspection, { status: 'refused' }>; problem: RefusalProblem }
  | { kind: 'installing'; progress: InstallState['progress']; cancelling: boolean }
  | { kind: 'result'; result: 'applied' | 'restart-required' | 'failed' | 'cancelled'; bundle?: string; version?: string; message?: string; pendingBuilds?: string[] }
  | { kind: 'unknown' }

/** The store install snapshot owns the phase once an install starts. */
export function installViewOf(install: InstallState, inspection: PluginSpecInspection | undefined): InstallView {
  if (install.phase === 'starting' || install.phase === 'running' || install.phase === 'cancelling') {
    return { kind: 'installing', progress: install.progress, cancelling: install.phase === 'cancelling' }
  }
  if (install.phase === 'unknown') return { kind: 'unknown' }
  if (install.phase === 'settled' && install.result) {
    const result = install.result
    if (result.application === 'applied') return { kind: 'result', result: 'applied', bundle: result.bundle, version: result.version }
    if (result.application === 'restart-required') return { kind: 'result', result: 'restart-required', bundle: result.bundle, version: result.version, message: result.restartReason }
    if (result.application === 'cancelled') return { kind: 'result', result: 'cancelled' }
    return {
      kind: 'result', result: 'failed',
      message: result.error?.diagnostic ?? result.error?.message ?? install.failure?.reason,
      ...(Array.isArray(result.pendingBuilds) && result.pendingBuilds.length ? { pendingBuilds: result.pendingBuilds } : {}),
    }
  }
  if (inspection?.status === 'accepted') return { kind: 'inspected', accepted: inspection }
  if (inspection?.status === 'refused') return { kind: 'refused', refused: inspection, problem: refusalProblem(inspection.problem) }
  return { kind: 'input' }
}

export function registryLabel(registry: ManagerRegistry): string {
  return registry ?? 'default'
}
