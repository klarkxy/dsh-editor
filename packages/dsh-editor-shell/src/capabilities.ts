/** Product-selected optional features, distinct from a missing/broken selected plugin. */
export const SHELL_RPC_CHANNEL = '/dsh-editor-shell'
export type ShellFeatureConfig = { features?: Record<string, string> }
export type ShellCapabilities = { features: Record<string, boolean> }
export type ShellCapabilityResult =
  | { ok: true; value: ShellCapabilities }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

export function featureEnabled(caps: ShellCapabilities | undefined, feature: string): boolean {
  return caps?.features?.[feature] === true
}

export function resolveShellCapabilities(
  config: ShellFeatureConfig,
  getService: (name: string) => unknown,
): ShellCapabilityResult {
  const selected = config.features ?? {}
  const features: Record<string, boolean> = {}
  const missing: string[] = []
  for (const [feature, service] of Object.entries(selected)) {
    if (typeof service !== 'string' || !service) continue
    const present = Boolean(getService(service))
    features[feature] = present
    if (!present) missing.push(feature)
  }
  if (missing.length) {
    return { ok: false, error: { code: 'internal', message: '所选组合缺少已启用的插件', details: { missing } } }
  }
  return { ok: true, value: { features } }
}
