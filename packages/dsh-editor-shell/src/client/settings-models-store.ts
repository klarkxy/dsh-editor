/**
 * Models settings page store: pure logic shared by the editor and its tests.
 * Mirrors the wire/host semantics of the upstream `dsh-client-ui-settings-models`
 * package without pulling React or DOM concerns into the shell layer. The page
 * reads its data from the host's `settings.describe` and `llm.providers`
 * answers, joins them with `credentials.describe`, and lets the caller drive
 * edits through {@link pathOps} — the editor itself is responsible for owning
 * the keystroke buffer, this module only knows how to diff and validate.
 */
import type {
  ConfigurableProviderView,
  CredentialView,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-client-connection/client'

/** Printable ASCII minus space: the same charset the host's key normalizer uses. */
export const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/**
 * A pasted `NAME=value` environment line. Upper-cased head keeps real `sk-` keys
 * out of the false positive, and `[^=]` after the `=` keeps base64 padding
 * (`ABCD==`) from looking like an assignment. Runs only at the keystroke
 * boundary — a key that legitimately takes this shape would be silently rejected
 * here, but every other layer rejects it too, so there is no path through.
 */
export const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

/** Whether a value is wrapped in one matching pair of quote characters. */
export function isQuoted(value: string): boolean {
  const first = value[0]
  if (first !== '"' && first !== "'" && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

/**
 * Judge the key input's current value. An empty field is not a failure (the
 * card opens with it empty even when a key is stored, where it means keep the
 * stored one); a field of only whitespace IS a failure so typed input is never
 * silently dropped.
 */
export function apiKeyFailure(draft: string): 'keyBlank' | 'keyIllegalCharacters' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/**
 * Derive the conventional credential reference for a provider route. The v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Subset of `ctx.settingsSchema` the store needs. The host owns the real
 * schemastery-backed implementation; tests pass a small in-memory walk so the
 * diff/validate logic stays decoupled from the schema runtime.
 */
export type SettingsSchemaOps = {
  /** Re-instantiate a `Schema` from a serialized `Schema.toJSON()` envelope. */
  rehydrate(serialized: unknown): unknown
  /** Read the descriptor at a path inside the rehydrated schema. */
  nodeAtPath(root: unknown, path: string[]): { type?: string; list?: unknown[] } | undefined
  /** Resolve a path against a settings layer (value/base/user). */
  getPath(value: unknown, path: string[]): unknown
  /** True when every segment of `path` is present in the given layer. */
  hasPath(value: unknown, path: string[]): boolean
}

/** One joined row the editor renders: provider entry + its settings address + its credential view. */
export type ProviderRow = {
  entry: ConfigurableProviderView
  configured: boolean
  removable: boolean
  apiKeyEnv: string | undefined
  credential: CredentialView | undefined
}

/** The credential reference a resolved profile names, or undefined when the profile has no `apiKeyEnv`. */
export function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: string[],
  schema: SettingsSchemaOps,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The credential reference a row resolves keys through. */
export function refFor(
  namespace: SettingsNamespaceView | undefined,
  path: string[],
  provider: string,
  schema: SettingsSchemaOps,
): string {
  if (namespace !== undefined) {
    const named = apiKeyEnvOf(namespace, path, schema)
    if (named !== undefined) return named
  }
  return deriveKeyRef(provider)
}

/**
 * Join the provider directory, the settings namespace mirror, and the
 * referenced credentials into the rows the page renders. `namespaces` and
 * `credentials` are read by `settingsNs`/credential ref respectively; an
 * absent namespace marks the row unconfigured and an absent credential (after
 * a failed describe) is left undefined so the editor can show its own error.
 */
export function joinProviderRows(
  providers: ConfigurableProviderView[],
  namespaces: Map<string, SettingsNamespaceView>,
  credentials: Record<string, CredentialView>,
  schema: SettingsSchemaOps,
): ProviderRow[] {
  return providers.map((entry) => {
    const namespace = namespaces.get(entry.settingsNs)
    const apiKeyEnv = apiKeyEnvOf(namespace, entry.settingsPath, schema)
    const ref = apiKeyEnv ?? deriveKeyRef(entry.provider)
    return {
      entry,
      configured:
        namespace !== undefined &&
        (entry.settingsPath.length === 0 || schema.getPath(namespace.value, entry.settingsPath) !== undefined),
      removable:
        namespace !== undefined &&
        entry.settingsPath.length > 0 &&
        schema.hasPath(namespace.user, entry.settingsPath) &&
        !schema.hasPath(namespace.base, entry.settingsPath),
      apiKeyEnv,
      credential: credentials[ref],
    }
  })
}

/** Whether a row can serve model requests as it stands. */
export function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

/** The status dot a row shows next to its name: configured, missing, or no dot. */
export function credentialDot(row: ProviderRow): 'configured' | 'missing' | null {
  if (row.credential?.configured === true) return 'configured'
  if (row.apiKeyEnv !== undefined && row.credential?.configured === false) return 'missing'
  return null
}

/** Rows the "add" picker offers: not yet configured, and addressing a known namespace. */
export function addableRows(rows: ProviderRow[]): ProviderRow[] {
  return rows.filter((row) => !row.configured && row.entry.settingsNs !== '')
}

/**
 * The editor layout the owning namespace selects. `llm-deepseek` uses the
 * curated model-catalog editor; `llm-pi-ai` uses the protocol/route editor;
 * anything else is a third-party namespace the page does not own.
 */
export function layoutOf(ns: string): 'deepseek' | 'pi-ai' | 'unknown' {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route. The choices come
 * from the namespace's own schema so they cannot drift from the ones the
 * adapter actually accepts.
 */
export const PROBE_ROUTE = '\0probe'

export function protocolChoices(namespace: SettingsNamespaceView | undefined, schema: SettingsSchemaOps): string[] {
  if (namespace === undefined) return []
  const list = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list
    .map((entry) => (entry as { value?: unknown } | null | undefined)?.value)
    .filter((value): value is string => typeof value === 'string')
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 */
export function pathOps(base: string[], before: unknown, after: Record<string, unknown>): SettingsPathOpView[] {
  const previous =
    typeof before === 'object' && before !== null && !Array.isArray(before) ? (before as Record<string, unknown>) : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** One model row as the catalog editor carries it; loosely typed because the wire does not constrain it. */
export type ModelDraft = {
  id?: unknown
  name?: unknown
  contextWindow?: unknown
  maxTokens?: unknown
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {},
  )
}

/** One validation failure: the offending row's index and the i18n key to surface. */
export type ModelFailure = {
  index: number
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid' | 'modelMaxTokensInvalid'
}

/**
 * Validate the constraints the serialized schema cannot express: required id,
 * unique id, and the numeric fields being positive integers. The first
 * offending row wins, in declaration order, so the editor can scroll the user
 * to it.
 */
export function validateModels(value: unknown): ModelFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * `deriveKeyRef` upper-cases the id and replaces every non-alphanumeric run
 * with `_`, and a credential reference is a POSIX shell identifier, which
 * cannot start with a digit. A digit-leading id would pass every check this
 * card makes and then fail at the credential seam with a regex the user
 * cannot act on.
 */
export const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Judge the route id input's current value. Empty is not a failure (the user
 * has not started typing); once non-empty, must match the pattern and must
 * not collide with an already-configured route.
 */
export function routeFailure(route: string, taken: string[]): 'routeInvalid' | 'routeTaken' | undefined {
  if (route.length === 0) return undefined
  if (!ROUTE_PATTERN.test(route)) return 'routeInvalid'
  if (taken.includes(route)) return 'routeTaken'
  return undefined
}
