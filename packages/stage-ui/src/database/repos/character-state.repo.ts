import type { CharacterStateRecordV1 } from '@proj-airi/stage-shared/character-state'

import localforage from 'localforage'

const records = localforage.createInstance({ name: 'airi-character-state', storeName: 'cards' })

/**
 * Runs one access under the lock that every window's character-state writes take. Reads take it too, so a new leader
 * that loads a record waits for the final save that the previous leader queued when it lost leadership.
 */
function locked<T>(run: () => Promise<T>) {
  return navigator.locks.request('airi:character-state', run)
}

/**
 * The character state on this device, one record per character card, keyed by the card id.
 *
 * Stored values are returned as `unknown`: a record may come from an older version or be damaged, so callers pass it
 * through `migrateCharacterState` before use. Only the character-state store's leader writes.
 */
export const characterStateRepo = {
  /** The stored value of one card, or `null` when the card has none. */
  async load(cardId: string) {
    return locked(() => records.getItem<unknown>(cardId))
  },
  /** Every stored value, in no particular order. */
  async loadAll() {
    return locked(async () => {
      const values: unknown[] = []
      await records.iterate<unknown, void>((value) => {
        values.push(value)
      })
      return values
    })
  },
  /** Saves the record under its card id, replacing the card's previous record. */
  async save(record: CharacterStateRecordV1) {
    await locked(() => records.setItem<CharacterStateRecordV1>(record.cardId, record))
  },
  /** Deletes the record of one card. */
  async remove(cardId: string) {
    await locked(() => records.removeItem(cardId))
  },
  /** Deletes every record. Only forgetting everything uses it. */
  async clear() {
    await locked(() => records.clear())
  },
}
