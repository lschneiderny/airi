import { Buffer } from 'node:buffer'

/** 24 kHz mono signed 16-bit PCM silence, 50 ms per code point, bounded to 0.25-30 s. */
export function encodeSpeech(input: string): Buffer {
  const samples = Math.round(Math.min(30, Math.max(0.25, Array.from(input).length * 0.05)) * 24000)
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  return wav
}
