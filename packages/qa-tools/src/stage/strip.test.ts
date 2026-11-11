import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Transformer } from '@napi-rs/image'
import { describe, expect, it } from 'vitest'

import { stripLayout, writeCaptureStrip } from './strip'

describe('capture strip', () => {
  it('wraps the seventh image and preserves differing aspect ratios', () => {
    const layout = stripLayout([...Array.from({ length: 6 }, () => ({ width: 640, height: 480 })), { width: 320, height: 400 }])
    expect(layout).toMatchObject({ width: 1920, height: 800 })
    expect(layout.cells[5]).toEqual({ x: 1600, y: 0, width: 320, height: 240 })
    expect(layout.cells[6]).toEqual({ x: 0, y: 400, width: 320, height: 400 })
  })

  it('composes every encoded PNG onto an opaque background', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-strip-'))
    try {
      const files: string[] = []
      for (const [index, color] of [[255, 0, 0, 255], [0, 255, 0, 255]].entries()) {
        const file = join(dir, `${index}.png`)
        writeFileSync(file, await Transformer.fromRgbaPixels(new Uint8Array(color), 1, 1).png())
        files.push(file)
      }
      const out = join(dir, 'strip.png')
      await writeCaptureStrip(files, out)
      const image = new Transformer(readFileSync(out))
      const pixels = await image.rawPixels()
      expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
      expect([...pixels.subarray(320 * 4, 320 * 4 + 4)]).toEqual([0, 255, 0, 255])
      expect([...pixels.subarray(640 * 4, 640 * 4 + 4)]).toEqual([24, 24, 24, 255])
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
