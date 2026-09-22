import type { ModelRoute } from './contracts.ts'

export type CatalogEffort = { id: string; name: string }
export type CatalogModel = {
  id: string
  name: string
  reasoning?: { efforts: readonly CatalogEffort[]; defaultEffort?: string }
}
export type CatalogGroup = { id: string; name: string; models: readonly CatalogModel[] }
export type SessionModelCatalog = {
  default?: { provider: string; model: string; reasoningEffort?: string }
  groups: readonly CatalogGroup[]
}

export type CatalogChoice = {
  provider: string
  model: string
  label: string
  efforts: readonly CatalogEffort[]
  defaultEffort?: string
}

const KEY_SEP = '\u001f'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseEffort(value: unknown): CatalogEffort | undefined {
  if (!isRecord(value)) return undefined
  const id = text(value.id)
  if (!id) return undefined
  return { id, name: text(value.name) ?? id }
}

function parseModel(value: unknown): CatalogModel | undefined {
  if (!isRecord(value)) return undefined
  const id = text(value.id)
  if (!id) return undefined
  const name = text(value.name) ?? id
  if (value.reasoning === undefined) return { id, name }
  if (!isRecord(value.reasoning) || !Array.isArray(value.reasoning.efforts)) return { id, name }
  const efforts = value.reasoning.efforts.map(parseEffort).filter((item): item is CatalogEffort => Boolean(item))
  const defaultEffort = text(value.reasoning.defaultEffort)
  return { id, name, reasoning: defaultEffort ? { efforts, defaultEffort } : { efforts } }
}

function parseGroup(value: unknown): CatalogGroup | undefined {
  if (!isRecord(value)) return undefined
  const id = text(value.id)
  if (!id || !Array.isArray(value.models)) return undefined
  const models = value.models.map(parseModel).filter((item): item is CatalogModel => Boolean(item))
  return { id, name: text(value.name) ?? id, models }
}

export function parseModelCatalog(value: unknown): SessionModelCatalog {
  const root = isRecord(value) ? value : {}
  const groups = Array.isArray(root.groups)
    ? root.groups.map(parseGroup).filter((item): item is CatalogGroup => Boolean(item))
    : []
  const fallback = isRecord(root.default) ? root.default : undefined
  const provider = fallback ? text(fallback.provider) : undefined
  const model = fallback ? text(fallback.model) : undefined
  const reasoningEffort = fallback ? text(fallback.reasoningEffort) : undefined
  const catalog: SessionModelCatalog = { groups }
  if (provider && model) catalog.default = reasoningEffort ? { provider, model, reasoningEffort } : { provider, model }
  return catalog
}

export function catalogChoices(catalog: SessionModelCatalog, bound?: Pick<ModelRoute, 'provider' | 'model'>): CatalogChoice[] {
  const choices: CatalogChoice[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) {
      choices.push({
        provider: group.id,
        model: model.id,
        label: `${group.name} / ${model.name}`,
        efforts: model.reasoning?.efforts ?? [],
        defaultEffort: model.reasoning?.defaultEffort,
      })
    }
  }
  if (bound?.provider && bound.model && !choices.some(item => item.provider === bound.provider && item.model === bound.model)) {
    choices.push({
      provider: bound.provider,
      model: bound.model,
      label: `${bound.provider} / ${bound.model}`,
      efforts: [],
    })
  }
  return choices
}

export function choiceOf(choices: readonly CatalogChoice[], provider: string, model: string): CatalogChoice | undefined {
  return choices.find(item => item.provider === provider && item.model === model)
}

/** Advertised efforts plus the current value if it is not in the list. Unlisted IDs stay selectable. */
export function effortOptions(choice: CatalogChoice | undefined, current?: string): CatalogEffort[] {
  const listed = choice?.efforts.map(item => ({ ...item })) ?? []
  if (current && !listed.some(item => item.id === current)) listed.push({ id: current, name: current })
  return listed
}

export function routeKey(provider: string, model: string): string {
  return `${provider}${KEY_SEP}${model}`
}

export function parseRouteKey(value: string): { provider: string; model: string } | undefined {
  const index = value.indexOf(KEY_SEP)
  if (index <= 0) return undefined
  const provider = value.slice(0, index)
  const model = value.slice(index + KEY_SEP.length)
  if (!provider || !model) return undefined
  return { provider, model }
}

export function emptyCatalog(): SessionModelCatalog {
  return { groups: [] }
}
