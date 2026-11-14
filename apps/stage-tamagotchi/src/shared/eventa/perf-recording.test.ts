import type { InvokeEventa } from '@moeru/eventa'
import type { UsageEventRecord, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import type { perfRecordingPullRollup } from './index'

import { describe, expectTypeOf, it } from 'vitest'

type ResponseOf<T> = T extends InvokeEventa<infer Res, infer _Req> ? Res : never
type RequestOf<T> = T extends InvokeEventa<infer _Res, infer Req> ? Req : never

type PulledRollup = NonNullable<ResponseOf<typeof perfRecordingPullRollup>>

describe('perf recording eventa contract', () => {
  it('pulls a window rollup that cannot carry main-owned fields, or null when not sampling', () => {
    expectTypeOf<ResponseOf<typeof perfRecordingPullRollup>>().toEqualTypeOf<PulledRollup | null>()
    expectTypeOf<RequestOf<typeof perfRecordingPullRollup>>().toEqualTypeOf<{ tick: number, acceptedTick: number | null }>()

    expectTypeOf<PulledRollup>().not.toHaveProperty('sessionId')
    expectTypeOf<PulledRollup>().not.toHaveProperty('t')
    expectTypeOf<PulledRollup>().not.toHaveProperty('epoch')
    expectTypeOf<PulledRollup>().not.toHaveProperty('visible')
    expectTypeOf<PulledRollup['kind']>().toEqualTypeOf<WindowRollupRecord['kind']>()
    expectTypeOf<PulledRollup['frameHist']>().toEqualTypeOf<WindowRollupRecord['frameHist']>()
  })

  it('carries only the window-observed events, without main-owned fields', () => {
    type PulledEvent = PulledRollup['events'][number]
    expectTypeOf<PulledEvent['name']>().toEqualTypeOf<'model-load' | 'feature-change'>()
    expectTypeOf<PulledEvent['detail']>().toEqualTypeOf<UsageEventRecord['detail']>()
    expectTypeOf<PulledEvent>().not.toHaveProperty('window')
    expectTypeOf<PulledEvent>().not.toHaveProperty('t')
  })
})
