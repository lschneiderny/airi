import type {
  ActivityObservation,
  AppCategory,
  BusyState,
  ContextObservation,
  ConversationObservation,
  NotifyObservation,
  Observation,
  PresenceObservation,
  PresenceReason,
  PresenceState,
  SalienceKey,
  SituationEvent,
  SituationEventKind,
  SituationRecentActivity,
  SituationState,
  SituationTracking,
} from './types'

import {
  activityTierTopicKey,
  activityTopicKey,
  BASE_SALIENCE,
  contextTopicKey,
  HALF_LIFE_MS,
  initialSituationState,
  longSessionSalience,
  notifyTopicKey,
  PRESENCE_RETURN_TOPIC_KEY,
  RECENT_ACTIVITIES_MAX,
  SITUATION_EVENTS_MAX,
  WAKE_TOPIC_KEY,
} from './types'

const MINUTE_MS = 60_000

/**
 * How long an app must stay in the foreground before its `app-switch` event exists.
 *
 * Tuning: raise it if alt-tab noise still reaches the character; lower it to
 * make the character notice a new app sooner.
 */
export const SETTLE_MS = 75_000

/**
 * Switching back to the previous app within this time of leaving it merges the
 * detour away: no event, and the previous span continues.
 *
 * Tuning: raise it to forgive longer detours (looking something up).
 */
export const FLAP_MERGE_MS = 30_000

/** Switches within {@link SWITCH_BURST_WINDOW_MS} that count as one `switching-burst` event. Tuning: raise to fire less often. */
export const SWITCH_BURST_COUNT = 3
/** Window for {@link SWITCH_BURST_COUNT}. Tuning: shorten to fire only for frantic switching. */
export const SWITCH_BURST_WINDOW_MS = 2 * MINUTE_MS

/** Foreground durations that emit `long-session` events, tier 1 first. Tuning: add or move tiers to nudge more or less often. */
export const LONG_SESSION_TIERS_MS: readonly number[] = Object.freeze([30 * MINUTE_MS, 60 * MINUTE_MS, 120 * MINUTE_MS, 180 * MINUTE_MS])

/**
 * Minimum time away before the `went-away` event exists, before coming back emits `returned`, and before an unlock
 * or resume emits `wake`, so a lock that ends at once leaves no topic. Tuning: lower to react to short breaks.
 */
export const RETURNED_AFTER_AWAY_MS = 5 * MINUTE_MS

/** Events whose effective salience falls below this are dropped. Tuning: raise to forget sooner. */
export const EVENT_DROP_SALIENCE = 0.05

/** Topic key of `switching-burst` events. */
export const SWITCH_BURST_TOPIC_KEY = 'activity:burst'
/** Topic key of `went-away` events. */
export const WENT_AWAY_TOPIC_KEY = 'presence:away'

export interface ReduceSituationOptions {
  /** App ids of AIRI's own windows. Activity from them is ignored. Compared case-insensitively. */
  readonly selfAppIds?: readonly string[]
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

interface Draft extends Mutable<SituationState> {
  recentActivities: SituationRecentActivity[]
  events: SituationEvent[]
  contexts: Record<string, { text: string, atMs: number }>
  tracking: Mutable<SituationTracking> & { switchTimes: number[] }
}

const PRESENCE_STATES: ReadonlySet<string> = new Set<PresenceState>(['here', 'idle', 'away', 'unknown'])
const PRESENCE_REASONS: ReadonlySet<string> = new Set<PresenceReason>(['locked', 'suspended', 'idle', 'stale'])
const BUSY_STATES: ReadonlySet<string> = new Set<BusyState>(['accepts', 'busy', 'fullscreen', 'presentation', 'quiet', 'unknown'])
const CATEGORIES: ReadonlySet<string> = new Set<AppCategory>(['game', 'browser', 'editor', 'media', 'chat', 'call', 'work', 'other'])
const URGENCIES: ReadonlySet<string> = new Set(['immediate', 'soon', 'later'])

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Salience of `event` at `nowMs`: `salience * 0.5^((now - at) / halfLife)`. Never grows before `atMs`. */
export function effectiveSalience(
  event: Pick<SituationEvent, 'salience' | 'atMs' | 'halfLifeMs'>,
  nowMs: number,
): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(event.atMs) || !(event.halfLifeMs > 0))
    return 0
  const age = Math.max(0, nowMs - event.atMs)
  return event.salience * 0.5 ** (age / event.halfLifeMs)
}

function cloneDraft(state: SituationState): Draft {
  return {
    ...state,
    recentActivities: [...state.recentActivities],
    events: state.events.map(event => ({ ...event })),
    contexts: { ...state.contexts },
    tracking: { ...state.tracking, switchTimes: [...state.tracking.switchTimes] },
  }
}

function makeEvent(
  kind: SituationEventKind,
  key: SalienceKey,
  topicKey: string,
  text: string,
  atMs: number,
  extra: { tier?: number, salience?: number } = {},
): SituationEvent {
  return {
    id: `${topicKey}@${atMs}`,
    kind,
    topicKey,
    text,
    atMs,
    salience: extra.salience ?? BASE_SALIENCE[key],
    halfLifeMs: HALF_LIFE_MS[key],
    tier: extra.tier ?? 0,
    origin: 'world',
    shownAtMs: null,
    addressedAtMs: null,
  }
}

/** Adds `event`. A repeated id is ignored; a newer event replaces older ones with its topic key (notify is deduped before this). */
function pushEvent(draft: Draft, event: SituationEvent): void {
  if (draft.events.some(existing => existing.id === event.id))
    return
  draft.events = draft.events.filter(existing => existing.topicKey !== event.topicKey)
  draft.events.push(event)
  draft.events.sort((a, b) => a.atMs - b.atMs)
  if (draft.events.length > SITUATION_EVENTS_MAX)
    draft.events = draft.events.slice(-SITUATION_EVENTS_MAX)
}

function durationText(thresholdMs: number): string {
  return thresholdMs < 60 * MINUTE_MS ? `${Math.round(thresholdMs / MINUTE_MS)} min` : `${Math.round(thresholdMs / (60 * MINUTE_MS))} h`
}

function advanceDraft(draft: Draft, nowMs: number): void {
  const now = Math.max(draft.nowMs ?? 0, nowMs)
  draft.nowMs = now
  const activity = draft.activity
  const tracking = draft.tracking

  if (activity) {
    if (tracking.settledSinceMs !== activity.sinceMs && now - activity.sinceMs >= SETTLE_MS) {
      tracking.settledSinceMs = activity.sinceMs
      pushEvent(draft, makeEvent(
        'app-switch',
        'app-switch',
        activityTopicKey(activity.appId),
        `switched to ${activity.label} (${activity.category})`,
        activity.sinceMs + SETTLE_MS,
      ))
    }

    let done = tracking.tierSinceMs === activity.sinceMs ? tracking.tierDone : 0
    while (done < LONG_SESSION_TIERS_MS.length && now - activity.sinceMs >= LONG_SESSION_TIERS_MS[done]) {
      const threshold = LONG_SESSION_TIERS_MS[done]
      done += 1
      pushEvent(draft, makeEvent(
        'long-session',
        'long-session',
        activityTierTopicKey(activity.appId, done),
        `${activity.label} (${activity.category}) for about ${durationText(threshold)}`,
        activity.sinceMs + threshold,
        { tier: done, salience: longSessionSalience(done) },
      ))
    }
    tracking.tierSinceMs = activity.sinceMs
    tracking.tierDone = done
  }

  const awaySince = tracking.awaySinceMs
  if (awaySince !== null && tracking.awayNotedSinceMs !== awaySince && now - awaySince >= RETURNED_AFTER_AWAY_MS) {
    tracking.awayNotedSinceMs = awaySince
    pushEvent(draft, makeEvent('went-away', 'went-away', WENT_AWAY_TOPIC_KEY, 'stepped away', awaySince + RETURNED_AFTER_AWAY_MS))
  }

  draft.events = draft.events.filter(event => effectiveSalience(event, now) >= EVENT_DROP_SALIENCE)
}

function applyPresence(draft: Draft, o: PresenceObservation, at: number): void {
  if (!PRESENCE_STATES.has(o.state))
    return
  const tracking = draft.tracking
  if (tracking.presenceAtMs !== null && at < tracking.presenceAtMs)
    return
  tracking.presenceAtMs = at

  const reason = o.reason !== undefined && PRESENCE_REASONS.has(o.reason) ? o.reason : null
  const previous = draft.presence
  if (previous.state === o.state) {
    draft.presence = { ...previous, reason }
    return
  }

  draft.presence = { state: o.state, reason, sinceMs: at }
  if (o.state === 'away') {
    // The `went-away` event follows from `advanceDraft` once the user has stayed away long enough.
    if (tracking.awaySinceMs === null)
      tracking.awaySinceMs = at
  }
  else if (o.state === 'here' || o.state === 'idle') {
    const awaySince = tracking.awaySinceMs
    tracking.awaySinceMs = null
    if (awaySince !== null)
      tracking.lastAwayMs = at - awaySince
    if (awaySince !== null && at - awaySince >= RETURNED_AFTER_AWAY_MS) {
      pushEvent(draft, makeEvent(
        'returned',
        'returned',
        PRESENCE_RETURN_TOPIC_KEY,
        `came back after ${Math.floor((at - awaySince) / MINUTE_MS)} min away`,
        at,
      ))
    }
  }
}

function applyActivity(draft: Draft, o: ActivityObservation, at: number, selfAppIds: ReadonlySet<string>): void {
  if (!nonEmpty(o.appId) || !CATEGORIES.has(o.category))
    return
  const appId = o.appId.trim()
  if (selfAppIds.has(appId.toLowerCase()))
    return
  const tracking = draft.tracking
  if (tracking.activityAtMs !== null && at < tracking.activityAtMs)
    return
  tracking.activityAtMs = at

  const label = nonEmpty(o.label) ? o.label.trim() : appId
  const title = nonEmpty(o.title) ? o.title.trim() : null
  const current = draft.activity

  if (!current) {
    draft.activity = { appId, label, category: o.category, title, sinceMs: at }
    tracking.settledSinceMs = at
    return
  }

  if (current.appId === appId) {
    draft.activity = { ...current, label, category: o.category, title }
    return
  }

  tracking.switchTimes = [...tracking.switchTimes.filter(time => time >= at - SWITCH_BURST_WINDOW_MS), at].slice(-8)

  const previous = draft.recentActivities[0]
  if (previous && previous.appId === appId && at - current.sinceMs <= FLAP_MERGE_MS) {
    // A short detour: the previous span continues as if the detour never happened.
    draft.recentActivities.shift()
    draft.activity = { appId, label, category: o.category, title, sinceMs: previous.sinceMs }
  }
  else {
    const ended: SituationRecentActivity = {
      appId: current.appId,
      label: current.label,
      category: current.category,
      sinceMs: current.sinceMs,
      endedAtMs: at,
    }
    draft.recentActivities.unshift(ended)
    draft.recentActivities = draft.recentActivities.slice(0, RECENT_ACTIVITIES_MAX)
    draft.activity = { appId, label, category: o.category, title, sinceMs: at }
  }

  if (tracking.switchTimes.length >= SWITCH_BURST_COUNT) {
    if (!tracking.burstActive) {
      tracking.burstActive = true
      pushEvent(draft, makeEvent(
        'switching-burst',
        'switching-burst',
        SWITCH_BURST_TOPIC_KEY,
        `switching between ${current.label} and ${label}`,
        at,
      ))
    }
  }
  else {
    tracking.burstActive = false
  }
}

function applyConversation(draft: Draft, o: ConversationObservation, at: number): void {
  const conversation = draft.conversation
  const latest = (previous: number | null): number => (previous === null ? at : Math.max(previous, at))
  if (o.who === 'user' && o.origin === 'user') {
    draft.conversation = { ...conversation, lastUserAtMs: latest(conversation.lastUserAtMs) }
  }
  else if (o.who === 'character' && o.origin === 'unprompted') {
    // Only a spoken unprompted turn reports here, so its addressed topic becomes the last remark now.
    draft.conversation = {
      ...conversation,
      lastCharacterAtMs: latest(conversation.lastCharacterAtMs),
      lastUnpromptedAtMs: latest(conversation.lastUnpromptedAtMs),
      lastUnpromptedTopic: draft.tracking.addressedTopic,
    }
    draft.tracking.addressedTopic = null
  }
  else if (o.who === 'character') {
    draft.conversation = { ...conversation, lastCharacterAtMs: latest(conversation.lastCharacterAtMs) }
  }
}

function applyContext(draft: Draft, o: ContextObservation, at: number): void {
  if (!nonEmpty(o.sourceKey) || typeof o.text !== 'string')
    return
  const existing = draft.contexts[o.sourceKey]
  if (existing && at < existing.atMs)
    return
  const text = o.text.trim()
  if (!text) {
    delete draft.contexts[o.sourceKey]
    return
  }
  draft.contexts[o.sourceKey] = { text, atMs: at }
  if (existing && existing.text === text)
    return

  const key: SalienceKey = o.sourceKey === 'vision' ? 'context-vision' : 'context'
  const salience = typeof o.salience === 'number' && Number.isFinite(o.salience) ? Math.min(1, Math.max(0, o.salience)) : undefined
  pushEvent(draft, makeEvent('context', key, contextTopicKey(o.sourceKey), text, at, { salience }))
}

function applyNotify(draft: Draft, o: NotifyObservation, at: number): void {
  if (!nonEmpty(o.sourceKey) || !nonEmpty(o.eventId) || !nonEmpty(o.headline) || !URGENCIES.has(o.urgency))
    return
  const topicKey = notifyTopicKey(o.sourceKey, o.eventId)
  if (draft.events.some(event => event.topicKey === topicKey))
    return
  const key: SalienceKey = o.reminder && o.critical === true ? 'notify-critical' : `notify-${o.urgency}`
  const note = nonEmpty(o.note) ? `: ${o.note.trim()}` : ''
  pushEvent(draft, makeEvent('notify', key, topicKey, `${o.headline.trim()}${note}`, at))
}

function applyObservation(draft: Draft, observation: Observation, now: number, options: ReduceSituationOptions): void {
  const raw = observation as { kind?: unknown, atMs?: unknown } | null
  if (!raw || typeof raw !== 'object' || !isTime(raw.atMs))
    return
  const at = Math.min(raw.atMs, now)

  switch (observation.kind) {
    case 'presence':
      applyPresence(draft, observation, at)
      break
    case 'wake': {
      // A wake ends the current away span, or the span that just ended when the return was reported first. A span
      // shorter than the returned threshold (an instant lock) leaves no topic; a wake without a span to measure keeps it.
      const tracking = draft.tracking
      const awayMs = tracking.awaySinceMs !== null ? at - tracking.awaySinceMs : tracking.lastAwayMs
      if (awayMs !== null && awayMs < RETURNED_AFTER_AWAY_MS)
        break
      // The newest wake in the ring wins; an older wake must not replace it.
      if ((observation.cause === 'unlock' || observation.cause === 'resume') && !draft.events.some(event => event.topicKey === WAKE_TOPIC_KEY && event.atMs > at)) {
        pushEvent(draft, makeEvent(
          'wake',
          'wake',
          WAKE_TOPIC_KEY,
          observation.cause === 'unlock' ? 'unlocked the computer' : 'woke the computer from sleep',
          at,
        ))
      }
      break
    }
    case 'activity':
      applyActivity(draft, observation, at, new Set((options.selfAppIds ?? []).map(id => id.toLowerCase())))
      break
    case 'conversation':
      applyConversation(draft, observation, at)
      break
    case 'context':
      applyContext(draft, observation, at)
      break
    case 'notify':
      applyNotify(draft, observation, at)
      break
    case 'stage': {
      const stage = draft.stage
      if (typeof observation.exposed !== 'string' || typeof observation.active !== 'string' || typeof observation.mood !== 'string')
        break
      if (!stage || at >= stage.atMs)
        draft.stage = { exposed: observation.exposed, active: observation.active, mood: observation.mood, atMs: at }
      break
    }
    case 'busy':
      if (BUSY_STATES.has(observation.state) && (draft.busy.atMs === null || at >= draft.busy.atMs))
        draft.busy = { state: observation.state, atMs: at }
      break
    default:
      // Unknown kinds are ignored; the producer may be newer than this reducer.
      break
  }
}

/**
 * Folds one observation into the situation. Pure: time comes only from the
 * arguments and never runs backwards (the larger of `state.nowMs` and
 * `nowMs` wins), and the input state is not mutated. Malformed observations
 * (non-finite or negative times, unknown kinds, empty ids) and observations
 * older than the slot they would replace are ignored.
 */
export function reduceSituation(
  state: SituationState,
  observation: Observation,
  nowMs: number,
  options: ReduceSituationOptions = {},
): SituationState {
  if (!isTime(nowMs))
    return state
  const draft = cloneDraft(state)
  const now = Math.max(state.nowMs ?? 0, nowMs)
  advanceDraft(draft, now)
  applyObservation(draft, observation, now, options)
  advanceDraft(draft, now)
  return draft
}

/** Derives the events that need no observation: settled app switches, long-session tiers, and expiry. */
export function advanceSituation(state: SituationState, nowMs: number): SituationState {
  if (!isTime(nowMs))
    return state
  const draft = cloneDraft(state)
  advanceDraft(draft, nowMs)
  return draft
}

/** Event kinds that only foreground activity observations produce. */
const FOREGROUND_EVENT_KINDS: ReadonlySet<SituationEventKind> = new Set<SituationEventKind>(['app-switch', 'long-session', 'switching-burst'])

/**
 * Drops everything that came from the foreground app: the current and recent apps (window title and category
 * included), their app-switch, long-session, and switching-burst events, the busy state read from the shell, and the
 * reducer's activity bookkeeping. The result matches a host that never had a foreground reader; the rest of the
 * situation is kept.
 *
 * Use when:
 * - The user stops sharing the foreground app and window titles, so the next prompt must not carry them
 */
export function forgetForeground(state: SituationState): SituationState {
  const draft = cloneDraft(state)
  draft.activity = null
  draft.recentActivities = []
  draft.events = draft.events.filter(event => !FOREGROUND_EVENT_KINDS.has(event.kind))
  draft.busy = initialSituationState.busy
  draft.tracking = {
    ...draft.tracking,
    activityAtMs: null,
    settledSinceMs: null,
    tierSinceMs: null,
    tierDone: 0,
    switchTimes: [],
    burstActive: false,
  }
  return draft
}

/**
 * Whether `sourceKey` belongs to the source `namespace`: it is the namespace itself, or a module inside it. An extension
 * module's source key is `<extension id>:<module id>` (`getMetadataSourceLabel` in stage-ui), so the extension id is
 * the namespace of every module the extension opens. `proj-airi:x-fork:m` is not inside `proj-airi:x`.
 */
export function isSourceInNamespace(sourceKey: string, namespace: string): boolean {
  return sourceKey === namespace || sourceKey.startsWith(`${namespace}:`)
}

/** Whether a context or notify topic key belongs to a source inside `namespace` (see {@link isSourceInNamespace}). */
export function isTopicFromSource(topicKey: string, namespace: string): boolean {
  const contextTopic = contextTopicKey(namespace)
  return topicKey === contextTopic || topicKey.startsWith(`${contextTopic}:`) || topicKey.startsWith(notifyTopicKey(namespace, ''))
}

/**
 * Drops everything that one source namespace (see {@link isSourceInNamespace}) put into the situation: its contexts,
 * its context and notify events, and her pending or last unprompted topic when its text came from one of them. The
 * rest of the situation is kept.
 *
 * Use when:
 * - The user stops sharing a source, such as the web extension, so the next prompt must not carry what it sent
 *
 * Expects:
 * - Her last topic is matched by text, so a topic whose event already left the ring keeps its text.
 */
export function forgetSource(state: SituationState, namespace: string): SituationState {
  const draft = cloneDraft(state)
  const forgottenTexts = new Set<string>()
  for (const [sourceKey, context] of Object.entries(draft.contexts)) {
    if (!isSourceInNamespace(sourceKey, namespace))
      continue
    forgottenTexts.add(context.text)
    delete draft.contexts[sourceKey]
  }
  draft.events = draft.events.filter((event) => {
    const fromSource = (event.kind === 'context' || event.kind === 'notify') && isTopicFromSource(event.topicKey, namespace)
    if (fromSource)
      forgottenTexts.add(event.text)
    return !fromSource
  })
  if (draft.tracking.addressedTopic !== null && forgottenTexts.has(draft.tracking.addressedTopic))
    draft.tracking = { ...draft.tracking, addressedTopic: null }
  if (draft.conversation.lastUnpromptedTopic !== null && forgottenTexts.has(draft.conversation.lastUnpromptedTopic))
    draft.conversation = { ...draft.conversation, lastUnpromptedTopic: null }
  return draft
}

/** Marks events as shown in a prompt. The first time wins; unknown ids are ignored. */
export function markShown(state: SituationState, eventIds: readonly string[], nowMs: number): SituationState {
  if (!isTime(nowMs))
    return state
  const ids = new Set(eventIds)
  const draft = cloneDraft(state)
  draft.nowMs = Math.max(draft.nowMs ?? 0, nowMs)
  draft.events = draft.events.map(event => ids.has(event.id) && event.shownAtMs === null ? { ...event, shownAtMs: draft.nowMs as number } : event)
  return draft
}

/**
 * Marks every event with `topicKey` as addressed by the character. The first
 * time wins. The event's text (`null` when no event matches) waits in
 * `tracking.addressedTopic` and becomes `conversation.lastUnpromptedTopic` when
 * the next unprompted character turn is spoken, so the prompt of the turn being
 * started still names the previous remark.
 */
export function markAddressed(state: SituationState, topicKey: string, nowMs: number): SituationState {
  if (!isTime(nowMs))
    return state
  const draft = cloneDraft(state)
  draft.nowMs = Math.max(draft.nowMs ?? 0, nowMs)
  const matched = draft.events.find(event => event.topicKey === topicKey)
  draft.events = draft.events.map(event => event.topicKey === topicKey && event.addressedAtMs === null ? { ...event, addressedAtMs: draft.nowMs as number } : event)
  draft.tracking.addressedTopic = matched?.text ?? null
  return draft
}
