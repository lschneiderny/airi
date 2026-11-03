import type { ClipBoneMask } from '../clip-mask'

export type ClipKind = 'gesture' | 'action' | 'dance' | 'stance' | 'unusable'
export type ClipLayer = 'upper' | 'full' | 'none'
export type ClipMetaNote = 'no-animated-bones' | 'bad-duration' | 'stance-name' | 'loop-name' | 'non-ascii-name'

export interface DerivedClipMeta {
  readonly layer: ClipLayer
  readonly kind: ClipKind
  readonly loop: boolean
  readonly durationMs: number
  /** A short ascii label the model can name, or `null` when the clip name has no ascii letters or digits. */
  readonly label: string | null
  readonly notes: readonly ClipMetaNote[]
}

/** An upper-body-only clip at most this long is a gesture. */
export const GESTURE_MAX_MS = 6_000
/** A clip that moves the root or legs for at least this long is a dance. */
export const DANCE_MIN_MS = 20_000
export const CLIP_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

const STANCE_NAME = /idle|待機|stand|立ち|sit|座|sleep|寝/i
const LOOP_NAME = /loop|ループ|repeat|_l$/i
const LABEL_MAX_LENGTH = 32

/** NFKC, lowercase, runs of non `[a-z0-9]` to `-`, trimmed and cut to 32 characters. Returns `null` when nothing is left. */
export function slugLabel(name: string): string | null {
  const slug = name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LABEL_MAX_LENGTH).replace(/-+$/, '')
  return slug === '' ? null : slug
}

/**
 * Derives a clip's layer, kind, loop flag and label from its bone mask, duration and name.
 * Rules, first match wins: bad duration, no animated bones, stance name, root or leg dance,
 * root or leg action, short upper gesture, long upper action.
 */
export function deriveClipMeta(mask: ClipBoneMask, durationMs: number, name: string): DerivedClipMeta {
  const label = slugLabel(name)
  const labelNotes: ClipMetaNote[] = label === null ? ['non-ascii-name'] : []
  const done = (layer: ClipLayer, kind: ClipKind, loop: boolean, notes: ClipMetaNote[]): DerivedClipMeta =>
    ({ layer, kind, loop, durationMs, label, notes: [...notes, ...labelNotes] })

  if (!(durationMs > 0) || !Number.isFinite(durationMs))
    return done('none', 'unusable', false, ['bad-duration'])

  const { groups } = mask
  if (!Object.values(groups).some(Boolean))
    return done('none', 'unusable', false, ['no-animated-bones'])

  const lower = groups.root || groups.leftLegIk || groups.rightLegIk || groups.lowerBody
  if (STANCE_NAME.test(name))
    return done(lower ? 'full' : 'upper', 'stance', true, ['stance-name'])

  const loopNamed = LOOP_NAME.test(name)
  const loopNotes: ClipMetaNote[] = loopNamed ? ['loop-name'] : []
  if (lower) {
    if (durationMs >= DANCE_MIN_MS)
      return done('full', 'dance', false, [])
    return done('full', 'action', loopNamed, loopNotes)
  }
  if (durationMs <= GESTURE_MAX_MS)
    return done('upper', 'gesture', false, [])
  return done('upper', 'action', loopNamed, loopNotes)
}

/** A gesture, derived or overridden, always plays on the upper layer; otherwise the derived layer stands. */
export function effectiveLayer(meta: DerivedClipMeta, kindOverride: ClipKind | null): ClipLayer {
  return (kindOverride ?? meta.kind) === 'gesture' ? 'upper' : meta.layer
}
