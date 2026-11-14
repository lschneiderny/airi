import { describe, expect, it } from 'vitest'

import { resolvePerfDirectoryOverride, resolvePerfRecording } from './mode'

describe('resolvePerfRecording', () => {
  it('records by default in a development build', () => {
    expect(resolvePerfRecording({ dev: true, packaged: false, env: {}, stored: undefined }))
      .toEqual({ buildMode: 'dev', enabled: true, source: 'default' })
  })

  it('keeps recording off by default in a preview or packaged build', () => {
    expect(resolvePerfRecording({ dev: false, packaged: false, env: {}, stored: undefined }))
      .toEqual({ buildMode: 'preview', enabled: false, source: 'default' })
    expect(resolvePerfRecording({ dev: false, packaged: true, env: {}, stored: undefined }))
      .toEqual({ buildMode: 'packaged', enabled: false, source: 'default' })
  })

  it('lets the stored toggle beat the default in either direction', () => {
    expect(resolvePerfRecording({ dev: true, packaged: false, env: {}, stored: false }))
      .toEqual({ buildMode: 'dev', enabled: false, source: 'toggle' })
    expect(resolvePerfRecording({ dev: false, packaged: true, env: {}, stored: true }))
      .toEqual({ buildMode: 'packaged', enabled: true, source: 'toggle' })
  })

  it('lets AIRI_PERF_RECORD beat the stored toggle in a development build', () => {
    expect(resolvePerfRecording({ dev: true, packaged: false, env: { AIRI_PERF_RECORD: '0' }, stored: true }))
      .toEqual({ buildMode: 'dev', enabled: false, source: 'env' })
    expect(resolvePerfRecording({ dev: true, packaged: false, env: { AIRI_PERF_RECORD: '1' }, stored: false }))
      .toEqual({ buildMode: 'dev', enabled: true, source: 'env' })
  })

  it('ignores AIRI_PERF_RECORD outside a development build', () => {
    expect(resolvePerfRecording({ dev: false, packaged: true, env: { AIRI_PERF_RECORD: '1' }, stored: undefined }))
      .toEqual({ buildMode: 'packaged', enabled: false, source: 'default' })
    expect(resolvePerfRecording({ dev: false, packaged: false, env: { AIRI_PERF_RECORD: '0' }, stored: true }))
      .toEqual({ buildMode: 'preview', enabled: true, source: 'toggle' })
  })

  it('ignores an AIRI_PERF_RECORD value that is not 0 or 1', () => {
    expect(resolvePerfRecording({ dev: true, packaged: false, env: { AIRI_PERF_RECORD: 'yes' }, stored: false }))
      .toEqual({ buildMode: 'dev', enabled: false, source: 'toggle' })
  })
})

describe('resolvePerfDirectoryOverride', () => {
  it('honors AIRI_PERF_DIR in a development build only', () => {
    expect(resolvePerfDirectoryOverride(true, { AIRI_PERF_DIR: '/tmp/perf' })).toBe('/tmp/perf')
    expect(resolvePerfDirectoryOverride(false, { AIRI_PERF_DIR: '/tmp/perf' })).toBeNull()
  })

  it('treats an unset or empty AIRI_PERF_DIR as no override', () => {
    expect(resolvePerfDirectoryOverride(true, {})).toBeNull()
    expect(resolvePerfDirectoryOverride(true, { AIRI_PERF_DIR: '' })).toBeNull()
  })
})
