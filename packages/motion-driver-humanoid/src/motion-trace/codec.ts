/** Encodes the float bits, including signed zero and NaN payloads, in little-endian order. */
export function encodeBlock(values: Float32Array): string {
  const bits = new Uint32Array(values.buffer, values.byteOffset, values.length)
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < values.length; i++)
    view.setUint32(i * 4, bits[i], true)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

/** Rejects malformed base64 and wrong block lengths before allocating the float block. */
export function decodeBlock(encoded: string, expectedLength: number): Float32Array {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0
    || encoded.length !== Math.ceil(expectedLength * 4 / 3) * 4) {
    throw new RangeError('Invalid motion trace block')
  }
  // Scan with constant stack space; a repeated-group regex exhausts V8's stack on long traces.
  const dataEnd = encoded.length - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
  for (let i = 0; i < dataEnd; i++) {
    const code = encoded.charCodeAt(i)
    const isBase64 = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57) || code === 43 || code === 47
    if (!isBase64)
      throw new RangeError('Invalid motion trace block')
  }
  const binary = atob(encoded)
  if (binary.length !== expectedLength * 4 || btoa(binary) !== encoded)
    throw new RangeError('Invalid motion trace block length or padding')
  const values = new Float32Array(expectedLength)
  const bits = new Uint32Array(values.buffer)
  for (let i = 0; i < expectedLength; i++) {
    const offset = i * 4
    bits[i] = binary.charCodeAt(offset) | binary.charCodeAt(offset + 1) << 8
      | binary.charCodeAt(offset + 2) << 16 | binary.charCodeAt(offset + 3) << 24
  }
  return values
}
