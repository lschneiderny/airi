/**
 * Fans the stage state out to every window that registered the stage contracts.
 *
 * Each window's eventa context emits only to its own renderer, so a config change made from one window (the stage page
 * reporting the active renderer, the settings page saving the mode) must call `emitAll` for the other windows to see it.
 */
export interface StageStateBroadcast {
  /** Registers one window's emitter. Returns the function that removes it; call it when the window closes. */
  add: (emit: () => void) => () => void
  emitAll: () => void
}

export function createStageStateBroadcast(): StageStateBroadcast {
  const emitters = new Set<() => void>()
  return {
    add(emit) {
      emitters.add(emit)
      return () => emitters.delete(emit)
    },
    emitAll() {
      for (const emit of emitters)
        emit()
    },
  }
}
