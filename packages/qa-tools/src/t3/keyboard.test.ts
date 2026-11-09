import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { playKeyboard } from './keyboard'

describe('isolated EIS keyboard input', () => {
  it.each([0, -1, 768, 1.5, Number.NaN])('rejects invalid evdev code %s before starting input', (keyCode) => {
    expect(() => playKeyboard([{ keyCode, phase: 'down', delayMs: 0 }])).toThrow()
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])('rejects invalid dwell %s before starting input', (delayMs) => {
    expect(() => playKeyboard([{ keyCode: 1, phase: 'down', delayMs }])).toThrow()
  })

  it.each([
    {},
    { AIRI_QA_DISPLAY: 'lsp-test', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
    { AIRI_QA_DISPLAY: 'lsp-test', XDG_RUNTIME_DIR: '/tmp/airi-qa-display/lsp-test/runtime', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
  ])('refuses a host bus even with a QA display marker: %j', async (environment) => {
    const helper = fileURLToPath(new URL('../../scripts/linux/kwin-keyboard.py', import.meta.url))
    await expect(promisify(execFile)('python3', ['-I', helper], { env: { PATH: process.env.PATH, ...environment }, timeout: 2000 }))
      .rejects
      .toThrow('Keyboard input requires a private pnpm qa:display run session')
  })
})
