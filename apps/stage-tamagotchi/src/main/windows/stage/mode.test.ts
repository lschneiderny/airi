import { describe, expect, it } from 'vitest'

import { selectHostMode } from './mode'

const desktopMmd = { experimental: true, mode: 'desktop', activeRenderer: 'mmd' } as const

describe('selectHostMode', () => {
  it('uses the saved mode for an MMD model', () => {
    expect(selectHostMode(desktopMmd, 'darwin', {})).toBe('desktop')
    expect(selectHostMode({ ...desktopMmd, mode: 'window' }, 'win32', {})).toBe('window')
  })

  it('keeps the classic window while the Experimental 3D stage setting is off, even for a saved desktop mode', () => {
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'darwin', {})).toBe('window')
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'win32', {})).toBe('window')
  })

  it('lets AIRI_STAGE_HOST override the setting, the platform, the renderer and the saved mode', () => {
    expect(selectHostMode({ experimental: false, mode: 'window', activeRenderer: 'other' }, 'linux', { AIRI_STAGE_HOST: 'desktop' })).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'win32', { AIRI_STAGE_HOST: 'window' })).toBe('window')
  })

  it('ignores an AIRI_STAGE_HOST value that is not a mode', () => {
    expect(selectHostMode(desktopMmd, 'darwin', { AIRI_STAGE_HOST: 'stage' })).toBe('desktop')
  })

  it('keeps the classic window on Linux', () => {
    expect(selectHostMode(desktopMmd, 'linux', {})).toBe('window')
  })

  it('keeps the classic window for a model that is not MMD or was never reported', () => {
    expect(selectHostMode({ ...desktopMmd, activeRenderer: 'other' }, 'win32', {})).toBe('window')
    expect(selectHostMode({ ...desktopMmd, activeRenderer: null }, 'darwin', {})).toBe('window')
  })
})
