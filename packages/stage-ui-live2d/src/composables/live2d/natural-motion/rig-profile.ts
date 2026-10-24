const channelIds = {
  headX: 'ParamAngleX',
  headY: 'ParamAngleY',
  headZ: 'ParamAngleZ',
  bodyX: 'ParamBodyAngleX',
  bodyY: 'ParamBodyAngleY',
  bodyZ: 'ParamBodyAngleZ',
  eyeX: 'ParamEyeBallX',
  eyeY: 'ParamEyeBallY',
  eyeLOpen: 'ParamEyeLOpen',
  eyeROpen: 'ParamEyeROpen',
  browLY: 'ParamBrowLY',
  browRY: 'ParamBrowRY',
  browLAngle: 'ParamBrowLAngle',
  browRAngle: 'ParamBrowRAngle',
  eyeLSmile: 'ParamEyeLSmile',
  eyeRSmile: 'ParamEyeRSmile',
  mouthForm: 'ParamMouthForm',
  mouthOpen: 'ParamMouthOpenY',
  breath: 'ParamBreath',
  cheek: 'ParamCheek',
} as const

export type NaturalChannel = keyof typeof channelIds

/** Resolves blush, not cheek inflation, from a conventional id or the rig's CDI display name. */
export function resolveCheekParameterId(ids: readonly string[], displayInfo?: unknown): string | undefined {
  const standard = ids.find(id => id === channelIds.cheek)
  if (standard)
    return standard
  const alias = ids.find(id => /^(?:param[_-]?)?(?:cheek\d*|blush|hoppe)$/i.test(id))
  if (alias)
    return alias
  if (!displayInfo || typeof displayInfo !== 'object' || !('Parameters' in displayInfo) || !Array.isArray(displayInfo.Parameters))
    return undefined
  for (const parameter of displayInfo.Parameters) {
    if (parameter && typeof parameter === 'object' && 'Id' in parameter && typeof parameter.Id === 'string'
      && 'Name' in parameter && typeof parameter.Name === 'string'
      && /^(?:cheek|blush|hoppe|\u8138\u7EA2|\u81C9\u7D05|\u8D64\u9762|\u982C\u67D3\u3081)$/i.test(parameter.Name.trim())
      && ids.includes(parameter.Id)) {
      return parameter.Id
    }
  }
}

/** The parsed Cubism physics fields needed for ownership discovery, without SDK imports. */
export interface PhysicsRigLike {
  settings: { baseInputIndex: number, inputCount: number, baseOutputIndex: number, outputCount: number }[]
  inputs: { source: { id: string } }[]
  outputs: { destination: { id: string }, weight?: number }[]
}

/** Channels available to Natural and destinations that must remain physics-owned. */
export interface Live2DRigProfile {
  channels: Map<NaturalChannel, { id: string, index: number, min: number, max: number, neutral: number }>
  physicsOutputs: Set<string>
  bodyFromHeadPhysics: { x: boolean, y: boolean, z: boolean }
}

/**
 * Discovers rig ownership without changing model parameters. An omitted output
 * weight counts as active; only an explicit zero disables ownership.
 */
export function readLive2DRigProfile(
  parameters: { ids: string[], minimumValues: ArrayLike<number>, maximumValues: ArrayLike<number>, defaultValues: ArrayLike<number> },
  physicsRig: PhysicsRigLike | undefined,
  displayInfo?: unknown,
): Live2DRigProfile {
  const channels: Live2DRigProfile['channels'] = new Map()
  for (const [channel, standardId] of Object.entries(channelIds)) {
    const id = channel === 'cheek' ? resolveCheekParameterId(parameters.ids, displayInfo) : standardId
    if (!id)
      continue
    const index = parameters.ids.indexOf(id)
    if (index < 0 || parameters.minimumValues[index] === parameters.maximumValues[index])
      continue
    channels.set(channel as NaturalChannel, {
      id,
      index,
      min: parameters.minimumValues[index],
      max: parameters.maximumValues[index],
      neutral: parameters.defaultValues[index],
    })
  }

  const physicsOutputs = new Set<string>()
  const edges = new Map<string, Set<string>>()
  if (physicsRig) {
    for (const output of physicsRig.outputs) {
      if (output.weight !== 0)
        physicsOutputs.add(output.destination.id)
    }
    for (const setting of physicsRig.settings) {
      const { baseInputIndex, inputCount, baseOutputIndex, outputCount } = setting
      // Reject malformed slices rather than reading another setting's parameters.
      if (![baseInputIndex, inputCount, baseOutputIndex, outputCount].every(value => Number.isSafeInteger(value) && value >= 0)
        || baseInputIndex + inputCount > physicsRig.inputs.length
        || baseOutputIndex + outputCount > physicsRig.outputs.length) {
        continue
      }
      const destinations = physicsRig.outputs.slice(baseOutputIndex, baseOutputIndex + outputCount)
        .filter(output => output.weight !== 0)
      for (const input of physicsRig.inputs.slice(baseInputIndex, baseInputIndex + inputCount)) {
        let targets = edges.get(input.source.id)
        if (!targets) {
          targets = new Set()
          edges.set(input.source.id, targets)
        }
        for (const output of destinations)
          targets.add(output.destination.id)
      }
    }
  }

  const reachable = new Set<string>([channelIds.headX, channelIds.headY, channelIds.headZ])
  const pending = [...reachable]
  for (const id of pending) {
    const targets = edges.get(id)
    if (!targets)
      continue
    for (const target of targets) {
      if (!reachable.has(target)) {
        reachable.add(target)
        pending.push(target)
      }
    }
  }
  return {
    channels,
    physicsOutputs,
    bodyFromHeadPhysics: {
      x: reachable.has(channelIds.bodyX),
      y: reachable.has(channelIds.bodyY),
      z: reachable.has(channelIds.bodyZ),
    },
  }
}
