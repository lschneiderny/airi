import type { SituationState } from '.'

import { describe, expect, it } from 'vitest'

import { heldTitles, initialSituationState, repeatsHeldTitle } from '.'

const T0 = 1_700_000_000_000

function stateWith(overrides: Partial<SituationState>): SituationState {
  return { ...initialSituationState, ...overrides }
}

describe('heldTitles', () => {
  it('lists the window title and every context title', () => {
    const state = stateWith({
      activity: { appId: 'firefox', label: 'Firefox', category: 'browser', title: 'Quarterly tax return 2026', sinceMs: T0 },
      contexts: {
        'extension:page': { text: 'User is browsing: Budget spreadsheet (https://example.test).', title: 'Budget spreadsheet', atMs: T0 },
        'vision': { text: 'A cat on the desk', title: null, atMs: T0 },
      },
    })

    expect(heldTitles(state)).toEqual(['Quarterly tax return 2026', 'Budget spreadsheet'])
  })

  it('is empty while the situation holds no title', () => {
    const state = stateWith({
      activity: { appId: 'firefox', label: 'Firefox', category: 'browser', title: null, sinceMs: T0 },
      contexts: { vision: { text: 'A cat on the desk', title: null, atMs: T0 } },
    })

    expect(heldTitles(initialSituationState)).toEqual([])
    expect(heldTitles(state)).toEqual([])
  })
})

describe('repeatsHeldTitle', () => {
  const titles = ['Quarterly Tax Return 2026']

  it('matches the whole title in any case', () => {
    expect(repeatsHeldTitle('The owner works on the quarterly tax return 2026 tonight.', titles)).toBe(true)
  })

  it('matches a title that the text wraps or pads', () => {
    expect(repeatsHeldTitle('Works on Quarterly  Tax\nReturn\t2026.', titles)).toBe(true)
    expect(repeatsHeldTitle('Works on Quarterly Tax Return 2026.', ['  Quarterly   Tax Return 2026 '])).toBe(true)
  })

  it('does not match a part of the title', () => {
    expect(repeatsHeldTitle('The owner files a tax return every quarter.', titles)).toBe(false)
  })

  it('never matches a title shorter than 8 characters', () => {
    expect(repeatsHeldTitle('The owner reads mail every morning.', ['Mail'])).toBe(false)
    expect(repeatsHeldTitle('Opened Inbox 1 again.', ['Inbox 1'])).toBe(false)
    expect(repeatsHeldTitle('Opened Inbox 12 again.', ['Inbox 12'])).toBe(true)
  })

  it('matches nothing without titles', () => {
    expect(repeatsHeldTitle('The owner works on the quarterly tax return 2026.', [])).toBe(false)
  })
})
