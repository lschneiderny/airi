import type { Observation } from '@proj-airi/stage-shared/situation'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePerformanceRuntimeState } from '../../../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../../../features/performance/settings'
import { startStageSensor } from './stage'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

describe('stage situation sensor', () => {
  let observations: Observation[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
    observations = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends nothing while nothing is exposed and state feedback is off', () => {
    startStageSensor(observation => observations.push(observation))

    expect(observations).toEqual([])
  })

  it('reports the exposed expressions by kind, and the active expressions and mood only with state feedback', async () => {
    const runtimeState = usePerformanceRuntimeState()
    runtimeState.publish({
      exposed: [{ label: 'smile', kind: 'face' }, { label: 'wink', kind: 'face' }, { label: 'tear', kind: 'effect' }],
      active: [{ slot: 'face', label: 'smile' }],
      mood: { valence: 0.2, arousal: 0.1, tension: 0 },
    })
    startStageSensor(observation => observations.push(observation))

    vi.setSystemTime(T0 + 1_000)
    await useExpressionPerformanceSettings().update({ stateFeedback: true })

    expect(observations).toEqual([
      { kind: 'stage', exposed: 'face: smile, wink / effect: tear', active: '', mood: '', atMs: T0 },
      { kind: 'stage', exposed: 'face: smile, wink / effect: tear', active: 'face smile', mood: 'valence 0.2, arousal 0.1, tension 0', atMs: T0 + 1_000 },
    ])
  })

  it('sends a change once and clears the line when everything is gone', () => {
    const runtimeState = usePerformanceRuntimeState()
    startStageSensor(observation => observations.push(observation))

    runtimeState.publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    // An identical publication changes nothing.
    runtimeState.publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })
    vi.setSystemTime(T0 + 1_000)
    runtimeState.publish({ exposed: [], active: [], mood: null })

    expect(observations).toEqual([
      { kind: 'stage', exposed: 'face: smile', active: '', mood: '', atMs: T0 },
      { kind: 'stage', exposed: '', active: '', mood: '', atMs: T0 + 1_000 },
    ])
  })

  it('stops watching when stopped', () => {
    const stop = startStageSensor(observation => observations.push(observation))

    stop()
    usePerformanceRuntimeState().publish({ exposed: [{ label: 'smile', kind: 'face' }], active: [], mood: null })

    expect(observations).toEqual([])
  })
})
