import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandReport } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdlePropCandidate, PastimeHistory } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { choosePastime, idleActivityEntries, idleSleepEntryIds } from '@proj-airi/stage-shared/expression-performance'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

/** How often the stage checks that what she holds is still shown and her sleep entries are due. */
const IDLE_PROPS_TICK_MS = 1000
/** Her eyes take about 6 s to close; what she sleeps with appears once they are nearly shut. */
const SLEEP_ENTRIES_DELAY_MS = 5000

export interface IdlePropsOptions {
  /** The expression store of the rendered model, or `undefined` for a renderer that has none. */
  backend: () => StageExpressionBackend | undefined
  /** She may do things on her own: the Natural driver draws her and the user's Idle activities setting is on. */
  enabled: () => boolean
  /** Tells the situation what she picked up and put away. */
  report: (entry: StageSelfReport) => void
  /** Answers Natural's pastime: `refused` when nothing could be shown, `done` when she put it away before its end. */
  answer: (seq: number, outcome: 'done' | 'refused') => void
  now?: () => number
}

/**
 * Realises the pastimes Natural's idle draw starts, with her own expressions, on a model whose store supports it
 * (Live2D). Natural decides when a pastime starts and ends; this picks which entry she holds and shows it.
 *
 * - A pastime start (`onErrand`) shows one entry the user marked as a pastime, chosen by `choosePastime` from
 *   Natural's `pick`. When nothing can be shown it answers `refused`, and Natural treats the pastime as spent.
 * - A pastime end puts the entry away. When the user changes her look by hand the store drops her claims; the tick
 *   sees the entry gone, puts it away and answers `done`. She also puts it away when she starts to sleep.
 * - Entries marked for sleep come on 5 s after she starts to fall asleep, when her eyes are nearly shut, and go off
 *   the moment she wakes.
 * - Both are claims below the slot leases, so an expression the model asks for still shows on top, and above the
 *   user's switches. Each pastime is reported to the situation as a `prop` activity with the entry's label.
 *
 * Call `onErrand` with each idle errand report of the scene and `onIdleBehaviour` with each behaviour report.
 */
export function useIdleProps(options: IdlePropsOptions) {
  const now = options.now ?? Date.now
  let history: PastimeHistory = { lastId: null, heldAtMs: {} }
  let held: (IdlePropCandidate & { seq: number }) | null = null
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
      ...sleeping ? idleSleepEntryIds(backend.catalog).filter(id => !switchedOn.includes(id)) : [],
    ])
  }

  function putAway(answer: boolean) {
    if (!held)
      return
    options.report({ activity: 'prop', phase: 'end', label: held.label })
    if (answer)
      options.answer(held.seq, 'done')
    held = null
  }

  function tick() {
    // The store drops her claims when the user changes her look by hand; the pastime she held is then over.
    if (held && !(claimable()?.idleActive ?? []).includes(held.id))
      putAway(true)
    applyClaims()
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
    const backend = claimable()
    const switchedOn = backend?.manualActive ?? []
    const offered = backend ? idleActivityEntries(backend.catalog).filter(candidate => !switchedOn.includes(candidate.id)) : []
    const nowMs = now()
    const picked = choosePastime(offered, history, { nowMs, pick: errand.pick })
    held = picked && { ...picked, seq: errand.seq }
    // An entry the store refused is not shown, so it is not told either; Natural counts the pastime as spent.
    if (!picked || !applyClaims().includes(picked.id)) {
      held = null
      options.answer(errand.seq, 'refused')
      return
    }
    history = { lastId: picked.id, heldAtMs: { ...history.heldAtMs, [picked.id]: nowMs } }
    options.report({ activity: 'prop', phase: 'start', label: picked.label })
  }

  /** Follows her sleep, so what she takes to bed is on while she sleeps and a pastime ends before it. */
  function onIdleBehaviour(report: IdleBehaviourReport) {
    if (report.behaviour !== 'sleep')
      return
    asleepSinceMs = report.phase === 'start' ? now() : null
    // The pastime ends before the sleep is reported, so the situation closes them in order.
    if (report.phase === 'start')
      putAway(true)
    tick()
  }

  useIntervalFn(tick, IDLE_PROPS_TICK_MS)
  onScopeDispose(() => {
    options.backend()?.setIdleClaims?.([])
  })

  return { tick, onErrand, onIdleBehaviour }
}
