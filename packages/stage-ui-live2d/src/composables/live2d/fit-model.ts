import type { MaybeRefOrGetter } from 'vue'

import { computed, toValue } from 'vue'

const startingOffsetY = 1 // upper half

/**
 *  Normalizes the model so that user `scale == 1` means twice the viewport height,
 *  and the model centered horizontally when `position.x == 0`,
 *  showing upper half of the body when `position.y == 0`
 */
export function useFitModel(
  canvasDim: MaybeRefOrGetter<{ width: number, height: number }>,
  modelDim: MaybeRefOrGetter<{ width: number, height: number }>,
) {
  const normalizedParam = computed(() => {
    const canvas = toValue(canvasDim)
    const model = toValue(modelDim)

    const heightScale = (canvas.height / model.height * 2)
    const widthScale = (canvas.width / model.width * 2)
    let minScale = Math.min(heightScale, widthScale)

    if (Number.isNaN(minScale) || minScale <= 0) {
      minScale = 1e-6
    }
    return {
      scale: minScale,
      x: canvas.width / 2,
      y: canvas.height * startingOffsetY,
    }
  })

  return normalizedParam
}
