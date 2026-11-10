import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parsePressureThresholds, readCpuPressure } from '../src/pressure'

let root: string
let path: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-pressure-'))
  path = join(root, 'cpu.psi')
  vi.stubEnv('AIRI_CPU_PRESSURE_FILE', path)
  vi.stubEnv('AIRI_CPU_PRESSURE_IDLE', undefined)
  vi.stubEnv('AIRI_CPU_PRESSURE_HOLD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('readCpuPressure', () => {
  it.each([0, 5, 11.13, 70, 100])('reads some avg10=%s independently of full pressure', (value) => {
    writeFileSync(path, `some avg10=${value} avg60=8.20 avg300=3.09 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`)
    expect(readCpuPressure()).toEqual({ someAvg10: value })
  })

  it('uses an explicit path instead of the environment override', () => {
    const other = join(root, 'other.psi')
    writeFileSync(path, 'some avg10=90.00 avg60=0.00 avg300=0.00 total=1\n')
    writeFileSync(other, 'some avg10=5.00 avg60=0.00 avg300=0.00 total=1\n')
    expect(readCpuPressure(other)).toEqual({ someAvg10: 5 })
  })

  it('returns no reading for a missing file', () => {
    expect(readCpuPressure()).toBeUndefined()
  })

  it.each([
    '',
    'garbage',
    'full avg10=5.00 avg60=5.00 avg300=5.00 total=1',
    'some avg10=NaN avg60=5.00 avg300=5.00 total=1',
    'some avg10=Infinity avg60=5.00 avg300=5.00 total=1',
    'some avg10=-1 avg60=5.00 avg300=5.00 total=1',
    'some avg10=101 avg60=5.00 avg300=5.00 total=1',
    'some avg10=5oops avg60=5.00 avg300=5.00 total=1',
    'some avg10=',
  ])('returns no reading for malformed PSI %j', (text) => {
    writeFileSync(path, text)
    expect(readCpuPressure()).toBeUndefined()
  })
})

describe('parsePressureThresholds', () => {
  it('defaults to idle below twenty and hold at seventy', () => {
    expect(parsePressureThresholds()).toEqual({ idle: 20, hold: 70 })
  })

  it.each(['0', '35', '100'])('accepts integer percentage %s for either threshold', (value) => {
    vi.stubEnv('AIRI_CPU_PRESSURE_IDLE', value)
    vi.stubEnv('AIRI_CPU_PRESSURE_HOLD', value)
    expect(parsePressureThresholds()).toEqual({ idle: Number(value), hold: Number(value) })
  })

  it.each(['', ' ', '-1', '101', '1.5', '1e2', '0x10', 'Infinity', 'NaN', '70oops'])('rejects malformed threshold %j before scheduling', (value) => {
    for (const key of ['AIRI_CPU_PRESSURE_IDLE', 'AIRI_CPU_PRESSURE_HOLD']) {
      vi.stubEnv(key, value)
      expect(() => parsePressureThresholds()).toThrow(expect.objectContaining({ code: 'bad-pressure-threshold', detail: key }))
      vi.stubEnv(key, undefined)
    }
  })
})
