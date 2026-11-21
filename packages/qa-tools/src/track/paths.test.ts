import { describe, expect, it } from 'vitest'

import { scenariosForPaths, touchesRenderLoop } from './paths'

describe('render-loop paths', () => {
  it.each([
    ['packages/stage-ui-mmd/src/composables/mmd/gaze.ts', ['mmd-idle', 'mmd-talk']],
    ['packages/stage-ui-live2d/src/composables/live2d/live2d.ts', ['live2d-idle']],
    ['packages/motion-driver-natural/src/index.ts', ['mmd-idle', 'mmd-talk', 'live2d-idle']],
    ['packages/stage-ui/src/stores/chat.ts', []],
    ['packages/stage-ui-mmd/src/composables/mmd/gaze.test.ts', []],
  ])('maps %s to its bench scenarios', (path, expected) => {
    expect(scenariosForPaths([path])).toEqual(expected)
  })

  it('returns the union of every matched row in matrix order', () => {
    expect(scenariosForPaths(['packages/stage-ui-live2d/src/a.ts', 'packages/stage-ui-mmd/src/b.ts'])).toEqual(['mmd-idle', 'mmd-talk', 'live2d-idle'])
  })

  it('touches the render loop only through a non-test file on a listed path', () => {
    expect(touchesRenderLoop(['docs/readme.md', 'packages/stage-shared/src/perf/recorder.ts'])).toBe(true)
    expect(touchesRenderLoop(['packages/stage-shared/src/perf/recorder.browser.test.ts', 'packages/stage-shared/src/index.ts'])).toBe(false)
  })
})
