import type { MMDTouchSource } from './colliders'

import { Bone, BufferGeometry, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, OrthographicCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'

import { MMDTouch } from './touch'

const SPHERE = 0
const viewport = { x: 0, y: 0, width: 200, height: 200 }
const rig = { bones: { head: 'head', hips: 'body' } }

type Skin = [bone: number, weight: number][]

/** One camera-facing quad per entry, 0.8 wide, with every vertex skinned by `skin`. */
function buildMesh(quads: { bottom: number, top: number, skin: Skin }[]) {
  const positions: number[] = []
  const skinIndices: number[] = []
  const skinWeights: number[] = []
  const indices: number[] = []
  for (const [quad, { bottom, top, skin }] of quads.entries()) {
    positions.push(-0.4, bottom, 0, 0.4, bottom, 0, 0.4, top, 0, -0.4, top, 0)
    for (let vertex = 0; vertex < 4; vertex++) {
      for (let slot = 0; slot < 4; slot++) {
        skinIndices.push(skin[slot]?.[0] ?? 0)
        skinWeights.push(skin[slot]?.[1] ?? 0)
      }
    }
    const base = quad * 4
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4))
  geometry.setIndex(indices)

  const body = new Bone()
  body.name = 'body'
  const head = new Bone()
  head.name = 'head'
  head.position.y = 1.4
  body.add(head)
  const prop = new Bone()
  prop.name = 'prop'

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
  mesh.add(body, prop)
  mesh.bind(new Skeleton([body, head, prop]))
  mesh.updateMatrixWorld(true)
  return mesh
}

const bones: MMDTouchSource['bones'] = [
  { name: 'body', parentBoneIndex: -1 },
  { name: 'head', parentBoneIndex: 0 },
  { name: 'prop', parentBoneIndex: -1 },
]

function camera() {
  const view = new OrthographicCamera(-2, 2, 2, -2, 0.1, 10)
  view.position.z = 5
  view.updateMatrixWorld(true)
  return view
}

/** Client pixels of a world point on the z = 0 plane under the orthographic camera above. */
function client(worldX: number, worldY: number) {
  return { clientX: (worldX / 2 + 1) * viewport.width / 2, clientY: (1 - worldY / 2) * viewport.height / 2 }
}

function press(touch: MMDTouch, worldX: number, worldY: number) {
  touch.pointer({ type: 'pointerdown', button: 0, timeStamp: 0, ...client(worldX, worldY) }, camera(), viewport)
  return touch.diagnostics(undefined, undefined)
}

describe('mmd touch without usable rigid bodies', () => {
  const quads = [
    { bottom: 0, top: 0.9, skin: [[0, 1]] as Skin },
    { bottom: 1, top: 1.8, skin: [[1, 1]] as Skin },
    { bottom: -0.9, top: -0.1, skin: [[2, 1]] as Skin },
    { bottom: -1.9, top: -1, skin: [[0, 0.4], [1, 0.6]] as Skin },
  ]

  it('builds no colliders and takes the region from the hit face\'s bone', () => {
    const touch = new MMDTouch(buildMesh(quads), { bones, rigidBodies: [] }, rig)
    expect(touch.colliders).toEqual([])

    expect(press(touch, 0, 1.4)).toMatchObject({ lastRegion: 'head', hitBody: false })
    expect(press(touch, 0, 0.5)).toMatchObject({ lastRegion: 'body', hitBody: false })
  })

  it('reports no region for a miss or a face on a bone outside the head and body subtrees', () => {
    const touch = new MMDTouch(buildMesh(quads), { bones, rigidBodies: [] }, rig)

    expect(press(touch, 1.5, 1.4)).toMatchObject({ lastRegion: null, hitBody: false })
    expect(press(touch, 0, -0.5)).toMatchObject({ lastRegion: null, hitBody: false })
  })

  it('lets the heaviest bone of a blended face decide the region', () => {
    const touch = new MMDTouch(buildMesh(quads), { bones, rigidBodies: [] }, rig)

    expect(press(touch, 0, -1.5)).toMatchObject({ lastRegion: 'head', hitBody: false })
  })

  it('commits a poke on the fallback region', () => {
    const touch = new MMDTouch(buildMesh(quads), { bones, rigidBodies: [] }, rig)
    const point = client(0, 0.5)
    touch.pointer({ type: 'pointerdown', button: 0, timeStamp: 0, ...point }, camera(), viewport)
    const events = touch.pointer({ type: 'pointerup', button: 0, timeStamp: 100, ...point }, camera(), viewport)

    expect(events).toEqual([expect.objectContaining({ kind: 'poke', region: 'body' })])
    expect(touch.takePokes()).toEqual([expect.objectContaining({ region: 'body' })])
  })

  it('never reads the mesh when the model has a usable rigid body', () => {
    const touch = new MMDTouch(buildMesh(quads), {
      bones,
      rigidBodies: [{ name: 'headSphere', boneIndex: 1, shapeType: SPHERE, shapeSize: [0.3, 0, 0], shapePosition: [0, 1.4, 0], shapeRotation: [0, 0, 0] }],
    }, rig)
    expect(touch.colliders).toHaveLength(1)

    expect(press(touch, 0, 1.4)).toMatchObject({ lastRegion: 'head', hitBody: true })
    // The body quad is still under the pointer, but colliders are the only source once one exists.
    expect(press(touch, 0, 0.5)).toMatchObject({ lastRegion: null, hitBody: false })
  })
})
