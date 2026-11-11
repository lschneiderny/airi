import type { Vec3 } from '../types'
import type { BodyCollider, BodyRigTraits } from './contracts'

/** Writes the outward unit normal along with the signed distance. Capsule length excludes caps. */
export function colliderDistance(collider: BodyCollider, point: Readonly<Vec3>, normal: Vec3): number {
  let x = point.x
  let y = point.y
  let z = point.z
  let radius = 0
  switch (collider.shape) {
    case 'sphere':
      radius = collider.radius
      break
    case 'capsule':
      radius = collider.radius
      y -= Math.max(-collider.length / 2, Math.min(collider.length / 2, y))
      break
    case 'box': {
      const qx = Math.abs(x) - collider.halfSize.x
      const qy = Math.abs(y) - collider.halfSize.y
      const qz = Math.abs(z) - collider.halfSize.z
      const inside = Math.max(qx, qy, qz)
      if (inside <= 0) {
        normal.x = inside === qx ? Math.sign(x) || 1 : 0
        normal.y = inside === qy && inside !== qx ? Math.sign(y) || 1 : 0
        normal.z = inside === qz && inside !== qx && inside !== qy ? Math.sign(z) || 1 : 0
        return inside
      }
      x = Math.max(0, qx) * Math.sign(x)
      y = Math.max(0, qy) * Math.sign(y)
      z = Math.max(0, qz) * Math.sign(z)
      break
    }
  }
  const length = Math.hypot(x, y, z)
  normal.x = length > 0 ? x / length : 1
  normal.y = length > 0 ? y / length : 0
  normal.z = length > 0 ? z / length : 0
  return length - radius
}

export function proxyColliders(traits: BodyRigTraits): readonly BodyCollider[] {
  const dx = traits.neck.x - traits.hips.x
  const dy = traits.neck.y - traits.hips.y
  const dz = traits.neck.z - traits.hips.z
  const width = Math.hypot(traits.arms.left.shoulder.x - traits.arms.right.shoulder.x, traits.arms.left.shoulder.y - traits.arms.right.shoulder.y, traits.arms.left.shoulder.z - traits.arms.right.shoulder.z)
  return [
    { bone: 'hips', shape: 'capsule', radius: 0.21 * width, length: Math.hypot(dx, dy, dz), centre: { x: dx / 2, y: dy / 2, z: dz / 2 }, rotation: { yaw: 0, pitch: Math.atan2(dz, dy), roll: -Math.atan2(dx, Math.hypot(dy, dz)) } },
    { bone: 'head', shape: 'sphere', radius: 0.75 * Math.hypot(traits.head.x - traits.neck.x, traits.head.y - traits.neck.y, traits.head.z - traits.neck.z), centre: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: 0 } },
  ]
}
