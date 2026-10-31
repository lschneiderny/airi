import type { StageDisplayInfo } from '../../../shared/eventa'
import type { StageConfig } from './config'

import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { buildStageHostState, defaultStageConfig, resolveHome, resolveHomeDisplay, stageConfigSchema, withStageHome } from './config'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/airi-test' } }))

function display(id: string, workArea: StageDisplayInfo['workArea'], options: { primary?: boolean, scaleFactor?: number } = {}): StageDisplayInfo {
  return {
    id,
    bounds: { ...workArea, y: workArea.y - 25, height: workArea.height + 25 },
    workArea,
    scaleFactor: options.scaleFactor ?? 2,
    primary: options.primary ?? false,
  }
}

const builtIn = display('1', { x: 0, y: 25, width: 1440, height: 875 }, { primary: true })
const external = display('7', { x: 1440, y: 0, width: 2560, height: 1415 }, { scaleFactor: 1 })

function config(patch: Partial<StageConfig>): StageConfig {
  return { ...defaultStageConfig, ...patch }
}

describe('stageConfigSchema', () => {
  it('fills every default from an empty file', () => {
    expect(parse(stageConfigSchema, {})).toEqual({ mode: 'window', activeRenderer: null, homeDisplayId: null, homes: {} })
  })

  it('rejects an unknown mode', () => {
    expect(() => parse(stageConfigSchema, { mode: 'fullscreen' })).toThrow()
  })
})

describe('resolveHomeDisplay', () => {
  it('uses the primary display on a fresh config', () => {
    expect(resolveHomeDisplay([external, builtIn], defaultStageConfig).id).toBe('1')
  })

  it('uses the saved display when it is connected', () => {
    expect(resolveHomeDisplay([builtIn, external], config({ homeDisplayId: '7' })).id).toBe('7')
  })

  it('finds a reconnected display with a new id by its saved fingerprint', () => {
    const reconnected = { ...external, id: '9' }
    const saved = config({
      homeDisplayId: '7',
      homes: { 7: { xDip: 300, fingerprint: { width: 2560, height: 1415, scaleFactor: 1 } } },
    })

    expect(resolveHomeDisplay([builtIn, reconnected], saved).id).toBe('9')
  })

  it('falls back to the primary display when the saved display was removed', () => {
    expect(resolveHomeDisplay([builtIn], config({ homeDisplayId: '7' })).id).toBe('1')
  })
})

describe('resolveHome', () => {
  it('returns the saved x when the display still has the saved size and scale', () => {
    const saved = config({ homes: { 1: { xDip: 1100, fingerprint: { width: 1440, height: 875, scaleFactor: 2 } } } })

    expect(resolveHome(builtIn, saved)).toEqual({ xDip: 1100 })
  })

  it('returns null so the renderer computes the default home when nothing is saved', () => {
    expect(resolveHome(builtIn, defaultStageConfig)).toBeNull()
  })

  it('returns null when the display changed size or scale since the home was saved', () => {
    const saved = config({ homes: { 1: { xDip: 1100, fingerprint: { width: 1440, height: 875, scaleFactor: 1 } } } })

    expect(resolveHome(builtIn, saved)).toBeNull()
  })
})

describe('buildStageHostState', () => {
  it('reports the resolved home display and null homes on a fresh config', () => {
    const state = buildStageHostState({ config: defaultStageConfig, displays: [builtIn, external], running: 'desktop' })

    expect(state).toEqual({
      mode: 'window',
      activeRenderer: null,
      displays: [builtIn, external],
      homeDisplayId: '1',
      homes: { 1: null, 7: null },
      running: 'desktop',
    })
  })
})

describe('withStageHome', () => {
  it('saves the home with the display fingerprint', () => {
    const next = withStageHome(defaultStageConfig, [builtIn], { displayId: '1', xDip: 1180 })

    expect(next.homes).toEqual({ 1: { xDip: 1180, fingerprint: { width: 1440, height: 875, scaleFactor: 2 } } })
  })

  it('rejects a display that is not connected and leaves the config unchanged', () => {
    const before = structuredClone(defaultStageConfig)

    expect(() => withStageHome(defaultStageConfig, [builtIn], { displayId: '42', xDip: 100 })).toThrow('display "42" is not connected')
    expect(defaultStageConfig).toEqual(before)
  })

  it('rejects an x that is not finite', () => {
    expect(() => withStageHome(defaultStageConfig, [builtIn], { displayId: '1', xDip: Number.NaN })).toThrow(TypeError)
  })
})
