import { describe, expect, it } from 'vitest'

import { readOutputs, readTree } from './tree'

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

describe('sway outputs projection', () => {
  const output = { name: 'HEADLESS-1', active: true, rect: { x: 1920, y: 0, width: 1280, height: 720 }, scale: 1.5, make: 'headless', current_mode: { width: 1920, height: 1080 } }

  it('keeps active outputs in logical coordinates with their scale and skips disabled ones', () => {
    expect(readOutputs([output, { name: 'DP-2', active: false, rect: { x: 0, y: 0, width: 0, height: 0 }, scale: -1 }]))
      .toEqual([{ name: 'HEADLESS-1', x: 1920, y: 0, width: 1280, height: 720, scale: 1.5 }])
  })

  it.each([
    { reply: { name: 'HEADLESS-1' } },
    { reply: [{ ...output, rect: 'private' }] },
    { reply: [{ ...output, rect: { ...output.rect, width: 0 } }] },
    { reply: [{ ...output, scale: 0 }] },
    { reply: [{ ...output, name: 'x'.repeat(257) }] },
    { reply: Array.from({ length: 17 }, (_, index) => ({ ...output, name: `HEADLESS-${index}` })) },
  ])('rejects a malformed reply %#', ({ reply }) => {
    expect(() => readOutputs(reply)).toThrow('Invalid Sway IPC payload')
  })
})
