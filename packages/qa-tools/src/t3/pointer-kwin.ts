import type { InferOutput } from 'valibot'

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { array, boolean, finite, minValue, number, optional, parse, pipe, strictObject, string } from 'valibot'

/**
 * The Linux pointer backend: a Python helper that talks to the `pnpm qa:display` session's private bus. It injects
 * absolute pointer input through KWin's EIS for `pnpm qa:display pointer`; the doctor runs its `probe` to report
 * whether that backend is available. It never runs outside a QA display.
 */
const kwinPointerHelper = fileURLToPath(new URL('../../scripts/linux/kwin-pointer.py', import.meta.url))

/** KWin 6 geometry is a QRectF in logical pixels; it is integral on a scale-1 output but typed as a real number. */
const RectSchema = strictObject({
  x: pipe(number(), finite()),
  y: pipe(number(), finite()),
  width: pipe(number(), finite(), minValue(0)),
  height: pipe(number(), finite(), minValue(0)),
})

const KwinProbeSchema = strictObject({
  ok: boolean(),
  missing: array(string()),
  screen: optional(RectSchema),
})
export type KwinProbe = InferOutput<typeof KwinProbeSchema>

export function parseKwinProbe(stdout: string): KwinProbe {
  return parse(KwinProbeSchema, JSON.parse(stdout.trim()))
}

/** Runs the helper's probe once; `python3 -I` keeps the user's site packages, `PYTHONPATH`, and the working directory out of it. */
export function runKwinProbe(options: { timeoutMs?: number, signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = execFile('python3', ['-I', kwinPointerHelper, 'probe'], { timeout: options.timeoutMs ?? 20_000, signal: options.signal }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`kwin-pointer probe failed: ${stderr.trim() || error.message}`))
      else
        resolveRun(stdout)
    })
    child.stdin?.end('')
  })
}
