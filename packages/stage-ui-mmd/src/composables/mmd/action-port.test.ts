import type { BodyActionFeedback, BodyActionRequest } from '@proj-airi/motion-driver-humanoid/director'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { MMDActionClip } from './action-port'

import { DANCE_REFRACTORY_MS } from '@proj-airi/motion-driver-humanoid/director'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MMDActionPort } from './action-port'
import { MMDStanceDirector } from './stance'

const EPOCH_MS = 1_000_000
const DANCE_MS = 8_000

const library: MMDActionClip[] = [
  { name: 'dance-long', label: 'moonwalk', kind: 'dance', exposed: true },
  { name: 'bow-deep', label: 'bow', kind: 'action', exposed: true },
  { name: 'spin-loop', label: 'spin', kind: 'action', exposed: true },
  { name: 'arms-wave', label: 'wave', kind: 'gesture', exposed: true },
  { name: 'cartwheel', label: 'cartwheel', kind: 'action', exposed: false },
]

interface FramePatch {
  dragging?: boolean
  away?: boolean
  feedback?: BodyActionFeedback
}

/** Drives the real director and the port the way the MMD scene does, one frame per call, without a stage world. */
function stage(clips: readonly MMDActionClip[] = library) {
  const director = new MMDStanceDirector()
  let seq = 0
  let request: BodyActionRequest | null = null
  const submit = vi.fn((name: string | null) => {
    const clip = clips.find(entry => entry.name === name)
    request = name === null
      ? { seq: ++seq, clipId: '', kind: 'action', layer: 'full', loop: false, durationMs: 0, source: 'tool' }
      : { seq: ++seq, clipId: name, kind: clip?.kind === 'dance' ? 'dance' : 'action', layer: 'full', loop: name === 'spin-loop', durationMs: DANCE_MS, source: 'tool' }
    return request.seq
  })
  const port = new MMDActionPort({
    clips: () => clips,
    submit,
    withdraw: (withdrawn: number) => {
      if (request?.seq === withdrawn)
        request = null
    },
  })
  function frame(atMs: number, patch: FramePatch = {}) {
    const performance: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: patch.away ?? false }
    const directorMs = EPOCH_MS + atMs
    director.update({
      nowMs: directorMs,
      performance,
      slots: {},
      idleMotionName: '',
      isRegistered: () => true,
      interaction: { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: request, actionFeedback: patch.feedback ?? null, dragging: patch.dragging ?? false },
    })
    port.observe({ directorMs, diagnostics: director.diagnostics })
  }
  return { director, port, frame, submit, pendingRequest: () => request }
}

describe('mmd action port with the stance director', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes only labeled, exposed actions and dances', () => {
    expect(stage().port.exposed()).toEqual([
      { label: 'moonwalk', kind: 'dance' },
      { label: 'bow', kind: 'action' },
      { label: 'spin', kind: 'action' },
    ])
  })

  it('accepts an exposed dance in the classic window and reports it performing', async () => {
    const { director, port, frame, submit } = stage()
    frame(0)

    const answer = port.perform('moonwalk')
    frame(100)
    const result = await answer

    expect(submit).toHaveBeenCalledExactlyOnceWith('dance-long')
    expect(result).toEqual({ success: true, state: { performing: { label: 'moonwalk', phase: 'playing', endsInSeconds: DANCE_MS / 1000 } } })
    expect(director.diagnostics.performing).toMatchObject({ clipId: 'dance-long', layer: 'full' })
  })

  it('refuses a second dance inside the refractory with the retry time in seconds', async () => {
    const { port, frame, pendingRequest } = stage()
    frame(0)
    const first = port.perform('moonwalk')
    frame(100)
    expect((await first).success).toBe(true)
    frame(9_000, { feedback: { seq: pendingRequest()!.seq, state: 'finished' } })

    const second = port.perform('moonwalk')
    frame(19_000)

    expect(await second).toEqual({
      success: false,
      state: { performing: null },
      error: `She can do that again in ${(DANCE_REFRACTORY_MS - 10_000) / 1000} s.`,
      retryAfterSeconds: (DANCE_REFRACTORY_MS - 10_000) / 1000,
    })
  })

  it('refuses while she is dragged, asleep, or already performing, and names the reason', async () => {
    const dragged = stage()
    dragged.frame(0)
    const drag = dragged.port.perform('bow')
    dragged.frame(100, { dragging: true })
    expect(await drag).toMatchObject({ success: false, error: 'She is being moved.' })
    expect(dragged.director.diagnostics.performing).toBeNull()

    const asleep = stage()
    asleep.frame(0)
    const sleep = asleep.port.perform('bow')
    asleep.frame(100, { away: true })
    expect(await sleep).toMatchObject({ success: false, error: 'She is asleep.' })

    const busy = stage()
    busy.frame(0)
    const dance = busy.port.perform('moonwalk')
    busy.frame(100)
    await dance
    const bow = busy.port.perform('bow')
    busy.frame(200)
    expect(await bow).toEqual({
      success: false,
      state: { performing: { label: 'moonwalk', phase: 'playing', endsInSeconds: DANCE_MS / 1000 } },
      error: 'She is already doing something.',
      retryAfterSeconds: DANCE_MS / 1000,
    })
  })

  it('stops a running loop with stop', async () => {
    const { director, port, frame } = stage()
    frame(0)
    const spin = port.perform('spin')
    frame(100)
    expect(await spin).toMatchObject({ success: true, state: { performing: { label: 'spin', endsInSeconds: null } } })

    const stop = port.perform(null)
    frame(200)

    expect(await stop).toEqual({ success: true, state: { performing: null } })
    expect(director.diagnostics.performing).toBeNull()
  })

  it('answers an unexposed, unknown or gesture label with the exposed labels and submits nothing', async () => {
    const { port, submit } = stage()

    for (const label of ['cartwheel', 'moonwalk-2', 'wave']) {
      expect(await port.perform(label), label).toEqual({
        success: false,
        error: `"${label}" is not an exposed action.`,
        available: ['moonwalk', 'bow', 'spin'],
      })
    }
    expect(submit).not.toHaveBeenCalled()
  })

  it('fails a request the director never answers and withdraws it, so a resumed stage does not play it', async () => {
    vi.useFakeTimers()
    const { director, port, frame, pendingRequest } = stage()
    frame(0)

    const stalled = expect(port.perform('moonwalk')).resolves.toEqual({ success: false, error: 'The stage did not answer the request.' })
    await vi.advanceTimersByTimeAsync(2_000)
    await stalled

    expect(pendingRequest()).toBeNull()
    frame(2_100)
    expect(director.diagnostics.performing).toBeNull()
  })

  it('fails a request that a newer one replaced before the director read it, and a request pending on dispose', async () => {
    const { port, frame } = stage()
    frame(0)

    const replaced = port.perform('moonwalk')
    const newer = port.perform('bow')
    frame(100)

    expect(await replaced).toEqual({ success: false, error: 'A newer action request replaced this one.' })
    expect(await newer).toMatchObject({ success: true, state: { performing: { label: 'bow' } } })

    const pending = port.perform('moonwalk')
    port.dispose()
    expect(await pending).toEqual({ success: false, error: 'The stage went away before the request was answered.' })
  })
})
