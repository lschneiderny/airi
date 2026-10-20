import type { SituationEvent, SituationState } from './types'

import { effectiveSalience } from './reducer'
import { contextTopicKey } from './types'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Longest context, topic, or title text that one bullet may carry. */
const CONTEXT_LINE_MAX_CHARS = 120
const TITLE_MAX_CHARS = 80
/** Unshown events below this effective salience are not worth a `New:` line. */
const NEW_EVENT_MIN_SALIENCE = 0.2
const NEW_EVENTS_MAX = 2
const ELLIPSIS = '...'

/** Default line budget of the block, header line included. */
export const SITUATION_MAX_LINES = 6
/** Default character budget of the block, header and newlines included. */
export const SITUATION_MAX_CHARS = 500

export interface RenderSituationOptions {
  /** Line budget including the header line. Default {@link SITUATION_MAX_LINES}. */
  readonly maxLines?: number
  /** Character budget including the header and newlines. Default {@link SITUATION_MAX_CHARS}. */
  readonly maxChars?: number
  /** Name used for the presence bullet. Default `The user`. */
  readonly userName?: string
  /** Whether to render the stage line. Default true. */
  readonly includeStage?: boolean
}

export interface RenderedSituation {
  readonly text: string
  /** Ids of the events rendered as `New:`; pass them to `markShown`. */
  readonly shownEventIds: string[]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function clockText(nowMs: number): string {
  const date = new Date(nowMs)
  return Number.isNaN(date.getTime()) ? '--:--' : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Longest prefix of `text` that fits in `limit` UTF-16 units without splitting a code point. */
function fitPrefix(text: string, limit: number): string {
  let out = ''
  for (const char of text) {
    if (out.length + char.length > limit)
      break
    out += char
  }
  return out
}

/** Caps `text` to `max` UTF-16 units, cutting at a word boundary and marking the cut. */
function truncate(text: string, max: number): string {
  if (text.length <= max)
    return text
  const head = fitPrefix(text, max - ELLIPSIS.length)
  const lastSpace = head.lastIndexOf(' ')
  // A single unbroken token has no word boundary to cut at.
  const cut = lastSpace > 0 && text[head.length] !== ' ' ? head.slice(0, lastSpace) : head
  return `${cut.trimEnd()}${ELLIPSIS}`
}

function clean(text: string, max: number): string {
  return truncate(oneLine(text), max)
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

/**
 * Buckets a span: under 1 min `just now`, 1-9 min exact, 10-59 min to the
 * nearest 5, from 60 min to the nearest half hour (`about 1.5 h`).
 */
function spanText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS)
  if (minutes < 1)
    return 'just now'
  if (minutes < 10)
    return `${minutes} min`
  const rounded = Math.round(minutes / 5) * 5
  if (rounded < 60)
    return `${rounded} min`
  return `about ${formatHours(Math.round(ms / HOUR_MS * 2) / 2)} h`
}

function agoText(ms: number): string {
  const span = spanText(ms)
  return span === 'just now' ? span : `${span} ago`
}

function durationText(ms: number): string {
  const span = spanText(ms)
  if (span === 'just now')
    return 'less than a minute'
  return span.startsWith('about ') ? span : `about ${span}`
}

function presenceBullet(state: SituationState, nowMs: number, userName: string): string | null {
  const { state: presence, sinceMs } = state.presence
  if (presence === 'unknown')
    return null
  const hasSince = sinceMs !== null && Number.isFinite(sinceMs)
  const elapsed = hasSince ? nowMs - sinceMs : 0
  switch (presence) {
    case 'here':
      return hasSince ? `${userName} is at the desk, active for ${durationText(elapsed)}` : `${userName} is at the desk`
    case 'idle':
      return hasSince ? `${userName} is at the desk but idle for ${durationText(elapsed)}` : `${userName} is at the desk but idle`
    case 'away':
      return hasSince ? `${userName} stepped away ${agoText(elapsed)}` : `${userName} is away`
    default:
      return null
  }
}

function activityBullets(state: SituationState, nowMs: number): string[] {
  const { activity } = state
  if (!activity)
    return []
  const label = oneLine(activity.label) || oneLine(activity.appId) || 'an app'
  const title = activity.title === null ? '' : clean(activity.title, TITLE_MAX_CHARS)
  const bullets = [`Now: ${label} (${activity.category})${title ? `: ${title}` : ''}, for ${durationText(nowMs - activity.sinceMs)}`]
  const previous = state.recentActivities.find(recent => recent.appId !== activity.appId)
  if (previous) {
    const previousLabel = oneLine(previous.label) || oneLine(previous.appId) || 'an app'
    bullets.push(`Before that: ${previousLabel}, ${durationText(previous.endedAtMs - previous.sinceMs)}`)
  }
  return bullets
}

/** Unshown events worth a `New:` line, most salient first. */
function unshownEvents(state: SituationState, nowMs: number): SituationEvent[] {
  return state.events
    .filter(event => event.shownAtMs === null && oneLine(event.text) !== '' && effectiveSalience(event, nowMs) >= NEW_EVENT_MIN_SALIENCE)
    .map(event => ({ event, salience: effectiveSalience(event, nowMs) }))
    .sort((a, b) => b.salience - a.salience || b.event.atMs - a.event.atMs || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
    .map(({ event }) => event)
}

function conversationBullet(state: SituationState, nowMs: number): string | null {
  const { lastUserAtMs, lastCharacterAtMs, lastUnpromptedAtMs, lastUnpromptedTopic } = state.conversation
  const talked = [lastUserAtMs, lastCharacterAtMs].filter((at): at is number => at !== null && Number.isFinite(at))
  const parts: string[] = []
  if (talked.length > 0)
    parts.push(`You two last talked ${agoText(nowMs - Math.max(...talked))}.`)
  if (lastUnpromptedAtMs !== null && Number.isFinite(lastUnpromptedAtMs)) {
    const topic = lastUnpromptedTopic === null ? '' : clean(lastUnpromptedTopic, CONTEXT_LINE_MAX_CHARS)
    parts.push(`You last spoke up on your own ${agoText(nowMs - lastUnpromptedAtMs)}${topic ? `, about ${topic}` : ''}.`)
  }
  return parts.length > 0 ? parts.join(' ') : null
}

function contextBullets(state: SituationState): { topicKey: string, text: string }[] {
  return Object.entries(state.contexts)
    .map(([key, context]) => ({ key, atMs: context.atMs, text: oneLine(context.text) }))
    .filter(entry => entry.text !== '')
    .sort((a, b) => b.atMs - a.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(entry => ({ topicKey: contextTopicKey(entry.key), text: truncate(entry.text, CONTEXT_LINE_MAX_CHARS) }))
}

function stageBullet(state: SituationState): string | null {
  const { stage } = state
  if (!stage)
    return null
  const parts = [
    ['on stage', stage.exposed],
    ['active', stage.active],
    ['mood', stage.mood],
  ]
    .map(([name, value]) => [name, oneLine(value)])
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`)
  return parts.length > 0 ? `Stage - ${parts.join('; ')}` : null
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

/**
 * Renders the state as a short flat-bullet block for the prompt. Bullets are
 * ordered by priority (presence, activity, new events, conversation, contexts,
 * stage) and the lowest-priority bullets are dropped whole until `maxLines`
 * (header included) and `maxChars` both hold. Pure: the same state and
 * `nowMs` give the same text. A non-finite `nowMs` renders the header only.
 */
export function renderSituation(
  state: SituationState,
  nowMs: number,
  options: RenderSituationOptions = {},
): RenderedSituation {
  const maxLines = positiveOr(options.maxLines, SITUATION_MAX_LINES)
  const maxChars = positiveOr(options.maxChars, SITUATION_MAX_CHARS)
  const userName = oneLine(options.userName ?? '') || 'The user'
  const header = `[Situation ${clockText(nowMs)}]`

  if (!Number.isFinite(nowMs))
    return { text: header, shownEventIds: [] }

  const presence = presenceBullet(state, nowMs, userName)
  const activity = activityBullets(state, nowMs)
  const conversation = conversationBullet(state, nowMs)
  const contexts = contextBullets(state)
  const stage = options.includeStage === false ? null : stageBullet(state)
  const unshown = unshownEvents(state, nowMs)

  // A context event whose source has a context line is the same fact as that
  // line, so the line carries it and the event gets no `New:` line of its own.
  const contextTopics = new Set(contexts.map(context => context.topicKey))
  const absorbedIds = new Map<string, string[]>()
  for (const event of unshown) {
    if (event.kind === 'context' && contextTopics.has(event.topicKey))
      absorbedIds.set(event.topicKey, [...(absorbedIds.get(event.topicKey) ?? []), event.id])
  }

  /** `promoted` lists context topics that get a `New:` line because their context line was dropped. */
  const build = (promoted: ReadonlySet<string>): { text: string, eventIds: string[], contextTopic?: string }[] => {
    const entries: { text: string, eventIds: string[], contextTopic?: string }[] = []
    const promotedShown = new Set<string>()
    if (presence)
      entries.push({ text: presence, eventIds: [] })
    for (const text of activity)
      entries.push({ text, eventIds: [] })
    let newCount = 0
    for (const event of unshown) {
      if (newCount === NEW_EVENTS_MAX)
        break
      const absorbed = absorbedIds.get(event.topicKey)
      if (event.kind === 'context' && absorbed) {
        if (!promoted.has(event.topicKey) || promotedShown.has(event.topicKey))
          continue
        promotedShown.add(event.topicKey)
      }
      entries.push({ text: `New: ${clean(event.text, CONTEXT_LINE_MAX_CHARS)} (${agoText(nowMs - event.atMs)})`, eventIds: event.kind === 'context' && absorbed ? absorbed : [event.id] })
      newCount++
    }
    if (conversation)
      entries.push({ text: conversation, eventIds: [] })
    for (const context of contexts) {
      if (!promotedShown.has(context.topicKey))
        entries.push({ text: context.text, eventIds: absorbedIds.get(context.topicKey) ?? [], contextTopic: context.topicKey })
    }
    if (stage)
      entries.push({ text: stage, eventIds: [] })
    return entries
  }

  const fitCount = (entries: readonly { text: string }[]): number => {
    const fits = (count: number): boolean => {
      const lines = [header, ...entries.slice(0, count).map(entry => `- ${entry.text}`)]
      return lines.length <= maxLines && lines.join('\n').length <= maxChars
    }
    let count = entries.length
    while (count > 0 && !fits(count))
      count--
    return count
  }

  let entries = build(new Set())
  let count = fitCount(entries)
  // When the budget drops a context line, its event may still say it as `New:`.
  const keptTopics = new Set(entries.slice(0, count).map(entry => entry.contextTopic))
  const dropped = new Set(contexts.map(context => context.topicKey).filter(topic => absorbedIds.has(topic) && !keptTopics.has(topic)))
  if (dropped.size > 0) {
    entries = build(dropped)
    count = fitCount(entries)
  }

  const kept = entries.slice(0, count)
  return {
    text: [header, ...kept.map(entry => `- ${entry.text}`)].join('\n'),
    shownEventIds: kept.flatMap(entry => entry.eventIds),
  }
}
