import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

/**
 * Scenarios name expressions by catalog id (what T1 resolves against the rig's catalog fixture), while the rendered
 * app keys expressions by their archive-relative `.exp3.json` path. This rewrites each `expression` event whose id is a
 * catalog entry to that entry's `fileName`; the harness zips the directory that holds the `*.model3.json`, so the
 * file name is the archive path. Ids that are not in the catalog, and entries with an empty `fileName` (combos and custom entries have no archive path), stay as they are, so the bridge rejects them and the
 * run fails instead of toggling a different expression.
 */
export function toRenderedExpressionIds(scenario: MotionScenario, catalog: readonly CatalogEntry[]): { scenario: MotionScenario, mapped: Record<string, string> } {
  const mapped: Record<string, string> = {}
  const events = scenario.events.map((event) => {
    if (event.kind !== 'expression')
      return event
    const entry = catalog.find(candidate => candidate.id === event.expressionId)
    if (!entry || !entry.fileName || entry.fileName === event.expressionId)
      return event
    mapped[event.expressionId] = entry.fileName
    return { ...event, expressionId: entry.fileName }
  })
  return { scenario: { ...scenario, events }, mapped }
}
