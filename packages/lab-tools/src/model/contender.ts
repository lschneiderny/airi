import type { ReplyTranscriptRecord } from '@proj-airi/qa-tools/model/transcript/schema'

import { CLOSENESS_STAGES } from '@proj-airi/stage-shared/character-state'

/** The seed of a config name such as `temp-0.3-seed-2-nothink`. */
export const SEED_TOKEN = /(?:^|-)seed-(\d+)(?=[-+@]|$)/
/** The `@<stage>` that a relationship-stage run appends to each stage's config name. */
const STAGE_SUFFIX = new RegExp(`@(?:${CLOSENESS_STAGES.join('|')})$`)

/**
 * Names what a run competes as: the model and its config without the seed and the relationship stage, so the seeded
 * repeats and the stages of one setup pool into one contender. `temp-0.3-seed-2-nothink` and `temp-0.3-seed-3-nothink`
 * both become `temp-0.3-nothink`; a config that was only a seed is `default`.
 */
export function contenderName(modelId: string, config: string): string {
  const name = config.replace(STAGE_SUFFIX, '').replace(SEED_TOKEN, '').replace(/^-+|-+$/g, '').replace(/-+(?=\+)/g, '')
  // A config that was only a seed, or a seed with a suffix such as `+canonical-history`, is the default setup.
  return `${modelId} · ${!name || name.startsWith('+') ? `default${name}` : name}`
}

/** {@link contenderName} of the record's model and config. */
export function contenderOf(record: ReplyTranscriptRecord): string {
  return contenderName(record.model.id, record.generation.config)
}
