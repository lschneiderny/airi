import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runT1 } from '../motion/t1/runner'
import { loadT3Scenario } from './args'
import { compareScenarioEvents, parseTraceEvents, scenarioEventsOf } from './verify-trace'

const fixtures = resolve(import.meta.dirname, '..', '..', 'fixtures')

describe('builtin t3-smoke scenario', () => {
  const { scenario } = loadT3Scenario('builtin:t3-smoke', { fixturesDir: resolve(fixtures, 'scenarios'), cwd: fixtures })

  it('has eight clear pulses, one ACT, one expression toggle and two screenshots per pulse', () => {
    const pulses = scenario.events.filter(event => event.kind === 'emotion')
    expect(pulses.map(event => event.kind === 'emotion' && event.emotion)).toEqual(['happy', 'sad', 'angry', 'surprised', 'think', 'love', 'flustered', 'sleepy'])
    expect(scenario.events.filter(event => event.kind === 'act')).toHaveLength(1)
    expect(scenario.events.filter(event => event.kind === 'expression').map(event => event.kind === 'expression' && event.on)).toEqual([true, false])
    expect(scenario.screenshotsAt).toEqual(pulses.flatMap(event => [event.at + 1, event.at + 3]))
  })

  // Idle cost 0.53 s (one runT1 simulation); 6.1 s under load, so 20 s.
  it('runs unchanged at T1 and stamps the same scenario events', () => {
    const catalog = JSON.parse(readFileSync(resolve(fixtures, 'forbooth-catalog.json'), 'utf8')) as CatalogEntry[]
    const trace = parseTraceEvents(runT1(scenario, { catalog }))
    expect(compareScenarioEvents(scenario.events, scenarioEventsOf(trace))).toEqual([])
  }, 20_000)
})
