import type { BodySide } from './channels'

export interface ArmKey {
  /** Shoulder-relative hand target, in total arm lengths: outward, up, forward. */
  readonly hand: readonly [number, number, number]
  /** Radians about the shoulder-hand ray; zero places the elbow as low as possible, positive swings it outward on either side. */
  readonly swivel: number
  readonly pron: number
  readonly wflex: number
  readonly wdev: number
}

export interface ArmAngles {
  readonly flex: number
  readonly abduct: number
  readonly twist: number
  readonly elbow: number
  readonly pron: number
  readonly wflex: number
  readonly wdev: number
}

export interface ArmKeyRig {
  readonly side: BodySide
  readonly upperLength: number
  readonly forearmLength: number
}

/** Load-time two-bone IK. Null means geometrically unreachable; joint limits and clearance follow separately. */
export function solveArmKey(key: ArmKey, arm: ArmKeyRig): ArmAngles | null {
  const sigma = arm.side === 'left' ? 1 : -1
  const length = arm.upperLength + arm.forearmLength
  const x = sigma * key.hand[0] * length
  const y = key.hand[1] * length
  const z = key.hand[2] * length
  const distance = Math.hypot(x, y, z)
  if (distance >= length || distance <= Math.abs(arm.upperLength - arm.forearmLength))
    return null
  const dx = x / distance
  const dy = y / distance
  const dz = z / distance
  const along = (arm.upperLength ** 2 + distance ** 2 - arm.forearmLength ** 2) / (2 * distance)
  const height = Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2))
  // Project gravity into the elbow circle. For a vertical ray, use forward.
  let rx = dx * dy
  let ry = -1 + dy * dy
  let rz = dz * dy
  if (Math.hypot(rx, ry, rz) < 1e-8) {
    rx = -dx * dz
    ry = -dy * dz
    rz = 1 - dz * dz
  }
  const radialLength = Math.hypot(rx, ry, rz)
  rx /= radialLength
  ry /= radialLength
  rz /= radialLength
  // The swivel turns about the shoulder-hand ray in the side's own sense, so equal keys mirror across the body.
  const cosine = Math.cos(key.swivel)
  const sine = sigma * Math.sin(key.swivel)
  const ex = dx * along + height * (rx * cosine + (dy * rz - dz * ry) * sine)
  const ey = dy * along + height * (ry * cosine + (dz * rx - dx * rz) * sine)
  const ez = dz * along + height * (rz * cosine + (dx * ry - dy * rx) * sine)
  const ux = ex / arm.upperLength
  const uy = ey / arm.upperLength
  const uz = ez / arm.upperLength
  const elbow = Math.acos(Math.max(-1, Math.min(1, (distance ** 2 - arm.upperLength ** 2 - arm.forearmLength ** 2) / (2 * arm.upperLength * arm.forearmLength))))
  const forwardLength = arm.forearmLength * Math.sin(elbow)
  const forwardShare = arm.forearmLength * Math.cos(elbow)
  const zx = (x - ex - ux * forwardShare) / forwardLength
  const zy = (y - ey - uy * forwardShare) / forwardLength
  const zz = (z - ez - uz * forwardShare) / forwardLength
  // U's columns are y=-upperDirection, z=bendDirection, x=y cross z.
  const xx = -uy * zz + uz * zy
  const flex = -Math.atan2(-uz, -uy)
  const abduct = sigma * Math.asin(Math.max(-1, Math.min(1, ux)))
  const twist = -sigma * Math.atan2(zx, xx)
  return { flex, abduct, twist, elbow, pron: key.pron, wflex: key.wflex, wdev: key.wdev }
}
