import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { array, integer, literal, maxValue, minValue, number, parse, pipe, strictObject, union } from 'valibot'

const stepsSchema = array(strictObject({
  /** Linux evdev code (not an XKB keycode, which includes an offset). */
  keyCode: pipe(number(), integer(), minValue(1), maxValue(767)),
  phase: union([literal('down'), literal('up')]),
  delayMs: pipe(number(), integer(), minValue(0)),
}))

export interface KeyboardStep {
  readonly keyCode: number
  readonly phase: 'down' | 'up'
  /** Dwell before this event, for deliberate key holds. */
  readonly delayMs: number
}

/**
 * Injects evdev press/release events through a private qa:display KWin EIS seat.
 * The helper verifies the recorded session bus before making any D-Bus call,
 * releases held keys on failure, and never queries desktop windows.
 */
export function playKeyboard(steps: readonly KeyboardStep[]): Promise<string> {
  const input = parse(stepsSchema, steps)
  const helper = fileURLToPath(new URL('../../scripts/linux/kwin-keyboard.py', import.meta.url))
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-I', helper], { timeout: 15_000 + input.reduce((sum, step) => sum + step.delayMs, 0) }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`KWin keyboard input failed: ${stderr.trim() || error.message}`))
      else
        resolve(stdout.trim())
    })
    child.stdin?.end(JSON.stringify(input))
  })
}
