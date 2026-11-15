/** The part of the Cubism core model that the measurement reads and writes. */
export interface ArtProbeModel {
  getDrawableCount: () => number
  getDrawableOpacity: (index: number) => number
  getParameterValueById: (id: string) => number
  setParameterValueById: (id: string, value: number) => void
  update: () => void
}

export interface ArtProbeParameter {
  id: string
  value: number
  blend: 'Add' | 'Multiply' | 'Overwrite'
}

const VISIBLE_OPACITY = 0.01

function visible(model: ArtProbeModel): boolean[] {
  return Array.from({ length: model.getDrawableCount() }, (_, index) => model.getDrawableOpacity(index) >= VISIBLE_OPACITY)
}

/**
 * Whether an expression only takes art away: applied to the model as it stands, it hides at least one drawable and
 * shows none. A rig's watermark switch reads true when the watermark is drawn until the switch is on, and false on a
 * rig whose switch draws the watermark. The model's parameters and drawables are left as they were.
 *
 * Call it on a freshly loaded model, before any expression or motion has written parameters.
 */
export function expressionOnlyHidesArt(model: ArtProbeModel, parameters: readonly ArtProbeParameter[]): boolean {
  const bases = parameters.map(parameter => model.getParameterValueById(parameter.id))
  const before = visible(model)
  for (const [index, parameter] of parameters.entries()) {
    const base = bases[index]
    model.setParameterValueById(parameter.id, parameter.blend === 'Add' ? base + parameter.value : parameter.blend === 'Multiply' ? base * parameter.value : parameter.value)
  }
  model.update()
  const after = visible(model)
  for (const [index, parameter] of parameters.entries())
    model.setParameterValueById(parameter.id, bases[index])
  model.update()
  return before.some((shown, index) => shown && !after[index]) && !after.some((shown, index) => shown && !before[index])
}
