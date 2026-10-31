import type { NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'
import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Camera, SkinnedMesh } from 'three'

import type { MMDRigProfile } from '../rig'
import type { MMDTouchCollider, MMDTouchRegionRoots, MMDTouchSource } from './colliders'
import type { MMDTouchEvent, MMDTouchSample } from './gestures'

import { Raycaster, Vector2, Vector3 } from 'three'

import { projectMMDHead } from '../natural/adapter'
import { buildMMDTouchColliders, mmdTouchColliderCenter, mmdTouchRegionOf, mmdTouchRegionRoots, raycastMMDTouchColliders } from './colliders'
import { MMDTouchGestures } from './gestures'

export interface MMDTouchPointer {
  type: string
  button: number
  clientX: number
  clientY: number
  timeStamp: number
}

export interface MMDTouchDiagnostics {
  lastRegion: string | null
  hitBody: boolean
  petActive: boolean
  headScreenPoint: { x: number, y: number } | null
  events: number
}

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * Pokes and pets on one loaded MMD model.
 *
 * Pointer rays hit the model's rigid bodies as analytic shapes posed from bone matrices,
 * so touch never reads the physics world. A model without usable rigid bodies falls back
 * to a skinned mesh raycast and the hit face's heaviest bone. Natural receives the result
 * through {@link MMDTouch.takePokes} and {@link MMDTouch.petHand}, so the response is the
 * pre-physics head and body motion that physics then carries into hair and cloth.
 */
export class MMDTouch {
  readonly gestures: MMDTouchGestures
  readonly colliders: MMDTouchCollider[]
  private readonly roots: MMDTouchRegionRoots
  private readonly headBoneIndex: number
  private readonly headCollider: MMDTouchCollider | undefined
  private readonly raycaster = new Raycaster()
  private readonly pointerNdc = new Vector2()
  private readonly scratch = new Vector3()
  private pokes: { region: NaturalTouchRegion, x: number, y: number }[] = []
  private pet: { x: number, y: number } | null = null
  private pressCenter: { x: number, y: number } | null = null
  private lastRegion: NaturalTouchRegion | null = null
  private hitBody = false
  private events = 0
  private headWidth = 1

  constructor(
    private readonly mesh: SkinnedMesh,
    private readonly source: MMDTouchSource,
    rig: Pick<MMDRigProfile, 'bones'>,
    options: { requireHold?: boolean } = {},
  ) {
    this.gestures = new MMDTouchGestures(options)
    this.roots = mmdTouchRegionRoots(rig)
    this.colliders = buildMMDTouchColliders(source, mesh.skeleton.boneInverses, mesh.bindMatrix, this.roots)
    this.headBoneIndex = rig.bones.head ? mesh.skeleton.bones.findIndex(bone => bone.name === rig.bones.head) : -1
    this.headCollider = this.colliders.find(collider => collider.boneIndex === this.headBoneIndex)
  }

  pointer(event: MMDTouchPointer, camera: Camera, viewport: PlacementRect): MMDTouchEvent[] {
    if (event.type === 'pointerleave' || event.type === 'pointercancel')
      return this.handle(this.gestures.cancelled(event.timeStamp))
    const sample = this.sample(event, camera, viewport)
    if (!sample)
      return []
    if (event.type === 'pointerdown')
      return event.button === 0 ? this.handle(this.gestures.pressed(sample)) : []
    if (event.type === 'pointerup')
      return event.button === 0 ? this.handle(this.gestures.released(sample)) : []
    const events = this.handle(this.gestures.moved(sample))
    this.pet = this.gestures.petting && sample.head ? { x: clampUnit(sample.head.x * 2), y: clampUnit(sample.head.y * 2) } : null
    return events
  }

  /** Commits held pokes and ends resting pets; call once per frame while either is pending. */
  update(timeMs: number): MMDTouchEvent[] {
    return this.gestures.petting || this.gestures.pressPending ? this.handle(this.gestures.update(timeMs)) : []
  }

  reset(timeMs: number): MMDTouchEvent[] {
    const events = this.handle(this.gestures.reset(timeMs))
    this.pokes = []
    this.pet = null
    return events
  }

  /** Pokes since the last call, region-relative with X right and Y down. */
  takePokes() {
    return this.pokes.splice(0)
  }

  get petHand() {
    return this.pet
  }

  /** The head collider centre (or the head bone without one) in canvas client pixels. */
  headScreenPoint(camera: Camera, viewport: PlacementRect): { x: number, y: number } | null {
    const bone = this.mesh.skeleton.bones[this.headBoneIndex]
    if (!bone)
      return null
    const world = this.headCollider
      ? mmdTouchColliderCenter(this.headCollider, bone.matrixWorld, this.scratch)
      : bone.getWorldPosition(this.scratch)
    return this.project(world, camera, viewport)
  }

  diagnostics(camera: Camera | undefined, viewport: PlacementRect | undefined): MMDTouchDiagnostics {
    return {
      lastRegion: this.lastRegion,
      hitBody: this.hitBody,
      petActive: this.gestures.petting,
      headScreenPoint: camera && viewport ? this.headScreenPoint(camera, viewport) : null,
      events: this.events,
    }
  }

  private handle(events: MMDTouchEvent[]): MMDTouchEvent[] {
    for (const event of events) {
      this.events++
      if (event.kind === 'poke') {
        const center = this.pressCenter ?? { x: event.x, y: event.y }
        const unit = event.region === 'head' ? 0.5 : 1
        const span = this.headWidth * unit
        this.pokes.push({ region: event.region, x: clampUnit((event.x - center.x) / span), y: clampUnit((event.y - center.y) / span) })
      }
      if (event.kind === 'pet-end')
        this.pet = null
    }
    return events
  }

  private sample(event: MMDTouchPointer, camera: Camera, viewport: PlacementRect): MMDTouchSample | null {
    if (viewport.width <= 0 || viewport.height <= 0)
      return null
    const head = projectMMDHead(this.mesh, camera, viewport)
    const headPoint = this.headScreenPoint(camera, viewport)
    this.headWidth = head?.width ?? viewport.height / 8
    this.pointerNdc.set(
      (event.clientX - viewport.x) / viewport.width * 2 - 1,
      1 - (event.clientY - viewport.y) / viewport.height * 2,
    )
    this.raycaster.setFromCamera(this.pointerNdc, camera)
    const hit = this.hit()
    this.lastRegion = hit?.region ?? null
    this.hitBody = hit?.fromCollider ?? false
    if (event.type === 'pointerdown') {
      this.pressCenter = hit?.region === 'head'
        ? headPoint
        : hit ? this.project(hit.center, camera, viewport) : null
    }
    return {
      timeMs: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      region: hit?.region ?? null,
      scale: this.headWidth,
      head: headPoint ? { x: (event.clientX - headPoint.x) / this.headWidth, y: (event.clientY - headPoint.y) / this.headWidth, halfHeight: 0.5 } : undefined,
    }
  }

  private hit(): { region: NaturalTouchRegion, center: Vector3, fromCollider: boolean } | null {
    const bones = this.mesh.skeleton.bones
    if (this.colliders.length > 0) {
      const hit = raycastMMDTouchColliders(this.raycaster.ray, this.colliders, index => bones[index]?.matrixWorld)
      if (!hit)
        return null
      return { region: hit.region, center: mmdTouchColliderCenter(hit.collider, bones[hit.collider.boneIndex].matrixWorld, new Vector3()), fromCollider: true }
    }
    const face = this.raycaster.intersectObject(this.mesh, false)[0]
    if (!face?.face)
      return null
    const bone = this.heaviestBone([face.face.a, face.face.b, face.face.c])
    const region = bone < 0 ? null : mmdTouchRegionOf(bone, this.source.bones, this.roots)
    return region ? { region, center: face.point, fromCollider: false } : null
  }

  private heaviestBone(vertices: number[]): number {
    const indices = this.mesh.geometry.getAttribute('skinIndex')
    const weights = this.mesh.geometry.getAttribute('skinWeight')
    if (!indices || !weights)
      return -1
    const totals = new Map<number, number>()
    for (const vertex of vertices) {
      for (let slot = 0; slot < 4; slot++) {
        const bone = indices.getComponent(vertex, slot)
        totals.set(bone, (totals.get(bone) ?? 0) + weights.getComponent(vertex, slot))
      }
    }
    let best = -1
    let bestWeight = 0
    for (const [bone, weight] of totals) {
      if (weight > bestWeight) {
        best = bone
        bestWeight = weight
      }
    }
    return best
  }

  private project(world: Vector3, camera: Camera, viewport: PlacementRect) {
    const ndc = this.scratch.copy(world).project(camera)
    return { x: viewport.x + (ndc.x + 1) * viewport.width / 2, y: viewport.y + (1 - ndc.y) * viewport.height / 2 }
  }
}
