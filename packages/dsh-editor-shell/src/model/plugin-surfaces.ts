export type SlotEntry = { options?: { id?: string; order?: number; label?: string | (() => string) } }

export function firstSurfaceEntry(entries: readonly SlotEntry[]): string | undefined {
  return entries.filter(entry => typeof entry.options?.id === 'string' && entry.options.id.trim())
    .map((entry, index) => ({ id: entry.options!.id!, order: entry.options?.order ?? 0, index }))
    .sort((left, right) => left.order - right.order || left.index - right.index)[0]?.id
}

export function modelSettingsSections(entries: readonly SlotEntry[], locale: 'zh' | 'en') {
  const seen = new Set<string>()
  return entries.flatMap((entry, index) => {
    const id = entry.options?.id?.trim()
    if (!id || seen.has(id)) return []
    seen.add(id)
    let label = id
    try {
      const raw = typeof entry.options?.label === 'function' ? entry.options.label() : entry.options?.label
      if (typeof raw === 'string' && raw.trim()) label = raw.trim()
    } catch { /* A label failure cannot hide other plugin settings. */ }
    return [{ id, label, order: entry.options?.order ?? 0, index }]
  }).sort((a, b) => a.order - b.order || a.index - b.index)
}
