import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { encodeFrame, encodeRequest, FrameDecoder, SwayProtocolError } from './ipc'

describe('i3 IPC framing', () => {
  it('encodes the documented little endian header and UTF-8 byte length', () => {
    const frame = encodeFrame(0x80000003, { name: 'é' })
    expect(frame.subarray(0, 14)).toEqual(Buffer.from([
      105,
      51,
      45,
      105,
      112,
      99,
      13,
      0,
      0,
      0,
      3,
      0,
      0,
      128,
    ]))
    expect(frame.subarray(14).toString()).toBe('{"name":"é"}')
  })

  it('decodes split headers, split payloads and concatenated frames', () => {
    const decoder = new FrameDecoder()
    const frame = encodeFrame(4, { name: 'é' })
    for (const byte of frame.subarray(0, -1))
      expect(decoder.push(Buffer.from([byte]))).toEqual([])
    expect(decoder.push(Buffer.concat([frame.subarray(-1), encodeFrame(2, { success: true })])))
      .toEqual([{ type: 4, payload: { name: 'é' } }, { type: 2, payload: { success: true } }])
    expect(() => decoder.finish()).not.toThrow()
  })

  it.each(['magic', 'length', 'json', 'utf8'] as const)('rejects malformed %s without exposing payloads', (kind) => {
    const frame = encodeFrame(4, 'private title')
    if (kind === 'magic')
      frame[0] = 0
    if (kind === 'length')
      frame.writeUInt32LE(0xFFFFFFFF, 6)
    if (kind === 'json')
      frame[14] = 0
    if (kind === 'utf8')
      frame[15] = 0xFF
    expect(() => new FrameDecoder().push(frame)).toThrow(new SwayProtocolError())
  })

  it('rejects an unfinished frame when the stream closes', () => {
    const decoder = new FrameDecoder()
    decoder.push(encodeFrame(4, {}).subarray(0, -1))
    expect(() => decoder.finish()).toThrow(SwayProtocolError)
  })

  it('only permits GET_TREE, GET_OUTPUTS and window and output SUBSCRIBE requests', () => {
    const decoder = new FrameDecoder()
    const requests = [encodeRequest(4), encodeRequest(3), encodeRequest(2)]
    expect(requests[0]?.subarray(14).length).toBe(0)
    expect(requests[1]?.subarray(14).length).toBe(0)
    expect(requests[1]?.readUInt32LE(10)).toBe(3)
    expect(decoder.push(requests[2] ?? Buffer.alloc(0))).toEqual([{ type: 2, payload: ['window', 'output'] }])
    for (const forbidden of [0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 100, 101])
      expect(() => Reflect.apply(encodeRequest, undefined, [forbidden])).toThrow(SwayProtocolError)
  })
})
