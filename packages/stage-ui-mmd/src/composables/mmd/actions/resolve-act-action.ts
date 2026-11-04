import type { MMDLabeledClip } from '../../../stores/mmd'

export type ActActionDropReason = 'unknown' | 'not-exposed' | 'not-gesture' | 'superseded'

export interface ActActionResolution {
  /** The clip name to perform, or `null` when nothing plays. */
  perform: string | null
  drops: { reason: ActActionDropReason, label: string }[]
}

/**
 * Resolves an ACT `action` label against the model's labeled clips, exposed or not, so a refusal names its reason.
 *
 * The label comes from the chat model and is only compared, exactly, with the labels the user curated; it is never
 * used as a clip name. Only an exposed gesture plays from ACT: a full-body action or dance needs `perform_action`.
 * Several clips may share a label, so an exposed gesture wins over an exposed non-gesture, which wins over a hidden clip.
 * When the label plays, a cue `gesture` of the same ACT is dropped as `superseded`; without a playing label the
 * gesture is left alone (the MMD scene renders no cue gestures anyway).
 */
export function resolveActAction(label: string | undefined, gesture: { kind: string } | undefined, clips: readonly MMDLabeledClip[]): ActActionResolution {
  if (label === undefined)
    return { perform: null, drops: [] }
  const matches = clips.filter(clip => clip.label === label)
  const exposed = matches.filter(clip => clip.exposed)
  const playable = exposed.find(clip => clip.kind === 'gesture')
  if (playable)
    return { perform: playable.name, drops: gesture ? [{ reason: 'superseded', label: gesture.kind }] : [] }
  const reason: ActActionDropReason = exposed.length > 0 ? 'not-gesture' : matches.length > 0 ? 'not-exposed' : 'unknown'
  return { perform: null, drops: [{ reason, label }] }
}
