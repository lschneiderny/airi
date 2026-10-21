import { afterEach, describe, expect, it } from 'vitest'

import { installMotionQaDispatcher } from './motion-qa'

interface MotionQaGlobal {
  __airiMotionQa?: { dispatch: (command: string) => Promise<string> }
}

describe('installMotionQaDispatcher', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__airiMotionQa')
  })

  it('answers malformed commands with a reply instead of throwing', async () => {
    installMotionQaDispatcher()
    const dispatch = (globalThis as MotionQaGlobal).__airiMotionQa?.dispatch
    if (!dispatch)
      throw new Error('the dispatcher must be installed')

    expect(JSON.parse(await dispatch('not json'))).toMatchObject({ ok: false })
    const unknown = JSON.parse(await dispatch(JSON.stringify({ name: 'startCapture', input: { durationSeconds: 0, label: 'x' } })))
    expect(unknown.ok).toBe(false)
    expect(unknown.issues.map((issue: { path: string }) => issue.path)).toEqual(['input.durationSeconds'])
  })
})
