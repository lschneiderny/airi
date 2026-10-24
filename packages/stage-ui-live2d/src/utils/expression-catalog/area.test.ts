import { describe, expect, it } from 'vitest'

import { faceRegions, suggestArea } from './area'

describe('expression areas', () => {
  it.each([
    ['expression19', 'Param82', '口罩', []],
    ['Bowtie', '换领结', '', []],
    ['Bloodstain', '血迹', '', []],
    ['Angry', 'Param60', '生气按键', []],
    ['Puff Cheeks', 'cheekpuff', '鼓脸', ['cheeks']],
    ['Hearts 1', '心心眼', '', ['eyes']],
    ['Flat Mouth', '贱兮兮', '', ['mouth']],
    ['Drum mouth', '[Drum mouth]鼓嘴→', '', ['mouth']],
    ['plain', 'ParamEyeBallX', '', ['eyes']],
    ['plain', 'param_mouth_open', '', ['mouth']],
    ['plain', 'switch', '汗眼', []],
    ['plain', 'switch', '面罩口', []],
    ['plain', 'switch', '鼓腮嘴', ['cheeks']],
    ['plain', 'switch', '嘴眼', ['mouth']],
    ['plain', 'switch', 'eyeliner', []],
  ])('finds first parameter regions for %s / %s / %s', (label, id, name, expected) => {
    expect([...faceRegions([id], label, new Map([[id, name]]))]).toEqual(expected)
  })

  it('uses labels only when no parameter has a face region', () => {
    expect([...faceRegions(['ParamMouthForm'], 'Blush')]).toEqual(['mouth'])
    expect([...faceRegions(['switch'], 'Blush')]).toEqual(['cheeks'])
    expect([...faceRegions(['ParamEyeOpen', 'ParamMouthForm'], 'Blush')]).toEqual(['eyes', 'mouth'])
    expect(suggestArea('face', ['switch'], 'Eyes and Mouth')).toBe('whole-look')
  })

  it.each([
    ['system', 'hidden'],
    ['prop', 'props'],
    ['outfit', 'outfit-hair'],
    ['effect', 'effects'],
    ['face', 'whole-look'],
    ['unsorted', 'whole-look'],
  ] as const)('gives kind %s area %s', (kind, expected) => {
    expect(suggestArea(kind, ['ParamEyeOpen', 'ParamMouthForm'], 'plain')).toBe(expected)
  })

  it('distinguishes whole looks, details and unknown labels', () => {
    expect(suggestArea('face', ['switch'], 'Angry')).toBe('whole-look')
    expect(suggestArea('face', ['switch'], 'Flat Mouth')).toBe('mouth')
    expect(suggestArea('unsorted', ['switch'], 'plain')).toBe('hidden')
  })
})
