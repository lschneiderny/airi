import type { Object3D, Scene, SkinnedMesh } from 'three'

import type { MMDRigProfile } from './rig'
import type { MMDTouchCollider } from './touch'

import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, SphereGeometry, Vector3 } from 'three'

import { disposeMMDObject } from '../../utils/mmd-materials'

/** Which devtools overlays the stage draws. The lab sets them over the diagnostics channel. */
export interface MMDOverlayFlags {
  /** Every PMX IK chain, through the solver's own helper. */
  ik: boolean
  /** Touch colliders as wireframes: head bodies in one color, body bodies in another. */
  colliders: boolean
  /** Foot anchors: the leg IK bones the foot-contact stage writes, and the ankles they pull. */
  feet: boolean
  /** The world-space point the body look-at is turning toward. */
  lookAt: boolean
}

export const mmdOverlayFlagNames = ['ik', 'colliders', 'feet', 'lookAt'] as const satisfies readonly (keyof MMDOverlayFlags)[]

export const mmdOverlaysOff: MMDOverlayFlags = { ik: false, colliders: false, feet: false, lookAt: false }

export function isMMDOverlayFlags(value: unknown): value is Partial<MMDOverlayFlags> {
  if (typeof value !== 'object' || value === null)
    return false
  return Object.entries(value).every(([key, on]) => (mmdOverlayFlagNames as readonly string[]).includes(key) && typeof on === 'boolean')
}

/** Overlay colors, shared with the lab legend so the readout matches the stage. */
export const mmdOverlayColors = {
  colliderHead: 0xF472B6,
  colliderBody: 0x38BDF8,
  footAnchor: 0xFACC15,
  ankle: 0xFB923C,
  lookAt: 0x4ADE80,
} as const

/** What the overlays read from the loaded model. The stage supplies it; the IK helper comes from the solver. */
export interface MMDOverlaySource {
  mesh: SkinnedMesh
  rig: Pick<MMDRigProfile, 'legIk'>
  colliders: readonly MMDTouchCollider[]
  createIkHelper: () => Object3D & { dispose: () => void }
  /** World-space look-at target, `null` while the body is not looking at anything. */
  lookAtTarget: () => { x: number, y: number, z: number } | null
}

/** Geometry sizes in world units, so markers stay visible at the default 0.1 view scale. */
const footMarkerRadius = 0.03
const lookAtMarkerRadius = 0.04

function wireframe(color: number) {
  return new MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.85 })
}

function solid(color: number) {
  return new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
}

function colliderGeometry(collider: MMDTouchCollider) {
  const [a, b] = collider.size
  switch (collider.shape) {
    case 'sphere':
      return new SphereGeometry(a, 10, 8)
    case 'box':
      return new BoxGeometry(a * 2, b * 2, collider.size[2] * 2)
    case 'capsule':
      return new CapsuleGeometry(a, b, 2, 8)
  }
}

/**
 * Devtools overlays for one loaded MMD model. Each overlay is a direct child of the scene
 * only while its flag is on; turning a flag off removes the object and disposes its geometry
 * and materials, so the scene child count returns to what it was before.
 */
export class MMDOverlays {
  private ik: (Object3D & { dispose: () => void }) | undefined
  private colliders: { group: Group, items: { mesh: Mesh, collider: MMDTouchCollider }[] } | undefined
  private feet: { group: Group, markers: { mesh: Mesh, bone: Object3D }[] } | undefined
  private lookAt: Mesh | undefined
  private readonly point = new Vector3()

  constructor(private readonly scene: Scene, private readonly source: MMDOverlaySource) {}

  get flags(): MMDOverlayFlags {
    return { ik: this.ik !== undefined, colliders: this.colliders !== undefined, feet: this.feet !== undefined, lookAt: this.lookAt !== undefined }
  }

  apply(flags: MMDOverlayFlags): void {
    if (flags.ik && !this.ik) {
      this.ik = this.source.createIkHelper()
      this.ik.renderOrder = 1000
      this.scene.add(this.ik)
    }
    else if (!flags.ik && this.ik) {
      this.scene.remove(this.ik)
      this.ik.dispose()
      this.ik = undefined
    }

    if (flags.colliders && !this.colliders) {
      const group = new Group()
      group.name = 'mmd-overlay-colliders'
      const items = this.source.colliders.map((collider) => {
        const mesh = new Mesh(colliderGeometry(collider), wireframe(collider.region === 'head' ? mmdOverlayColors.colliderHead : mmdOverlayColors.colliderBody))
        mesh.matrixAutoUpdate = false
        mesh.renderOrder = 1000
        group.add(mesh)
        return { mesh, collider }
      })
      this.colliders = { group, items }
      this.scene.add(group)
    }
    else if (!flags.colliders && this.colliders) {
      this.scene.remove(this.colliders.group)
      disposeMMDObject(this.colliders.group)
      this.colliders = undefined
    }

    if (flags.feet && !this.feet) {
      const group = new Group()
      group.name = 'mmd-overlay-feet'
      const bones = new Map(this.source.mesh.skeleton.bones.map(bone => [bone.name, bone]))
      const markers: { mesh: Mesh, bone: Object3D }[] = []
      for (const side of ['left', 'right'] as const) {
        const chain = this.source.rig.legIk[side]
        if (!chain)
          continue
        const anchor = bones.get(chain.ikBone)
        const ankle = bones.get(chain.target)
        if (anchor)
          markers.push({ mesh: new Mesh(new OctahedronGeometry(footMarkerRadius), solid(mmdOverlayColors.footAnchor)), bone: anchor })
        if (ankle)
          markers.push({ mesh: new Mesh(new SphereGeometry(footMarkerRadius * 0.6, 8, 6), solid(mmdOverlayColors.ankle)), bone: ankle })
      }
      for (const marker of markers) {
        marker.mesh.renderOrder = 1000
        group.add(marker.mesh)
      }
      this.feet = { group, markers }
      this.scene.add(group)
    }
    else if (!flags.feet && this.feet) {
      this.scene.remove(this.feet.group)
      disposeMMDObject(this.feet.group)
      this.feet = undefined
    }

    if (flags.lookAt && !this.lookAt) {
      this.lookAt = new Mesh(new SphereGeometry(lookAtMarkerRadius, 12, 8), wireframe(mmdOverlayColors.lookAt))
      this.lookAt.name = 'mmd-overlay-look-at'
      this.lookAt.renderOrder = 1000
      this.scene.add(this.lookAt)
    }
    else if (!flags.lookAt && this.lookAt) {
      this.scene.remove(this.lookAt)
      disposeMMDObject(this.lookAt)
      this.lookAt = undefined
    }
  }

  /** Follows the posed bones; call once per frame after the animation step and before rendering. */
  update(): void {
    if (this.colliders) {
      const bones = this.source.mesh.skeleton.bones
      for (const { mesh, collider } of this.colliders.items) {
        const bone = bones[collider.boneIndex]
        if (!bone)
          continue
        mesh.matrix.multiplyMatrices(bone.matrixWorld, collider.offset)
        mesh.matrixWorld.copy(mesh.matrix)
      }
    }
    if (this.feet) {
      for (const { mesh, bone } of this.feet.markers)
        mesh.position.copy(bone.getWorldPosition(this.point))
    }
    if (this.lookAt) {
      const target = this.source.lookAtTarget()
      this.lookAt.visible = target !== null
      if (target)
        this.lookAt.position.set(target.x, target.y, target.z)
    }
  }

  dispose(): void {
    this.apply(mmdOverlaysOff)
  }
}
