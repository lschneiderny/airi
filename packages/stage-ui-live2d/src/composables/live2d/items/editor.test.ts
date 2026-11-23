import { describe, expect, it } from 'vitest'

import { drawablesOf, partTreeOf, readPartDisplayNames, viewItemEditor } from './editor'

describe('readPartDisplayNames', () => {
  it('reads cdi3 part names and skips malformed records', () => {
    const names = readPartDisplayNames({ Parts: [{ Id: 'PartHair', Name: 'Hair' }, { Id: 42, Name: 'Bad' }, { Id: 'PartBody' }, null] })
    expect([...names]).toEqual([['PartHair', 'Hair']])
  })

  it('returns no names for a model without display info', () => {
    expect(readPartDisplayNames(undefined).size).toBe(0)
    expect(readPartDisplayNames({ Parameters: [] }).size).toBe(0)
  })
})

describe('partTreeOf', () => {
  it('lists parts depth first under their parents, roots in model order, with display names', () => {
    const ids = ['Body', 'Head', 'Hair', 'HairFront', 'Arm']
    const parents = [-1, 0, 1, 2, 0]
    const tree = partTreeOf(ids, parents, new Map([['Head', 'Her head']]))
    expect(tree).toEqual([
      { id: 'Body', name: 'Body', parentId: null, depth: 0 },
      { id: 'Head', name: 'Her head', parentId: 'Body', depth: 1 },
      { id: 'Hair', name: 'Hair', parentId: 'Head', depth: 2 },
      { id: 'HairFront', name: 'HairFront', parentId: 'Hair', depth: 3 },
      { id: 'Arm', name: 'Arm', parentId: 'Body', depth: 1 },
    ])
  })

  it('lists every part once when the parent table is out of range or cyclic', () => {
    const tree = partTreeOf(['A', 'B', 'C'], [1, 0, 7], new Map())
    expect(tree.map(part => part.id).sort()).toEqual(['A', 'B', 'C'])
    expect(tree).toHaveLength(3)
    expect(tree.find(part => part.id === 'C')).toMatchObject({ parentId: null, depth: 0 })
  })
})

describe('drawablesOf', () => {
  it('pairs each drawable with its owning part and leaves orphans without one', () => {
    expect(drawablesOf(['D0', 'D1', 'D2'], [1, -1, 5], ['P0', 'P1'])).toEqual([
      { id: 'D0', partId: 'P1' },
      { id: 'D1', partId: null },
      { id: 'D2', partId: null },
    ])
  })

  it('leaves every drawable without a part on a core without the parent table', () => {
    expect(drawablesOf(['D0'], [], ['P0'])).toEqual([{ id: 'D0', partId: null }])
  })
})

describe('viewItemEditor', () => {
  it('maps canvas units through renderer pixels to CSS pixels and back by the backing ratio', () => {
    const editor = viewItemEditor({
      canvas: { width: 100, height: 100 },
      parts: [],
      drawables: [],
      pickPin: () => undefined,
      poseOf: () => undefined,
      canvasToGlobal: point => ({ x: point.x * 3, y: point.y * 3 }),
      globalToCanvas: point => ({ x: point.x / 3, y: point.y / 3 }),
    }, () => 2)
    expect(editor.canvasToView({ x: 10, y: 20 })).toEqual({ x: 15, y: 30 })
    expect(editor.viewToCanvas({ x: 15, y: 30 })).toEqual({ x: 10, y: 20 })
    expect(editor.canvas).toEqual({ width: 100, height: 100 })
  })
})
