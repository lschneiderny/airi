import { createStreamingControlParser } from '@proj-airi/pipelines-audio'
import { STAGE_RUNTIME_CONFIG } from '@proj-airi/stage-shared/stage-contract'

/**
 * How an earlier reply joins the history of the next request.
 *
 * - `raw` sends it as the model wrote it.
 * - `canonical` sends it as the app does since it rewrites recovered cues: through core-agent's `canonicalCueText`.
 * - `accepted` keeps only the markers the stage accepts (cues the stage controller parses, MOOD, and the runtime's own
 *   markers such as SILENT). It is not what the app sends; it measures how much an unknown marker that stays in the
 *   history, such as `<|look: you|>`, spreads into later replies.
 */
export const HISTORY_MODES = ['raw', 'canonical', 'accepted'] as const
export type HistoryMode = typeof HISTORY_MODES[number]

/** A MOOD marker belongs to the character-state layer, so the stage controller never parses it. */
const MOOD_MARKER = /^<\|MOOD(?:\s|\|>)/
/** Markers the chat runtime itself consumes before the stage sees them. */
const RUNTIME_MARKER = /^<\|(?:SILENT|STICKER)(?:\s|\|>)/

/**
 * The reply text the next request carries under `mode`.
 *
 * Expects:
 * - A built `@proj-airi/core-agent`; the run command checks it before the first request.
 */
export async function historyText(text: string, mode: HistoryMode): Promise<string> {
  if (mode === 'raw')
    return text
  // The package resolves to its build, which the run command checks before the first request.
  const { canonicalCueText, replayReply } = await import('@proj-airi/core-agent')
  const canonical = await canonicalCueText(text, STAGE_RUNTIME_CONFIG.recoverCueNames)
  if (mode === 'canonical')
    return canonical
  const replay = await replayReply({ text: canonical, stage: STAGE_RUNTIME_CONFIG, chunks: 'whole' })
  const controller = createStreamingControlParser()
  let kept = ''
  for (const event of replay.events) {
    if (event.kind === 'literal') {
      kept += event.value
      continue
    }
    let parsed = MOOD_MARKER.test(event.value) || RUNTIME_MARKER.test(event.value)
    if (!parsed) {
      await controller.dispatchWith(event.value, {
        observer: (stage) => {
          if (stage.type === 'parsed')
            parsed = true
        },
      })
    }
    if (parsed)
      kept += event.value
  }
  // Removing a marker leaves the spaces on both sides of it.
  return kept.replace(/[ \t]{2,}/g, ' ').trim()
}
