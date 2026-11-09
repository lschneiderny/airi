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

  it.each([
    ['an explicit --bus over the inherited bus', { explicitBus: 'unix:path=/tmp/private', inheritedBus: sessionBus }, 'unix:path=/tmp/private'],
    ['an explicit --bus without an inherited bus', { explicitBus: 'unix:path=/tmp/private' }, 'unix:path=/tmp/private'],
    ['the inherited bus the session guard accepted', { inheritedBus: sessionBus }, sessionBus],
  ])('uses %s', (_name, input, address) => {
    expect(selectKwinProbeBus(input)).toEqual({ address })
  })

  it('refuses when there is neither --bus nor an inherited bus, naming qa:display run', () => {
    expect(selectKwinProbeBus({})).toEqual({ error: expect.stringContaining('pnpm qa:display run --') })
  })
})

describe('formatKwinProbeLine', () => {
  it('replaces the active caption with its length', () => {
    const line = formatKwinProbeLine({ method: 'Active', payload: { caption: 'secret.txt - Kate', resourceClass: 'kate', desktopFileName: 'org.kde.kate', pid: 7, fullScreen: false } })
    expect(JSON.parse(line)).toEqual({ method: 'Active', payload: { captionLength: 17, resourceClass: 'kate', desktopFileName: 'org.kde.kate', pid: 7, fullScreen: false } })
    expect(line).not.toContain('secret')
  })

  it('replaces every own-window caption with its length', () => {
    const caption = 'F2 synthetic private window title'
    const line = formatKwinProbeLine({ method: 'OwnWindows', payload: [{ id: '{w1}', pid: 4242, x: 0, y: 0, width: 200, height: 200, keepAbove: true, outputScale: 1, caption }] })
    expect(line).not.toContain(caption)
    expect(JSON.parse(line)).toEqual({ method: 'OwnWindows', payload: [{ id: '{w1}', pid: 4242, x: 0, y: 0, width: 200, height: 200, keepAbove: true, outputScale: 1, captionLength: caption.length }] })
  })

  it.each([
    { method: 'Active', payload: null },
    { method: 'Hello', payload: { api: 'plasma6' } },
    { method: 'Cursor', payload: { x: 300, y: 200 } },
  ] as const)('prints $method unchanged', (message) => {
    expect(JSON.parse(formatKwinProbeLine(message))).toEqual(message)
  })
})
