import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { MaybeRefOrGetter } from 'vue'

import type { StageCharacterPlacement } from '../../shared/eventa'

import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { toValue, watch } from 'vue'

import { electronStageCharacterPlacementChanged } from '../../shared/eventa'

/** An edge has to move further than this, in DIP, before the main process hears about it. */
const placementThresholdDip = 2

function edgeMoved(previous: PlacementRect, next: PlacementRect): boolean {
  return Math.abs(previous.x - next.x) > placementThresholdDip
    || Math.abs(previous.y - next.y) > placementThresholdDip
    || Math.abs(previous.x + previous.width - next.x - next.width) > placementThresholdDip
    || Math.abs(previous.y + previous.height - next.y - next.height) > placementThresholdDip
}

/**
 * Publishes the character placement to the main process, which anchors the chat and answers
 * `electronStageGetCharacterPlacement` from it.
 *
 * Use when:
 * - The desktop stage page owns the scene
 *
 * Expects:
 * - `placement` is in Electron DIP screen coordinates, or `null` before the scene has measured her
 *
 * Returns:
 * - Nothing. An event is sent only when the display changes or an edge of `bounds` or `homeBounds` moves by more than
 *   2 DIP against the last placement sent, so sub-pixel jitter and a still character cost no IPC.
 */
export function useStagePlacementPublisher(placement: MaybeRefOrGetter<StageCharacterPlacement | null>): void {
  const context = useElectronEventaContext()
  let lastSent: StageCharacterPlacement | null = null

  watch(() => toValue(placement), (next) => {
    if (!next)
      return
    if (lastSent && lastSent.displayId === next.displayId
      && !edgeMoved(lastSent.bounds, next.bounds) && !edgeMoved(lastSent.homeBounds, next.homeBounds)) {
      return
    }
    lastSent = next
    context.value.emit(electronStageCharacterPlacementChanged, next)
  }, { immediate: true })
}
