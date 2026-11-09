import { describe, expect, it } from 'vitest'

import { formatKwinProbeLine, parseKwinProbeArgs, selectKwinProbeBus } from './kwin-probe-plan'

describe('parseKwinProbeArgs', () => {
  it.each([
    [[], { seconds: 10, cursor: false }],
    [['--seconds', '15'], { seconds: 15, cursor: false }],
    [['--cursor', '--seconds', '3600'], { seconds: 3600, cursor: true }],
    [['--bus', 'unix:path=/tmp/bus'], { seconds: 10, cursor: false, bus: 'unix:path=/tmp/bus' }],
  ])('parses %j', (argv, expected) => {
    expect(parseKwinProbeArgs(argv)).toEqual(expected)
  })

  it.each([
    [['--seconds'], '--seconds needs a value'],
    [['--bus'], '--bus needs an address'],
    [['--bus', ''], '--bus needs an address'],
    [['--seconds', '0'], '--seconds must be a whole number from 1 to 3600'],
    [['--seconds', '3601'], '--seconds must be a whole number from 1 to 3600'],
    [['--seconds', '1.5'], '--seconds must be a whole number from 1 to 3600'],
    [['--seconds', '-1'], '--seconds must be a whole number from 1 to 3600'],
    [['--seconds', 'ten'], '--seconds must be a whole number from 1 to 3600'],
    [['--verbose'], 'unknown argument "--verbose"'],
    [['15'], 'unknown argument "15"'],
  ])('rejects %j', (argv, error) => {
    expect(parseKwinProbeArgs(argv)).toEqual({ error })
  })
})

describe('selectKwinProbeBus', () => {
  const sessionBus = 'unix:path=/run/user/1000/airi-qa-display/kp/bus'
  const hostBus = 'unix:path=/run/user/1000/bus'
  const sessions = (name: string) => name === 'kp' ? sessionBus : null

  it.each([
    ['an explicit --bus', { explicitBus: 'unix:path=/tmp/private', inheritedBus: hostBus, sessionBus: sessions }, 'unix:path=/tmp/private'],
    ['the marker naming the running session that owns the inherited bus', { marker: 'kp', inheritedBus: sessionBus, sessionBus: sessions }, sessionBus],
  ])('accepts %s', (_name, input, address) => {
    expect(selectKwinProbeBus(input)).toEqual({ address })
  })

  it.each([
    ['no marker on the host bus', { inheritedBus: hostBus, sessionBus: sessions }, 'AIRI_QA_DISPLAY_SESSION is not set'],
    ['no marker and no bus', { sessionBus: sessions }, 'AIRI_QA_DISPLAY_SESSION is not set'],
    ['a marker that is not a session name', { marker: '../kp', inheritedBus: sessionBus, sessionBus: sessions }, 'is not a qa:display session name'],
    ['a marker naming a stopped session', { marker: 'gone', inheritedBus: sessionBus, sessionBus: sessions }, 'qa:display session "gone" is not running'],
    ['a marker with the host bus inherited', { marker: 'kp', inheritedBus: hostBus, sessionBus: sessions }, 'is not the bus of qa:display session "kp"'],
    ['a marker with no bus inherited', { marker: 'kp', sessionBus: sessions }, 'is not the bus of qa:display session "kp"'],
  ])('refuses %s', (_name, input, reason) => {
    const result = selectKwinProbeBus(input)
    expect(result).toEqual({ error: expect.stringContaining(reason) })
    expect(result).toEqual({ error: expect.stringContaining('pnpm qa:display run --') })
  })
})

describe('formatKwinProbeLine', () => {
  it('replaces the active caption with its length', () => {
    const line = formatKwinProbeLine({ method: 'Active', payload: { caption: 'secret.txt - Kate', resourceClass: 'kate', desktopFileName: 'org.kde.kate', pid: 7, fullScreen: false } })
    expect(JSON.parse(line)).toEqual({ method: 'Active', payload: { captionLength: 17, resourceClass: 'kate', desktopFileName: 'org.kde.kate', pid: 7, fullScreen: false } })
    expect(line).not.toContain('secret')
  })

  it.each([
    { method: 'Active', payload: null },
    { method: 'Hello', payload: { api: 'plasma6' } },
    { method: 'Cursor', payload: { x: 300, y: 200 } },
  ] as const)('prints $method unchanged', (message) => {
    expect(JSON.parse(formatKwinProbeLine(message))).toEqual(message)
  })
})
