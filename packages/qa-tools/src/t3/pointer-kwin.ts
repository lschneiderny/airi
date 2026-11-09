import type { InferOutput } from 'valibot'

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { array, boolean, finite, integer, minValue, nullable, number, optional, parse, pipe, strictObject, string } from 'valibot'

/**
 * The Linux pointer backend: a Python helper that talks to the `pnpm qa:display` session's private bus. It injects
 * absolute pointer input through KWin's EIS and reads window geometry, the cursor, and the active window through a
 * one-shot KWin script. It never runs outside a QA display (see `selectPointerBackend`).
 */
export const kwinPointerHelper = fileURLToPath(new URL('../../scripts/linux/kwin-pointer.py', import.meta.url))

/** KWin 6 geometry is a QRectF in logical pixels; it is integral on a scale-1 output but typed as a real number. */
const RectSchema = strictObject({
  x: pipe(number(), finite()),
  y: pipe(number(), finite()),
  width: pipe(number(), finite(), minValue(0)),
  height: pipe(number(), finite(), minValue(0)),
})
export type KwinRect = InferOutput<typeof RectSchema>

const KwinWindowSchema = strictObject({
  pid: pipe(number(), integer(), minValue(0)),
  caption: string(),
  resourceClass: string(),
  active: boolean(),
  minimized: boolean(),
  /** KWin's stacking order: a higher value is drawn above a lower one. */
  stack: pipe(number(), integer()),
  frame: RectSchema,
  client: RectSchema,
})
export type KwinWindow = InferOutput<typeof KwinWindowSchema>

const KwinQuerySchema = strictObject({
  screen: RectSchema,
  cursor: strictObject({ x: number(), y: number() }),
  activePid: pipe(number(), integer(), minValue(0)),
  activeName: nullable(string()),
  windows: array(KwinWindowSchema),
})
export type KwinQuery = InferOutput<typeof KwinQuerySchema>

const KwinProbeSchema = strictObject({
  ok: boolean(),
  missing: array(string()),
  screen: optional(RectSchema),
})
export type KwinProbe = InferOutput<typeof KwinProbeSchema>

export function parseKwinProbe(stdout: string): KwinProbe {
  return parse(KwinProbeSchema, JSON.parse(stdout.trim()))
}

export function parseKwinQuery(stdout: string): KwinQuery {
  return parse(KwinQuerySchema, JSON.parse(stdout.trim()))
}

/** `python3 -I` keeps the user's site packages, `PYTHONPATH`, and the working directory out of the helper. */
export function kwinHelperCommand(subcommand: 'probe' | 'query' | 'play'): { command: string, args: string[] } {
  return { command: 'python3', args: ['-I', kwinPointerHelper, subcommand] }
}

/** Runs the helper once; stdin carries the play table, so a long scenario never meets an argument length limit. */
export function runKwinHelper(subcommand: 'probe' | 'query' | 'play', options: { input?: string, timeoutMs?: number, signal?: AbortSignal } = {}): Promise<string> {
  const built = kwinHelperCommand(subcommand)
  return new Promise((resolveRun, reject) => {
    const child = execFile(built.command, built.args, { timeout: options.timeoutMs ?? 20_000, signal: options.signal }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`kwin-pointer ${subcommand} failed: ${stderr.trim() || error.message}`))
      else
        resolveRun(stdout)
    })
    child.stdin?.end(options.input ?? '')
  })
}

export interface StageWindowMatch {
  /** `pid` when the app's process tree owns the window, `size` when only the client size identified it. */
  method: 'pid' | 'size'
  window: KwinWindow
}

/**
 * Finds the stage window among KWin's normal windows. A window counts only when its client rectangle has the stage
 * page's CSS size, because KWin coordinates are logical pixels and the virtual output has scale 1. Windows owned by
 * the app's process tree are preferred; the size-only fallback applies only when no window has one of those PIDs.
 *
 * Caveat: Electron draws a window menu bar inside the client rectangle, so a stage window with a visible menu bar
 * would offset its page below the client origin. Its client height then differs from the page height, and the
 * match refuses instead of pressing at the wrong place.
 */
export function matchStageWindow(windows: readonly KwinWindow[], appPids: readonly number[], page: { width: number, height: number }): StageWindowMatch {
  const visible = windows.filter(window => !window.minimized)
  const sized = (list: readonly KwinWindow[]) => list.filter(window => window.client.width === page.width && window.client.height === page.height)
  const owned = visible.filter(window => appPids.includes(window.pid))
  const describe = (list: readonly KwinWindow[]) => list.map(window => `${window.pid}:${JSON.stringify(window.caption)} client=${window.client.width}x${window.client.height}@${window.client.x},${window.client.y}`).join(', ') || 'none'
  const pick = (list: readonly KwinWindow[], method: StageWindowMatch['method']): StageWindowMatch => {
    if (list.length === 1)
      return { method, window: list[0] }
    throw new Error(`pointer-window-ambiguous: ${list.length} windows have the stage page size ${page.width}x${page.height} (${method} match): ${describe(list)}`)
  }
  if (owned.length > 0) {
    const candidates = sized(owned)
    if (candidates.length === 0)
      throw new Error(`pointer-window-unmatched: no window of the app (PIDs ${appPids.join(', ')}) has a ${page.width}x${page.height} client rectangle; a menu bar or zoom would offset the page. App windows: ${describe(owned)}`)
    return pick(candidates, 'pid')
  }
  const candidates = sized(visible)
  if (candidates.length === 0)
    throw new Error(`pointer-window-unmatched: no KWin window belongs to the app (PIDs ${appPids.join(', ')}) or has a ${page.width}x${page.height} client rectangle. Windows: ${describe(visible)}`)
  return pick(candidates, 'size')
}

export interface PointerOccluder {
  pid: number
  caption: string
  frame: KwinRect
  /** How many planned steps land inside this window's frame while it is stacked above the stage. */
  steps: number
}

/**
 * Lists windows stacked above the stage whose frames cover planned steps. KWin delivers input there to the upper
 * window unless that window has an empty input region, which a QA run cannot read; the run records the list so a
 * missing touch can be traced to the window that took the input.
 */
export function occludingWindows(windows: readonly KwinWindow[], stage: KwinWindow, steps: readonly { x: number, y: number }[]): PointerOccluder[] {
  const inside = (rect: KwinRect, point: { x: number, y: number }) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  return windows
    .filter(window => window !== stage && !window.minimized && window.stack > stage.stack)
    .map(window => ({ pid: window.pid, caption: window.caption, frame: window.frame, steps: steps.filter(step => inside(window.frame, step) && inside(stage.client, step)).length }))
    .filter(occluder => occluder.steps > 0)
}
