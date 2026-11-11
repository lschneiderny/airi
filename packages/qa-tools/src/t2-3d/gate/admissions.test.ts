import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseManifest } from '../reference/manifest'
import { buildReference } from './reference'

function bodyClip(lying: boolean): string {
  const arm = (side: string, sign: number) => `JOINT ${side}Shoulder { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Arm { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}ForeArm { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Hand { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation } } } }`
  const leg = (side: string, sign: number) => `JOINT ${side}UpLeg { OFFSET ${sign} 0 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Leg { OFFSET 0 -1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}Foot { OFFSET 0 -1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT ${side}ToeBase { OFFSET 0 0 1 CHANNELS 3 Zrotation Yrotation Xrotation } } } }`
  const hierarchy = `HIERARCHY ROOT Hips { OFFSET 0 0 0 CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
JOINT Spine { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Spine1 { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Neck1 { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation
JOINT Head { OFFSET 0 1 0 CHANNELS 3 Zrotation Yrotation Xrotation } }
${arm('Left', 1)} ${arm('Right', -1)} } }
${leg('Left', 1)} ${leg('Right', -1)} }`
  const jointCount = 1 + (hierarchy.match(/JOINT/g)?.length ?? 0)
  const values = Array.from<number>({ length: 3 + jointCount * 3 }).fill(0)
  const rest = values.join(' ')
  values[5] = lying ? 90 : 0
  return `${hierarchy}\nMOTION\nFrames: 1441\nFrame Time: 0.0083333\n${rest}\n${Array.from<string>({ length: 1440 }).fill(values.join(' ')).join('\n')}\n`
}

describe('fixed reference source admission', () => {
  it('retains a refused fitting entry as evidence and ingests the next fixed entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motion3d-admissions-'))
    const manifest = parseManifest({
      datasets: [{ id: 'analytic', licence: 'synthetic', url: 'https://example.test/' }],
      clips: ['lying', 'upright'].map(name => ({ file: `${name}.bvh`, dataset: 'analytic', class: 'idle', profile: 'cmu', split: 'fit', subject: name, role: 'window' })),
    })
    try {
      await writeFile(join(directory, 'lying.bvh'), bodyClip(true))
      await writeFile(join(directory, 'upright.bvh'), bodyClip(false))
      const bands = await buildReference({ directory, manifest, gitSha: 'analytic', signal: new AbortController().signal })
      expect(bands.datasets[0].clips).toBe(2)
      expect(bands.context.admission).toMatchObject({
        fixed: 2,
        admitted: 1,
        refusals: [{ name: 'non-upright', class: 'idle', split: 'fit', subject: 'lying' }],
      })
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('prevents fitting when a required held-out source cannot be judged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motion3d-heldout-admission-'))
    const manifest = parseManifest({
      datasets: [{ id: 'analytic', licence: 'synthetic', url: 'https://example.test/' }],
      clips: [{ file: 'lying.bvh', dataset: 'analytic', class: 'idle', profile: 'cmu', split: 'holdout', subject: 'lying', role: 'window' }],
    })
    try {
      await writeFile(join(directory, 'lying.bvh'), bodyClip(true))
      await expect(buildReference({ directory, manifest, gitSha: 'analytic', signal: new AbortController().signal })).rejects.toMatchObject({ name: 'reference-holdout-refused' })
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
