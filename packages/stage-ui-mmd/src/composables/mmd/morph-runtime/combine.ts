export type MorphLayer = 'naturalFace' | 'clip' | 'expression' | 'blink' | 'lipSync' | 'devtools'

export interface MorphChannel {
  readonly layer: MorphLayer
  readonly weight: number
  readonly alpha?: number
  readonly additive?: boolean
}

export interface MorphComposition {
  readonly role?: 'vowel' | 'mouth' | 'eye' | 'other'
  readonly speakEnv?: number
  readonly exprEyeClosure?: number
}

// Low to high; keep speech above expression so expressions cannot lock vowels.
const priority: readonly MorphLayer[] = ['naturalFace', 'clip', 'expression', 'blink', 'lipSync', 'devtools']

export function combineMorphChannels(channels: readonly MorphChannel[], context: MorphComposition = {}): number {
  let value = 0
  let additive = 0
  const lipSyncOwnsMouth = channels.some(channel => channel.layer === 'lipSync')
  const speakEnv = context.speakEnv ?? (lipSyncOwnsMouth ? 1 : 0)
  const expressionBlink = Math.max(0, ...channels.filter(c => c.layer === 'expression' && !c.additive).map(c => c.weight))
  for (const layer of priority) {
    const members = channels.filter(c => c.layer === layer)
    for (const channel of members) {
      if (channel.additive)
        additive += channel.weight * (channel.alpha ?? 1)
    }
    const absolute = members.filter(c => !c.additive)
    if (!absolute.length)
      continue
    let upper = Math.max(...absolute.map(c => c.weight))
    let alpha = Math.max(...absolute.map(c => c.alpha ?? 1))
    switch (layer) {
      case 'lipSync':
        if (context.role !== 'vowel' && context.role !== 'mouth')
          continue
        alpha *= speakEnv
        break
      case 'blink':
        if (context.role !== 'eye')
          continue
        upper = Math.max(expressionBlink, upper * (1 - (context.exprEyeClosure ?? 0)))
        break
      case 'expression':
        if (context.role === 'mouth' && !lipSyncOwnsMouth)
          upper *= 1 - 0.7 * speakEnv
        break
    }
    value += (upper - value) * alpha
  }
  return Math.min(1, Math.max(0, value + additive))
}
