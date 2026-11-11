import type { MMDFrameStage } from './frame-pipeline'

import { describe, expect, it, vi } from 'vitest'

import { composeMMDStages } from './stage-composition'

const bodyStage = (id: string): MMDFrameStage => ({ id, run: vi.fn() })
const body = {
  poseStages: ['locomotion', 'body-torso', 'foot-contact', 'body-head', 'body-arms', 'eyes'].map(bodyStage),
  surfaceStage: bodyStage('body-diagnostics'),
}

describe('mmd stage composition', () => {
  it('returns the documented pose and surface order, with host stages the host does not run left inert', () => {
    const natural = vi.fn()
    const stages = composeMMDStages({ body, host: { natural } })
    expect(stages.pose.map(stage => stage.id)).toEqual(['natural', 'locomotion', 'body-torso', 'foot-contact', 'body-head', 'body-arms', 'eyes', 'classic-gaze', 'classic-face', 'lip-sync', 'bone-morphs'])
    expect(stages.surface.map(stage => stage.id)).toEqual(['body-diagnostics', 'morphs', 'motion-trace'])
    expect(stages.pose[1]).toBe(body.poseStages[0])
    expect(stages.surface[0]).toBe(body.surfaceStage)
    expect(stages.pose[0].run).toBe(natural)
    expect(stages.pose.slice(7).every(stage => stage.run === stages.pose[7].run && stage.run !== natural)).toBe(true)
  })

  it('refuses a body without one of its pose stages', () => {
    expect(() => composeMMDStages({ body: { ...body, poseStages: body.poseStages.slice(1) }, host: {} })).toThrow(/locomotion/)
  })
})
