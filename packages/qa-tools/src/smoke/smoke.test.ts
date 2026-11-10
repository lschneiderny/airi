import { describe, expect, it } from 'vitest'

import { parseSmokeArgs, SmokeUsageError } from './args'
import { checkHostMode } from './host-mode'
import { pageErrorFrom, targetLabel } from './page-errors'
import { parseAllowedErrors, scanMainLog, triageErrors } from './triage'

describe('page errors', () => {
  it('labels windows by hash route', () => {
    expect(targetLabel('http://localhost:5173/?synced-leader=true#/')).toBe('#/')
    expect(targetLabel('http://localhost:5173/#/chat-floating')).toBe('#/chat-floating')
    expect(targetLabel('http://localhost:5173/beat-sync.html')).toBe('http://localhost:5173/beat-sync.html')
  })

  it('reads an uncaught exception with its description and location', () => {
    const error = pageErrorFrom('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught', url: 'http://localhost:5173/main.ts', lineNumber: 81, exception: { description: 'Error: boom\n    at main.ts:82:8' } },
    }, '#/', 5)
    expect(error).toEqual({ kind: 'exception', target: '#/', text: 'Error: boom\n    at main.ts:82:8', source: 'http://localhost:5173/main.ts:82', at: 5 })
  })

  it('joins console.error arguments and ignores other console levels', () => {
    const params = { type: 'error', args: [{ type: 'string', value: 'failed:' }, { type: 'number', value: 3 }, { type: 'object', description: 'Error: x' }], stackTrace: { callFrames: [{ url: 'a.ts', lineNumber: 9 }] } }
    expect(pageErrorFrom('Runtime.consoleAPICalled', params, '#/', 1)).toEqual({ kind: 'console', target: '#/', text: 'failed: 3 Error: x', source: 'a.ts:10', at: 1 })
    expect(pageErrorFrom('Runtime.consoleAPICalled', { ...params, type: 'warning' }, '#/', 1)).toBeNull()
  })

  it('keeps only error-level browser log entries', () => {
    expect(pageErrorFrom('Log.entryAdded', { entry: { level: 'error', text: 'Failed to load resource', url: 'http://x/a.png' } }, '#/', 2)).toEqual({ kind: 'log', target: '#/', text: 'Failed to load resource', source: 'http://x/a.png', at: 2 })
    expect(pageErrorFrom('Log.entryAdded', { entry: { level: 'verbose', text: 'x' } }, '#/', 2)).toBeNull()
  })
})

describe('main log scan', () => {
  it('keeps logger errors and Node crashes, and drops Chromium noise and Vite client echoes', () => {
    const log = [
      '2026-11-09T11:36:33.313Z \u001B[31m[error]\u001B[39m [godot-stage] sidecar exited',
      '[970368:1109/063631.855915:ERROR:ui/ozone/platform/wayland/host/wayland_wp_color_manager.cc:277] Unable to set image transfer function.',
      '6:40:47 AM [vite] (client) [Unhandled rejection] Error: probe',
      '6:36:41 AM [vite] (client) [console.error] failed',
      'UnhandledPromiseRejectionWarning: Error: main boom',
      '2026-11-09T11:36:33.313Z [warn] [auto-updater] feed override',
    ].join('\n')
    expect(scanMainLog(log)).toEqual([
      '2026-11-09T11:36:33.313Z [error] [godot-stage] sidecar exited',
      'UnhandledPromiseRejectionWarning: Error: main boom',
    ])
  })
})

describe('error triage', () => {
  const allowList = parseAllowedErrors([
    { pattern: '^ResizeObserver loop', kind: 'exception', reason: 'Chromium reports benign layout loops', added: '2026-11-09', removeWhen: 'never' },
    { pattern: 'sidecar exited', kind: 'main', reason: 'no Godot build in CI-less worktrees', added: '2026-11-09', removeWhen: 'the sidecar is optional' },
  ])

  it('splits errors into allowed and unexpected by kind and pattern', () => {
    const triage = triageErrors([
      { kind: 'exception', target: '#/', text: 'ResizeObserver loop limit exceeded', at: 1 },
      { kind: 'console', target: '#/', text: 'ResizeObserver loop limit exceeded', at: 2 },
    ], ['[error] sidecar exited', '[error] other'], allowList)
    expect(triage.allowed).toEqual([{ kind: 'exception', target: '#/', text: 'ResizeObserver loop limit exceeded', at: 1, reason: 'Chromium reports benign layout loops' }])
    expect(triage.unexpected).toEqual([{ kind: 'console', target: '#/', text: 'ResizeObserver loop limit exceeded', at: 2 }])
    expect(triage.mainAllowed).toEqual([{ text: '[error] sidecar exited', reason: 'no Godot build in CI-less worktrees' }])
    expect(triage.mainUnexpected).toEqual(['[error] other'])
  })

  it('rejects entries without a reason or with an invalid pattern', () => {
    expect(() => parseAllowedErrors([{ pattern: 'x', kind: 'main', reason: '', added: 'd', removeWhen: 'r' }])).toThrow()
    expect(() => parseAllowedErrors([{ pattern: '(', kind: 'main', reason: 'r', added: 'd', removeWhen: 'r' }])).toThrow()
  })
})

describe('smoke arguments', () => {
  it('defaults to no model and a 20 second settle', () => {
    expect(parseSmokeArgs([], '/repo')).toEqual({ model: undefined, kind: 'live2d', stageHost: 'window', expectHost: 'window', xwayland: false, electronArgs: [], settleMs: 20_000, allow: undefined, out: undefined })
  })

  it('resolves paths against the caller and infers the model kind', () => {
    expect(parseSmokeArgs(['--model', 'm/a.vrm', '--settle', '0', '--out', 'o'], '/repo')).toMatchObject({ model: '/repo/m/a.vrm', kind: 'vrm', settleMs: 0, out: '/repo/o' })
  })

  it('rejects positionals, a kind without a model, and out-of-range settle times', () => {
    expect(() => parseSmokeArgs(['run'], '/repo')).toThrow(SmokeUsageError)
    expect(() => parseSmokeArgs(['--kind', 'mmd'], '/repo')).toThrow('--kind needs --model')
    expect(() => parseSmokeArgs(['--settle', '601'], '/repo')).toThrow(SmokeUsageError)
  })

  it('runs the desktop stage host only for an MMD model', () => {
    expect(parseSmokeArgs(['--stage-host', 'desktop', '--model', 'm/a.pmx'], '/repo')).toMatchObject({ stageHost: 'desktop', kind: 'mmd' })
    expect(() => parseSmokeArgs(['--stage-host', 'desktop'], '/repo')).toThrow('--stage-host desktop needs an MMD --model')
    expect(() => parseSmokeArgs(['--stage-host', 'desktop', '--model', 'm/a.vrm'], '/repo')).toThrow('--stage-host desktop needs an MMD --model')
    expect(() => parseSmokeArgs(['--stage-host', 'stage'], '/repo')).toThrow()
  })

  it('expects the requested host by default and accepts the classic window on a gated platform', () => {
    const desktop = ['--stage-host', 'desktop', '--model', 'm/a.pmx']
    expect(parseSmokeArgs(desktop, '/repo')).toMatchObject({ stageHost: 'desktop', expectHost: 'desktop' })
    expect(parseSmokeArgs([...desktop, '--expect-host', 'window'], '/repo')).toMatchObject({ stageHost: 'desktop', expectHost: 'window' })
    expect(() => parseSmokeArgs(['--expect-host', 'desktop'], '/repo')).toThrow('--expect-host desktop needs --stage-host desktop')
    expect(() => parseSmokeArgs([...desktop, '--expect-host', 'stage'], '/repo')).toThrow()
  })

  it('launches through XWayland and passes Electron switches through', () => {
    expect(parseSmokeArgs(['--xwayland', '--electron-arg=--use-gl=angle', '--electron-arg=--use-angle=swiftshader'], '/repo')).toMatchObject({ xwayland: true, electronArgs: ['--use-gl=angle', '--use-angle=swiftshader'] })
    expect(() => parseSmokeArgs(['--electron-arg=use-gl'], '/repo')).toThrow('--electron-arg takes one Chromium or Electron switch')
    expect(() => parseSmokeArgs(['--electron-arg=--'], '/repo')).toThrow('--electron-arg takes one Chromium or Electron switch')
  })
})

describe('host mode check', () => {
  const classicLog = '2026-11-09T19:20:18.123Z \u001B[32m[log]\u001B[39m Building the classic window host (Linux desktop stage eligible: false)\n'
  const desktopLog = 'Building the desktop stage host (Linux desktop stage eligible: true)\n'

  it('passes the classic window when no stage window existed', () => {
    expect(checkHostMode('window', classicLog, ['#/', '#/inlay', 'http://localhost:5173/beat-sync.html'])).toBeUndefined()
  })

  it('fails an expected classic window when the desktop stage was built or opened', () => {
    expect(checkHostMode('window', desktopLog, ['#/stage'])).toMatch(/expected the classic window host, the app built the desktop stage host/)
    expect(checkHostMode('window', classicLog, ['#/', '#/stage'])).toMatch(/a #\/stage window existed/)
    expect(checkHostMode('window', classicLog, ['#/inlay'])).toMatch(/no #\/ window/)
  })

  it('passes the desktop stage only with its window', () => {
    expect(checkHostMode('desktop', desktopLog, ['#/stage', '#/inlay'])).toBeUndefined()
    expect(checkHostMode('desktop', desktopLog, ['#/inlay'])).toMatch(/no #\/stage window/)
    expect(checkHostMode('desktop', classicLog, ['#/'])).toMatch(/expected the desktop stage host, the app built the classic window host/)
  })

  it('fails when the app never logged its host mode', () => {
    expect(checkHostMode('window', 'starting electron app...\n', ['#/'])).toMatch(/never logged/)
  })
})
