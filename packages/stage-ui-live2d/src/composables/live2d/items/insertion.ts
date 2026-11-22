/** Where an item draws among her drawables. */
export type Live2DItemInsertionLayer
  = | { kind: 'behind' }
    | { kind: 'front' }
    | { kind: 'above', drawableId: string }

export interface Live2DItemInsertion {
  id: string
  layer: Live2DItemInsertionLayer
}

/**
 * One step of her render pass.
 *
 * `model` draws the drawables at draw positions `from` up to, not including,
 * `to`, in render order. `insert` draws the listed items, in order.
 */
export type Live2DInsertionSegment
  = | { kind: 'model', from: number, to: number }
    | { kind: 'insert', itemIds: string[] }

export interface Live2DInsertionPlan {
  segments: Live2DInsertionSegment[]
  /** Items whose `above` drawable the model lacks. They draw in front instead. */
  missingLayer: string[]
}

/**
 * Splits her render pass around the shown items.
 *
 * Behind items draw before her first drawable, an `above` item right after its
 * drawable's current draw position, and front items after her last drawable.
 * Motions can change the render order, so positions are read from
 * `renderOrders` on every call and nothing is cached. Items at one position draw
 * in list order. No items gives no segments, and the caller leaves the render
 * hook unset so her frame stays exactly as without items.
 *
 * `renderOrders` holds each drawable's draw position, indexed by drawable;
 * `indexById` returns a drawable's index, or a negative number when it is missing.
 */
export function resolveInsertionSegments(
  items: readonly Live2DItemInsertion[],
  renderOrders: ArrayLike<number>,
  indexById: (drawableId: string) => number,
): Live2DInsertionPlan {
  const missingLayer: string[] = []
  if (items.length === 0)
    return { segments: [], missingLayer }

  const drawableCount = renderOrders.length
  const placed = items.map((item) => {
    if (item.layer.kind === 'behind')
      return { id: item.id, position: 0 }
    if (item.layer.kind === 'front')
      return { id: item.id, position: drawableCount }

    const index = indexById(item.layer.drawableId)
    if (index < 0 || index >= drawableCount) {
      missingLayer.push(item.id)
      return { id: item.id, position: drawableCount }
    }
    return { id: item.id, position: renderOrders[index] + 1 }
  })
  // Array sort is stable, so items at one position keep their list order.
  placed.sort((left, right) => left.position - right.position)

  const segments: Live2DInsertionSegment[] = []
  let drawn = 0
  for (const { id, position } of placed) {
    if (position > drawn) {
      segments.push({ kind: 'model', from: drawn, to: position })
      drawn = position
    }
    const last = segments.at(-1)
    if (last?.kind === 'insert')
      last.itemIds.push(id)
    else
      segments.push({ kind: 'insert', itemIds: [id] })
  }
  if (drawn < drawableCount)
    segments.push({ kind: 'model', from: drawn, to: drawableCount })

  return { segments, missingLayer }
}
