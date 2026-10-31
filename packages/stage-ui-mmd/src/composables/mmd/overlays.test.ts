import type { MMDTouchCollider } from './touch'

import { Bone, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, Scene, Skeleton, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { MMDOverlays, mmdOverlaysOff } from './overlays'

function createSource() {
  const names = ['センター', '左足ＩＫ', '左足首', '右足ＩＫ', '右足首', '頭']
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
  return {
    source: {
      mesh,
      rig: {
        legIk: {
          left: { ikBone: '左足ＩＫ', ikBoneIndex: 1, target: '左足首', knee: null, upperLeg: null, kneeLimit: null },
          right: { ikBone: '右足ＩＫ', ikBoneIndex: 3, target: '右足首', knee: null, upperLeg: null, kneeLimit: null },
        },
      },
      colliders,
      createIkHelper: () => ikHelper,
      lookAtTarget: () => lookAt,
    },
    ikHelper,
    setLookAt: (value: typeof lookAt) => { lookAt = value },
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

    overlays.apply({ ik: true, colliders: true, feet: true, lookAt: true })
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

    overlays.apply({ ik: false, colliders: true, feet: true, lookAt: true })
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
    overlays.apply({ ik: false, colliders: true, feet: true, lookAt: true })
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
})
