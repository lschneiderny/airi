import type { BodyCollider, BodyRigTraits, BodySide } from '../performance'
import type { BodyMeshSource, BodyModel } from './contracts'

import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, BodyCollision, createBodyPerformer, DEFAULT_ARM_REST_POSE } from '../performance'
import { bareBody } from './body-model.test-fixtures'
import { buildBodyModel, REST_GARMENT_CLEARANCE_MAX } from './index'
import { restTraits, solveRest } from './rest'

const DEG = Math.PI / 180
const SIDES: readonly BodySide[] = ['left', 'right']

/** The performer's own arm test of the default rest pose at the model's rest abduction, against the model's volumes or other colliders. */
function restDepth(source: BodyMeshSource, model: BodyModel, side: BodySide, abduct = model.rest[side].abduct, colliders: readonly BodyCollider[] = model.volumes, clearance = 0): number {
  const channels = new Float32Array(BODY_CHANNELS.length)
  const pose = DEFAULT_ARM_REST_POSE
  for (const start of [BODY_CHANNELS.indexOf('leftClavElev'), BODY_CHANNELS.indexOf('rightClavElev')])
    channels.set([pose.clavElev, pose.clavProt, pose.flex, pose.abduct, pose.twist, pose.elbow, pose.pron, pose.wflex, pose.wdev], start)
  // Unfitted, as the rest solve measures: the corrector's fit would shrink whatever this pose touches.
  const collision = new BodyCollision({ ...restTraits(source), colliders }, channels.slice(), false)
  channels[BODY_CHANNELS.indexOf(`${side}Abduct`)] = abduct
  return collision.measure(side, channels, clearance).depth
}

/** The rig traits a host hands the performer: the source's skeleton with the model's volumes and its rest abduction per arm. */
function rigTraits(source: BodyMeshSource, model: BodyModel): BodyRigTraits {
  const skeleton = restTraits(source)
  const arm = (side: BodySide) => ({ ...skeleton.arms[side], restAbduct: model.rest[side].abduct })
  return { ...skeleton, arms: { left: arm('left'), right: arm('right') }, colliders: model.volumes }
}

/** A trunk slice lies left to right, or front to back, by a quarter turn of pitch, when it is deeper than it is wide. */
const alongDepth = (volume: BodyModel['volumes'][number]) => volume.rotation.pitch !== 0
/** The half-width and the half-depth of a trunk slice: its cap, plus its cylinder's half length along the way it lies. */
const halfWidth = (volume: BodyModel['volumes'][number]) => volume.shape === 'capsule' ? volume.radius + (alongDepth(volume) ? 0 : volume.length / 2) : 0
const halfDepth = (volume: BodyModel['volumes'][number]) => volume.shape === 'capsule' ? volume.radius + (alongDepth(volume) ? volume.length / 2 : 0) : 0

describe('buildBodyModel', () => {
  it('fits a bare body: slices on the trunk, a capsule on each thigh, nothing on the neck or the head, and the default rest', () => {
    const source = bareBody().build()
    const model = buildBodyModel(source)

    const trunk = model.volumes.filter(volume => !volume.leg)
    expect(trunk.length).toBeGreaterThan(4)
    // The neck and the head of this mesh carry surface too, and get no volume: a host keeps its own bodies for them.
    expect(new Set(trunk.map(volume => volume.bone))).toEqual(new Set(['hips', 'spine0', 'spine1']))
    // Each slice is as wide and as deep as the body there: 0.9 to 1 to each side, 0.65 to 0.7 deep.
    for (const volume of trunk) {
      expect(volume.shape).toBe('capsule')
      expect(halfWidth(volume)).toBeGreaterThan(0.5)
      expect(halfWidth(volume)).toBeLessThanOrEqual(1.001)
      expect(halfDepth(volume)).toBeLessThanOrEqual(0.701)
    }
    const thighs = model.volumes.filter(volume => volume.leg)
    expect(thighs.map(volume => volume.leg)).toEqual([{ side: 'left', segment: 'thigh' }, { side: 'right', segment: 'thigh' }])
    expect(thighs.every(volume => volume.bone === 'hips' && volume.shape === 'capsule' && Math.abs(volume.radius - 0.55) < 0.02)).toBe(true)

    expect(model.garments).toEqual([])
    for (const side of SIDES) {
      expect(model.rest[side]).toEqual({ abduct: DEFAULT_ARM_REST_POSE.abduct, limit: null })
      expect(restDepth(source, model, side)).toBe(0)
      // The sleeves of this mesh are 0.3 and 0.25 around segments 2.62 and 2.41 long.
      expect(model.limbs[side].upperArm).toBeCloseTo(0.3 / 2.625, 1)
      expect(model.limbs[side].forearm).toBeCloseTo(0.25 / 2.408, 1)
    }
    expect(model.report.vertices).toMatchObject({ flesh: 0, garment: 0 })
    expect(model.report.adjustments.every(adjustment => adjustment.reason === 'shoulder-joints')).toBe(true)
  })

  it('never makes an obstacle of what the arm wears: its own vertices and a cuff around the bind-pose forearm', () => {
    const bare = buildBodyModel(bareBody().build())
    const mesh = bareBody()
    // A rigid cuff skinned to the chest that hugs the left forearm in the bind pose.
    mesh.limb('leftLower', 'leftHand', 0.28)
    const cuffed = mesh.build()
    for (let vertex = bareBody().build().positions.length / 3; vertex < cuffed.positions.length / 3; vertex++)
      (cuffed.skinIndices as number[])[vertex * 4] = mesh.index('chest')
    expect(buildBodyModel(cuffed).volumes).toEqual(bare.volumes)
  })

  it('excludes vertices with any arm weight and ignores vertices with no weight', () => {
    const mesh = bareBody()
    const bare = buildBodyModel(mesh.build())
    const from = mesh.build().positions.length / 3
    mesh.tube('spine', 10.2, 12.6, [1.5, 1])
    const source = mesh.build()
    const skinIndices = Array.from(source.skinIndices)
    const skinWeights = Array.from(source.skinWeights)
    const count = source.positions.length / 3 - from
    for (let vertex = from; vertex < from + count; vertex++) {
      skinIndices[vertex * 4 + 1] = mesh.index('leftUpper')
      skinWeights[vertex * 4] = vertex % 2 === 0 ? 0.99 : 0
      skinWeights[vertex * 4 + 1] = vertex % 2 === 0 ? 0.01 : 0
    }
    const model = buildBodyModel({ ...source, skinIndices, skinWeights })

    expect(model.volumes).toEqual(bare.volumes)
    expect(model.report.vertices.arm - bare.report.vertices.arm).toBe(count / 2)
    expect(model.report.vertices.ignored - bare.report.vertices.ignored).toBe(count / 2)
  })

  it('ignores a vertex whose position is not finite', () => {
    const mesh = bareBody()
    let cloth = 'hips'
    for (let row = 0; row < 3; row++) {
      cloth = mesh.bone(`cloth_${row}`, cloth, [0, 10 - row, 1])
      mesh.simulate(cloth, 3)
    }
    const sound = buildBodyModel(mesh.build())
    const from = mesh.build().positions.length / 3
    // A ring on the waist, one on the left forearm and one on the cloth, each vertex with one coordinate that is not a
    // finite number.
    mesh.ring('spine', 12, 0.9, 0.65)
    mesh.ring('leftLower', 12.5, 0.25, 0.25, { x: 4 })
    mesh.ring(cloth, 9, 1.2, 1)
    const source = mesh.build()
    const positions = Array.from(source.positions)
    const count = positions.length / 3 - from
    for (let vertex = from; vertex < from + count; vertex++)
      positions[vertex * 3 + vertex % 3] = [Number.NaN, Infinity, -Infinity][Math.floor(vertex / 3) % 3]
    const model = buildBodyModel({ ...source, positions })

    expect(model).toEqual({ ...sound, report: { ...sound.report, vertices: { ...sound.report.vertices, ignored: sound.report.vertices.ignored + count } } })
  })

  it('takes a rigid jacket for a hard volume and opens the resting arms until they clear it', () => {
    const mesh = bareBody()
    mesh.tube('spine', 10.2, 12.6, [1.5, 1])
    const source = mesh.build()
    const model = buildBodyModel(source)

    expect(Math.max(...model.volumes.filter(volume => volume.bone === 'spine0').map(halfWidth))).toBeCloseTo(1.5, 1)
    for (const side of SIDES) {
      expect(model.rest[side].abduct).toBeGreaterThan(DEFAULT_ARM_REST_POSE.abduct + 1 * DEG)
      expect(model.rest[side].abduct).toBeLessThanOrEqual(22 * DEG + 1e-9)
      expect(model.rest[side].limit).toBeNull()
      expect(restDepth(source, model, side)).toBe(0)
      // The default hang is inside the jacket, and one degree less than the solved rest does not clear it with room.
      expect(restDepth(source, model, side, DEFAULT_ARM_REST_POSE.abduct)).toBeGreaterThan(0)
      expect(restDepth(source, model, side, model.rest[side].abduct, model.volumes, 0.03)).toBe(0)
      expect(restDepth(source, model, side, model.rest[side].abduct - DEG, model.volumes, 0.03)).toBeGreaterThan(0)
    }
    expect(model.report.adjustments.filter(adjustment => adjustment.reason === 'rest-clearance')).toEqual([])
  })

  /**
   * A skirt of eight chains, three simulated bones deep, flaring from the waist to `hem` at the height of the hands.
   * `collidesWithArm` says whether the simulator collides its bones with the arms.
   */
  function skirted(hem: number, mobility: number, collidesWithArm = false) {
    const mesh = bareBody()
    const bones: string[] = []
    for (let chain = 0; chain < 8; chain++) {
      let parent = 'hips'
      for (let row = 0; row < 3; row++) {
        parent = mesh.bone(`skirt_${chain}_${row}`, parent, [Math.cos(chain), 10.6 - row, Math.sin(chain)])
        mesh.simulate(parent, mobility, collidesWithArm)
        bones.push(parent)
      }
    }
    // Each row of the cloth rides on the bones of its height, and each chain carries a strip of three vertices a ring.
    for (let row = 0; row < 3; row++)
      mesh.tube(place => `skirt_${Math.floor(place / 3)}_${row}`, 10.6 - row, 9.6 - row, [1.1 + (hem - 1.1) * row / 3, 0.9 + (hem - 1.1) * row / 3], [1.1 + (hem - 1.1) * (row + 1) / 3, 0.9 + (hem - 1.1) * (row + 1) / 3])
    return { mesh, bones }
  }

  it('keeps a flared simulated skirt out of the hard volumes and reports it as a garment', () => {
    const bare = buildBodyModel(bareBody().build())
    const { mesh, bones } = skirted(2.8, 3)
    const source = mesh.build()
    const model = buildBodyModel(source)

    expect(model.volumes.filter(volume => !volume.leg)).toEqual(bare.volumes.filter(volume => !volume.leg))
    expect(model.garments).toHaveLength(1)
    const [skirt] = model.garments
    expect(skirt.anchor).toBe('hips')
    expect(skirt.bones).toEqual(bones.map(mesh.index).sort((a, b) => a - b))
    expect(skirt.silhouette.length).toBeGreaterThan(0)
    expect(skirt.silhouette.every(shape => shape.bone === 'hips')).toBe(true)
    expect(skirt.mobility).toBe(3)
    expect(skirt.pinched).toBe(false)
    expect(model.report.vertices.garment).toBeGreaterThan(0)
    for (const side of SIDES) {
      // The hem reaches the hanging hand: the arm opens until it clears the hem with room for its sway.
      expect(model.rest[side].abduct).toBeGreaterThan(DEFAULT_ARM_REST_POSE.abduct)
      expect(model.rest[side].abduct).toBeLessThanOrEqual(DEFAULT_ARM_REST_POSE.abduct + REST_GARMENT_CLEARANCE_MAX + 1e-9)
      expect(restDepth(source, model, side)).toBe(0)
    }
  })

  it('takes a skirt and a bow that hang from the same bone for two garments, because no triangle ties them', () => {
    const alone = buildBodyModel(skirted(2.8, 3, true).mesh.build())
    const { mesh, bones } = skirted(2.8, 3, true)
    // A bow behind the hips on two chains of its own, which the simulator keeps apart from the arms. Its loops reach
    // out to the hands.
    const bow: string[] = []
    for (const side of [1, -1]) {
      let parent = 'hips'
      for (let row = 0; row < 3; row++) {
        parent = mesh.bone(`bow_${side}_${row}`, parent, [side * (1 + row), 10, -1.2])
        mesh.simulate(parent, 3)
        bow.push(parent)
      }
    }
    mesh.tube(place => place < 6 || place >= 18 ? 'bow_1_2' : 'bow_-1_2', 9.2, 10, [3.6, 0.2], [3.6, 0.2], { z: -1.2 })
    const model = buildBodyModel(mesh.build())

    expect(model.garments.map(garment => garment.bones)).toEqual([bones.map(mesh.index).sort((a, b) => a - b), bow.map(mesh.index).sort((a, b) => a - b)])
    // The skirt keeps the rest shape it has without the bow.
    expect(model.garments[0].silhouette).toEqual(alone.garments[0].silhouette)
    expect(model.garments[1].silhouette.length).toBeGreaterThan(0)
  })

  it('takes the chains under a bone of their own for one garment, though no triangle ties them', () => {
    const mesh = bareBody()
    const knot = mesh.bone('knot', 'spine', [0, 12, -0.8])
    const tails: string[] = []
    for (const side of [1, -1]) {
      let parent = knot
      for (let row = 0; row < 3; row++) {
        parent = mesh.bone(`tail_${side}_${row}`, parent, [side * 0.5, 11.5 - row, -0.9])
        mesh.simulate(parent, 3)
        tails.push(parent)
      }
      mesh.tube(parent, 9.5, 11.5, [0.3, 0.1], [0.3, 0.1], { x: side * 0.5, z: -0.9 })
    }
    const model = buildBodyModel(mesh.build())

    expect(model.garments.map(garment => garment.bones)).toEqual([tails.map(mesh.index).sort((a, b) => a - b)])
  })

  it('never joins chains that hang from different bones, whatever triangles tie them', () => {
    const { mesh, bones } = skirted(2.8, 3)
    const lace: string[] = []
    let parent = 'spine'
    for (let row = 0; row < 3; row++) {
      parent = mesh.bone(`lace_${row}`, parent, [0, 11 - row, 1])
      mesh.simulate(parent, 3)
      lace.push(parent)
    }
    // A ring of lace sewn to the first strip of the skirt: every second vertex is the skirt's.
    mesh.tube(place => place % 2 ? 'lace_2' : 'skirt_0_0', 10.4, 10.6, [1.1, 0.9])
    const model = buildBodyModel(mesh.build())

    expect(model.garments.map(garment => [garment.anchor, garment.bones])).toEqual([
      ['hips', bones.map(mesh.index).sort((a, b) => a - b)],
      ['spine0', lace.map(mesh.index).sort((a, b) => a - b)],
    ])
  })

  it('records a garment below arm reach without adding rest obstacles', () => {
    const mesh = bareBody()
    const bare = buildBodyModel(mesh.build())
    const hem = mesh.bone('hem', 'hips', [0, 5, 0])
    mesh.simulate(hem, 3, true)
    mesh.tube(hem, 4, 5, [5, 2])
    const model = buildBodyModel(mesh.build())

    expect(model.garments).toEqual([expect.objectContaining({ bones: [mesh.index(hem)], silhouette: [], pinched: false })])
    expect(model.volumes).toEqual(bare.volumes)
    expect(model.rest).toEqual(bare.rest)
  })

  it('settles within four degrees when clearance with sway needs seven degrees', () => {
    const locked = buildBodyModel(skirted(3.04, 0).mesh.build())
    const swinging = buildBodyModel(skirted(3.04, 3).mesh.build())

    for (const side of SIDES) {
      expect(locked.rest[side].abduct).toBeCloseTo(16 * DEG, 9)
      expect(swinging.rest[side].abduct).toBeCloseTo(16 * DEG, 9)
    }
  })

  it('marks a skirt as pinched when its centreline would clear one degree past the limit', () => {
    const model = buildBodyModel(skirted(4.72, 3).mesh.build())

    expect(model.garments[0].pinched).toBe(true)
    expect(model.rest.left.abduct).toBeCloseTo(16 * DEG, 9)
  })

  it('reports a free-swinging skirt the resting arm cannot leave as pinched, and a locked one as not', () => {
    const wide = buildBodyModel(skirted(6, 3).mesh.build())
    expect(wide.garments[0].pinched).toBe(true)
    for (const side of SIDES) {
      expect(wide.rest[side].limit).toEqual({ kind: 'garment', index: 0 })
      // No rest frees the arm, so it settles 4 degrees out, where it overlaps the skirt least, and opens no further.
      expect(wide.rest[side].abduct).toBeCloseTo(DEFAULT_ARM_REST_POSE.abduct + 4 * DEG, 9)
    }
    const locked = buildBodyModel(skirted(6, 0).mesh.build())
    expect(locked.garments[0].pinched).toBe(false)
    expect(locked.rest.left.limit).toEqual({ kind: 'garment', index: 0 })
  })

  it('opens the arm out of a free-swinging skirt it rests inside, beyond the range it settles in', () => {
    const model = buildBodyModel(skirted(4, 3).mesh.build())
    expect(model.garments[0].pinched).toBe(false)
    for (const side of SIDES) {
      expect(model.rest[side].limit).toEqual({ kind: 'garment', index: 0 })
      expect(model.rest[side].abduct).toBeGreaterThan(DEFAULT_ARM_REST_POSE.abduct + 4 * DEG)
      expect(model.rest[side].abduct).toBeLessThanOrEqual(28 * DEG + 1e-9)
    }
  })

  it('opens the arm clear of a skirt the simulator collides with the arm, where the arm leans on its edge', () => {
    const apart = buildBodyModel(skirted(4, 3).mesh.build())
    const source = skirted(4, 3, true).mesh.build()
    const colliding = buildBodyModel(source)
    for (const side of SIDES) {
      // Kept apart from the arm, the skirt is left to the simulator once the arm's centreline is out of it.
      expect(apart.rest[side].limit).toEqual({ kind: 'garment', index: 0 })
      // Colliding with the arm, it is cleared as a hard volume is, within the 30 degrees the widest rest allows.
      expect(colliding.rest[side].abduct).toBeGreaterThan(apart.rest[side].abduct)
      expect(colliding.rest[side].abduct).toBeLessThanOrEqual(30 * DEG + 1e-9)
      expect(colliding.rest[side].limit).toBeNull()
      expect(restDepth(source, colliding, side, colliding.rest[side].abduct, colliding.garments[0].silhouette)).toBe(0)
    }
  })

  it('leaves the arm where it settled in a colliding skirt it rests inside, and in one it clears only beyond 30 degrees', () => {
    // A locked skirt holds the arm's centreline: the arm is in the garment, and the simulator drapes the cloth around it.
    expect(buildBodyModel(skirted(4, 0, true).mesh.build()).rest).toEqual(buildBodyModel(skirted(4, 0).mesh.build()).rest)
    // The centreline leaves these skirts within 28 degrees. The narrower capsule clears at 31.
    for (const hem of [4.46, 4.6]) {
      const wide = buildBodyModel(skirted(hem, 3, true).mesh.build())
      expect(wide.rest).toEqual(buildBodyModel(skirted(hem, 3).mesh.build()).rest)
      expect(wide.rest.left.limit).toEqual({ kind: 'garment', index: 0 })
    }
  })

  it('clears the garments the simulator collides with the arm together, whatever their order', () => {
    const source = bareBody().build()
    const ornament = (x: number, y: number, radius: number) => ({
      bones: [],
      anchor: 'hips' as const,
      silhouette: [{ bone: 'hips' as const, shape: 'sphere' as const, radius, centre: { x, y: y - 10, z: 0.8 }, rotation: { yaw: 0, pitch: 0, roll: 0 } }],
      mobility: 0,
      collidesWithArm: true,
    })
    // The left arm leans on the near ornament up to 21 degrees and clears it from 23. On its way out it meets the far
    // one, which it leans on from 22 to 26 degrees and has passed at 28.
    const near = ornament(2.8, 9.2, 0.4)
    const far = ornament(3.6, 9.6, 0.1)
    const forward = solveRest(restTraits(source), [], [near, far])
    const backward = solveRest(restTraits(source), [], [far, near])

    expect(backward.rest.left.abduct).toBe(forward.rest.left.abduct)
    expect(forward.rest.left.abduct).toBeCloseTo(28 * DEG, 9)
    for (const garment of [near, far])
      expect(restDepth(source, buildBodyModel(source), 'left', forward.rest.left.abduct, garment.silhouette, 0.03)).toBe(0)
    expect(forward.rest.right).toEqual({ abduct: DEFAULT_ARM_REST_POSE.abduct, limit: null })
  })

  it('opens the arm out of the free-swinging garments together, and reports the one it ends inside as pinched', () => {
    const source = bareBody().build()
    const charm = (x: number, y: number, radius: number) => ({
      bones: [],
      anchor: 'hips' as const,
      silhouette: [{ bone: 'hips' as const, shape: 'sphere' as const, radius, centre: { x, y: y - 10, z: 0.8 }, rotation: { yaw: 0, pitch: 0, roll: 0 } }],
      mobility: 3,
      collidesWithArm: false,
    })
    const centreline = (garment: ReturnType<typeof charm>, abduct: number) => restDepth(source, buildBodyModel(source), 'left', abduct, garment.silhouette, -0.15)
    // The left arm's centreline lies inside the low charm up to 20 degrees and inside the small one at 20 and 21. It
    // is out of the low charm from 21, where the small one holds it, and out of both from 22.
    const low = charm(2.8, 9.2, 0.7)
    const small = charm(2.8, 10.6, 0.15)
    for (const garments of [[low, small], [small, low]]) {
      const solved = solveRest(restTraits(source), [], garments)
      expect(solved.rest.left.abduct).toBeCloseTo(22 * DEG, 9)
      expect(solved.pinched).toEqual([false, false])
      for (const garment of garments)
        expect(centreline(garment, solved.rest.left.abduct)).toBe(0)
    }
    // The wide charm holds the centreline from 20 degrees on, so no rest is out of both. The arm stays in the low one,
    // which is then pinched, though the arm alone could leave it at 21.
    const wide = charm(3.4, 10.6, 0.7)
    const held = solveRest(restTraits(source), [], [low, wide])
    expect(held.pinched).toEqual([true, false])
    expect(centreline(low, held.rest.left.abduct)).toBeGreaterThan(0)
    expect(centreline(wide, held.rest.left.abduct)).toBe(0)
  })

  it('clears a locked skirt at its bind shape and a free-swinging one by its sway', () => {
    const locked = buildBodyModel(skirted(2.8, 0).mesh.build())
    const free = buildBodyModel(skirted(2.8, 3).mesh.build())
    for (const side of SIDES)
      expect(free.rest[side].abduct - locked.rest[side].abduct).toBeCloseTo(3 * DEG, 9)
  })

  it('takes simulated flesh for a hard volume, and the same shape on a chain of three bones for a garment', () => {
    const waist = (deep: boolean) => {
      const mesh = bareBody()
      let parent = 'spine'
      for (let row = 0; row < (deep ? 3 : 1); row++) {
        parent = mesh.bone(`belly_${row}`, parent, [0, 12, 0.6])
        mesh.simulate(parent, 0.5)
      }
      // A blob in front of the waist, 0.65 beyond its surface.
      mesh.tube(parent, 11.6, 12.4, [0.7, 0.3], [0.7, 0.3], { z: 1 })
      const source = mesh.build()
      return { source, model: buildBodyModel(source) }
    }
    /** The depth of the slice at the blob's height. */
    const depthAt = ({ source, model }: { source: BodyMeshSource, model: BodyModel }) => {
      const at = (volume: BodyModel['volumes'][number]) => source.bones[source.canonical.spine[0]].position.y + volume.centre.y
      const slice = model.volumes.filter(volume => volume.bone === 'spine0' && volume.shape === 'capsule').sort((a, b) => Math.abs(at(a) - 12) - Math.abs(at(b) - 12))[0]
      return 2 * halfDepth(slice)
    }
    const bareSource = bareBody().build()
    const bare = depthAt({ source: bareSource, model: buildBodyModel(bareSource) })

    const flesh = waist(false)
    expect(flesh.model.garments).toEqual([])
    expect(flesh.model.report.vertices.flesh).toBeGreaterThan(0)
    expect(depthAt(flesh)).toBeGreaterThan(bare + 0.4)

    const garment = waist(true)
    expect(garment.model.garments).toHaveLength(1)
    expect(garment.model.garments[0].anchor).toBe('spine0')
    expect(garment.model.report.vertices.flesh).toBe(0)
    expect(depthAt(garment)).toBeCloseTo(bare, 9)
  })

  it('keeps a two-bone simulated chain hard through half the shoulder span', () => {
    const waist = (mobility: number) => {
      const mesh = bareBody()
      const root = mesh.bone('waist-root', 'spine', [0, 12, 0.6])
      const tip = mesh.bone('waist-tip', root, [0, 12, 1])
      mesh.simulate(root, 0)
      mesh.simulate(tip, mobility)
      mesh.tube(tip, 11.6, 12.4, [0.7, 0.3], [0.7, 0.3], { z: 1 })
      return buildBodyModel(mesh.build())
    }
    const atLimit = waist(1.2)
    const overLimit = waist(1.21)

    expect(atLimit.report.vertices.flesh).toBeGreaterThan(0)
    expect(atLimit.garments).toEqual([])
    expect(overLimit.report.vertices.flesh).toBe(0)
    expect(overLimit.garments).toHaveLength(1)
  })

  it('keeps a shell wider than the shoulder span inside the shoulder joints, so it never holds the arm', () => {
    const mesh = bareBody()
    // A rigid cape around the shoulders, twice as wide as the shoulder span.
    mesh.tube('chest', 14, 15.4, [2.4, 1.2])
    const source = mesh.build()
    const model = buildBodyModel(source)

    // Beside the upper arm, down to the elbow of a hanging arm (12.4), no volume passes 0.18 of the upper arm inside
    // each shoulder joint (1.2 - 0.47).
    const high = model.volumes.filter(volume => !volume.leg && source.bones[source.canonical.spine[1]].position.y + volume.centre.y > 13.9 && volume.bone === 'spine1')
    expect(high.length).toBeGreaterThan(0)
    for (const volume of high) {
      expect(halfWidth(volume)).toBeLessThanOrEqual(1.2 - 0.18 * Math.hypot(2, 1.7) + 1e-9)
      // Narrowed, the shell is deeper than it is wide, and it keeps its depth of 1.2.
      expect(halfDepth(volume)).toBeCloseTo(1.2, 1)
    }
    expect(model.report.adjustments.some(adjustment => adjustment.reason === 'shoulder-joints' && adjustment.bone === 'spine1' && adjustment.scale < 0.5)).toBe(true)
    for (const side of SIDES) {
      expect(model.rest[side]).toEqual({ abduct: DEFAULT_ARM_REST_POSE.abduct, limit: null })
      expect(restDepth(source, model, side)).toBe(0)
    }
    // The corrector keeps a clear guard pose on both sides: the shell does not trap it.
    const traits = rigTraits(source, model)
    expect(new BodyCollision(traits, createBodyPerformer({ traits, seed: 1 }).restChannels()).capabilities.gestures).toEqual({ left: true, right: true })
  })

  it('keeps the trunk beside the upper arm inside the shoulder joints, so a rim under the armpit never lifts the arm', () => {
    const mesh = bareBody()
    // The rim of an armhole, 0.3 outside the shoulder joints (1.2), below the armpit (13.7) and above the elbow of a
    // hanging arm (12.4).
    mesh.tube('chest', 13, 13.2, [1.5, 0.7])
    const source = mesh.build()
    const model = buildBodyModel(source)

    const y = (volume: BodyModel['volumes'][number]) => source.bones[source.canonical.spine[volume.bone === 'spine0' ? 0 : 1]].position.y + volume.centre.y
    const beside = model.volumes.filter(volume => !volume.leg && (volume.bone === 'spine0' || volume.bone === 'spine1') && y(volume) > 15 - Math.hypot(2, 1.7))
    expect(beside.length).toBeGreaterThan(2)
    for (const volume of beside)
      expect(halfWidth(volume)).toBeLessThanOrEqual(1.2 - 0.18 * Math.hypot(2, 1.7) + 1e-9)
    // Below the elbow the trunk keeps its width.
    expect(Math.max(...model.volumes.filter(volume => volume.bone === 'hips' && !volume.leg).map(halfWidth))).toBeCloseTo(1, 1)
    for (const side of SIDES) {
      expect(model.rest[side]).toEqual({ abduct: DEFAULT_ARM_REST_POSE.abduct, limit: null })
      // The default hang clears with the rest solve's room to spare, so the arm leaves it without touching the trunk.
      expect(restDepth(source, model, side, DEFAULT_ARM_REST_POSE.abduct, model.volumes, 0.03)).toBe(0)
    }
  })

  it('lays a trunk slice that is deeper than it is wide front to back, so it keeps its depth', () => {
    const mesh = bareBody()
    // A chest 1.6 deep to each side of the spine, twice what the shoulder joints leave it in width.
    mesh.tube('chest', 13.6, 15, [0.9, 1.6])
    const source = mesh.build()
    const model = buildBodyModel(source)

    const deep = model.volumes.filter(volume => volume.bone === 'spine1' && source.bones[source.canonical.spine[1]].position.y + volume.centre.y > 13.9)
    expect(deep.length).toBeGreaterThan(0)
    for (const volume of deep) {
      expect(alongDepth(volume)).toBe(true)
      expect(halfDepth(volume)).toBeCloseTo(1.6, 1)
      expect(halfWidth(volume)).toBeLessThanOrEqual(1.2 - 0.18 * Math.hypot(2, 1.7) + 1e-9)
    }
    // A slice that is wider than it is deep still lies left to right.
    expect(model.volumes.filter(volume => volume.bone === 'hips' && !volume.leg).every(volume => !alongDepth(volume))).toBe(true)
  })

  it('shrinks a volume no rest abduction clears until one does, and names it', () => {
    const mesh = bareBody()
    // A rigid hoop at the height of the hands, far wider than any rest reaches.
    mesh.tube('hips', 9, 10.4, [4.5, 1])
    const source = mesh.build()
    const model = buildBodyModel(source)

    const shrunk = model.report.adjustments.filter(adjustment => adjustment.reason === 'rest-clearance')
    expect(shrunk.length).toBeGreaterThan(0)
    expect(shrunk.every(adjustment => adjustment.bone === 'hips' && adjustment.scale < 1)).toBe(true)
    for (const side of SIDES) {
      expect(model.rest[side].abduct).toBeLessThanOrEqual(22 * DEG + 1e-9)
      expect(restDepth(source, model, side)).toBe(0)
    }
    expect([model.rest.left.limit?.kind, model.rest.right.limit?.kind]).toContain('volume')
  })

  it('names a limiting volume the solve dropped by no index, and keeps it in the adjustments', () => {
    const mesh = bareBody()
    // A rigid hoop at the height of the wrists, inside one slice, so wide and so deep that it is dropped: no rest clears
    // the 0.3 of its size that a volume keeps at the least.
    mesh.tube('hips', 9.9, 10, [15, 3])
    const model = buildBodyModel(mesh.build())

    // The solve scans the left arm first, so the hoop is gone by the time it scans the right one.
    expect(model.rest.left.limit).toEqual({ kind: 'volume', index: null })
    expect(model.report.adjustments).toContainEqual({ volume: -1, bone: 'hips', scale: 0, reason: 'rest-clearance' })
  })

  it('builds the same model from the same source', () => {
    const build = () => buildBodyModel(skirted(3.6, 3).mesh.build())
    expect(build()).toEqual(build())
  })
})
