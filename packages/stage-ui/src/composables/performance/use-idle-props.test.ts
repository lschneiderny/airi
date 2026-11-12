import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { IDLE_PROP_HOLD_MS } from '@proj-airi/stage-shared/expression-performance'
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useIdleProps } from './use-idle-props'

function entry(id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch }
}

describe('useIdleProps', () => {
  let scope: ReturnType<typeof effectScope> | undefined
  afterEach(() => scope?.stop())

  function setup(catalog: CatalogEntry[], withClaims = true) {
    const state = { nowMs: 0, enabled: true, mode: 'idle' as 'idle' | 'talking', away: false }
    const reports: string[] = []
    const backend: StageExpressionBackend & { idleActive: string[], manualActive: string[] } = {
      catalog,
      modelId: 'model',
      llmEligibleEntries: [],
      leases: { face: null, effect: null, prop: null },
      manualActive: [],
      idleActive: [],
    }
    if (withClaims) {
      backend.setIdleClaims = (ids) => {
        backend.idleActive = ids.filter(id => catalog.some(candidate => candidate.id === id) && !backend.manualActive.includes(id))
        return backend.idleActive
      }
    }
    scope = effectScope()
    const props = scope.run(() => useIdleProps({
      backend: () => backend,
      enabled: () => state.enabled,
      performance: () => ({ mode: state.mode, away: state.away }),
      report: (report: StageSelfReport) => reports.push(`${report.activity}:${report.phase}:${report.label}`),
      now: () => state.nowMs,
      seed: 7,
    }))!
    /** Ticks once a second until `until` holds or `seconds` passed. */
    const run = (seconds: number, until: () => boolean = () => false) => {
      for (let second = 0; second < seconds && !until(); second++) {
        state.nowMs += 1000
        props.tick()
      }
    }
    return { state, backend, reports, props, run }
  }

  it('picks a pastime up, tells the situation, and puts it away when its time is up', () => {
    const { backend, reports, run } = setup([entry('game', { idleUse: 'activity', label: 'handheld' }), entry('glasses')])
    run(3600, () => backend.idleActive.length > 0)
    expect(backend.idleActive).toEqual(['game'])
    expect(reports).toEqual(['prop:start:handheld'])
    run(IDLE_PROP_HOLD_MS.max / 1000 + 2, () => backend.idleActive.length === 0)
    expect(backend.idleActive).toEqual([])
    expect(reports).toEqual(['prop:start:handheld', 'prop:end:handheld'])
  })

  it('puts the pastime away when she is spoken to, and when the user changes her look by hand', () => {
    const spoken = setup([entry('game', { idleUse: 'activity' })])
    spoken.run(3600, () => spoken.backend.idleActive.length > 0)
    spoken.state.mode = 'talking'
    spoken.run(1)
    expect(spoken.backend.idleActive).toEqual([])
    expect(spoken.reports).toEqual(['prop:start:game', 'prop:end:game'])
    scope?.stop()

    const changed = setup([entry('game', { idleUse: 'activity' })])
    changed.run(3600, () => changed.backend.idleActive.length > 0)
    // What the Live2D store does when the user toggles a switch.
    changed.backend.idleActive = []
    changed.run(1)
    expect(changed.reports).toEqual(['prop:start:game', 'prop:end:game'])
    expect(changed.backend.idleActive).toEqual([])
  })

  it('takes her sleep entries to bed and puts them away when she wakes', () => {
    const { backend, reports, props, state, run } = setup([entry('pillow', { idleUse: 'sleep' }), entry('bubble', { idleUse: 'sleep', kind: 'effect' }), entry('game', { idleUse: 'activity' })])
    state.away = true
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start' })
    // Her eyes are still closing.
    run(4)
    expect(backend.idleActive).toEqual([])
    run(1)
    expect(backend.idleActive).toEqual(['pillow', 'bubble'])
    props.onIdleBehaviour({ behaviour: 'yawn', phase: 'start' })
    expect(backend.idleActive).toEqual(['pillow', 'bubble'])
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end' })
    expect(backend.idleActive).toEqual([])
    // What she sleeps with is part of the sleep the Natural driver already reports.
    expect(reports).toEqual([])
  })

  it('does nothing while idle activities are off, for an entry the user switched on, or on a store without claims', () => {
    const off = setup([entry('game', { idleUse: 'activity' }), entry('pillow', { idleUse: 'sleep' })])
    off.state.enabled = false
    off.props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start' })
    off.run(10)
    expect(off.backend.idleActive).toEqual([])
    off.props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end' })
    off.run(3600)
    expect(off.backend.idleActive).toEqual([])
    expect(off.reports).toEqual([])
    scope?.stop()

    const manual = setup([entry('game', { idleUse: 'activity' })])
    manual.backend.manualActive = ['game']
    manual.run(3600)
    expect(manual.reports).toEqual([])
    scope?.stop()

    const plain = setup([entry('game', { idleUse: 'activity' })], false)
    plain.run(3600)
    expect(plain.reports).toEqual([])
  })

  it('clears her claims when the stage goes away', () => {
    const { backend, run } = setup([entry('game', { idleUse: 'activity' })])
    run(3600, () => backend.idleActive.length > 0)
    scope?.stop()
    scope = undefined
    expect(backend.idleActive).toEqual([])
  })
})
