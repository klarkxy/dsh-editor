/** Product-selected optional features, distinct from a missing/broken selected plugin. */
export const SHELL_RPC_CHANNEL = '/dsh-editor-shell'
export type ShellFeatureConfig = { assistant?: boolean; zhihu?: boolean }
export type ShellCapabilities = { assistant: boolean; completion: boolean; zhihu: boolean }
export type ShellCapabilityResult = { ok: true; value: ShellCapabilities } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
