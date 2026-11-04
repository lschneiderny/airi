import { describe, expect, it } from 'vitest'

import { MotionRegistrations } from './motion-registrations'

describe('motionRegistrations', () => {
  it('skips a motion registered at the same revision and reloads one at a newer revision', () => {
    const registrations = new MotionRegistrations()
    registrations.mark('wave', 0)

    expect(registrations.isCurrent('wave', 0)).toBe(true)
    expect(registrations.isCurrent('wave', 1)).toBe(false)
    expect(registrations.isCurrent('step', 0)).toBe(false)
  })

  it('forgets a motion that left the library, so a re-import under the same name loads again', () => {
    const registrations = new MotionRegistrations()
    registrations.mark('wave', 0)
    registrations.mark('step', 0)

    // The user removed "step" and imported another file under that name: it is a fresh descriptor at revision 0.
    expect(registrations.prune(['wave'])).toEqual(['step'])

    expect(registrations.has('step')).toBe(false)
    expect(registrations.isCurrent('step', 0)).toBe(false)
    expect(registrations.has('wave')).toBe(true)
    expect(registrations.isCurrent('wave', 0)).toBe(true)
  })

  it('prunes nothing while every registered motion is still imported', () => {
    const registrations = new MotionRegistrations()
    registrations.mark('wave', 0)

    expect(registrations.prune(['wave', 'other'])).toEqual([])
    expect(registrations.has('wave')).toBe(true)
  })
})
