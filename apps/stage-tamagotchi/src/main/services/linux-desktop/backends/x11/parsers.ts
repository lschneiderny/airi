import { Buffer } from 'node:buffer'

/** Reject malformed UTF-8 rather than manufacturing replacement characters. */
export function parseUtf8Name(data: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    const name = text.endsWith('\0') ? text.slice(0, -1) : text
    return name.includes('\0') ? null : name
  }
  catch (error) {
    if (error instanceof TypeError)
      return null
    throw error
  }
}

export function parseWmClass(data: Uint8Array): string | null {
  const separator = data.indexOf(0)
  if (separator < 0 || data.at(-1) !== 0 || data.indexOf(0, separator + 1) !== data.length - 1)
    return null
  // ICCCM STRING fields use Latin-1, including bytes that are invalid UTF-8.
  return Buffer.from(data.subarray(separator + 1, -1)).toString('latin1')
}

/** Xlib expands format-32 wire values into native unsigned longs. */
export function parseAtomArray(data: unknown): number[] | null {
  if (!Array.isArray(data) && !(data instanceof Uint32Array) && !(data instanceof BigUint64Array))
    return null
  const atoms: number[] = []
  for (const value of data) {
    const atom = typeof value === 'bigint' ? Number(value) : value
    if (typeof atom !== 'number' || !Number.isInteger(atom) || atom < 0 || atom > 0xFFFFFFFF)
      return null
    atoms.push(atom)
  }
  return atoms
}
