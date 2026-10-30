import type { ContextObservation } from '@proj-airi/stage-shared/situation'

import type { ContextMessage } from '../../../types/chat'
import type { ContextIngestResult } from '../../chat/context-store'

import { BASE_SALIENCE } from '@proj-airi/stage-shared/situation'

import { getEventSourceKey } from '../../../utils/event-source'
import { useSituationStore } from '../index'
import { situationContextText } from './context-text'

/**
 * Maps one context message (plugin `context:update`, vision, `input:text` context updates) to a situation
 * `context` observation.
 *
 * The situation keeps only the newest text per source key, so an `append-self` update replaces the earlier text of
 * its source instead of piling up. Vision output is recognized by `metadata.module === 'vision'`; it gets the vision
 * salience explicitly because its source key is the publishing peer, never the literal `vision` key that the reducer
 * maps by itself, and it is timed by its capture, so a late result never replaces a newer one.
 * The text goes through {@link situationContextText}.
 *
 * Returns `undefined` for a message without string text.
 */
export function contextObservationFrom(message: ContextMessage, nowMs: number): ContextObservation | undefined {
  if (typeof message.text !== 'string')
    return undefined

  const metadata: Record<string, unknown> | undefined = message.metadata
  const vision = metadata?.module === 'vision'
  const capturedAt = metadata?.capturedAt

  return {
    kind: 'context',
    sourceKey: getEventSourceKey(message),
    text: situationContextText(message.text),
    atMs: vision && typeof capturedAt === 'number' && Number.isFinite(capturedAt) ? capturedAt : nowMs,
    salience: vision ? BASE_SALIENCE['context-vision'] : BASE_SALIENCE.context,
  }
}

/**
 * Folds one context message into the leader's situation.
 *
 * Returns the ingest result for lifecycle observability, or `undefined` when nothing was ingested: in a follower
 * window, in a window whose situation store was never initialized, or for a message without string text.
 * `entryCount` is 0 when an empty text cleared the source.
 */
export function ingestContextMessage(message: ContextMessage): ContextIngestResult | undefined {
  const situation = useSituationStore()
  if (!situation.leading)
    return undefined

  const observation = contextObservationFrom(message, Date.now())
  if (!observation)
    return undefined

  situation.ingest(observation)
  return {
    sourceKey: observation.sourceKey,
    mutation: 'replace',
    entryCount: situation.state.contexts[observation.sourceKey] ? 1 : 0,
  }
}
