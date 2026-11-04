import type { MMDLabeledClip } from '../../../stores/mmd'

import { describe, expect, it } from 'vitest'

import { resolveActAction } from './resolve-act-action'

const clips: MMDLabeledClip[] = [
  { name: 'arms-wave.vmd', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true },
  { name: 'bow.vmd', label: 'bow', kind: 'gesture', layer: 'upper', exposed: false },
  { name: 'dance-long.vmd', label: 'moonwalk', kind: 'dance', layer: 'full', exposed: true },
  { name: 'legs-step.vmd', label: 'step', kind: 'action', layer: 'full', exposed: true },
]

describe('resolveActAction', () => {
  it('performs the clip of an exposed gesture label', () => {
    expect(resolveActAction('wave', undefined, clips)).toEqual({ perform: 'arms-wave.vmd', drops: [] })
  })

  it('drops a label no clip carries as unknown', () => {
    expect(resolveActAction('jump', undefined, clips)).toEqual({ perform: null, drops: [{ reason: 'unknown', label: 'jump' }] })
  })

  it('drops a labeled clip the user did not expose', () => {
    expect(resolveActAction('bow', undefined, clips)).toEqual({ perform: null, drops: [{ reason: 'not-exposed', label: 'bow' }] })
  })

  it.each(['moonwalk', 'step'])('drops an exposed %s clip because only gestures play from ACT', (label) => {
    expect(resolveActAction(label, undefined, clips)).toEqual({ perform: null, drops: [{ reason: 'not-gesture', label }] })
  })

  it('lets a resolved clip supersede the cue gesture', () => {
    expect(resolveActAction('wave', { kind: 'nod' }, clips)).toEqual({ perform: 'arms-wave.vmd', drops: [{ reason: 'superseded', label: 'nod' }] })
  })

  it('compares the label exactly against curated labels and never against clip names', () => {
    expect(resolveActAction('arms-wave.vmd', undefined, clips).perform).toBeNull()
    expect(resolveActAction('WAVE', undefined, clips)).toEqual({ perform: null, drops: [{ reason: 'unknown', label: 'WAVE' }] })
  })

  it('does nothing without a label, even when a cue gesture is set', () => {
    expect(resolveActAction(undefined, { kind: 'nod' }, clips)).toEqual({ perform: null, drops: [] })
  })

  it('prefers an exposed gesture when several clips share a label', () => {
    const shared: MMDLabeledClip[] = [
      { name: 'hidden.vmd', label: 'wave', kind: 'gesture', layer: 'upper', exposed: false },
      { name: 'big.vmd', label: 'wave', kind: 'action', layer: 'full', exposed: true },
      { name: 'small.vmd', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true },
    ]
    expect(resolveActAction('wave', undefined, shared)).toEqual({ perform: 'small.vmd', drops: [] })
    expect(resolveActAction('wave', undefined, shared.slice(0, 2))).toEqual({ perform: null, drops: [{ reason: 'not-gesture', label: 'wave' }] })
  })
})
