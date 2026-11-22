import type { IdleErrandRecord } from '@proj-airi/motion-driver-natural/idle-errands'
import type { CatalogEntry, Occasion } from '@proj-airi/stage-shared/expression-performance'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { StageSelfReport } from '../../stores/self'

import { CharacterMind } from '@proj-airi/character-mind'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
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

  /** The window's mind, which keeps the moment rest; a stage that shares it passes the same one. */
  function windowMind(clock: { nowMs: number }) {
    return new CharacterMind({ seed: 1, clock: () => clock.nowMs })
  }

  function setup(catalog: CatalogEntry[], withClaims = true, shared?: { mind: CharacterMind, clock: { nowMs: number } }) {
    const state: { nowMs: number, enabled: boolean, occasions: Occasion[], random: number } = { nowMs: shared?.clock.nowMs ?? 0, enabled: true, occasions: [], random: 0 }
    const mind = shared?.mind ?? windowMind(state)
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
      momentRest: () => mind.state.refractory.momentRest,
      momentMarked: entryId => mind.receive({ kind: 'performer-report', report: { kind: 'moment-marked', entryId } }),
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
    return { state, backend, reports, answers, props, run, start, end, mind }
  }

  it('rests an entry another stage marked, by the moment rest the mind keeps', () => {
    const catalog = [entry('wink', { moments: ['poked'] })]
    const clock = { nowMs: 0 }
    const mind = windowMind(clock)
    const first = setup(catalog, true, { mind, clock })
    const firstScope = scope!
    const second = setup(catalog, true, { mind, clock })
    try {
      first.props.onMoment('poked')
      expect(first.backend.idleActive).toEqual(['wink'])

      clock.nowMs = second.state.nowMs = 59_999
      second.props.onMoment('poked')
      expect(second.backend.idleActive).toEqual([])

      clock.nowMs = second.state.nowMs = 60_000
      second.props.onMoment('poked')
      expect(second.backend.idleActive).toEqual(['wink'])
    }
    finally {
      firstScope.stop()
    }
  })

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

  it('marks an act, a let-go, and a waking from the intent that started each, alike in two stages and apart from previews', () => {
    const catalog = [
      ...['one', 'two', 'three'].map(id => entry(id, { kind: 'face', moments: ['check-in'] })),
      ...['four', 'five'].map(id => entry(id, { kind: 'face', moments: ['held-back'] })),
      ...['six', 'seven'].map(id => entry(id, { kind: 'face', moments: ['waking'] })),
    ]
    const first = setup(catalog)
    const firstScope = scope!
    const second = setup(catalog)
    // The second stage drew previews before, on another local stream.
    second.state.random = 0.99
    second.props.onMoment('check-in', { force: true })
    second.run(61)
    try {
      const shown = { 'check-in': new Set<string>(), 'let-go': new Set<string>(), 'sleep': new Set<string>() }
      let passed = 0
      for (let i = 0; i < 100; i++) {
        for (const behaviour of ['check-in', 'let-go', 'sleep'] as const) {
          const intentId = `${i}-${behaviour}`
          // An act and a let-go mark their start; a sleep marks its end, the waking.
          const marking = behaviour === 'sleep' ? 'end' : 'start'
          for (const stage of [first, second]) {
            stage.props.onIdleBehaviour({ behaviour, phase: 'start', intentId })
            if (marking === 'end')
              stage.props.onIdleBehaviour({ behaviour, phase: 'end', intentId })
          }
          expect(first.backend.idleActive, intentId).toEqual(second.backend.idleActive)
          for (const id of first.backend.idleActive)
            shown[behaviour].add(id)
          passed += Number(first.backend.idleActive.length === 0)
          if (marking === 'start') {
            for (const stage of [first, second])
              stage.props.onIdleBehaviour({ behaviour, phase: 'end', intentId })
          }
          first.run(61)
          second.run(61)
        }
      }
      expect([...shown['check-in']].sort()).toEqual(['one', 'three', 'two'])
      expect([...shown['let-go']].sort()).toEqual(['five', 'four'])
      expect([...shown.sleep].sort()).toEqual(['seven', 'six'])
      // The chance still lets some moments pass.
      expect(passed).toBeGreaterThan(0)
    }
    finally {
      firstScope.stop()
    }
  })

  it('seeds the waking apart from a moment of the same sleep order', () => {
    const catalog = ['six', 'seven'].map(id => entry(id, { kind: 'face', moments: ['waking'] }))
    const woken = setup(catalog)
    const wokenScope = scope!
    const marked = setup(catalog)
    try {
      let differs = 0
      for (let i = 0; i < 100; i++) {
        const intentId = `${i}-idle`
        woken.props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end', intentId })
        marked.props.onMoment('waking', { intentId })
        differs += Number(woken.backend.idleActive.join() !== marked.backend.idleActive.join())
        woken.run(61)
        marked.run(61)
      }
      expect(differs).toBeGreaterThan(0)
    }
    finally {
      wokenScope.stop()
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
    props.onIdleBehaviour({ behaviour: 'check-in', phase: 'start', intentId: null })
    expect(backend.idleActive).toEqual(['wink'])
    run(3)
    expect(backend.idleActive).toEqual(['wink'])
    props.onIdleBehaviour({ behaviour: 'check-in', phase: 'end', intentId: null })
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
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start', intentId: null })
    run(10)
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end', intentId: null })
    expect(backend.idleActive).toEqual(['sleepy'])
    run(6)
    expect(backend.idleActive).toEqual([])
    props.onIdleBehaviour({ behaviour: 'let-go', phase: 'start', intentId: null })
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
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start', intentId: null })
    expect(reports).toEqual(['prop:start:game', 'prop:end:game'])
    expect(answers).toEqual(['1:done'])
    // Her eyes are still closing.
    run(4)
    expect(backend.idleActive).toEqual([])
    run(1)
    expect(backend.idleActive).toEqual(['pillow', 'bubble'])
    props.onIdleBehaviour({ behaviour: 'yawn', phase: 'start', intentId: null })
    expect(backend.idleActive).toEqual(['pillow', 'bubble'])
    props.onIdleBehaviour({ behaviour: 'sleep', phase: 'end', intentId: null })
    expect(backend.idleActive).toEqual([])
    // What she sleeps with is part of the sleep the Natural driver already reports.
    expect(reports).toEqual(['prop:start:game', 'prop:end:game'])
  })

  it('refuses the pastime while idle activities are off, for an entry the user switched on, or on a store without claims', () => {
    const off = setup([entry('game', { idleUse: 'activity' }), entry('pillow', { idleUse: 'sleep' })])
    off.state.enabled = false
    off.props.onIdleBehaviour({ behaviour: 'sleep', phase: 'start', intentId: null })
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

  it('holds a stage item as her only pastime, and the Live2D store shows it as an item', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    setActivePinia(createPinia())
    const store = useExpressionStore()
    store.registerDefinitions('model', [])
    const placement = { x: 0, y: 0, rotation: 0, scale: 1, flipX: false, anchor: { x: 0.5, y: 0.5 }, layer: { kind: 'front' as const } }
    const handheld = store.applySettingsCommand({ type: 'create-item', item: { assetId: 'asset-handheld', label: 'handheld', kind: 'prop', mappings: [], idleUse: 'activity', placement } }) as string
    store.setAvailableItemAssets(new Set(['asset-handheld']))
    const reports: string[] = []
    const mind = windowMind({ nowMs: 0 })
    scope = effectScope()
    const props = scope.run(() => useIdleProps({
      backend: () => store,
      enabled: () => true,
      report: (report: StageSelfReport) => reports.push(`${report.activity}:${report.phase}:${report.label}`),
      answer: () => {},
      occasions: () => [],
      momentRest: () => mind.state.refractory.momentRest,
      momentMarked: () => {},
      random: () => 0,
      now: () => 0,
    }))!

    props.onErrand({ phase: 'start', errand: pastime(1) })

    expect(store.idleActive).toEqual([handheld])
    expect(store.itemTargets.map(target => target.document.id)).toEqual([handheld])
    expect(reports).toEqual(['prop:start:handheld'])
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
