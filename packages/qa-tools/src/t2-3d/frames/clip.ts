import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { delimiter, extname, join } from 'node:path'

import { drawText, GLYPH_HEIGHT, GLYPH_WIDTH } from './font'

/** What a clip is and is not; printed by the command, written beside the clip and burned into its last line. */
export const CLIP_LIMITS = 'QA renderer: the posed mesh only, flat grey, no materials, face, lighting, physics-driven hair or cloth. It shows body motion; it is not how she looks in the app.'

/** ffmpeg encoder and arguments per output extension; null for an extension the command does not write. */
export function clipCodec(out: string): { encoder: string, args: string[] } | null {
  switch (extname(out).toLowerCase()) {
    case '.mp4': return { encoder: 'libopenh264', args: ['-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] }
    case '.webm': return { encoder: 'libvpx-vp9', args: ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuv420p'] }
    case '.webp': return { encoder: 'libwebp_anim', args: ['-c:v', 'libwebp_anim', '-loop', '0', '-quality', '75', '-pix_fmt', 'yuv420p'] }
    case '.gif': return { encoder: 'gif', args: ['-c:v', 'gif', '-loop', '0'] }
    default: return null
  }
}

/** The first `ffmpeg` executable on PATH, or null. `isFile` is injected so the lookup is testable without this machine's PATH. */
export function findOnPath(binary: string, path: string | undefined, isFile: (candidate: string) => boolean): string | null {
  for (const dir of (path ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, binary)
    if (isFile(candidate))
      return candidate
  }
  return null
}

/** Motion times drawn at `hz` from `from` to `to` inclusive; the clip plays them at `hz` frames per second, so in real time. */
export function clipTimes(from: number, to: number, hz: number): number[] {
  return Array.from({ length: Math.floor((to - from) * hz + 1e-6) + 1 }, (_, i) => from + i / hz)
}

/** Events in the last `holdSeconds` before `t`, newest first, so a marker stays on screen long enough to read. */
export function activeEvents(events: readonly MotionTraceEvent[], t: number, label: (event: MotionTraceEvent) => string, holdSeconds = 1): string[] {
  return events.filter(event => event.t <= t + 1e-9 && event.t > t - holdSeconds).sort((a, b) => b.t - a.t).map(event => `${event.t.toFixed(2)} ${label(event)}`)
}

export interface ClipPanel {
  readonly rgb: Uint8Array
}

export interface ClipBlock {
  /** One panel per view, left to right. */
  readonly panels: readonly ClipPanel[]
  /** Text lines drawn above this run's panels. */
  readonly header: readonly string[]
}

const SEPARATOR = 6

function wrapWords(line: string, columns: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    if (current && current.length + 1 + word.length > columns) {
      lines.push(current)
      current = word
    }
    else {
      current = current ? `${current} ${word}` : word
    }
  }
  return current ? [...lines, current] : lines
}
const HEADER_LINES = 5
const SCALE = 2

/**
 * One clip frame: run blocks left to right (before, then after), each a header over its view panels, and the footer
 * across the bottom. Width and height are even, as yuv420p needs.
 */
export function composeClipFrame(blocks: readonly ClipBlock[], panelWidth: number, panelHeight: number, footer: readonly string[]): { rgb: Uint8Array, width: number, height: number } {
  const views = Math.max(...blocks.map(block => block.panels.length))
  const headerHeight = HEADER_LINES * GLYPH_HEIGHT * SCALE + 6
  const rawWidth = blocks.length * views * panelWidth + (blocks.length - 1) * SEPARATOR
  const width = rawWidth + (rawWidth % 2)
  const footerLines = footer.flatMap(line => wrapWords(line, Math.floor((width - 4) / GLYPH_WIDTH)))
  const footerHeight = footerLines.length * (GLYPH_HEIGHT + 2) + 6
  const rawHeight = headerHeight + panelHeight + footerHeight
  const height = rawHeight + (rawHeight % 2)
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const columns = Math.floor((views * panelWidth - 4) / (GLYPH_WIDTH * SCALE))
  blocks.forEach((block, b) => {
    const x0 = b * (views * panelWidth + SEPARATOR)
    if (b > 0) {
      for (let y = 0; y < headerHeight + panelHeight; y++)
        rgb.fill(60, ((y * width) + x0 - SEPARATOR) * 3, ((y * width) + x0) * 3)
    }
    block.header.slice(0, HEADER_LINES).forEach((line, i) => drawText(rgb, width, height, x0 + 2, 3 + i * GLYPH_HEIGHT * SCALE, line.slice(0, columns), SCALE))
    block.panels.forEach((panel, v) => {
      for (let y = 0; y < panelHeight; y++)
        rgb.set(panel.rgb.subarray(y * panelWidth * 3, (y + 1) * panelWidth * 3), ((headerHeight + y) * width + x0 + v * panelWidth) * 3)
    })
  })
  footerLines.forEach((line, i) => drawText(rgb, width, height, 2, headerHeight + panelHeight + 3 + i * (GLYPH_HEIGHT + 2), line, 1, [90, 90, 90]))
  return { rgb, width, height }
}
