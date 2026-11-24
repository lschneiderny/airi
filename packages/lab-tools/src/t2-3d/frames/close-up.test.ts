import type { Vec3 } from '../metrics'

import { analyticTrace } from '@proj-airi/qa-tools/t2-3d/metrics/test-trace'
import { describe, expect, it } from 'vitest'

import { closeUpCamera, closeUpFraming, DEFAULT_CLOSE_UP_SPAN, facingSeries, parseCloseUp } from './close-up'
import { dot } from './render'

/** Where `point` lands in a close-up image: [x, y] pixels, as `rasterize` projects it. */
function drawnAt(point: Vec3, focus: Vec3, bone: 'leftHand' | 'rightHand', view: 'front' | 'side', yaw: number): [number, number] {
  const camera = closeUpCamera(view, bone, yaw)
  const { framing, centre } = closeUpFraming(camera, focus, 2, 400)
  return [framing.width / 2 + framing.scale * (dot(camera.across, point) - centre), (framing.top - point[1]) * framing.scale]
}

describe('close-up', () => {
  it('reads --focus and --span, and refuses a span without a bone, an untraced bone or a span of no size', () => {
    expect(parseCloseUp(undefined, undefined)).toBeNull()
    expect(parseCloseUp('leftHand', undefined)).toEqual({ bone: 'leftHand', span: DEFAULT_CLOSE_UP_SPAN })
    expect(parseCloseUp('rightIndexProximal', '1.5')).toEqual({ bone: 'rightIndexProximal', span: 1.5 })
    expect(parseCloseUp(undefined, '3')).toMatch(/--focus/)
    expect(parseCloseUp('leftPinky', '3')).toMatch(/traced bone/)
    expect(parseCloseUp('leftHand', '0')).toMatch(/above 0/)
  })

  it('draws the focus at the image centre and spans the given units across the image', () => {
    const focus: Vec3 = [3, 9, -2]
    expect(drawnAt(focus, focus, 'leftHand', 'front', 0.7)).toEqual([200, 200])
    // span 2 over 400 pixels: one model unit up is 200 pixels up.
    expect(drawnAt([3, 10, -2], focus, 'leftHand', 'front', 0.7)[1]).toBeCloseTo(0, 9)
  })

  it('turns the views with her facing, and looks at a right-side bone from her right', () => {
    const focus: Vec3 = [0, 0, 0]
    const ahead = (yaw: number): Vec3 => [Math.sin(yaw), 0, Math.cos(yaw)]
    const leftward = (yaw: number): Vec3 => [Math.cos(yaw), 0, -Math.sin(yaw)]
    for (const yaw of [0, 1.2, -2.5]) {
      // Seen from her left her front is on the image left; seen from her right, on the image right.
      expect(drawnAt(ahead(yaw), focus, 'leftHand', 'side', yaw)[0]).toBeCloseTo(0, 6)
      expect(drawnAt(ahead(yaw), focus, 'rightHand', 'side', yaw)[0]).toBeCloseTo(400, 6)
      // From the front her left is on the image right, whichever way she has turned.
      expect(drawnAt(leftward(yaw), focus, 'leftHand', 'front', yaw)[0]).toBeCloseTo(400, 6)
    }
  })

  it('averages a stride\'s pelvis twist out of her facing but keeps a turn', () => {
    const twist = analyticTrace({ seconds: 4, bones: ['hips'], yaw: t => 0.5 + 0.1 * Math.sin(2 * Math.PI * t) })
    const facing = facingSeries(twist)
    expect(Math.abs(facing[120] - 0.5)).toBeLessThan(0.002)
    const turn = analyticTrace({ seconds: 4, bones: ['hips'], yaw: t => 0.3 * t })
    expect(facingSeries(turn)[120]).toBeCloseTo(0.6, 6)
  })
})
