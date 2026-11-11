import process from 'node:process'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Quaternion } from 'three'
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import { describe, expect, it } from 'vitest'

import { parseTrace } from '../read-trace'
import { parseBvh, readBvh } from './bvh'
import { convertBvh, ingestClip } from './ingest'
import { listClips, parseManifest, readManifest } from './manifest'
import { resolveSkeleton } from './skeletons'
import { inspectSource } from './test-helpers'

const tiny = `HIERARCHY
ROOT Root {
OFFSET 0 0 0
CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
JOINT Mid {
OFFSET 0 1 0
CHANNELS 3 Xrotation Zrotation Yrotation
JOINT Tip {
OFFSET 0 1 0
CHANNELS 3 Yrotation Xrotation Zrotation
End Site { OFFSET 0 1 0 }
} } }
MOTION
Frames: 1
Frame Time: 0.016667
1 2 3 90 90 0 90 90 0 0 90 0
`

// A compact full CMU body, including the helper joints that must fold in.
function cmuFixture() {
  const arm = (side: string, sign: number) => `JOINT ${side}Shoulder { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Arm { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}ForeArm { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Hand { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation } } } }`
  const leg = (side: string, sign: number) => `JOINT ${side}UpLeg { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Leg { OFFSET 0 -2 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Foot { OFFSET 0 -2 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}ToeBase { OFFSET 0 0 1 CHANNELS 3 Zrotation Yrotation Xrotation } } } }`
  const hierarchy = `HIERARCHY ROOT Hips { OFFSET 0 0 0 CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
JOINT LowerBack { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Spine { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Spine1 { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Neck { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Neck1 { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Head { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation } } }
${arm('Left', 1)} ${arm('Right', -1)} } } }
${leg('Left', 1)} ${leg('Right', -1)} }`
  const jointCount = 1 + (hierarchy.match(/JOINT/g)?.length ?? 0)
  const row = (x: number, degrees: number) => [x, 10, 0, degrees, 0, 0, ...Array.from({ length: (jointCount - 1) * 3 }).fill(0)].join(' ')
  return `${hierarchy}\nMOTION\nFrames: 5\nFrame Time: 0.0083333\n${[row(100, 160), row(2, 0), row(6, 60), row(10, 120), row(14, 180)].join('\n')}\n`
}

function convert(text = cmuFixture()) {
  return convertBvh(parseBvh(text), {
    id: 'synthetic-cmu',
    profile: 'cmu',
    class: 'talk',
    assetSha256: 'a'.repeat(64),
  })
}

describe('reference ingestion', () => {
  it('preserves channel order and reconstructs known world orientations', () => {
    const clip = parseBvh(tiny)
    const worlds: Quaternion[] = []
    for (let i = 0; i < clip.names.length; i++) {
      const local = new Quaternion(...clip.rotations[0][i])
      worlds.push(clip.parents[i] < 0 ? local : worlds[clip.parents[i]].clone().multiply(local))
    }
    expect(clip.frameTime).toBe(0.016667)
    expect(clip.channels[1]).toEqual(['Xrotation', 'Zrotation', 'Yrotation'])
    expect(clip.rootPositions[0]).toEqual([1, 2, 3])
    expect(worlds[0].toArray()).toEqual([
      expect.closeTo(-0.5, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
    ])
    expect(worlds[1].toArray()).toEqual([
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.5, 12),
    ])
    // Rz(90) Ry(90) Rx(90) Rz(90) Rx(90), computed analytically.
    const expected = new Quaternion(Math.SQRT1_2, Math.SQRT1_2, 0, 0)
    expect(Math.abs(worlds[2].dot(expected))).toBeCloseTo(1, 12)
  })

  it('drops only the added CMU T pose without a fixed trim', () => {
    const result = parseTrace(convert(cmuFixture().replace('0.0083333', String(1 / 60))))
    expect(result.trace.frames).toBe(4)
    expect([...result.root].filter((_, index) => index % 4 === 0)).toEqual([2, 6, 10, 14])
  })

  it('averages consecutive 120 Hz positions and rotations into 60 Hz samples', () => {
    const result = parseTrace(convert())
    expect(result.trace.hz).toBe(60)
    expect(result.trace.frames).toBe(2)
    expect([...result.root]).toEqual([4, 10, 0, 0, 12, 10, 0, 0])
    expect(result.channels[9]).toBeCloseTo(1 / 60, 7)
    expect(result.rot[2]).toBeCloseTo(Math.sin(Math.PI / 12), 6)
    expect(result.rot[3]).toBeCloseTo(Math.cos(Math.PI / 12), 6)
    expect(result.rot[result.trace.rig.bones.length * 4 + 2]).toBeCloseTo(Math.sin(5 * Math.PI / 12), 6)
    expect(result.trace.rig.legLength).toBe(4)
  })

  it('derives the trace basis from the rest pose on a permuted source rig', () => {
    const clip = parseBvh(cmuFixture())
    const permuted = {
      ...clip,
      offsets: clip.offsets.map(([x, y, z]) => [z, x, y] satisfies [number, number, number]),
      rootPositions: clip.rootPositions.map(([x, y, z]) => [z, x, y] satisfies [number, number, number]),
      rotations: clip.rotations.map(frame => frame.map(([x, y, z, w]) => [z, x, y, w] satisfies [number, number, number, number])),
    }
    const result = parseTrace(convertBvh(permuted, { id: 'permuted', profile: 'cmu', class: 'talk', assetSha256: 'a'.repeat(64) }))
    const expected = parseTrace(convert())
    for (let i = 0; i < result.root.length; i++)
      expect(result.root[i]).toBeCloseTo(expected.root[i], 6)
    for (let i = 0; i < result.rot.length; i++)
      expect(result.rot[i]).toBeCloseTo(expected.rot[i], 6)
  })

  it('aligns quaternion hemispheres before averaging and across output frames', () => {
    const clip = parseBvh(cmuFixture())
    const flipped = {
      ...clip,
      rotations: clip.rotations.map((frame, index) => frame.map(([x, y, z, w]) =>
        (index % 2 ? [-x, -y, -z, -w] : [x, y, z, w]) satisfies [number, number, number, number])),
    }
    const result = parseTrace(convertBvh(flipped, { id: 'flipped', profile: 'cmu', class: 'talk', assetSha256: 'a'.repeat(64) }))
    const expected = parseTrace(convert())
    for (let i = 0; i < result.rot.length; i++)
      expect(result.rot[i]).toBeCloseTo(expected.rot[i], 6)
  })

  it('refuses a required bone by its source name', () => {
    expect(() => convert(cmuFixture().replace('JOINT Head', 'JOINT Other'))).toThrow(
      expect.objectContaining({ name: 'reference-missing-bone', detail: expect.stringContaining('Head') }),
    )
  })

  it('refuses a rest pose whose head is not upright above its feet', () => {
    const clip = parseBvh(cmuFixture())
    const head = clip.names.indexOf('Head')
    const fallen = { ...clip, offsets: clip.offsets.map((offset, index) => index === head ? [0, -20, 0] satisfies [number, number, number] : offset) }
    expect(() => resolveSkeleton(fallen, 'cmu')).toThrow(expect.objectContaining({ name: 'reference-rest-pose' }))
  })

  it('reads a BVH file through the Node boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reference-bvh-'))
    try {
      await writeFile(join(dir, 'tiny.bvh'), tiny)
      expect((await readBvh(join(dir, 'tiny.bvh'))).names).toEqual(['Root', 'Mid', 'Tip'])
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires a split and lists clips by class and split', () => {
    const clip = { file: 'test.bvh', dataset: 'cmu', class: 'talk', profile: 'cmu', subject: '18', role: 'window' }
    const datasets = [{ id: 'cmu', licence: 'test', url: 'https://example.com' }]
    expect(() => parseManifest({ datasets, clips: [clip] })).toThrow(expect.objectContaining({ name: 'reference-manifest' }))
    const manifest = parseManifest({ datasets, clips: [{ ...clip, split: 'fit' }, { ...clip, file: 'hold.bvh', split: 'holdout' }] })
    expect(listClips(manifest, 'talk', 'fit').map(c => c.file)).toEqual(['test.bvh'])
  })
})

const mocapDir = process.env.AIRI_QA_MOCAP_DIR
if (mocapDir) {
  it('preserves real channel metadata and exact header time lost by BVHLoader', async () => {
    for (const file of ['cmu/018/18_08.bvh', '100style/100STYLE/Neutral/Neutral_ID.bvh']) {
      const text = await readFile(join(mocapDir, file), 'utf8')
      const oracle = inspectSource(text)
      const parsed = parseBvh(text)
      const loaded = new BVHLoader().parse(text)
      expect(parsed.frameTime).toBe(oracle.frameTime)
      expect(parsed.channels).toEqual(oracle.channels)
      expect(parsed.names).toEqual(oracle.names)
      expect(parsed.parents).toEqual(oracle.parents)
      expect(parsed.offsets).toEqual(oracle.offsets)
      expect(parsed.rotations).toHaveLength(oracle.frames)
      expect(loaded.clip.tracks[0].times[1]).not.toBe(oracle.frameTime)
      expect(Object.hasOwn(loaded.skeleton.bones[0], 'channels')).toBe(false)
      for (let frame = 0; frame < oracle.rotations.length; frame++) {
        for (let joint = 0; joint < oracle.names.length; joint++) {
          const q = new Quaternion(...parsed.rotations[frame][joint])
          expect(Math.abs(q.dot(new Quaternion(...oracle.rotations[frame][joint])))).toBeCloseTo(1, 12)
        }
      }
    }
  })

  it('ingests real CMU and 100STYLE clips through the shared trace reader', async () => {
    const manifest = await readManifest(join(mocapDir, 'clips.json'))
    for (const profile of ['cmu', '100style'] as const) {
      const clip = manifest.clips.find(c => c.profile === profile)
      if (!clip)
        throw new Error(`Missing real ${profile} fixture`)
      const result = parseTrace(await ingestClip(mocapDir, clip))
      expect(result.trace.source.level).toBe('reference')
      expect(result.trace.rig.assetSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(result.trace.rig.bones).toContain('head')
    }
  })
}
