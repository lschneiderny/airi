/** Reads parameter values by index, as the Cubism core model does. */
export interface Live2DParameterReader {
  getParameterValueByIndex: (index: number) => number
}

/** Writes parameter values by index, as the Cubism core model does. */
export interface Live2DParameterWriter {
  setParameterValueByIndex: (index: number, value: number) => void
}

/**
 * Copies one model's final parameter values into another model by parameter id.
 *
 * A linked Live2D item mirrors her: `capture` runs at her `beforeModelUpdate`, when
 * her values are final for the frame, and `apply` runs at the item's
 * `afterMotionUpdate`, so the item's own physics then runs on her values. The ids
 * in `excluded`, the item's physics outputs, are never copied, so physics stays
 * their only writer.
 *
 * Index pairs and the value buffer are resolved once; a frame allocates nothing.
 */
export class Live2DParameterMirror {
  private readonly sourceIndices: Int32Array
  private readonly targetIndices: Int32Array
  private readonly values: Float32Array
  private captured = false

  constructor(sourceIds: readonly string[], targetIds: readonly string[], excluded: ReadonlySet<string>) {
    const targetIndexById = new Map<string, number>()
    targetIds.forEach((id, index) => targetIndexById.set(id, index))
    const sources: number[] = []
    const targets: number[] = []
    sourceIds.forEach((id, index) => {
      const target = targetIndexById.get(id)
      if (target === undefined || excluded.has(id))
        return
      sources.push(index)
      targets.push(target)
    })
    this.sourceIndices = Int32Array.from(sources)
    this.targetIndices = Int32Array.from(targets)
    this.values = new Float32Array(sources.length)
  }

  capture(source: Live2DParameterReader) {
    for (let pair = 0; pair < this.sourceIndices.length; pair++)
      this.values[pair] = source.getParameterValueByIndex(this.sourceIndices[pair])
    this.captured = true
  }

  /** Writes the last captured values; before the first capture it writes nothing. */
  apply(target: Live2DParameterWriter) {
    if (!this.captured)
      return
    for (let pair = 0; pair < this.targetIndices.length; pair++)
      target.setParameterValueByIndex(this.targetIndices[pair], this.values[pair])
  }
}
