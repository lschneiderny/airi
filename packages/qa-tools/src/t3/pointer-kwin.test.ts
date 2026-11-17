import { describe, expect, it } from 'vitest'

import { parseKwinProbe } from './pointer-kwin'

describe('kwin pointer helper probe', () => {
  it('parses probe results with and without the output geometry', () => {
    expect(parseKwinProbe('{"ok":true,"missing":[],"screen":{"x":0,"y":0,"width":1920,"height":1080}}').screen?.width).toBe(1920)
    expect(parseKwinProbe('{"ok":false,"missing":["libei.so.1: not found"]}')).toEqual({ ok: false, missing: ['libei.so.1: not found'] })
  })

  it('rejects malformed probe output', () => {
    expect(() => parseKwinProbe('garbage')).toThrow()
    expect(() => parseKwinProbe('{"ok":true}')).toThrow()
  })
})
