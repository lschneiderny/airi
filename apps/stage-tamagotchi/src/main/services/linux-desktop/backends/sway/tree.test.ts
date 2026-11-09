import { describe, expect, it } from 'vitest'

import { readTree } from './tree'

const rect = { x: -100, y: 24, width: 800, height: 600 }
const window = {
  id: 42,
  name: 'airi-bind-1',
  type: 'con',
  pid: 123,
  focused: true,
  app_id: 'ai.moeru.airi',
  fullscreen_mode: 2,
  rect,
  nodes: [],
  floating_nodes: [],
}

describe('sway tree projection', () => {
  it('finds floating focused windows and own windows with inherited output scale', () => {
    const tree = {
      id: 1,
      type: 'root',
      rect,
      nodes: [{
        id: 2,
        type: 'output',
        rect,
        scale: 1.5,
        nodes: [],
        floating_nodes: [window, { ...window, id: 43, pid: 456, focused: false }],
      }],
    }
    expect(readTree(tree, [123])).toEqual({
      active: { caption: 'airi-bind-1', resourceClass: 'ai.moeru.airi', desktopFileName: 'ai.moeru.airi', pid: 123, fullScreen: true },
      ownWindows: [{ id: '42', caption: 'airi-bind-1', pid: 123, ...rect, keepAbove: false, outputScale: 1.5 }],
    })
  })

  it('uses XWayland class and ignores focused workspace containers', () => {
    expect(readTree({ ...window, app_id: null, window_properties: { class: 'Konsole' } }, []).active)
      .toEqual({ caption: 'airi-bind-1', resourceClass: 'Konsole', desktopFileName: '', pid: 123, fullScreen: true })
    expect(readTree({ id: 1, type: 'workspace', focused: true, rect }, []).active).toBeNull()
  })

  it.each([
    { ...window, pid: -1 },
    { ...window, rect: { ...rect, width: -1 } },
    { ...window, nodes: [null] },
  ])('rejects malformed node data', (tree) => {
    expect(() => readTree(tree, [])).toThrow('Invalid Sway IPC payload')
  })
})
