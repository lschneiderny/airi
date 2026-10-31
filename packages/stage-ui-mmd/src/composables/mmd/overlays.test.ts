import type { Line } from 'three'

import type { MMDOverlaySource, MMDOverlayStage } from './overlays'
import type { MMDTouchCollider } from './touch'

import { Bone, BufferGeometry, CapsuleGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, Scene, Skeleton, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { mmdOverlaysOff } from './overlay-flags'
import { MMDOverlays } from './overlays'

function createSource() {
  const names = ['センター', '左足ＩＫ', '左足首', '右足ＩＫ', '右足首', '頭', '左腕', '左ひじ', '左手首']
  const bones = names.map((name, index) => {
    const bone = new Bone()
    bone.name = name
    bone.position.set(index, index * 2, 0)
    return bone
  })
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
  mesh.add(bones[0])
  mesh.bind(new Skeleton(bones))
  mesh.updateMatrixWorld(true)
  const colliders: MMDTouchCollider[] = [
    { name: 'head', boneIndex: 5, region: 'head', shape: 'sphere', size: [1, 0, 0], offset: new Matrix4() },
    { name: 'chest', boneIndex: 0, region: 'body', shape: 'box', size: [1, 2, 3], offset: new Matrix4().makeTranslation(0, 1, 0) },
    { name: 'arm', boneIndex: 0, region: 'body', shape: 'capsule', size: [0.5, 2, 0], offset: new Matrix4() },
  ]
  const ikHelper = Object.assign(new Object3D(), { dispose: vi.fn() })
  let lookAt: { x: number, y: number, z: number } | null = { x: 1, y: 2, z: 3 }
  let stage: MMDOverlayStage | null = { floor: { minX: -40, maxX: 40 }, ground: { minX: -30, maxX: 30 }, homeX: 12, goalX: null, goalReason: null }
  const labels: Object3D[] = []
  return {
    source: {
      mesh,
      rig: {
        bones: { leftUpperArm: '左腕', leftLowerArm: '左ひじ', leftHand: '左手首' },
        legIk: {
          left: { ikBone: '左足ＩＫ', ikBoneIndex: 1, target: '左足首', knee: null, upperLeg: null, kneeLimit: null },
          right: { ikBone: '右足ＩＫ', ikBoneIndex: 3, target: '右足首', knee: null, upperLeg: null, kneeLimit: null },
        },
      },
      colliders,
      createIkHelper: () => ikHelper,
      lookAtTarget: () => lookAt,
      stage: () => stage,
      createLabel: (text: string) => {
        const label = new Object3D()
        label.name = `label:${text}`
        labels.push(label)
        return label
      },
    } satisfies MMDOverlaySource,
    ikHelper,
    labels,
    setLookAt: (value: typeof lookAt) => { lookAt = value },
    setStage: (value: typeof stage) => { stage = value },
  }
}

function disposables(root: Object3D) {
  const geometries: BufferGeometry[] = []
  const materials: MeshBasicMaterial[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.push(object.geometry)
      materials.push(object.material as MeshBasicMaterial)
    }
  })
  return { geometries, materials }
}

describe('mmd overlays', () => {
  it('adds each overlay to the scene while on and removes and disposes it when off', () => {
    const scene = new Scene()
    scene.add(new Group())
    const baseline = scene.children.length
    const { source, ikHelper } = createSource()
    const overlays = new MMDOverlays(scene, source)

    overlays.apply({ ...mmdOverlaysOff, ik: true, colliders: true, feet: true, lookAt: true })
    expect(scene.children.length).toBe(baseline + 4)
    expect(scene.children).toContain(ikHelper)
    const colliderGroup = scene.getObjectByName('mmd-overlay-colliders')!
    const feetGroup = scene.getObjectByName('mmd-overlay-feet')!
    expect(colliderGroup.children).toHaveLength(3)
    expect(feetGroup.children).toHaveLength(4)
    const spies = [...disposables(colliderGroup).geometries, ...disposables(feetGroup).geometries, ...disposables(scene.getObjectByName('mmd-overlay-look-at')!).geometries]
      .map(geometry => vi.spyOn(geometry, 'dispose'))
    const materialSpies = [...disposables(colliderGroup).materials, ...disposables(feetGroup).materials]
      .map(material => vi.spyOn(material, 'dispose'))

    overlays.apply({ ...mmdOverlaysOff, colliders: true, feet: true, lookAt: true })
    expect(scene.children.length).toBe(baseline + 3)
    expect(ikHelper.dispose).toHaveBeenCalledTimes(1)

    overlays.apply(mmdOverlaysOff)
    expect(scene.children.length).toBe(baseline)
    expect(overlays.flags).toEqual(mmdOverlaysOff)
    for (const spy of spies)
      expect(spy).toHaveBeenCalled()
    for (const spy of materialSpies)
      expect(spy).toHaveBeenCalled()
  })

  it('does not duplicate an overlay that is already on', () => {
    const scene = new Scene()
    const { source } = createSource()
    const overlays = new MMDOverlays(scene, source)
    overlays.apply({ ...mmdOverlaysOff, colliders: true })
    overlays.apply({ ...mmdOverlaysOff, colliders: true })
    expect(scene.children.length).toBe(1)
    overlays.dispose()
    expect(scene.children.length).toBe(0)
  })

  it('follows the posed bones and hides the look-at marker without a target', () => {
    const scene = new Scene()
    const { source, setLookAt } = createSource()
    const overlays = new MMDOverlays(scene, source)
    overlays.apply({ ...mmdOverlaysOff, colliders: true, feet: true, lookAt: true })
    source.mesh.skeleton.bones[0].position.set(5, 0, 0)
    source.mesh.updateMatrixWorld(true)

    overlays.update()

    const colliderGroup = scene.getObjectByName('mmd-overlay-colliders')!
    const chest = colliderGroup.children[1] as Mesh
    expect(new Vector3().setFromMatrixPosition(chest.matrix).toArray()).toEqual([5, 1, 0])
    const feetGroup = scene.getObjectByName('mmd-overlay-feet')!
    const expected = source.mesh.skeleton.bones[1].getWorldPosition(new Vector3())
    expect(feetGroup.children[0].position.distanceTo(expected)).toBeLessThan(1e-9)
    const marker = scene.getObjectByName('mmd-overlay-look-at')!
    expect(marker.visible).toBe(true)
    expect(marker.position.toArray()).toEqual([1, 2, 3])

    setLookAt(null)
    overlays.update()
    expect(marker.visible).toBe(false)
    overlays.dispose()
  })

  it('draws the floor line, ground line, home and goal from the stage world and hides them without one', () => {
    const scene = new Scene()
    const { source, setStage, labels } = createSource()
    const overlays = new MMDOverlays(scene, source)
    overlays.apply({ ...mmdOverlaysOff, floorLine: true, groundLine: true, home: true, goal: true })
    expect(scene.children.length).toBe(4)

    overlays.update()
    const floor = scene.getObjectByName('mmd-overlay-floor-line') as Line
    const ground = scene.getObjectByName('mmd-overlay-ground-line') as Line
    const home = scene.getObjectByName('mmd-overlay-home')!
    const goal = scene.getObjectByName('mmd-overlay-goal')!
    expect(Array.from(floor.geometry.getAttribute('position').array)).toEqual([-40, 0, 0, 40, 0, 0])
    const groundPoints = Array.from(ground.geometry.getAttribute('position').array)
    expect([groundPoints[0], groundPoints[3]]).toEqual([-30, 30])
    expect(groundPoints[1]).toBeGreaterThan(0)
    expect(home.position.x).toBe(12)
    expect(goal.visible).toBe(false)
    expect(labels).toHaveLength(0)

    setStage({ floor: { minX: -40, maxX: 40 }, ground: { minX: -30, maxX: 30 }, homeX: 12, goalX: -5, goalReason: 'approach-chat' })
    overlays.update()
    overlays.update()
    expect(goal.visible).toBe(true)
    expect(goal.position.x).toBe(-5)
    expect(labels.map(label => label.name)).toEqual(['label:approach-chat'])
    expect(goal.children).toContain(labels[0])

    setStage({ floor: { minX: -40, maxX: 40 }, ground: { minX: -30, maxX: 30 }, homeX: 12, goalX: -5, goalReason: 'tool' })
    overlays.update()
    expect(labels.map(label => label.name)).toEqual(['label:approach-chat', 'label:tool'])
    expect(goal.children).toEqual([labels[1]])

    setStage(null)
    overlays.update()
    expect([floor.visible, ground.visible, home.visible, goal.visible]).toEqual([false, false, false, false])
    expect(goal.children).toHaveLength(0)

    overlays.dispose()
    expect(scene.children.length).toBe(0)
  })

  it('stretches the arm capsules between the posed arm bones', () => {
    const scene = new Scene()
    const { source } = createSource()
    const overlays = new MMDOverlays(scene, source)
    overlays.apply({ ...mmdOverlaysOff, armCapsules: true })
    const group = scene.getObjectByName('mmd-overlay-arm-capsules')!
    expect(group.children).toHaveLength(2)

    const [upper, elbow, wrist] = ['左腕', '左ひじ', '左手首'].map(name => source.mesh.skeleton.bones.find(bone => bone.name === name)!)
    upper.position.set(0, 10, 0)
    elbow.position.set(0, 6, 0)
    wrist.position.set(0, 2, 0)
    source.mesh.updateMatrixWorld(true)
    overlays.update()

    const [upperCapsule, forearmCapsule] = group.children as Mesh[]
    const upperWorld = upper.getWorldPosition(new Vector3())
    const elbowWorld = elbow.getWorldPosition(new Vector3())
    const wristWorld = wrist.getWorldPosition(new Vector3())
    expect(upperCapsule.position.distanceTo(upperWorld.clone().lerp(elbowWorld, 0.75))).toBeLessThan(1e-9)
    const fingertip = wristWorld.clone().addScaledVector(wristWorld.clone().sub(elbowWorld), 0.65)
    expect(forearmCapsule.position.distanceTo(elbowWorld.clone().lerp(fingertip, 0.5))).toBeLessThan(1e-9)
    const axis = new Vector3(0, 1, 0).applyQuaternion(forearmCapsule.quaternion)
    expect(axis.dot(fingertip.clone().sub(elbowWorld).normalize())).toBeCloseTo(1, 9)
    expect(forearmCapsule.geometry).toBeInstanceOf(CapsuleGeometry)
    const geometry = (forearmCapsule.geometry as CapsuleGeometry).parameters
    expect(geometry.height).toBeCloseTo(elbowWorld.distanceTo(fingertip), 9)
    expect(geometry.radius).toBeCloseTo(0.12 * elbowWorld.distanceTo(wristWorld), 9)

    overlays.dispose()
    expect(scene.children.length).toBe(0)
  })
})
