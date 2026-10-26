import { describe, expect, it } from 'vitest'

import { chatActivityFrom } from './chat-activity'

const now = 1_000_000
const sent = { sentSeq: 3, sentWords: 7 }

describe('chatActivityFrom', () => {
  it('reports typing within 1.5 s of a draft change', () => {
    expect(chatActivityFrom([{ hasDraft: true, lastInputAtMs: now - 1500 }], now, sent)).toEqual({ typing: true, sentSeq: 3, sentWords: 7 })
  })

  it('stops typing 1.6 s after the last draft change', () => {
    expect(chatActivityFrom([{ hasDraft: true, lastInputAtMs: now - 1600 }], now, sent).typing).toBe(false)
  })

  it('ignores a recent report without a draft', () => {
    expect(chatActivityFrom([{ hasDraft: false, lastInputAtMs: now }], now, sent).typing).toBe(false)
  })

  it('types while any one of several composers is typing', () => {
    const reports = [
      { hasDraft: true, lastInputAtMs: now - 4000 },
      { hasDraft: false, lastInputAtMs: now },
      { hasDraft: true, lastInputAtMs: now - 200 },
    ]
    expect(chatActivityFrom(reports, now, sent).typing).toBe(true)
    expect(chatActivityFrom(reports.slice(0, 2), now, sent).typing).toBe(false)
    expect(chatActivityFrom([], now, sent).typing).toBe(false)
  })
})
