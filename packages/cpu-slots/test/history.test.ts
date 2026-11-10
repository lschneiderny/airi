import type { HistoryEvent } from '../src/history'

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { appendHistory, historyRoot, parseSince, readHistory } from '../src/history'

let root: string
const record: HistoryEvent = {
  ts: 1_000,
  event: 'grant',
  id: 'one',
  seq: 1,
  class: 'live',
  min: 4,
  max: 6,
  slots: 6,
  budget: 12,
  heldBefore: 0,
  queueAhead: 0,
  waitMs: 100,
  heldMs: 0,
  lastWaitReason: null,
  pid: 10,
  cwd: '/worktree',
  command: 'qa:smoke',
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-history-'))
  vi.stubEnv('AIRI_CPU_SLOTS_HISTORY_DIR', root)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

it.each(['ticket', 'wait', 'grant', 'release', 'abort', 'unreadable'] as const)('persists the JSONL storage contract for %s', (event) => {
  appendHistory({ ...record, event })
  expect(readFileSync(join(root, 'events.jsonl'), 'utf8')).toBe(`${JSON.stringify({ ...record, event })}\n`)
})

it('rotates only after the current file exceeds five megabytes and retains the previous segment', () => {
  const path = join(root, 'events.jsonl')
  writeFileSync(path, ' '.repeat(5 * 1024 * 1024))
  appendHistory(record)
  expect(existsSync(join(root, 'events.1.jsonl'))).toBe(false)
  appendHistory({ ...record, id: 'two' })
  expect(readFileSync(join(root, 'events.1.jsonl'), 'utf8')).toContain('"id":"one"')
  expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify({ ...record, id: 'two' })}\n`)
})

it('aggregates grants and releases once each, reads rotated history, and counts malformed records', () => {
  writeFileSync(join(root, 'events.1.jsonl'), `${JSON.stringify({ ...record, event: 'ticket' })}\n${JSON.stringify(record)}\n`)
  appendHistory({ ...record, event: 'release', heldMs: 400 })
  appendHistory({ ...record, id: 'two', waitMs: 300 })
  appendHistory({ ...record, id: 'two', event: 'release', heldMs: 800 })
  appendFileSync(join(root, 'events.jsonl'), 'not json\n{}\nnull\n')
  expect(readHistory()).toEqual({
    malformed: 3,
    classes: { live: { count: 2, waitMs: { median: 200, p90: 300 }, heldMs: { median: 600, p90: 800 } } },
    topWaits: [{ ...record, id: 'two', waitMs: 300 }, record],
  })
})

it('filters by timestamp before aggregation and limits the slowest waits to five', () => {
  for (let index = 0; index < 10; index++)
    appendHistory({ ...record, ts: index * 1_000, id: String(index), waitMs: index * 100 })
  const summary = readHistory(3_000)
  expect(summary.classes.live).toEqual({ count: 7, waitMs: { median: 600, p90: 900 }, heldMs: { median: 0, p90: 0 } })
  expect(summary.topWaits.map(event => event.id)).toEqual(['9', '8', '7', '6', '5'])
})

it('reads missing history without creating a directory', () => {
  vi.stubEnv('AIRI_CPU_SLOTS_HISTORY_DIR', join(root, 'missing'))
  expect(readHistory()).toEqual({ malformed: 0, classes: {}, topWaits: [] })
  expect(existsSync(historyRoot())).toBe(false)
})

it.each([['10ms', 10], ['2s', 2_000], ['3m', 180_000], ['4h', 14_400_000], ['1d', 86_400_000]])('parses duration %s', (input, expected) => {
  expect(parseSince(input)).toBe(expected)
})

it.each(['', 'garbage', '-1h', 'Infinity', '0s', '999999999999999999d'])('rejects malformed duration %j', (input) => {
  expect(() => parseSince(input)).toThrow('bad duration')
})
