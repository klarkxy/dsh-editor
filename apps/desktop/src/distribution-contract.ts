import distribution from './distribution-contract.json' with { type: 'json' }

// Independent guarantees projected from the finite distribution description.
// Namespace and prefix do not confer ownership on an unknown package or entry.
function flagged(rows: Record<string, object>, flag: string): ReadonlySet<string> {
  return new Set(Object.entries(rows).filter(([, row]) => (row as Record<string, unknown>)[flag] === true).map(([name]) => name))
}

export const REQUIRED_CORE_BUNDLES = flagged(distribution.packages, 'requiredCore')
export const CORE_PLUGIN_BUNDLE_NAMES = flagged(distribution.packages, 'coreLocked')
export const RETIRED_PLUGIN_PACKAGES = flagged(distribution.packages, 'retired')
export const CORE_PLUGIN_ENTRY_IDS = flagged(distribution.entries, 'coreLocked')
export const HOST_LOCKED_ENTRY_IDS = flagged(distribution.entries, 'hostLocked')
export const RESTORED_PATCH_IDS = flagged(distribution.entries, 'restore')
export const RETIRED_PLUGIN_IDS = flagged(distribution.entries, 'retired')
export const OPTIONAL_PUBLIC_PLUGINS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(distribution.entries).flatMap(([id, row]) => 'optionalPackage' in row ? [[id, row.optionalPackage]] : []),
)
