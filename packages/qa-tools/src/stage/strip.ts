import { readFile, writeFile } from 'node:fs/promises'

import { Transformer } from '@napi-rs/image'

/** Six fixed-width cells per row; differing shot aspect ratios retain all their pixels. */
export function stripLayout(sizes: readonly { width: number, height: number }[]) {
  if (sizes.length === 0 || sizes.some(size => size.width <= 0 || size.height <= 0))
    throw new RangeError('A strip needs at least one nonempty image')
  const heights = sizes.map(size => Math.max(1, Math.round(size.height * 320 / size.width)))
  const cellHeight = Math.max(...heights)
  return {
    width: 6 * 320,
    height: Math.ceil(sizes.length / 6) * cellHeight,
    cells: heights.map((height, index) => ({ x: index % 6 * 320, y: Math.floor(index / 6) * cellHeight, width: 320, height })),
  }
}

/** Called only after the shots and capture manifest have been written. */
export async function writeCaptureStrip(shots: readonly string[], out: string): Promise<void> {
  const images = await Promise.all(shots.map(async path => new Transformer(await readFile(path))))
  const layout = stripLayout(await Promise.all(images.map(image => image.metadata())))
  const pixels = new Uint8Array(layout.width * layout.height * 4)
  // Opaque dark background, including unused cells in the last row.
  for (let offset = 0; offset < pixels.length; offset += 4)
    pixels.set([24, 24, 24, 255], offset)
  const sheet = Transformer.fromRgbaPixels(pixels, layout.width, layout.height)
  for (let index = 0; index < images.length; index++) {
    const cell = layout.cells[index]
    sheet.overlay(await images[index].resize(cell.width, cell.height).png(), cell.x, cell.y)
  }
  await writeFile(out, await sheet.png())
}
