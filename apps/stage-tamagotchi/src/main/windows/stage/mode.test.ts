import { describe, expect, it } from 'vitest'

import { selectHostMode } from './mode'

const dev = { development: true }
const production = { development: false }
const desktopMmd = { experimental: true, mode: 'desktop', activeRenderer: 'mmd' } as const

describe('selectHostMode', () => {
  it('uses the saved mode for an MMD model', () => {
    expect(selectHostMode(desktopMmd, 'darwin', {}, dev)).toBe('desktop')
    expect(selectHostMode({ ...desktopMmd, mode: 'window' }, 'win32', {}, dev)).toBe('window')
  })

  it('keeps the classic window while the Experimental 3D stage setting is off, even for a saved desktop mode', () => {
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'darwin', {}, dev)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'win32', {}, dev)).toBe('window')
  })

  it('lets AIRI_STAGE_HOST override, in a development build, the setting, the platform, the renderer and the saved mode', () => {
    expect(selectHostMode({ experimental: false, mode: 'window', activeRenderer: 'other' }, 'linux', { AIRI_STAGE_HOST: 'desktop' }, dev)).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'win32', { AIRI_STAGE_HOST: 'window' }, dev)).toBe('window')
  })

  it('ignores AIRI_STAGE_HOST in a production build, which obeys the setting', () => {
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'darwin', { AIRI_STAGE_HOST: 'desktop' }, production)).toBe('window')
    expect(selectHostMode(desktopMmd, 'win32', { AIRI_STAGE_HOST: 'window' }, production)).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'win32', {}, production)).toBe('desktop')
  })

  it('ignores an AIRI_STAGE_HOST value that is not a mode', () => {
    expect(selectHostMode(desktopMmd, 'darwin', { AIRI_STAGE_HOST: 'stage' }, dev)).toBe('desktop')
  })

  it('keeps the classic window on Linux', () => {
    expect(selectHostMode(desktopMmd, 'linux', {}, dev)).toBe('window')
  })

  it('keeps the classic window for a model that is not MMD or was never reported', () => {
    expect(selectHostMode({ ...desktopMmd, activeRenderer: 'other' }, 'win32', {}, dev)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, activeRenderer: null }, 'darwin', {}, dev)).toBe('window')
  })
})
