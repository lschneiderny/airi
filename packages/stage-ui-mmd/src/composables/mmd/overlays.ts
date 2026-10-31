import type { Object3D, Scene, SkinnedMesh } from 'three'

import type { MMDOverlayFlags } from './overlay-flags'
import type { MMDRigProfile } from './rig'
import type { MMDTouchCollider } from './touch'

import { BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, OctahedronGeometry, Quaternion, SphereGeometry, Sprite, Texture, Vector3 } from 'three'

import { disposeMMDObject } from '../../utils/mmd-materials'
import { mmdArmCapsules } from './body/arms'
import { mmdOverlayColors, mmdOverlaysOff } from './overlay-flags'

/** The stage world the world overlays draw, in model units on the floor line; `null` in classic mode. */
export interface MMDOverlayStage {
  /** The work area's left and right edges projected to the floor line. */
  floor: { minX: number, maxX: number }
  ground: { minX: number, maxX: number }
  homeX: number
  goalX: number | null
  /** The locomotion reason of the goal in progress, shown as the goal marker's label. */
  goalReason: string | null
}

/** What the overlays read from the loaded model. The stage supplies it; the IK helper comes from the solver. */
export interface MMDOverlaySource {
  mesh: SkinnedMesh
  rig: Pick<MMDRigProfile, 'legIk' | 'bones'>
  colliders: readonly MMDTouchCollider[]
  createIkHelper: () => Object3D & { dispose: () => void }
  /** World-space look-at target, `null` while the body is not looking at anything. */
  lookAtTarget: () => { x: number, y: number, z: number } | null
  /** The stage world for the world overlays, re-read every frame; `null` keeps them hidden. */
  stage: () => MMDOverlayStage | null
  /** Builds the goal marker's text label (a canvas sprite in the scene); without it the goal marker has no label. */
  createLabel?: (text: string) => Object3D
}

/** Geometry sizes in world units, so markers stay visible at the default 0.1 view scale. */
const footMarkerRadius = 0.03
const lookAtMarkerRadius = 0.04
const worldMarkerRadius = 0.12
/** The ground line sits this far above the floor line, so both stay visible where they overlap. */
const groundLineLift = 0.02
/** The goal label floats this far above its marker. */
const goalLabelLift = 0.5
/** An arm capsule is rebuilt when its length or radius moves by more than this share, so a steady pose allocates nothing. */
const capsuleRebuildTolerance = 0.02

function wireframe(color: number) {
  return new MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.85 })
}

function solid(color: number) {
  return new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
}

function line(color: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
  const object = new Line(geometry, new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }))
  object.renderOrder = 1000
  object.frustumCulled = false
  return object
}

function setLine(object: Line, from: { x: number, y: number, z: number }, to: { x: number, y: number, z: number }): void {
  const position = object.geometry.getAttribute('position')
  position.setXYZ(0, from.x, from.y, from.z)
  position.setXYZ(1, to.x, to.y, to.z)
  position.needsUpdate = true
}

/** Lines and sprites are not meshes, so `disposeMMDObject` skips them; this releases every overlay object. */
function disposeOverlay(root: Object3D): void {
  disposeMMDObject(root)
  root.traverse((object) => {
    if (object instanceof Line || object instanceof Sprite) {
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if ('map' in material && material.map instanceof Texture)
          material.map.dispose()
        material.dispose()
      }
    }
  })
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

interface ArmCapsuleMarker {
  mesh: Mesh
  length: number
  radius: number
}

interface ArmSideMarkers {
  upper: Object3D
  elbow: Object3D
  wrist: Object3D
  capsules: [ArmCapsuleMarker, ArmCapsuleMarker]
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
  private floorLine: Line | undefined
  private groundLine: Line | undefined
  private home: Mesh | undefined
  private goal: { marker: Mesh, label: Object3D | undefined, labelText: string | null } | undefined
  private armCapsules: { group: Group, sides: ArmSideMarkers[] } | undefined
  private readonly point = new Vector3()
  private readonly up = new Vector3(0, 1, 0)
  private readonly direction = new Vector3()
  private readonly quaternion = new Quaternion()

  constructor(private readonly scene: Scene, private readonly source: MMDOverlaySource) {}

  get flags(): MMDOverlayFlags {
    return {
      ik: this.ik !== undefined,
      colliders: this.colliders !== undefined,
      feet: this.feet !== undefined,
      lookAt: this.lookAt !== undefined,
      floorLine: this.floorLine !== undefined,
      groundLine: this.groundLine !== undefined,
      home: this.home !== undefined,
      goal: this.goal !== undefined,
      armCapsules: this.armCapsules !== undefined,
    }
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

    if (flags.floorLine && !this.floorLine) {
      this.floorLine = line(mmdOverlayColors.floorLine)
      this.floorLine.name = 'mmd-overlay-floor-line'
      this.scene.add(this.floorLine)
    }
    else if (!flags.floorLine && this.floorLine) {
      this.scene.remove(this.floorLine)
      disposeOverlay(this.floorLine)
      this.floorLine = undefined
    }

    if (flags.groundLine && !this.groundLine) {
      this.groundLine = line(mmdOverlayColors.groundLine)
      this.groundLine.name = 'mmd-overlay-ground-line'
      this.scene.add(this.groundLine)
    }
    else if (!flags.groundLine && this.groundLine) {
      this.scene.remove(this.groundLine)
      disposeOverlay(this.groundLine)
      this.groundLine = undefined
    }

    if (flags.home && !this.home) {
      this.home = new Mesh(new OctahedronGeometry(worldMarkerRadius), solid(mmdOverlayColors.home))
      this.home.name = 'mmd-overlay-home'
      this.home.renderOrder = 1000
      this.scene.add(this.home)
    }
    else if (!flags.home && this.home) {
      this.scene.remove(this.home)
      disposeMMDObject(this.home)
      this.home = undefined
    }

    if (flags.goal && !this.goal) {
      const marker = new Mesh(new OctahedronGeometry(worldMarkerRadius), wireframe(mmdOverlayColors.goal))
      marker.name = 'mmd-overlay-goal'
      marker.renderOrder = 1000
      this.goal = { marker, label: undefined, labelText: null }
      this.scene.add(marker)
    }
    else if (!flags.goal && this.goal) {
      this.scene.remove(this.goal.marker)
      disposeOverlay(this.goal.marker)
      this.goal = undefined
    }

    if (flags.armCapsules && !this.armCapsules) {
      const group = new Group()
      group.name = 'mmd-overlay-arm-capsules'
      const bones = new Map(this.source.mesh.skeleton.bones.map(bone => [bone.name, bone]))
      const bone = (name: string | undefined) => (name === undefined ? undefined : bones.get(name))
      const sides: ArmSideMarkers[] = []
      for (const side of ['left', 'right'] as const) {
        const upper = bone(this.source.rig.bones[`${side}UpperArm`])
        const elbow = bone(this.source.rig.bones[`${side}LowerArm`])
        const wrist = bone(this.source.rig.bones[`${side}Hand`])
        if (!upper || !elbow || !wrist)
          continue
        const capsule = (): ArmCapsuleMarker => {
          const mesh = new Mesh(new CapsuleGeometry(1, 1, 2, 8), wireframe(mmdOverlayColors.armCapsule))
          mesh.renderOrder = 1000
          group.add(mesh)
          return { mesh, length: 1, radius: 1 }
        }
        sides.push({ upper, elbow, wrist, capsules: [capsule(), capsule()] })
      }
      this.armCapsules = { group, sides }
      this.scene.add(group)
    }
    else if (!flags.armCapsules && this.armCapsules) {
      this.scene.remove(this.armCapsules.group)
      disposeMMDObject(this.armCapsules.group)
      this.armCapsules = undefined
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
    if (this.floorLine || this.groundLine || this.home || this.goal)
      this.updateWorld(this.source.stage())
    if (this.armCapsules)
      this.updateArms(this.armCapsules.sides)
  }

  private updateWorld(stage: MMDOverlayStage | null): void {
    if (this.floorLine) {
      this.floorLine.visible = stage !== null
      if (stage)
        setLine(this.floorLine, { x: stage.floor.minX, y: 0, z: 0 }, { x: stage.floor.maxX, y: 0, z: 0 })
    }
    if (this.groundLine) {
      this.groundLine.visible = stage !== null
      if (stage)
        setLine(this.groundLine, { x: stage.ground.minX, y: groundLineLift, z: 0 }, { x: stage.ground.maxX, y: groundLineLift, z: 0 })
    }
    if (this.home) {
      this.home.visible = stage !== null
      if (stage)
        this.home.position.set(stage.homeX, worldMarkerRadius, 0)
    }
    if (this.goal) {
      const goalX = stage?.goalX ?? null
      this.goal.marker.visible = goalX !== null
      if (goalX !== null)
        this.goal.marker.position.set(goalX, worldMarkerRadius, 0)
      const text = goalX === null ? null : stage?.goalReason ?? null
      if (text !== this.goal.labelText) {
        if (this.goal.label) {
          this.goal.marker.remove(this.goal.label)
          disposeOverlay(this.goal.label)
          this.goal.label = undefined
        }
        if (text !== null && this.source.createLabel) {
          this.goal.label = this.source.createLabel(text)
          this.goal.label.position.set(0, goalLabelLift, 0)
          this.goal.marker.add(this.goal.label)
        }
        this.goal.labelText = text
      }
    }
  }

  private updateArms(sides: readonly ArmSideMarkers[]): void {
    for (const side of sides) {
      const capsules = mmdArmCapsules(side.upper.getWorldPosition(new Vector3()), side.elbow.getWorldPosition(new Vector3()), side.wrist.getWorldPosition(new Vector3()))
      for (const [index, capsule] of capsules.entries()) {
        const marker = side.capsules[index]
        const length = capsule.from.distanceTo(capsule.to)
        if (Math.abs(length - marker.length) > capsuleRebuildTolerance * marker.length || Math.abs(capsule.radius - marker.radius) > capsuleRebuildTolerance * marker.radius) {
          marker.mesh.geometry.dispose()
          marker.mesh.geometry = new CapsuleGeometry(capsule.radius, length, 2, 8)
          marker.length = length
          marker.radius = capsule.radius
        }
        marker.mesh.position.copy(capsule.from).lerp(capsule.to, 0.5)
        this.direction.copy(capsule.to).sub(capsule.from).normalize()
        marker.mesh.quaternion.copy(this.quaternion.setFromUnitVectors(this.up, this.direction))
      }
    }
  }

  dispose(): void {
    this.apply(mmdOverlaysOff)
  }
}
