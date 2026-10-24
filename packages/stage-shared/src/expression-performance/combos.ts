import type { CatalogEntry, ComboDocument, SlotName } from './catalog'

export function resolveAlias(id: string, catalog: readonly CatalogEntry[]): string {
  return catalog.find(entry => entry.aliases?.includes(id))?.id ?? id
}

export function usableMembers(entry: CatalogEntry, catalog: readonly CatalogEntry[]): { expressionId: string, strength: number }[] {
  const seen = new Set<string>()
  return (entry.members ?? []).flatMap((member) => {
    const expressionId = resolveAlias(member.expressionId, catalog)
    const expression = catalog.find(candidate => candidate.id === expressionId)
    if (!expression || expression.kind === 'combo' || member.strength === 0 || seen.has(expressionId))
      return []
    seen.add(expressionId)
    return [{ expressionId, strength: member.strength }]
  })
}

export function entrySlots(entry: CatalogEntry, catalog: readonly CatalogEntry[]): SlotName[] {
  if (entry.kind !== 'combo')
    return entry.kind === 'face' || entry.kind === 'effect' || entry.kind === 'prop' ? [entry.kind] : []
  const kinds = usableMembers(entry, catalog).map(member => catalog.find(candidate => candidate.id === member.expressionId)!.kind)
  if (kinds.some(kind => kind === 'outfit' || kind === 'system' || kind === 'unsorted'))
    return []
  return (['face', 'effect', 'prop'] as const).filter(kind => kinds.includes(kind))
}

export function expandEntry(entry: CatalogEntry, catalog: readonly CatalogEntry[]): { expressionId: string, strength: number }[] {
  return entry.kind === 'combo' ? usableMembers(entry, catalog) : [{ expressionId: entry.id, strength: 1 }]
}

export function validateComboDocument(document: ComboDocument, catalog: readonly CatalogEntry[]): { success: true } | { success: false, error: string } {
  if (document.members.some(member => member.expressionId.startsWith('combo:')))
    return { success: false, error: 'Combos cannot contain combos' }
  const ids = document.members.map(member => member.expressionId)
  if (new Set(ids).size !== ids.length)
    return { success: false, error: 'Combo member ids must be unique' }
  if (usableMembers({ ...document, kind: 'combo', mappings: [], group: null, confirmed: true, fileName: '', parameterIds: [] }, catalog).length === 0)
    return { success: false, error: 'A combo needs at least one usable member' }
  return { success: true }
}
