import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadT3Scenario } from './args'
import { toRenderedExpressionIds } from './expression-ids'

const fixtures = resolve(import.meta.dirname, '..', '..', 'fixtures')
const catalog = JSON.parse(readFileSync(resolve(fixtures, 'forbooth-catalog.json'), 'utf8')) as CatalogEntry[]
const { scenario } = loadT3Scenario('builtin:t3-smoke', { fixturesDir: resolve(fixtures, 'scenarios'), cwd: fixtures })

describe('toRenderedExpressionIds', () => {
  it('rewrites catalog ids to archive file names and keeps every other event', () => {
    const { scenario: rendered, mapped } = toRenderedExpressionIds(scenario, catalog)
    expect(mapped).toEqual({ expression1: 'expression1.exp3.json' })
    expect(rendered.events.filter(event => event.kind === 'expression').map(event => event.kind === 'expression' && event.expressionId)).toEqual(['expression1.exp3.json', 'expression1.exp3.json'])
    expect(rendered.events.map(event => [event.kind, event.at])).toEqual(scenario.events.map(event => [event.kind, event.at]))
    expect(scenario.events.find(event => event.kind === 'expression')).toMatchObject({ expressionId: 'expression1' })
  })

  it('leaves an entry with an empty fileName unmapped', () => {
    const combo = { ...catalog[0]!, id: 'pair', kind: 'combo' as const, fileName: '' }
    const events = [{ kind: 'expression' as const, at: 1, expressionId: 'pair', on: true }]
    const { scenario: rendered, mapped } = toRenderedExpressionIds({ ...scenario, events }, [combo])
    expect(mapped).toEqual({})
    expect(rendered.events).toEqual(events)
  })

  it('leaves ids outside the catalog unchanged so the bridge rejects them', () => {
    const unknown = { ...scenario, events: [{ kind: 'expression' as const, at: 1, expressionId: 'not-in-catalog', on: true }] }
    const { scenario: rendered, mapped } = toRenderedExpressionIds(unknown, catalog)
    expect(mapped).toEqual({})
    expect(rendered.events).toEqual(unknown.events)
  })
})
