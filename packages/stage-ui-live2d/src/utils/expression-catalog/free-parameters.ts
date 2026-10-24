import type { ExpressionDefinition } from '../../composables/live2d/expression/compose'

export interface FreeParameter {
  id: string
  name: string
  min: number
  max: number
  default: number
}

/** Free switches exclude every expression write and every runtime-owned parameter. */
export function findFreeParameters({ parameters, exp3Definitions, drivenIds, displayNames }: {
  parameters: { ids: readonly string[], minimumValues: ArrayLike<number>, maximumValues: ArrayLike<number>, defaultValues: ArrayLike<number> }
  exp3Definitions: ExpressionDefinition[]
  drivenIds: ReadonlySet<string>
  displayNames: ReadonlyMap<string, string>
}): FreeParameter[] {
  const written = new Set(exp3Definitions.flatMap(definition => definition.parameters.map(parameter => parameter.id)))
  return parameters.ids.flatMap((id, index) => {
    const min = parameters.minimumValues[index]
    const max = parameters.maximumValues[index]
    return written.has(id) || drivenIds.has(id) || min === max
      ? []
      : [{ id, name: displayNames.get(id) ?? id, min, max, default: parameters.defaultValues[index] }]
  })
}
