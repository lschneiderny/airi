import { Buffer } from 'node:buffer'

const magic = Buffer.from('i3-ipc')
// Trees can include many windows, but a corrupt peer must not allocate 4 GiB.
const maxPayload = 16 * 1024 * 1024

export class SwayProtocolError extends Error {
  constructor() {
    // Parser errors must never include window titles or raw payloads.
    super('Invalid Sway IPC payload')
    this.name = 'SwayProtocolError'
  }
}

export interface Frame {
  readonly type: number
  readonly payload: unknown
}

export function encodeFrame(type: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload))
  if (body.length > maxPayload)
    throw new SwayProtocolError()
  const header = Buffer.alloc(14)
  magic.copy(header)
  header.writeUInt32LE(body.length, 6)
  header.writeUInt32LE(type, 10)
  return Buffer.concat([header, body])
}

/** The backend's sole outgoing boundary cannot encode state-changing commands. */
export function encodeRequest(type: 2 | 4): Buffer {
  if (type === 2)
    return encodeFrame(2, ['window'])
  if (type !== 4)
    throw new SwayProtocolError()
  const header = Buffer.alloc(14)
  magic.copy(header)
  header.writeUInt32LE(4, 10)
  return header
}

export class FrameDecoder {
  private buffered = Buffer.alloc(0)
  private readonly utf8 = new TextDecoder('utf-8', { fatal: true })

  push(chunk: Buffer): Frame[] {
    this.buffered = Buffer.concat([this.buffered, chunk])
    const frames: Frame[] = []
    while (this.buffered.length >= 14) {
      if (!this.buffered.subarray(0, 6).equals(magic))
        throw new SwayProtocolError()
      const length = this.buffered.readUInt32LE(6)
      if (length > maxPayload)
        throw new SwayProtocolError()
      if (this.buffered.length < 14 + length)
        break
      let payload: unknown
      try {
        payload = JSON.parse(this.utf8.decode(this.buffered.subarray(14, 14 + length)))
      }
      catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError)
          throw new SwayProtocolError()
        throw error
      }
      frames.push({ type: this.buffered.readUInt32LE(10), payload })
      this.buffered = this.buffered.subarray(14 + length)
    }
    return frames
  }

  finish(): void {
    if (this.buffered.length)
      throw new SwayProtocolError()
  }
}
