import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../../composables/live2d/expression/compose'

function compareIds(left: string, right: string): number {
  const a = Array.from(left, char => char.codePointAt(0)!)
  const b = Array.from(right, char => char.codePointAt(0)!)
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index])
      return a[index] - b[index]
  }
  return a.length - b.length
}

/** Exact effective writes ignore neutral Add/Multiply writes and fade timing. */
export function deduplicateCatalog(entries: CatalogEntry[], defs: ExpressionDefinition[], referencedIds: ReadonlySet<string>, keepSeparate: ReadonlySet<string> = new Set()): CatalogEntry[] {
  const signatures = new Map<string, CatalogEntry[]>()
  const definitions = new Map(defs.map(def => [def.id, def]))
  const result = entries.map(entry => ({ ...entry }))
  for (const entry of result) {
    if (keepSeparate.has(entry.id))
      continue
    const writes = definitions.get(entry.id)!.parameters.filter(parameter => parameter.blend === 'Overwrite' || (parameter.blend === 'Add' ? parameter.value !== 0 : parameter.value !== 1)).map(parameter => [parameter.id, parameter.blend, parameter.value] as const).sort((a, b) => compareIds(JSON.stringify(a), JSON.stringify(b)))
    if (writes.length === 0)
      continue
    const signature = JSON.stringify(writes)
    const members = signatures.get(signature) ?? []
    members.push(entry)
    signatures.set(signature, members)
  }
  const sourceRank = { model: 0, vtube: 1, file: 2, user: 3 }
  const generic = /^(?:exp|expr|expression|face|f|表情)?[\s_.-]*\d+$/i
  const key = (entry: CatalogEntry) => [
    entry.kind === 'system' ? 0 : 1,
    generic.test(entry.label) ? 1 : 0,
    sourceRank[entry.labelSource ?? 'file'],
    referencedIds.has(entry.id) ? 0 : 1,
  ]
  for (const members of signatures.values()) {
    if (members.length < 2)
      continue
    members.sort((a, b) => {
      const left = key(a)
      const right = key(b)
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index])
          return left[index] - right[index]
      }
      return compareIds(a.id, b.id)
    })
    const [primary, ...duplicates] = members
    primary.aliases = duplicates.map(entry => entry.id)
    for (const entry of duplicates) {
      entry.duplicateOf = primary.id
      entry.exposedToLlm = false
      entry.mappings = []
      entry.group = null
      entry.area = 'hidden'
    }
  }
  return result
}
