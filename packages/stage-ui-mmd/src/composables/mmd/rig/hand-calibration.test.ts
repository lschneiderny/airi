import type { MMDHandPoints } from './hand-calibration'

import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { readMMDHandCalibration } from './hand-calibration'

type V = [number, number, number]

/**
 * A left hand built in its own frame: the hand runs along +X from the wrist at the origin, the index side faces +Z and
 * the palm -Y. `bend` flexes every finger at its knuckle, `fan` turns the index finger toward the thumb by it and the
 * ring and little fingers away by it and twice it, `wrist` flexes the whole hand toward the palm from the forearm, and
 * `roll` turns the hand about its axis. `mirror` builds the right hand.
 */
function hand({ bend = 0, fan = 0, wrist = 0, roll = 0, mirror = false } = {}): MMDHandPoints {
  const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), wrist))
  const place = (p: Vector3): V => {
    const q = p.clone().applyQuaternion(turn)
    return [mirror ? -q.x : q.x, q.y, q.z]
  }
  const finger = (z: number, spread: number): MMDHandPoints['thumb'] => {
    const direction = new Vector3(1, 0, 0)
      .applyAxisAngle(new Vector3(0, 0, -1), bend)
      .applyAxisAngle(new Vector3(0, -1, 0), spread)
    const at = (distance: number) => place(new Vector3(1, 0, z).addScaledVector(direction, distance))
    return [at(0), at(0.4), at(0.7), at(0.9)]
  }
  return {
    elbow: place(new Vector3(-3, 0, 0).applyQuaternion(turn.clone().invert())),
    wrist: [0, 0, 0],
    thumb: [place(new Vector3(0.2, -0.1, 0.4)), place(new Vector3(0.5, -0.2, 0.6)), place(new Vector3(0.75, -0.3, 0.7)), place(new Vector3(0.95, -0.35, 0.75))],
    fingers: { index: finger(0.25, fan), middle: finger(0, 0), ring: finger(-0.2, -fan), little: finger(-0.4, -2 * fan) },
  }
}

describe('readMMDHandCalibration', () => {
  it('reads the palm frame, bends and spread of a straight left hand facing down', () => {
    const calibration = readMMDHandCalibration(1, hand())!
    expect(calibration.axis[0]).toBeCloseTo(1, 9)
    expect(calibration.normal[1]).toBeCloseTo(-1, 9)
    expect(calibration.wrist!.flexion).toBeCloseTo(0, 9)
    expect(calibration.wrist!.deviation).toBeCloseTo(0, 9)
    for (const finger of Object.values(calibration.fingers)) {
      expect(finger!.bend[0]).toBeCloseTo(0, 9)
      expect(finger!.spread).toBeCloseTo(0, 9)
      expect(finger!.curlAxis[2]).toBeCloseTo(-1, 9)
    }
  })

  it('reads the same bends, spread and wrist bend on a rolled hand and on the mirrored right hand', () => {
    const shape = { bend: 0.2, fan: 0.1, wrist: 0.15 }
    for (const [sigma, points] of [[1, hand({ ...shape, roll: 0.35 })], [-1, hand({ ...shape, mirror: true })]] as const) {
      const calibration = readMMDHandCalibration(sigma, points)!
      expect(calibration.wrist!.flexion).toBeCloseTo(0.15, 9)
      expect(calibration.fingers.index!.spread).toBeCloseTo(0.1, 9)
      expect(calibration.fingers.middle!.spread).toBeCloseTo(0, 9)
      expect(calibration.fingers.little!.spread).toBeCloseTo(-0.2, 9)
      expect(calibration.fingers.ring!.bend[0]).toBeCloseTo(0.2, 9)
      expect(calibration.fingers.ring!.bend[1]).toBeCloseTo(0, 9)
      expect(calibration.fingers.ring!.chord).toBeCloseTo(0.2, 9)
    }
  })

  it('reads a zigzag finger joint by joint and its knuckle-to-tip line as a whole', () => {
    const points = hand()
    // The middle finger's intermediate joint sits 0.05 toward the palm: flexed at the knuckle, bent back after it.
    const [knuckle, intermediate, distal, tip] = points.fingers.middle
    const zigzag = { ...points, fingers: { ...points.fingers, middle: [knuckle, [intermediate![0], -0.05, intermediate![2]], distal, tip] as MMDHandPoints['thumb'] } }
    const middle = readMMDHandCalibration(1, zigzag)!.fingers.middle!
    expect(middle.bend[0]).toBeCloseTo(Math.atan2(0.05, 0.4), 9)
    expect(middle.bend[1]).toBeCloseTo(-Math.atan2(0.05, 0.4) - Math.atan2(0.05, 0.3), 9)
    expect(middle.chord).toBeCloseTo(0, 9)
  })

  it('reads the thumb opposition from the thumb side toward the palm on either hand', () => {
    const left = readMMDHandCalibration(1, hand())!.thumb!
    const right = readMMDHandCalibration(-1, hand({ mirror: true }))!.thumb!
    // From the wrist-side base to the tip the thumb runs (0.75, -0.25, 0.35): 35.5 degrees from +Z toward the palm.
    expect(left.opposition).toBeCloseTo(Math.atan2(0.25, 0.35), 9)
    expect(right.opposition).toBeCloseTo(left.opposition, 9)
  })

  it('needs two knuckles for a palm', () => {
    const points = hand()
    const lone = { ...points, fingers: { index: points.fingers.index, middle: [null, null, null, null], ring: [null, null, null, null], little: [null, null, null, null] } } as MMDHandPoints
    expect(readMMDHandCalibration(1, lone)).toBeNull()
  })
})
