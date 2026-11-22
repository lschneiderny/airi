import type { IdleErrandRecord } from '@proj-airi/motion-driver-natural/idle-errands'
import type { CatalogEntry, Occasion } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { afterEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useIdleProps } from './use-idle-props'

function entry(id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch }
}

function pastime(seq: number, pick = 0): IdleErrandRecord {
  return { seq, kind: 'pastime', start: seq, end: seq + 120, holdSeconds: 120, pick, endedAt: null, outcome: null }
}

describe('useIdleProps', () => {
  let scope: ReturnType<typeof effectScope> | undefined
  afterEach(() => scope?.stop())

  function setup(catalog: CatalogEntry[], withClaims = true) {
    const state: { nowMs: number, enabled: boolean, occasions: Occasion[], random: number } = { nowMs: 0, enabled: true, occasions: [], random: 0 }
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
      occasions: () => state.occasions,
      random: () => state.random,
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

  it('uses the same moment id for the same pick independently of the local stream', () => {
    const catalog = ['one', 'two', 'three'].map(id => entry(id, { moments: ['poked'] }))
    const first = setup(catalog)
    const firstScope = scope!
    const second = setup(catalog)
    second.state.random = 0.99
    try {
      const picks = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const intentId = `${i}-moment`
        first.props.onMoment('poked', { intentId })
        second.props.onMoment('poked', { intentId })
        expect(first.backend.idleActive).toEqual(second.backend.idleActive)
        for (const id of first.backend.idleActive)
          picks.add(id)
        first.run(61)
        second.run(61)
      }
      expect([...picks].sort()).toEqual(['one', 'three', 'two'])
    }
    finally {
      firstScope.stop()
    }
  })

  it('keeps the 0.6 chance across 10000 distinct moment ids', () => {
    const { backend, props, state } = setup([entry('puff', { moments: ['poked'] })])
    let shown = 0
    for (let i = 0; i < 10000; i++) {
      props.onMoment('poked', { intentId: `${i}-moment` })
      shown += Number(backend.idleActive.length > 0)
      state.nowMs += 61_000
      props.tick()
    }
    expect(Math.abs(shown / 10000 - 0.6)).toBeLessThan(0.02)
  })

  it('picks a different pastime from the last one while another is offered', () => {
    const { reports, start, end } = setup([entry('game', { idleUse: 'activity' }), entry('snack', { idleUse: 'activity' })])
    start(pastime(1, 0))
    end(pastime(1, 0))
    start(pastime(2, 0))
    expect(reports).toEqual(['prop:start:game', 'prop:end:game', 'prop:start:snack'])
  })

  it('shows a pastime tagged with occasions only during one of them, and first then', () => {
    const { state, reports, answers, start, end } = setup([entry('game', { idleUse: 'activity' }), entry('bread', { idleUse: 'activity', occasions: ['morning'] })])
    // Outside the morning the draw that would land on the bread takes the game.
    start(pastime(1, 0.99))
    end(pastime(1, 0.99))
    state.occasions = ['morning']
    start(pastime(2, 0))
    expect(reports).toEqual(['prop:start:game', 'prop:end:game', 'prop:start:bread'])
    expect(answers).toEqual([])
  })

  it('refuses a pastime when every entry waits for an occasion that does not hold', () => {
    const { backend, reports, answers, start } = setup([entry('bread', { idleUse: 'activity', occasions: ['morning'] })])
    start(pastime(1))
    expect(backend.idleActive).toEqual([])
    expect(reports).toEqual([])
    expect(answers).toEqual(['1:refused'])
  })

  it('marks an act that is a moment with a tagged entry until the act ends', () => {
    const { backend, reports, props, run } = setup([entry('wink', { kind: 'face', moments: ['check-in'] }), entry('tongue', { kind: 'face', moments: ['peering'] })])
    props.onIdleBehaviour({ behaviour: 'check-in', phase: 'start' })
    expect(backend.idleActive).toEqual(['wink'])
    run(3)
    expect(backend.idleActive).toEqual(['wink'])
    props.onIdleBehaviour({ behaviour: 'check-in', phase: 'end' })
    expect(backend.idleActive).toEqual([])
    // A moment is seconds long and is not told to the situation.
    expect(reports).toEqual([])
    expect(props.state().moment).toBeNull()
  })

  it('keeps the expression of a passing moment for its hold, one moment at a time, and lets some moments pass', () => {
    const { state, backend, props, run } = setup([entry('puff', { kind: 'face', moments: ['poked'] }), entry('blush', { kind: 'effect', moments: ['petted'] })])
    props.onMoment('poked')
    props.onMoment('petted')
    expect(backend.idleActive).toEqual(['puff'])
    expect(props.state().moment).toEqual({ moment: 'poked', label: 'puff' })
    run(3)
    expect(backend.idleActive).toEqual([])
    // The draw decides whether she marks a moment at all.
    state.random = 0.9
    props.onMoment('petted')
    expect(backend.idleActive).toEqual([])
    // A forced moment is the lab's preview: it shows whatever the draw says.
    props.onMoment('petted', { force: true })
    expect(backend.idleActive).toEqual(['blush'])
  })

  it('marks waking up and holding something back, and marks nothing while the setting is off', () => {
    const { state, backend, props, run } = setup([entry('sleepy', { kind: 'face', moments: ['waking'] }), entry('pout', { kind: 'face', moments: ['held-back'] })])
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start' })
    run(10)
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end' })
    expect(backend.idleActive).toEqual(['sleepy'])
    run(6)
    expect(backend.idleActive).toEqual([])
    props.onIdleBehaviour({ behaviour: 'let-go', phase: 'start' })
    expect(backend.idleActive).toEqual(['pout'])
    run(4)
    state.enabled = false
    props.onMoment('held-back', { force: true })
    expect(backend.idleActive).toEqual([])
  })

  it('starts a pastime by hand through the same pick and report, without an answer to Natural, and ends it after 30 s', () => {
    const { state, backend, reports, answers, props, run } = setup([entry('game', { idleUse: 'activity' }), entry('bread', { idleUse: 'activity', occasions: ['morning'] })])
    state.occasions = ['morning']
    props.playPastime()
    expect(backend.idleActive).toEqual(['bread'])
    expect(props.state()).toEqual({ occasions: ['morning'], pastime: 'bread', moment: null })
    run(29)
    expect(backend.idleActive).toEqual(['bread'])
    run(1)
    expect(backend.idleActive).toEqual([])
    expect(reports).toEqual(['prop:start:bread', 'prop:end:bread'])
    expect(answers).toEqual([])
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
