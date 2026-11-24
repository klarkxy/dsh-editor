import { describe, expect, it } from 'vitest'
import type { ConfigurableProviderView, CredentialView, SettingsNamespaceView, SettingsPathOpView } from './dsh-compat.ts'
import {
  ACCOUNT_PROVIDER,
  ENV_LINE,
  LEGAL_API_KEY,
  PROBE_ROUTE,
  ROUTE_PATTERN,
  STANDARD_REASONING_EFFORTS,
  addableRows,
  apiKeyEnvOf,
  apiKeyFailure,
  credentialDot,
  deriveDisplayName,
  deriveKeyRef,
  deriveRoute,
  discoveryFailureKind,
  isAccountRow,
  isLocalNetworkHost,
  isLoopbackHost,
  isQuoted,
  isValidEndpointBaseURL,
  joinProviderRows,
  layoutOf,
  modelDrafts,
  needsSetup,
  normalizeBaseURL,
  parseModelIds,
  pathOps,
  protocolChoices,
  protocolOrder,
  providerUsable,
  reasoningChoiceOf,
  reasoningEffortsFor,
  refFor,
  routeFailure,
  validateModels,
  type ProviderRow,
  type SettingsSchemaOps,
} from './client/settings-models-store.ts'

/**
 * A tiny schema ops that walks plain objects. `rehydrate` returns the
 * serialized envelope unchanged so the caller can also inspect it, and
 * `nodeAtPath` reads `type`/`list` descriptors from objects shaped like
 * schemastery's union envelope (`{ type: 'union', list: [{ value }, ...] }`).
 */
function makeSchema(nodes: Record<string, { type?: string; list?: unknown[] }> = {}): SettingsSchemaOps {
  return {
    rehydrate: (serialized: unknown) => serialized,
    nodeAtPath: (_root, path) => nodes[path.join('.')],
    getPath: (value, path) => walkPath(value, path),
    hasPath: (value, path) => {
      if (value === undefined || value === null) return false
      let cursor: unknown = value
      for (const segment of path) {
        if (typeof cursor !== 'object' || cursor === null) return false
        if (!(segment in (cursor as Record<string, unknown>))) return false
        cursor = (cursor as Record<string, unknown>)[segment]
      }
      return true
    },
  }
}

function walkPath(value: unknown, path: string[]): unknown {
  if (value === undefined || value === null) return undefined
  let cursor: unknown = value
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
    if (cursor === undefined) return undefined
  }
  return cursor
}

function entry(overrides: Partial<ConfigurableProviderView> = {}): ConfigurableProviderView {
  const provider = typeof overrides.provider === 'string' ? overrides.provider : 'minimax-cn'
  return {
    provider,
    displayName: 'Minimax CN',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'minimax-cn'],
    active: true,
    ...overrides,
    id: typeof overrides.id === 'string' ? overrides.id : provider,
  }
}

function namespace(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: {},
    value: {},
    revision: 1,
    applies: 'live',
    secrets: [],
    ...overrides,
  }
}

describe('deriveKeyRef', () => {
  it('uppercases a single-segment provider id and appends _API_KEY', () => {
    expect(deriveKeyRef('openai')).toBe('OPENAI_API_KEY')
  })

  it('collapses a hyphenated run into a single underscore', () => {
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('collapses a consecutive run of hyphens and dots into a single underscore', () => {
    expect(deriveKeyRef('foo--bar.baz')).toBe('FOO_BAR_BAZ_API_KEY')
  })

  it('preserves an existing underscore because the post-uppercase regex treats it as alphanumeric', () => {
    expect(deriveKeyRef('deepseek_official')).toBe('DEEPSEEK_OFFICIAL_API_KEY')
  })
})

describe('apiKeyFailure', () => {
  it('treats an empty field as "keep the stored key" and reports no failure', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })

  it('rejects a field of only whitespace as a blank input (typed input never silently dropped)', () => {
    expect(apiKeyFailure('   ')).toBe('keyBlank')
    expect(apiKeyFailure('\t\n')).toBe('keyBlank')
  })

  it('rejects an env-line paste as illegal characters', () => {
    expect(ENV_LINE.test('OPENAI_API_KEY=sk-abc')).toBe(true)
    expect(apiKeyFailure('OPENAI_API_KEY=sk-abc')).toBe('keyIllegalCharacters')
  })

  it('rejects a quoted string as illegal characters even when the inside is all legal', () => {
    expect(isQuoted('"sk-abc"')).toBe(true)
    expect(apiKeyFailure('"sk-abc"')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure("'sk-abc'")).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('`sk-abc`')).toBe('keyIllegalCharacters')
  })

  it('accepts a printable-ASCII key without spaces', () => {
    expect(LEGAL_API_KEY.test('sk-abc_123.XYZ!@#')).toBe(true)
    expect(apiKeyFailure('sk-abc_123.XYZ!@#')).toBeUndefined()
  })

  it('rejects a key containing a space as illegal characters', () => {
    expect(apiKeyFailure('sk abc')).toBe('keyIllegalCharacters')
  })

  it('rejects a key containing a non-printable character as illegal characters', () => {
    expect(apiKeyFailure('sk-\u00A0abc')).toBe('keyIllegalCharacters')
  })
})

describe('isQuoted', () => {
  it('matches a same-character quote pair at both ends', () => {
    expect(isQuoted('"x"')).toBe(true)
    expect(isQuoted("'x'")).toBe(true)
    expect(isQuoted('`x`')).toBe(true)
  })

  it('rejects mismatched or absent pairs', () => {
    expect(isQuoted('"x\'')).toBe(false)
    expect(isQuoted('x"')).toBe(false)
    expect(isQuoted('"x')).toBe(false)
    expect(isQuoted('"')).toBe(false)
  })
})

describe('pathOps', () => {
  it('emits a set op for every key whose value changed', () => {
    const ops = pathOps(['providers', 'minimax-cn'], { api: 'openai' }, { api: 'anthropic' })
    expect(ops).toEqual([{ op: 'set', path: ['providers', 'minimax-cn', 'api'], value: 'anthropic' }])
  })

  it('emits an unset op for every key in before that after no longer names', () => {
    const ops = pathOps(['providers', 'minimax-cn'], { api: 'openai', baseURL: 'https://x', models: [1] }, { api: 'openai' })
    expect(ops).toEqual([
      { op: 'unset', path: ['providers', 'minimax-cn', 'baseURL'] },
      { op: 'unset', path: ['providers', 'minimax-cn', 'models'] },
    ])
  })

  it('emits no ops when the shallow shape is unchanged (JSON.stringify equal counts as unchanged)', () => {
    const before = { api: 'openai', baseURL: 'https://x', models: [1, 2, 3] }
    const after = { api: 'openai', baseURL: 'https://x', models: [1, 2, 3] }
    expect(pathOps(['providers', 'minimax-cn'], before, after)).toEqual([])
  })

  it('treats a non-plain before (undefined / array / null / primitive) as empty', () => {
    expect(pathOps(['providers', 'minimax-cn'], undefined, { api: 'openai' })).toEqual([
      { op: 'set', path: ['providers', 'minimax-cn', 'api'], value: 'openai' },
    ])
    expect(pathOps(['providers', 'minimax-cn'], null as unknown as Record<string, unknown>, { api: 'openai' })).toEqual([
      { op: 'set', path: ['providers', 'minimax-cn', 'api'], value: 'openai' },
    ])
    expect(pathOps(['providers', 'minimax-cn'], [1, 2, 3] as unknown as Record<string, unknown>, { api: 'openai' })).toEqual([
      { op: 'set', path: ['providers', 'minimax-cn', 'api'], value: 'openai' },
    ])
    expect(pathOps(['providers', 'minimax-cn'], 'oops' as unknown as Record<string, unknown>, { api: 'openai' })).toEqual([
      { op: 'set', path: ['providers', 'minimax-cn', 'api'], value: 'openai' },
    ])
  })

  it('still picks up an unset when before is treated as empty but after is also empty', () => {
    expect(pathOps(['providers', 'minimax-cn'], undefined, {})).toEqual([])
  })

  it('compares values via JSON.stringify so a structurally-different but semantically-equal object counts as changed', () => {
    // The diff is shallow: only the key's JSON form is compared. A new object
    // instance with the same fields still serializes the same, so no set op
    // is emitted — the caller rebuilds the value object and we trust that
    // shape to mean "unchanged".
    const ops = pathOps(['providers', 'minimax-cn'], { models: [1, 2] }, { models: [1, 2] })
    expect(ops).toEqual([])
  })
})

describe('validateModels', () => {
  it('passes through undefined as "inherited"', () => {
    expect(validateModels(undefined)).toBeUndefined()
  })

  it('reports modelIdRequired when the id trims to empty (string of spaces or missing)', () => {
    expect(validateModels([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModels([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModels([{ id: 123 }])).toEqual({ index: 0, key: 'modelIdRequired' })
  })

  it('reports modelIdDuplicate when a later row repeats an earlier id', () => {
    expect(validateModels([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual({ index: 2, key: 'modelIdDuplicate' })
    expect(validateModels([{ id: 'a' }, { id: 'a' }])).toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('reports modelNameInvalid when name is set but not a non-empty string', () => {
    expect(validateModels([{ id: 'a', name: '' }])).toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModels([{ id: 'a', name: 123 }])).toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModels([{ id: 'a', name: null }])).toEqual({ index: 0, key: 'modelNameInvalid' })
  })

  it('reports modelContextInvalid when contextWindow is set but not a positive integer', () => {
    expect(validateModels([{ id: 'a', contextWindow: 0 }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'a', contextWindow: -1 }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'a', contextWindow: 1.5 }])).toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModels([{ id: 'a', contextWindow: '256' }])).toEqual({ index: 0, key: 'modelContextInvalid' })
  })

  it('reports modelMaxTokensInvalid when maxTokens is set but not a positive integer', () => {
    expect(validateModels([{ id: 'a', maxTokens: 0 }])).toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModels([{ id: 'a', maxTokens: '8192' }])).toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
  })

  it('passes a clean, valid catalog', () => {
    expect(validateModels([{ id: 'a', name: 'A' }, { id: 'b', contextWindow: 256000, maxTokens: 8192 }])).toBeUndefined()
  })

  it('returns the first offending row by declaration order', () => {
    expect(validateModels([{ id: 'a' }, { id: '' }, { id: 'c', contextWindow: -1 }])).toEqual({ index: 1, key: 'modelIdRequired' })
  })

  it('tolerates a non-array input by falling back to modelDrafts (which yields [])', () => {
    expect(validateModels('not an array')).toBeUndefined()
    expect(validateModels(null)).toBeUndefined()
  })

  it('substitutes a non-plain-object entry with {} so missing id reports modelIdRequired', () => {
    expect(validateModels([null, 'string', 42, { id: 'ok' }])).toEqual({ index: 0, key: 'modelIdRequired' })
  })
})

describe('modelDrafts', () => {
  it('returns an empty list for non-array input', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts(null)).toEqual([])
    expect(modelDrafts('foo')).toEqual([])
  })

  it('substitutes a non-plain-object entry with {}', () => {
    expect(modelDrafts([null, 'x', [1, 2], { id: 'ok' }])).toEqual([{}, {}, {}, { id: 'ok' }])
  })
})

describe('reasoningChoiceOf', () => {
  it('treats absent and false reasoningEfforts as off', () => {
    expect(reasoningChoiceOf({ id: 'a' })).toBe('off')
    expect(reasoningChoiceOf({ id: 'a', reasoningEfforts: false })).toBe('off')
  })

  it('recognizes the standard six levels', () => {
    expect(reasoningChoiceOf({ reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } })).toBe('standard')
  })

  it('marks hand-written spellings and non-objects as custom', () => {
    expect(reasoningChoiceOf({ reasoningEfforts: { off: null, high: 'ultra' } })).toBe('custom')
    expect(reasoningChoiceOf({ reasoningEfforts: { low: 'low' } })).toBe('custom')
    expect(reasoningChoiceOf({ reasoningEfforts: 'high' })).toBe('custom')
    expect(reasoningChoiceOf({ reasoningEfforts: ['low'] })).toBe('custom')
  })
})

describe('reasoningEffortsFor', () => {
  it('writes a copy of the standard levels for standard', () => {
    const value = reasoningEffortsFor('standard')
    expect(value).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
    expect(value).not.toBe(STANDARD_REASONING_EFFORTS)
  })

  it('clears the field for off and custom', () => {
    expect(reasoningEffortsFor('off')).toBeUndefined()
    expect(reasoningEffortsFor('custom')).toBeUndefined()
  })
})

describe('joinProviderRows', () => {
  it('marks a row configured when the namespace exists and settingsPath is empty', () => {
    const schema = makeSchema()
    const ns = namespace({ ns: 'llm-deepseek', value: {} })
    const rows = joinProviderRows(
      [entry({ settingsNs: 'llm-deepseek', settingsPath: [] })],
      new Map([['llm-deepseek', ns]]),
      {},
      schema,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.configured).toBe(true)
  })

  it('marks a row not configured when its namespace is missing', () => {
    const schema = makeSchema()
    const rows = joinProviderRows([entry()], new Map(), {}, schema)
    expect(rows[0]?.configured).toBe(false)
  })

  it('marks a row configured when the namespace exists and the value at settingsPath is defined', () => {
    const schema = makeSchema()
    const value = { providers: { 'minimax-cn': { api: 'openai' } } }
    const ns = namespace({ value })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.configured).toBe(true)
  })

  it('marks a row not configured when the namespace exists but value at settingsPath is undefined', () => {
    const schema = makeSchema()
    const ns = namespace({ value: { providers: {} } })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.configured).toBe(false)
  })

  it('marks a row removable when user has the path but base does not', () => {
    const schema = makeSchema()
    const ns = namespace({ user: { providers: { 'minimax-cn': { api: 'openai' } } }, base: { providers: {} } })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.removable).toBe(true)
  })

  it('refuses to mark removable when base also has the path (built-in profile)', () => {
    const schema = makeSchema()
    const ns = namespace({
      user: { providers: { 'minimax-cn': { api: 'openai' } } },
      base: { providers: { 'minimax-cn': { api: 'openai' } } },
    })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.removable).toBe(false)
  })

  it('refuses to mark removable when user does not have the path', () => {
    const schema = makeSchema()
    const ns = namespace({ user: {}, base: {} })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.removable).toBe(false)
  })

  it('refuses to mark removable when settingsPath is empty (the row edits the whole section)', () => {
    const schema = makeSchema()
    const ns = namespace({ user: {}, base: {} })
    const rows = joinProviderRows(
      [entry({ settingsPath: [] })],
      new Map([['llm-pi-ai', ns]]),
      {},
      schema,
    )
    expect(rows[0]?.removable).toBe(false)
  })

  it('reads apiKeyEnv from the profile subtree when present', () => {
    const schema = makeSchema()
    const ns = namespace({ value: { providers: { 'minimax-cn': { apiKeyEnv: 'MY_KEY' } } } })
    const rows = joinProviderRows([entry()], new Map([['llm-pi-ai', ns]]), {}, schema)
    expect(rows[0]?.apiKeyEnv).toBe('MY_KEY')
  })

  it('falls back to the derived ref for the credential lookup when apiKeyEnv is missing', () => {
    const schema = makeSchema()
    const cred: CredentialView = { configured: true, source: 'env', writable: false }
    const rows = joinProviderRows(
      [entry()],
      new Map(),
      { MINIMAX_CN_API_KEY: cred },
      schema,
    )
    expect(rows[0]?.apiKeyEnv).toBeUndefined()
    expect(rows[0]?.credential).toBe(cred)
  })
})

describe('apiKeyEnvOf', () => {
  it('returns undefined when the namespace is missing', () => {
    expect(apiKeyEnvOf(undefined, ['providers', 'minimax-cn'], makeSchema())).toBeUndefined()
  })

  it('returns the profile apiKeyEnv when it is a non-empty string', () => {
    const schema = makeSchema()
    const ns = namespace({ value: { providers: { 'minimax-cn': { apiKeyEnv: 'MY_KEY' } } } })
    expect(apiKeyEnvOf(ns, ['providers', 'minimax-cn'], schema)).toBe('MY_KEY')
  })

  it('returns undefined when the profile apiKeyEnv is empty or non-string', () => {
    const schema = makeSchema()
    expect(apiKeyEnvOf(namespace({ value: { providers: { 'minimax-cn': { apiKeyEnv: '' } } } }), ['providers', 'minimax-cn'], schema)).toBeUndefined()
    expect(apiKeyEnvOf(namespace({ value: { providers: { 'minimax-cn': { apiKeyEnv: 42 } } } }), ['providers', 'minimax-cn'], schema)).toBeUndefined()
  })
})

describe('refFor', () => {
  it('returns the named apiKeyEnv when the profile carries one', () => {
    const schema = makeSchema()
    const ns = namespace({ value: { providers: { 'minimax-cn': { apiKeyEnv: 'CUSTOM_KEY' } } } })
    expect(refFor(ns, ['providers', 'minimax-cn'], 'minimax-cn', schema)).toBe('CUSTOM_KEY')
  })

  it('falls back to deriveKeyRef when the profile has no apiKeyEnv', () => {
    const schema = makeSchema()
    expect(refFor(namespace(), ['providers', 'minimax-cn'], 'minimax-cn', schema)).toBe('MINIMAX_CN_API_KEY')
  })

  it('falls back to deriveKeyRef when the namespace is missing', () => {
    expect(refFor(undefined, ['providers', 'minimax-cn'], 'minimax-cn', makeSchema())).toBe('MINIMAX_CN_API_KEY')
  })
})

describe('credentialDot', () => {
  const baseRow: ProviderRow = {
    entry: entry(),
    configured: true,
    removable: false,
    apiKeyEnv: 'MINIMAX_CN_API_KEY',
    credential: undefined,
  }

  it('reports configured when the credential view says configured', () => {
    expect(credentialDot({ ...baseRow, credential: { configured: true, writable: false } })).toBe('configured')
  })

  it('reports missing when apiKeyEnv is set and the credential is explicitly not configured', () => {
    expect(credentialDot({ ...baseRow, credential: { configured: false, writable: true } })).toBe('missing')
  })

  it('reports null when there is no apiKeyEnv (no key needed) regardless of credential', () => {
    expect(credentialDot({ ...baseRow, apiKeyEnv: undefined, credential: { configured: false, writable: true } })).toBeNull()
    expect(credentialDot({ ...baseRow, apiKeyEnv: undefined, credential: { configured: true, writable: false } })).toBe('configured')
  })

  it('reports null when apiKeyEnv is set but no credential view was returned (describe failed)', () => {
    expect(credentialDot({ ...baseRow, credential: undefined })).toBeNull()
  })

  it('keeps the key semantics for non-account rows when an account presence is passed', () => {
    expect(credentialDot({ ...baseRow, credential: { configured: true, writable: false } }, 'signed-out')).toBe('configured')
    expect(credentialDot({ ...baseRow, credential: { configured: false, writable: true } }, 'signed-in')).toBe('missing')
    expect(credentialDot({ ...baseRow, credential: undefined }, 'signed-in')).toBeNull()
  })

  it('maps the account presence onto the dot and ignores the credential view entirely', () => {
    const accountRow: ProviderRow = {
      entry: entry({ provider: ACCOUNT_PROVIDER, id: ACCOUNT_PROVIDER, displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] }),
      configured: true,
      removable: false,
      apiKeyEnv: 'DEEPSEEK_ACCOUNT_API_KEY',
      credential: { configured: true, writable: false },
    }
    expect(credentialDot(accountRow, 'signed-in')).toBe('configured')
    expect(credentialDot(accountRow, 'signed-out')).toBe('missing')
    expect(credentialDot(accountRow, undefined)).toBeNull()
    expect(credentialDot(accountRow)).toBeNull()
  })
})

describe('providerUsable', () => {
  const baseRow: ProviderRow = {
    entry: entry(),
    configured: true,
    removable: false,
    apiKeyEnv: 'MINIMAX_CN_API_KEY',
    credential: { configured: true, writable: false },
  }

  it('is false when the entry is not active (route is not registered)', () => {
    expect(providerUsable({ ...baseRow, entry: entry({ active: false }) })).toBe(false)
  })

  it('is true when no apiKeyEnv is required (the profile authenticates another way)', () => {
    expect(providerUsable({ ...baseRow, apiKeyEnv: undefined, credential: undefined })).toBe(true)
  })

  it('is true when apiKeyEnv is required and the credential is configured', () => {
    expect(providerUsable(baseRow)).toBe(true)
  })

  it('is false when apiKeyEnv is required and the credential is missing', () => {
    expect(providerUsable({ ...baseRow, credential: { configured: false, writable: true } })).toBe(false)
  })

  it('keeps the key semantics for non-account rows when an account presence is passed', () => {
    expect(providerUsable(baseRow, 'signed-out')).toBe(true)
    expect(providerUsable({ ...baseRow, credential: { configured: false, writable: true } }, 'signed-in')).toBe(false)
  })

  it('requires the account row to be active and signed in', () => {
    const accountRow: ProviderRow = {
      entry: entry({ provider: ACCOUNT_PROVIDER, id: ACCOUNT_PROVIDER, displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] }),
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }
    expect(providerUsable(accountRow, 'signed-in')).toBe(true)
    expect(providerUsable(accountRow, 'signed-out')).toBe(false)
    expect(providerUsable(accountRow, undefined)).toBe(false)
    expect(providerUsable(accountRow)).toBe(false)
    expect(providerUsable({ ...accountRow, entry: entry({ provider: ACCOUNT_PROVIDER, id: ACCOUNT_PROVIDER, settingsNs: 'llm-deepseek-account', settingsPath: [], active: false }) }, 'signed-in')).toBe(false)
  })
})

describe('isAccountRow', () => {
  it('recognizes the deepseek-account provider id and nothing else', () => {
    const accountRow: ProviderRow = {
      entry: entry({ provider: ACCOUNT_PROVIDER, id: ACCOUNT_PROVIDER, settingsNs: 'llm-deepseek-account', settingsPath: [] }),
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }
    expect(isAccountRow(accountRow)).toBe(true)
    expect(isAccountRow({ ...accountRow, entry: entry({ provider: 'deepseek', id: 'deepseek', settingsNs: 'llm-deepseek', settingsPath: [] }) })).toBe(false)
  })
})

describe('needsSetup', () => {
  const keyRow: ProviderRow = {
    entry: entry({ provider: 'deepseek', id: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }),
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: { configured: false, writable: true },
  }

  it('is the setup posture for the only key-based row while nothing is usable', () => {
    expect(needsSetup(keyRow, false)).toBe(true)
    expect(needsSetup({ ...keyRow, credential: { configured: true, writable: false } }, false)).toBe(false)
  })

  it('never prompts for a routed row or once another row is usable', () => {
    expect(needsSetup({ ...keyRow, entry: entry({ settingsPath: ['providers', 'deepseek'] }) }, false)).toBe(false)
    expect(needsSetup(keyRow, true)).toBe(false)
  })

  it('never sends the account row to the API-key setup card', () => {
    const accountRow: ProviderRow = {
      entry: entry({ provider: ACCOUNT_PROVIDER, id: ACCOUNT_PROVIDER, displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] }),
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }
    expect(needsSetup(accountRow, false)).toBe(false)
    expect(needsSetup(accountRow, true)).toBe(false)
  })
})

describe('addableRows', () => {
  it('keeps rows that are not configured and address a known namespace', () => {
    const rows: ProviderRow[] = [
      { entry: entry({ provider: 'a' }), configured: false, removable: false, apiKeyEnv: undefined, credential: undefined },
      { entry: entry({ provider: 'b' }), configured: true, removable: false, apiKeyEnv: undefined, credential: undefined },
    ]
    expect(addableRows(rows).map((row) => row.entry.provider)).toEqual(['a'])
  })

  it('drops rows whose settingsNs is empty (no addressable namespace)', () => {
    const rows: ProviderRow[] = [
      { entry: entry({ provider: 'a', settingsNs: '' }), configured: false, removable: false, apiKeyEnv: undefined, credential: undefined },
    ]
    expect(addableRows(rows)).toEqual([])
  })
})

describe('layoutOf', () => {
  it('returns deepseek for llm-deepseek', () => {
    expect(layoutOf('llm-deepseek')).toBe('deepseek')
  })

  it('returns pi-ai for llm-pi-ai', () => {
    expect(layoutOf('llm-pi-ai')).toBe('pi-ai')
  })

  it('returns unknown for any other namespace', () => {
    expect(layoutOf('llm-openai')).toBe('unknown')
    expect(layoutOf('')).toBe('unknown')
  })
})

describe('protocolChoices', () => {
  it('returns an empty list when the namespace is missing', () => {
    expect(protocolChoices(undefined, makeSchema())).toEqual([])
  })

  it('returns the union literal list when the probe route exposes a union of string api', () => {
    const schema = makeSchema({
      [`providers.${PROBE_ROUTE}.api`]: { type: 'union', list: [{ value: 'openai' }, { value: 'anthropic' }] },
    })
    const ns = namespace({ schema: { providers: { [PROBE_ROUTE]: { api: { type: 'union' } } } } })
    expect(protocolChoices(ns, schema)).toEqual(['openai', 'anthropic'])
  })

  it('filters out non-string union entries', () => {
    const schema = makeSchema({
      [`providers.${PROBE_ROUTE}.api`]: { type: 'union', list: [{ value: 'openai' }, { value: 42 }, { value: 'anthropic' }] },
    })
    const ns = namespace({ schema: {} })
    expect(protocolChoices(ns, schema)).toEqual(['openai', 'anthropic'])
  })

  it('returns an empty list when the probe route is missing', () => {
    const schema = makeSchema({})
    expect(protocolChoices(namespace(), schema)).toEqual([])
  })

  it('returns an empty list when the node is not a union', () => {
    const schema = makeSchema({ [`providers.${PROBE_ROUTE}.api`]: { type: 'string' } })
    expect(protocolChoices(namespace(), schema)).toEqual([])
  })
})

describe('routeFailure', () => {
  it('treats an empty route as "not started typing yet" and reports no failure', () => {
    expect(routeFailure('', ['acme'])).toBeUndefined()
  })

  it('reports routeInvalid when the value does not match the pattern', () => {
    expect(ROUTE_PATTERN.test('1abc')).toBe(false)
    expect(routeFailure('1abc', [])).toBe('routeInvalid')
    expect(routeFailure('Acme', [])).toBe('routeInvalid')
    expect(routeFailure('acme-', [])).toBe('routeInvalid')
    expect(routeFailure('acme--gateway', [])).toBe('routeInvalid')
  })

  it('reports routeTaken when the value matches the pattern but collides with an existing route', () => {
    expect(routeFailure('acme-gateway', ['acme-gateway'])).toBe('routeTaken')
  })

  it('reports no failure for a well-formed, non-colliding route', () => {
    expect(routeFailure('acme-gateway', ['other-route'])).toBeUndefined()
  })
})

describe('normalizeBaseURL', () => {
  it('trims whitespace and returns an empty string for empty input', () => {
    expect(normalizeBaseURL('   ')).toBe('')
    expect(normalizeBaseURL('')).toBe('')
  })

  it('prepends http:// only for loopback hosts and https:// for public and LAN hosts', () => {
    expect(normalizeBaseURL('api.moonshot.cn/v1')).toBe('https://api.moonshot.cn/v1')
    expect(normalizeBaseURL('8.8.8.8/v1')).toBe('https://8.8.8.8/v1')
    expect(normalizeBaseURL('127.0.0.1:3425/v1')).toBe('http://127.0.0.1:3425/v1')
    expect(normalizeBaseURL('localhost:11434')).toBe('http://localhost:11434')
    expect(normalizeBaseURL('192.168.1.5:8000/v1/chat/completions')).toBe('https://192.168.1.5:8000/v1')
    expect(normalizeBaseURL('nas:8080/v1')).toBe('https://nas:8080/v1')
  })

  it('keeps an explicit scheme untouched, local or LAN host or not', () => {
    expect(normalizeBaseURL('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeBaseURL('http://192.168.1.5:8000/v1')).toBe('http://192.168.1.5:8000/v1')
    expect(normalizeBaseURL('https://127.0.0.1:3425')).toBe('https://127.0.0.1:3425')
    expect(normalizeBaseURL('https://api.deepseek.com//')).toBe('https://api.deepseek.com')
  })

  it('wraps schemeless bare IPv6 hosts in brackets without double-wrapping', () => {
    expect(normalizeBaseURL('::1/v1')).toBe('http://[::1]/v1')
    expect(normalizeBaseURL('::1:11434/v1')).toBe('http://[::1]:11434/v1')
    expect(normalizeBaseURL('[::1]/v1')).toBe('http://[::1]/v1')
    expect(normalizeBaseURL('[::1]:11434/v1')).toBe('http://[::1]:11434/v1')
    expect(normalizeBaseURL('2001:db8::1/v1')).toBe('https://[2001:db8::1]/v1')
    expect(() => new URL(normalizeBaseURL('::1/v1'))).not.toThrow()
    expect(() => new URL(normalizeBaseURL('::1:11434/v1'))).not.toThrow()
  })

  it('strips /v1/messages, /messages, and trailing /v1 for anthropic-messages while keeping /v1 for OpenAI-compatible protocols', () => {
    expect(normalizeBaseURL('https://api.anthropic.com/v1/messages', 'anthropic-messages')).toBe('https://api.anthropic.com')
    expect(normalizeBaseURL('https://api.anthropic.com/v1', 'anthropic-messages')).toBe('https://api.anthropic.com')
    expect(normalizeBaseURL('https://api.anthropic.com/messages', 'anthropic-messages')).toBe('https://api.anthropic.com')
    expect(normalizeBaseURL('https://gateway.example.com/anthropic/v1/messages', 'anthropic-messages')).toBe('https://gateway.example.com/anthropic')
    expect(normalizeBaseURL('https://gateway.example.com/anthropic/v1/', 'anthropic-messages')).toBe('https://gateway.example.com/anthropic')
    expect(normalizeBaseURL('https://api.moonshot.cn/v1/messages', 'openai-completions')).toBe('https://api.moonshot.cn/v1')
    expect(normalizeBaseURL('https://api.moonshot.cn/v1/chat/completions', 'openai-completions')).toBe('https://api.moonshot.cn/v1')
  })

  it('strips a trailing API call path, repeatedly and case-insensitively', () => {
    expect(normalizeBaseURL('api.moonshot.cn/v1/chat/completions')).toBe('https://api.moonshot.cn/v1')
    expect(normalizeBaseURL('https://x.test/v1/Chat/Completions/')).toBe('https://x.test/v1')
    expect(normalizeBaseURL('https://x.test/v1/models')).toBe('https://x.test/v1')
    expect(normalizeBaseURL('https://x.test/v1/responses')).toBe('https://x.test/v1')
    expect(normalizeBaseURL('https://x.test/v1/messages')).toBe('https://x.test/v1')
    expect(normalizeBaseURL('https://x.test/v1/completions')).toBe('https://x.test/v1')
    expect(normalizeBaseURL('https://x.test/v1/chat/completions/models')).toBe('https://x.test/v1')
  })

  it('keeps query strings untouched', () => {
    expect(normalizeBaseURL('https://x.test/v1?key=1')).toBe('https://x.test/v1?key=1')
  })
})

describe('isLoopbackHost and isValidEndpointBaseURL', () => {
  it('recognizes only loopback hosts as loopback', () => {
    for (const host of ['localhost', 'sub.localhost', '127.0.0.1', '127.55.0.9', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
    for (const host of ['', '192.168.1.5', '10.0.0.1', '172.16.0.1', 'nas', 'nas.local', '8.8.8.8', 'api.moonshot.cn']) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })

  it('validates HTTP(S) URLs with a non-empty host', () => {
    expect(isValidEndpointBaseURL('')).toBe(false)
    expect(isValidEndpointBaseURL('   ')).toBe(false)
    expect(isValidEndpointBaseURL('http://')).toBe(false)
    expect(isValidEndpointBaseURL('ftp://example.com/v1')).toBe(false)
    expect(isValidEndpointBaseURL('not a url')).toBe(false)
    expect(isValidEndpointBaseURL('::1/v1')).toBe(true)
    expect(isValidEndpointBaseURL('::1:11434/v1')).toBe(true)
    expect(isValidEndpointBaseURL('api.anthropic.com/v1', 'anthropic-messages')).toBe(true)
  })
})

describe('deriveRoute', () => {
  it('derives the base label from the host, dropping TLDs and second-level public suffixes', () => {
    expect(deriveRoute('https://api.moonshot.cn/v1', [])).toBe('moonshot')
    expect(deriveRoute('https://open.bigmodel.cn', [])).toBe('bigmodel')
    expect(deriveRoute('https://api.deepseek.com', [])).toBe('deepseek')
    expect(deriveRoute('https://foo.example.com.cn/v1', [])).toBe('example')
  })

  it('treats IP literals and single-label hosts as local', () => {
    expect(deriveRoute('http://127.0.0.1:11434', [])).toBe('local')
    expect(deriveRoute('http://[::1]:11434', [])).toBe('local')
    expect(deriveRoute('http://localhost:11434', [])).toBe('local')
  })

  it('appends -2, -3, … until the route is free', () => {
    expect(deriveRoute('https://api.moonshot.cn', ['moonshot'])).toBe('moonshot-2')
    expect(deriveRoute('https://api.moonshot.cn', ['moonshot', 'moonshot-2'])).toBe('moonshot-3')
    expect(deriveRoute('not a url', ['custom', 'custom-2'])).toBe('custom-3')
  })

  it('sanitizes the label into a legal route and falls back to custom', () => {
    expect(deriveRoute('https://api_v2.example.com', [])).toBe('example')
    expect(deriveRoute('https://my_gateway.com', [])).toBe('my-gateway')
    expect(deriveRoute('https://9lives.com', [])).toBe('p-9lives')
    expect(deriveRoute('not a url', [])).toBe('custom')
    expect(ROUTE_PATTERN.test(deriveRoute('https://api.moonshot.cn', ['moonshot']))).toBe(true)
    expect(ROUTE_PATTERN.test(deriveRoute('https://9lives.example.com', []))).toBe(true)
  })
})

describe('deriveDisplayName', () => {
  it('capitalizes the same base label deriveRoute uses', () => {
    expect(deriveDisplayName('https://api.moonshot.cn/v1')).toBe('Moonshot')
    expect(deriveDisplayName('https://open.bigmodel.cn')).toBe('Bigmodel')
    expect(deriveDisplayName('https://api.deepseek.com')).toBe('Deepseek')
  })

  it('returns undefined for local and IP hosts so callers can substitute a localized label', () => {
    expect(deriveDisplayName('http://localhost:11434')).toBeUndefined()
    expect(deriveDisplayName('http://127.0.0.1:11434')).toBeUndefined()
  })

  it('falls back to a neutral name when nothing can be parsed', () => {
    expect(deriveDisplayName('not a url')).toBe('Custom')
  })
})

describe('isLocalNetworkHost', () => {
  it('covers localhost names, single-label hosts and the v6 loopback', () => {
    for (const host of ['localhost', 'printer.localhost', 'nas', 'nas.local', '::1', '[::1]']) {
      expect(isLocalNetworkHost(host), host).toBe(true)
    }
  })

  it('covers the private IPv4 ranges only', () => {
    for (const host of ['127.0.0.1', '127.55.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '169.254.0.1']) {
      expect(isLocalNetworkHost(host), host).toBe(true)
    }
    for (const host of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.167.0.1', '169.255.0.1', '11.0.0.1', 'api.moonshot.cn', 'example.com']) {
      expect(isLocalNetworkHost(host), host).toBe(false)
    }
  })
})

describe('discoveryFailureKind', () => {
  it('maps credential failures to key', () => {
    expect(discoveryFailureKind('https://x answered 401; check the API key', 'DISCOVERY_FAILED')).toBe('key')
    expect(discoveryFailureKind('https://x answered 403; check the API key')).toBe('key')
    expect(discoveryFailureKind('whatever', 'INVALID_CREDENTIAL')).toBe('key')
    expect(discoveryFailureKind("this provider's API key is blank; enter it on the Models page")).toBe('key')
    expect(discoveryFailureKind('API key contains characters no HTTP header can carry')).toBe('key')
  })

  it('maps wrong-address responses to address', () => {
    expect(discoveryFailureKind('https://x answered 404')).toBe('address')
    expect(discoveryFailureKind('https://x did not answer with JSON')).toBe('address')
    expect(discoveryFailureKind('the endpoint\'s model listing has neither a "data" array nor a "models" object')).toBe('address')
    expect(discoveryFailureKind('the endpoint\'s model listing has no "models" array')).toBe('address')
  })

  it('maps unreachable endpoints to network', () => {
    expect(discoveryFailureKind('could not reach https://x.test/v1')).toBe('network')
  })

  it('maps unreadable protocols to unsupported', () => {
    expect(discoveryFailureKind('whatever', 'DISCOVERY_UNSUPPORTED')).toBe('unsupported')
    expect(discoveryFailureKind('pi-ai protocol "x" has no model listing this build can read; enter this provider\'s models by hand')).toBe('unsupported')
  })

  it('falls back to other', () => {
    expect(discoveryFailureKind('answered 500')).toBe('other')
    expect(discoveryFailureKind('model discovery aborted by caller', 'ABORTED')).toBe('other')
  })
})

describe('parseModelIds', () => {
  it('splits on commas, whitespace, newlines and CJK separators, trimmed and deduped in order', () => {
    expect(parseModelIds('a, b b')).toEqual(['a', 'b'])
    expect(parseModelIds('a，b、c\nd  e')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(parseModelIds('a, a ,b,a')).toEqual(['a', 'b'])
    expect(parseModelIds('  ')).toEqual([])
  })
})

describe('protocolOrder', () => {
  it('puts openai-completions first and keeps the rest in order', () => {
    expect(protocolOrder(['anthropic-messages', 'openai-completions', 'google-generative-ai']))
      .toEqual(['openai-completions', 'anthropic-messages', 'google-generative-ai'])
    expect(protocolOrder(['anthropic-messages', 'google-generative-ai']))
      .toEqual(['anthropic-messages', 'google-generative-ai'])
    expect(protocolOrder([])).toEqual([])
  })
})
