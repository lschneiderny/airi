import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandReport } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdlePropCandidate, Moment, MomentCandidate, Occasion, PastimeHistory } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { NaturalLabIdleLife } from '../../stores/natural-performance-override'
import type { StageSelfReport } from '../../stores/self'

import { chooseMomentEntry, choosePastime, drawPickerTickets, drawRandom, expressionSeed, idleActivityEntries, idleSleepEntryIds, MOMENT_HOLD_MS, MOMENT_SETTINGS, momentEntries } from '@proj-airi/stage-shared/expression-performance'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

/** How often the stage checks that what she holds is still shown and her sleep entries are due. */
const IDLE_PROPS_TICK_MS = 1000
/** Her eyes take about 6 s to close; what she sleeps with appears once they are nearly shut. */
const SLEEP_ENTRIES_DELAY_MS = 5000
/** How long a pastime started by hand stays, and a moment played by hand that would otherwise last as long as an act. */
const PREVIEW_PASTIME_MS = 30_000
const PREVIEW_ACT_MOMENT_MS = 4000

/** The idle acts and cues of the Natural driver that are moments: the expression is on from the act's start to its end. */
const ACT_MOMENTS: Partial<Record<IdleBehaviourReport['behaviour'], Moment>> = { 'check-in': 'check-in', 'yawn': 'yawning', 'zone-out': 'zoning-out', 'peer': 'peering' }

export interface IdlePropsOptions {
  /** The expression store of the rendered model, or `undefined` for a renderer that has none. */
  backend: () => StageExpressionBackend | undefined
  /** She may do things on her own: the Natural driver draws her and the user's Idle activities setting is on. */
  enabled: () => boolean
  /** Tells the situation what she picked up and put away. */
  report: (entry: StageSelfReport) => void
  /** Answers Natural's pastime: `refused` when nothing could be shown, `done` when she put it away before its end. */
  answer: (seq: number, outcome: 'done' | 'refused') => void
  /**
   * The occasions that hold now, read once a second and at each pastime start. A pastime tagged with occasions is
   * shown only during one of them. Absent means no occasion ever holds, so tagged pastimes stay away.
   */
  occasions?: () => readonly Occasion[]
  /** Uniform draws for performer reports and previews only; defaults to a local Mulberry32 stream starting at 0. */
  random?: () => number
  now?: () => number
}

/**
 * Realises the pastimes Natural's idle draw starts, with her own expressions, on a model whose store supports it
 * (Live2D). Natural decides when a pastime starts and ends; this picks which entry she holds and shows it.
 *
 * - A pastime start (`onErrand`) shows one entry the user marked as a pastime, chosen by `choosePastime` from
 *   Natural's `pick` and the occasions that hold. When nothing can be shown it answers `refused`, and Natural treats
 *   the pastime as spent.
 * - A pastime end puts the entry away. When the user changes her look by hand the store drops her claims; the tick
 *   sees the entry gone, puts it away and answers `done`. She also puts it away when she starts to sleep.
 * - Entries marked for sleep come on 5 s after she starts to fall asleep, when her eyes are nearly shut, and go off
 *   the moment she wakes.
 * - A moment (`onMoment`, and the idle acts `onIdleBehaviour` sees) is marked with one entry the user tagged for it,
 *   some of the times it happens: until the act ends for a moment that is an act, for a few seconds otherwise. One
 *   moment is marked at a time. A moment is not reported to the situation.
 * - All of them are claims below the slot leases, so an expression the model asks for still shows on top, and above
 *   the user's switches. Each pastime is reported to the situation as a `prop` activity with the entry's label.
 *
 * Call `onErrand` with each idle errand report of the scene, `onIdleBehaviour` with each behaviour report, and
 * `onMoment` for the moments that come from elsewhere (a touch, the user coming back). `playPastime` and
 * `onMoment(moment, { force: true })` are previews for the motion lab.
 */
export function useIdleProps(options: IdlePropsOptions) {
  const now = options.now ?? Date.now
  let randomState = 0
  const random = options.random ?? (() => {
    const drawn = drawRandom(randomState)
    randomState = drawn.random
    return drawn.value
  })
  let history: PastimeHistory = { lastId: null, heldAtMs: {} }
  /** A pastime started by hand has a negative `seq`, which Natural never issues, and ends at `untilMs`. */
  let held: (IdlePropCandidate & { seq: number, untilMs?: number }) | null = null
  let previewSeq = 0
  let momentHistory: Record<string, number> = {}
  let marking: (MomentCandidate & { moment: Moment, untilMs: number }) | null = null
  let occasions: readonly Occasion[] = []
  /** When she started to fall asleep, or `null` while she is awake. */
  let asleepSinceMs: number | null = null

  function claimable() {
    const backend = options.backend()
    return backend?.setIdleClaims !== undefined && options.enabled() ? backend : undefined
  }

  /** Shows what she holds and what she sleeps with, and returns what the store applied. */
  function applyClaims(): readonly string[] {
    const backend = options.backend()
    if (!backend?.setIdleClaims)
      return []
    const enabled = options.enabled()
    const switchedOn = backend.manualActive ?? []
    const sleeping = enabled && asleepSinceMs !== null && now() - asleepSinceMs >= SLEEP_ENTRIES_DELAY_MS
    return backend.setIdleClaims([
      ...held ? [held.id] : [],
      ...marking ? [marking.id] : [],
      ...sleeping ? idleSleepEntryIds(backend.catalog).filter(id => !switchedOn.includes(id)) : [],
    ])
  }

  function putAway(answer: boolean) {
    if (!held)
      return
    options.report({ activity: 'prop', phase: 'end', label: held.label })
    if (answer && held.seq > 0)
      options.answer(held.seq, 'done')
    held = null
  }

  function tick() {
    // The store drops her claims when the user changes her look by hand; the pastime she held is then over.
    if (held && !(claimable()?.idleActive ?? []).includes(held.id))
      putAway(true)
    if (held?.untilMs !== undefined && now() >= held.untilMs)
      putAway(false)
    if (marking && now() >= marking.untilMs)
      marking = null
    applyClaims()
    // Read every tick, not only at a pastime start: the morning begins when the user is first seen.
    occasions = options.occasions?.() ?? []
  }

  /** Follows Natural's pastimes: shows one when it starts, puts it away when it ends. */
  function onErrand(report: IdleErrandReport) {
    const { errand } = report
    if (errand.kind !== 'pastime')
      return
    if (report.phase === 'end') {
      if (held?.seq === errand.seq) {
        putAway(false)
        applyClaims()
      }
      return
    }
    // A pastime started by hand gives way to the one Natural starts, and the other way round.
    putAway(true)
    const backend = claimable()
    const switchedOn = backend?.manualActive ?? []
    const offered = backend ? idleActivityEntries(backend.catalog).filter(candidate => !switchedOn.includes(candidate.id)) : []
    const nowMs = now()
    occasions = options.occasions?.() ?? []
    const picked = choosePastime(offered, history, { nowMs, pick: errand.pick, occasions })
    held = picked && { ...picked, seq: errand.seq }
    // An entry the store refused is not shown, so it is not told either; Natural counts the pastime as spent.
    if (!picked || !applyClaims().includes(picked.id)) {
      held = null
      if (errand.seq > 0)
        options.answer(errand.seq, 'refused')
      return
    }
    history = { lastId: picked.id, heldAtMs: { ...history.heldAtMs, [picked.id]: nowMs } }
    options.report({ activity: 'prop', phase: 'start', label: picked.label })
  }

  /**
   * Marks `moment` with one of the entries tagged for it, or lets it pass; see `chooseMomentEntry`. `phase: 'end'`
   * ends a moment that lasts as long as its act. `force` is the lab's preview: it replaces a moment in progress and
   * skips the chance and the entry's rest. A mind moment carries `intentId`, which seeds both draws independently
   * of previews and local performer reports; those have no mind moment id and use the local stream.
   */
  function onMoment(moment: Moment, options_: { intentId?: string, phase?: 'start' | 'end', force?: boolean } = {}) {
    if (options_.phase === 'end') {
      if (marking?.moment === moment && MOMENT_HOLD_MS[moment] === 'act') {
        marking = null
        applyClaims()
      }
      return
    }
    const backend = claimable()
    if (!backend || (marking && !options_.force))
      return
    const switchedOn = backend.manualActive ?? []
    const offered = momentEntries(backend.catalog).filter(candidate => !switchedOn.includes(candidate.id) && candidate.id !== held?.id)
    const nowMs = now()
    const tickets = options_.intentId === undefined
      ? { gate: random(), pick: random() }
      : drawPickerTickets(expressionSeed(options_.intentId, 'moment')).tickets
    const picked = chooseMomentEntry(offered, moment, momentHistory, { nowMs, chance: tickets.gate, pick: tickets.pick, force: options_.force })
    if (!picked)
      return
    const hold = MOMENT_HOLD_MS[moment]
    marking = { ...picked, moment, untilMs: nowMs + (hold === 'act' ? options_.force ? PREVIEW_ACT_MOMENT_MS : MOMENT_SETTINGS.actCapMs : hold) }
    if (!applyClaims().includes(picked.id)) {
      marking = null
      return
    }
    momentHistory = { ...momentHistory, [picked.id]: nowMs }
  }

  /** Starts a pastime now, as Natural's draw would, for the lab: the same pick, claim and report, kept for 30 s. */
  function playPastime() {
    previewSeq -= 1
    onErrand({ phase: 'start', errand: { seq: previewSeq, kind: 'pastime', start: 0, end: 0, holdSeconds: null, pick: random(), endedAt: null, outcome: null } })
    if (held)
      held.untilMs = now() + PREVIEW_PASTIME_MS
  }

  /** What she shows on her own right now, for the lab's readout. */
  function state(): NaturalLabIdleLife {
    return { occasions: [...occasions], pastime: held?.label ?? null, moment: marking && { moment: marking.moment, label: marking.label } }
  }

  /**
   * Follows her acts: the ones that are moments, and her sleep, so what she takes to bed is on while she sleeps and a
   * pastime ends before it.
   */
  function onIdleBehaviour(report: IdleBehaviourReport) {
    const moment = ACT_MOMENTS[report.behaviour]
    if (moment)
      onMoment(moment, { phase: report.phase })
    // She held something back: the cue is over in a moment, so only its start counts.
    if (report.behaviour === 'let-go' && report.phase === 'start')
      onMoment('held-back')
    if (report.behaviour !== 'sleep')
      return
    asleepSinceMs = report.phase === 'start' ? now() : null
    // The pastime ends before the sleep is reported, so the situation closes them in order.
    if (report.phase === 'start')
      putAway(true)
    tick()
    if (report.phase === 'end')
      onMoment('waking')
  }

  useIntervalFn(tick, IDLE_PROPS_TICK_MS)
  onScopeDispose(() => {
    options.backend()?.setIdleClaims?.([])
  })

  return { tick, onErrand, onIdleBehaviour, onMoment, playPastime, state }
}
