import type { IdleErrandRecord } from '@proj-airi/motion-driver-natural/idle-errands'
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { afterEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useIdleProps } from './use-idle-props'

function entry(id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch }
}

function pastime(seq: number, pick = 0): IdleErrandRecord {
  return { seq, kind: 'pastime', start: seq, end: seq + 120, pick, endedAt: null, outcome: null }
}

describe('useIdleProps', () => {
  let scope: ReturnType<typeof effectScope> | undefined
  afterEach(() => scope?.stop())

  function setup(catalog: CatalogEntry[], withClaims = true) {
    const state = { nowMs: 0, enabled: true }
    const reports: string[] = []
    const answers: string[] = []
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
      report: (report: StageSelfReport) => reports.push(`${report.activity}:${report.phase}:${report.label}`),
      answer: (seq, outcome) => answers.push(`${seq}:${outcome}`),
      now: () => state.nowMs,
    }))!
    /** Ticks once a second for `seconds`. */
    const run = (seconds: number) => {
      for (let second = 0; second < seconds; second++) {
        state.nowMs += 1000
        props.tick()
      }
    }
    const start = (errand: IdleErrandRecord) => props.onErrand({ phase: 'start', errand })
    const end = (errand: IdleErrandRecord) => props.onErrand({ phase: 'end', errand: { ...errand, endedAt: errand.end, outcome: 'done' } })
    return { state, backend, reports, answers, props, run, start, end }
  }

  it('holds the pastime Natural starts, tells the situation, and puts it away when Natural ends it', () => {
    const { backend, reports, answers, run, start, end } = setup([entry('game', { idleUse: 'activity', label: 'handheld' }), entry('glasses')])
    start(pastime(1))
    run(30)
    expect(backend.idleActive).toEqual(['game'])
    end(pastime(1))
    expect(backend.idleActive).toEqual([])
    expect(reports).toEqual(['prop:start:handheld', 'prop:end:handheld'])
    expect(answers).toEqual([])
  })

  it('picks a different pastime from the last one while another is offered', () => {
    const { reports, start, end } = setup([entry('game', { idleUse: 'activity' }), entry('snack', { idleUse: 'activity' })])
    start(pastime(1, 0))
    end(pastime(1, 0))
    start(pastime(2, 0))
    expect(reports).toEqual(['prop:start:game', 'prop:end:game', 'prop:start:snack'])
  })

  it('puts the pastime away and answers done when the user changes her look by hand', () => {
    const { backend, reports, answers, run, start } = setup([entry('game', { idleUse: 'activity' })])
    start(pastime(1))
    // What the Live2D store does when the user toggles a switch.
    backend.idleActive = []
    run(1)
    expect(reports).toEqual(['prop:start:game', 'prop:end:game'])
    expect(answers).toEqual(['1:done'])
    expect(backend.idleActive).toEqual([])
  })

  it('takes her sleep entries to bed, puts the pastime away first, and puts them away when she wakes', () => {
    const { backend, reports, answers, props, run, start } = setup([entry('pillow', { idleUse: 'sleep' }), entry('bubble', { idleUse: 'sleep', kind: 'effect' }), entry('game', { idleUse: 'activity' })])
    start(pastime(1))
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start' })
    expect(reports).toEqual(['prop:start:game', 'prop:end:game'])
    expect(answers).toEqual(['1:done'])
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
    expect(reports).toEqual(['prop:start:game', 'prop:end:game'])
  })

  it('refuses the pastime while idle activities are off, for an entry the user switched on, or on a store without claims', () => {
    const off = setup([entry('game', { idleUse: 'activity' }), entry('pillow', { idleUse: 'sleep' })])
    off.state.enabled = false
    off.props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start' })
    off.run(10)
    expect(off.backend.idleActive).toEqual([])
    off.start(pastime(1))
    expect(off.answers).toEqual(['1:refused'])
    expect(off.reports).toEqual([])
    scope?.stop()

    const manual = setup([entry('game', { idleUse: 'activity' })])
    manual.backend.manualActive = ['game']
    manual.start(pastime(1))
    expect(manual.answers).toEqual(['1:refused'])
    expect(manual.reports).toEqual([])
    scope?.stop()

    const plain = setup([entry('game', { idleUse: 'activity' })], false)
    plain.start(pastime(1))
    expect(plain.answers).toEqual(['1:refused'])
    expect(plain.reports).toEqual([])
  })

  it('clears her claims when the stage goes away', () => {
    const { backend, start } = setup([entry('game', { idleUse: 'activity' })])
    start(pastime(1))
    expect(backend.idleActive).toEqual(['game'])
    scope?.stop()
    scope = undefined
    expect(backend.idleActive).toEqual([])
  })
})
