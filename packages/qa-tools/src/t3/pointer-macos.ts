import type { InferOutput } from 'valibot'

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { array, boolean, finite, integer, minValue, nullable, number, object, optional, parse, pipe, string } from 'valibot'

/**
 * The macOS pointer backend: a Python helper that drives the real cursor through CoreGraphics with `ctypes`, so it
 * needs no dependency beyond the system frameworks. Coordinates are global display points with the origin at the
 * top-left of the main display, the same space as Electron's `screen` DIPs and CDP's `screenX`/`screenY`.
 *
 * A warp moves the cursor without an event and needs no permission. Moves, presses, releases, and drags post HID
 * events, which macOS drops silently unless the app that started python3 has Accessibility access; the helper refuses
 * such a table with exit code 3 and a `post-event access` message instead of claiming input it could not deliver.
 */
const macPointerHelper = fileURLToPath(new URL('../../scripts/macos/mac-pointer.py', import.meta.url))

export type MacPointerAction = 'warp' | 'move' | 'down' | 'up'

/** One row of a pointer table; `atMs` counts from the start of playback and never decreases. */
export interface MacPointerStep {
  atMs: number
  action: MacPointerAction
  x: number
  y: number
}

export interface Point {
  x: number
  y: number
}

function step(atMs: number, action: MacPointerAction, point: Point): MacPointerStep {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y))
    throw new Error(`Pointer coordinates must be integers, got ${point.x},${point.y}`)
  return { atMs, action, x: point.x, y: point.y }
}

/** Moves the cursor without posting an event; apps that poll the cursor see it, hover handlers do not. */
export function warpSteps(point: Point): MacPointerStep[] {
  return [step(0, 'warp', point)]
}

/** Posts one mouse move, so the window under the cursor gets hover input. */
export function moveSteps(point: Point): MacPointerStep[] {
  return [step(0, 'move', point)]
}

/** Moves onto the point, rests `dwellMs` so hover state settles, and presses the left button there. */
export function pressSteps(point: Point, dwellMs = 0): MacPointerStep[] {
  return [step(0, 'move', point), step(dwellMs, 'down', point)]
}

/** Releases the left button at the point. */
export function releaseSteps(point: Point): MacPointerStep[] {
  return [step(0, 'up', point)]
}

export interface DragOptions {
  /** Time from the press to the release. */
  durationMs: number
  /** Intermediate posted moves between the two points; at least 1. */
  moves: number
  /** Rest on `from` before the press, as in `pressSteps`. */
  dwellMs?: number
}

/** Presses at `from`, posts evenly spaced dragged moves along the straight line, and releases at `to`. */
export function dragSteps(from: Point, to: Point, options: DragOptions): MacPointerStep[] {
  const { durationMs, moves, dwellMs = 0 } = options
  if (!Number.isInteger(moves) || moves < 1)
    throw new Error(`A drag needs at least one intermediate move, got ${moves}`)
  const steps = pressSteps(from, dwellMs)
  for (let index = 1; index <= moves; index++) {
    const fraction = index / (moves + 1)
    steps.push(step(Math.round(dwellMs + durationMs * fraction), 'move', {
      x: Math.round(from.x + (to.x - from.x) * fraction),
      y: Math.round(from.y + (to.y - from.y) * fraction),
    }))
  }
  steps.push(step(dwellMs + durationMs, 'move', to), step(dwellMs + durationMs, 'up', to))
  return steps
}

/** The helper invocation; `python3 -I` keeps the user's site packages, `PYTHONPATH`, and the working directory out of it. */
export function macPointerCommand(command: 'probe' | 'play', steps: MacPointerStep[] = []): { command: string, args: string[], input: string } {
  return { command: 'python3', args: ['-I', macPointerHelper, command], input: command === 'play' ? JSON.stringify({ steps }) : '' }
}

const ScreenSchema = object({
  width: pipe(number(), integer(), minValue(0)),
  height: pipe(number(), integer(), minValue(0)),
})

const MacPointerProbeSchema = object({
  /** Whether posted moves, presses, releases, and drags reach apps. */
  ok: boolean(),
  warp: boolean(),
  postEvents: boolean(),
  /** The app macOS checks for Accessibility: the bundle that started the process tree, when known. */
  responsibleApp: nullable(string()),
  missing: array(string()),
  screen: optional(ScreenSchema),
})
export type MacPointerProbe = InferOutput<typeof MacPointerProbeSchema>

const MacPointerReceiptSchema = object({
  played: pipe(number(), integer(), minValue(0)),
  maxTimingErrorMs: pipe(number(), finite()),
  /** The cursor read back after playback. */
  x: pipe(number(), finite()),
  y: pipe(number(), finite()),
  screen: ScreenSchema,
})
export type MacPointerReceipt = InferOutput<typeof MacPointerReceiptSchema>

export function parseMacPointerProbe(stdout: string): MacPointerProbe {
  return parse(MacPointerProbeSchema, JSON.parse(stdout.trim()))
}

export function parseMacPointerReceipt(stdout: string): MacPointerReceipt {
  return parse(MacPointerReceiptSchema, JSON.parse(stdout.trim()))
}

function runHelper(command: 'probe' | 'play', steps: MacPointerStep[], timeoutMs: number): Promise<string> {
  const built = macPointerCommand(command, steps)
  return new Promise((resolveRun, reject) => {
    const child = execFile(built.command, built.args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error)
        reject(new Error(`mac-pointer ${command} failed: ${stderr.trim() || error.message}`))
      else
        resolveRun(stdout)
    })
    child.stdin?.end(built.input)
  })
}

export async function runMacPointerProbe(options: { timeoutMs?: number } = {}): Promise<MacPointerProbe> {
  return parseMacPointerProbe(await runHelper('probe', [], options.timeoutMs ?? 10_000))
}

/** Plays a table built from the step functions above and resolves the receipt with the cursor read back. */
export async function playMacPointer(steps: MacPointerStep[]): Promise<MacPointerReceipt> {
  const lastAtMs = steps.at(-1)?.atMs ?? 0
  return parseMacPointerReceipt(await runHelper('play', steps, lastAtMs + 20_000))
}
