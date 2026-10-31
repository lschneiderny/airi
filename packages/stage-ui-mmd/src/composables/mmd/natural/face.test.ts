import { MMDToonMaterial } from '@moeru/three-mmd/materials/toon'
import { describe, expect, it } from 'vitest'

import { createModel } from '../__fixtures__/model'
import { createMorphController } from '../morph'
import { descriptor } from '../morph-runtime/fixtures'
import { createMMDMorphRuntime } from '../morph-runtime/index'
import { applyNaturalFace } from './face'

function fixture() {
  const mmd = createModel()
  const names = ['困る左', '困る右', '真面目', '怒り', 'まばたき', '笑い', 'あ', 'い', 'う']
  mmd.pmx = {
    ...mmd.pmx,
    morphs: names.map(name => ({
      name,
      englishName: '',
      category: name === 'まばたき' ? 2 : 3,
      type: 1,
      indices: new Int32Array(),
      positions: new Float32Array(),
    })),
  }
  mmd.mesh.material = new MMDToonMaterial(descriptor())
  mmd.mesh.morphTargetDictionary = Object.fromEntries(names.map((name, i) => [name, i]))
  mmd.mesh.morphTargetInfluences = names.map(() => 0)
  const runtime = createMMDMorphRuntime(mmd)
  const read = (name: string) => mmd.mesh.morphTargetInfluences?.[names.indexOf(name)]
  return { mmd, runtime, read }
}

const frame = {
  pose: { headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0, eyeX: 0, eyeY: 0 },
  fixation: { x: 0, y: 0 },
  face: { eyeOpenMultiplier: 0.8, eyeOpenHint: 0, browY: 0, browAngle: 0, browLY: -0.3, browRY: -0.1, browLAngle: -0.2, browRAngle: 0, eyeSmile: 0.2, mouthForm: 0.1, silentMouthOpen: 0.15, cheek: 0 },
  blink: { blinkFactor: 1 },
  breath: { value: 0.45, headY: 0 },
}

describe('natural MMD face layers', () => {
  it('maps asymmetric brows, partial lids and smile without a clip masking the face', () => {
    const { mmd, runtime, read } = fixture()
    applyNaturalFace(runtime, frame)
    runtime.applySurfaceStage()
    expect(read('困る左')).toBeCloseTo(0.3)
    expect(read('困る右')).toBeCloseTo(0.1)
    expect(read('怒り')).toBeCloseTo(0.2)
    expect(read('まばたき')).toBeCloseTo(0.2)
    expect(read('笑い')).toBeCloseTo(0.3)
    expect(read('あ')).toBeCloseTo(0.15)
    mmd.dispose()
  })

  it('keeps blink separate from face and lets lip sync replace the Natural vowel', () => {
    const { mmd, runtime, read } = fixture()
    applyNaturalFace(runtime, { ...frame, blink: { blinkFactor: 0 } })
    const lips = createMorphController(mmd.mesh, {}, (name, weight) => runtime.setChannel('lipSync', name, weight))
    lips.set('vowelA', 0.8)
    runtime.applySurfaceStage()
    expect(read('まばたき')).toBe(1)
    expect(read('あ')).toBe(0.8)
    expect(lips.get('vowelA')).toBe(0.8)
    // A channel writer never contaminates the next clip snapshot.
    lips.set('vowelA', 0.4)
    expect(read('あ')).toBe(0.8)
    runtime.setComposition({ speakEnv: 0 })
    applyNaturalFace(runtime, frame)
    mmd.mesh.morphTargetInfluences?.fill(0)
    runtime.applySurfaceStage()
    expect(read('まばたき')).toBeCloseTo(0.2)
    expect(read('あ')).toBeCloseTo(0.15)
    mmd.dispose()
  })

  it('honors a model slot override instead of the default Natural brow candidate', () => {
    const { mmd, runtime, read } = fixture()
    applyNaturalFace(runtime, frame, { browTroubledLeft: '困る右' })
    runtime.applySurfaceStage()
    expect(read('困る左')).toBe(0)
    expect(read('困る右')).toBeCloseTo(0.3)
    mmd.dispose()
  })
})
