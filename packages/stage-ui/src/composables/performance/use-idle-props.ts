import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdlePropMemory } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { decideIdleProp, idleActivityEntries, idleSleepEntryIds, initialIdlePropMemory } from '@proj-airi/stage-shared/expression-performance'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

/** How often the stage asks whether she picks something up or puts it away. */
const IDLE_PROPS_TICK_MS = 1000
/** Her eyes take about 6 s to close; what she sleeps with appears once they are nearly shut. */
const SLEEP_ENTRIES_DELAY_MS = 5000

export interface IdlePropsOptions {
  /** The expression store of the rendered model, or `undefined` for a renderer that has none. */
  backend: () => StageExpressionBackend | undefined
  /** She may do things on her own: the Natural driver draws her and the user's Idle activities setting is on. */
  enabled: () => boolean
  performance: () => Pick<PerformanceState, 'mode' | 'away'>
  /** Tells the situation what she picked up and put away. */
  report: (entry: StageSelfReport) => void
  now?: () => number
  seed?: number
}

/**
 * Lets the character use her own expressions unasked, on a model whose store supports it (Live2D).
 *
 * - An entry the user marked as a pastime is picked up for a few minutes while she is idle or watching, and put away
 *   when its time is up, when she is spoken to, and before she sleeps. `decideIdleProp` owns the timing.
 * - Entries marked for sleep come on 5 s after she starts to fall asleep, when her eyes are nearly shut, and go off
 *   the moment she wakes.
 * - Both are claims below the slot leases, so an expression the model asks for still shows on top, and above the
 *   user's switches. When the user changes her look by hand the store drops the claims, and the pastime ends here.
 * - Each pastime is reported to the situation as a `prop` activity with the entry's label, so the model is told.
 *
 * Call `onIdleBehaviour` with each idle behaviour report of the scene; `tick` runs once a second on its own.
 */
export function useIdleProps(options: IdlePropsOptions) {
  const now = options.now ?? Date.now
  const seed = options.seed ?? Math.floor(Math.random() * 0x1_0000_0000)
  let memory: IdlePropMemory = initialIdlePropMemory
  /** When she started to fall asleep, or `null` while she is awake. */
  let asleepSinceMs: number | null = null

  function tick() {
    const backend = options.backend()
    const enabled = backend?.setIdleClaims !== undefined && options.enabled()
    const catalog = backend?.catalog ?? []
    const switchedOn = backend?.manualActive ?? []
    const held = memory.current
    // The store drops her claims when the user changes her look by hand; the pastime she held is then over.
    const revoked = held !== null && !(backend?.idleActive ?? []).includes(held.id)
    const activities = enabled ? idleActivityEntries(catalog).filter(candidate => !switchedOn.includes(candidate.id) && (!revoked || candidate.id !== held.id)) : []
    const { mode, away } = options.performance()
    const nowMs = now()
    const decision = decideIdleProp(memory, {
      nowMs,
      activities,
      free: enabled && (mode === 'idle' || mode === 'watching') && !away && asleepSinceMs === null,
      pace: 1,
      seed,
    })
    memory = decision.memory
    if (decision.ended)
      options.report({ activity: 'prop', phase: 'end', label: decision.ended.label })

    if (backend?.setIdleClaims) {
      const pastime = memory.current
      const applied = backend.setIdleClaims([
        ...pastime ? [pastime.id] : [],
        ...enabled && asleepSinceMs !== null && nowMs - asleepSinceMs >= SLEEP_ENTRIES_DELAY_MS ? idleSleepEntryIds(catalog).filter(id => !switchedOn.includes(id)) : [],
      ])
      // An entry the store refused is not shown, so it is not told either; the next tick ends it as revoked.
      if (decision.started && applied.includes(decision.started.id))
        options.report({ activity: 'prop', phase: 'start', label: decision.started.label })
    }
  }

  /** Follows her sleep, so what she takes to bed is on while she sleeps and a pastime ends before it. */
  function onIdleBehaviour(report: IdleBehaviourReport) {
    if (report.behaviour !== 'sleep')
      return
    asleepSinceMs = report.phase === 'start' ? now() : null
    tick()
  }

  useIntervalFn(tick, IDLE_PROPS_TICK_MS)
  onScopeDispose(() => {
    options.backend()?.setIdleClaims?.([])
  })

  return { tick, onIdleBehaviour }
}
