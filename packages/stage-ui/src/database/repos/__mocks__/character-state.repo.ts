import type { CharacterStateRecordV1 } from '@proj-airi/stage-shared/character-state'

/** In-memory character state for Node tests, which have no IndexedDB. Values are cloned like IndexedDB clones them. */
const records = new Map<string, unknown>()

export const characterStateRepo = {
  async load(cardId: string) {
    return records.has(cardId) ? structuredClone(records.get(cardId)) : null
  },
  async loadAll() {
    return [...records.values()].map(value => structuredClone(value))
  },
  async save(record: CharacterStateRecordV1) {
    records.set(record.cardId, structuredClone(record))
  },
  async remove(cardId: string) {
    records.delete(cardId)
  },
  async clear() {
    records.clear()
  },
}
