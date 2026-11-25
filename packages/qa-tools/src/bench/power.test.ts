import { describe, expect, it } from 'vitest'

import { parsePowerLimit } from './power'

const ac = 'Now drawing from \'AC Power\'\n -InternalBattery-0 (id=1234)\t80%; charging; 1:00 remaining present: true\n'
const battery = 'Now drawing from \'Battery Power\'\n -InternalBattery-0 (id=1234)\t80%; discharging; 5:00 remaining present: true\n'
const settings = (lowPowerMode: 0 | 1) => `System-wide power settings:\nCurrently in use:\n standby              1\n lowpowermode         ${lowPowerMode}\n sleep                1\n`

describe('parsePowerLimit', () => {
  it('passes a Mac on AC power outside Low Power Mode', () => {
    expect(parsePowerLimit(ac, settings(0))).toBeNull()
  })

  it('limits a Mac drawing from its battery', () => {
    expect(parsePowerLimit(battery, settings(0))).toBe('on-battery')
  })

  it('limits a Mac in Low Power Mode on AC power', () => {
    expect(parsePowerLimit(ac, settings(1))).toBe('low-power-mode')
  })

  it('limits a Mac with High Power Mode whose power mode is Low', () => {
    expect(parsePowerLimit(ac, 'Currently in use:\n powermode            1\n sleep                1\n')).toBe('low-power-mode')
  })

  it('passes a Mac with High Power Mode in Automatic or High', () => {
    expect(parsePowerLimit(ac, 'Currently in use:\n powermode            0\n')).toBeNull()
    expect(parsePowerLimit(ac, 'Currently in use:\n powermode            2\n')).toBeNull()
  })

  it('passes a macOS that does not report lowpowermode', () => {
    expect(parsePowerLimit(ac, 'Currently in use:\n sleep                1\n')).toBeNull()
  })
})
