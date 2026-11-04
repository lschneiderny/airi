/** The kinds a clip can be exposed as: gestures ride on the ACT `action` field, actions and dances on `perform_action`. */
export const EXPOSED_ACTION_KINDS = ['gesture', 'action', 'dance'] as const

export type ExposedActionKind = typeof EXPOSED_ACTION_KINDS[number]

export interface ExposedAction {
  label: string
  kind: ExposedActionKind
}

// The same slug rule as the stage's `normalizeActionLabel` in `@proj-airi/pipelines-audio`.
const labelPattern = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * Parses the `--exposed-actions` flag: comma-separated `label:kind` pairs, for example `wave:gesture,moonwalk:dance`.
 *
 * Use when:
 * - A qa-tools command takes the exposed clips of a run from the command line.
 *
 * Expects:
 * - `value` is operator input; every pair needs a slug label and one of the three kinds, and a label appears once
 *
 * Returns:
 * - The pairs in the order given
 *
 * Throws:
 * - An `Error` naming the offending pair when one is malformed, has an unknown kind, or repeats a label
 */
export function parseExposedActions(value: string): ExposedAction[] {
  const seen = new Set<string>()
  return value.split(',').map((pair) => {
    const parts = pair.split(':')
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '')
      throw new Error(`expected label:kind, got ${JSON.stringify(pair)}`)
    const [label, written] = parts
    if (!labelPattern.test(label))
      throw new Error(`invalid label ${JSON.stringify(label)}: use lowercase letters, digits and '-' (at most 32 characters)`)
    const kind = EXPOSED_ACTION_KINDS.find(known => known === written)
    if (kind === undefined)
      throw new Error(`unknown kind ${JSON.stringify(written)} for label ${JSON.stringify(label)}: use ${EXPOSED_ACTION_KINDS.join(', ')}`)
    if (seen.has(label))
      throw new Error(`duplicate label ${JSON.stringify(label)}`)
    seen.add(label)
    return { label, kind }
  })
}

/**
 * Renders the `actions` system-prompt section the way stage-ui's `useStageActionsPrompt` does: one sentence for the
 * gesture labels and one for the action and dance labels, each omitted when its list is empty.
 * The text is empty when nothing is exposed. A test pins it against the stage-ui output.
 */
export function renderActionsSection(exposed: readonly ExposedAction[], t: (key: string, params?: Record<string, string>) => string): string {
  const gestures = exposed.filter(entry => entry.kind === 'gesture').map(entry => entry.label)
  const actions = exposed.filter(entry => entry.kind !== 'gesture').map(entry => entry.label)
  return [
    ...gestures.length ? [t('base.prompt.actions-gestures', { gestures: gestures.join(', ') })] : [],
    ...actions.length ? [t('base.prompt.actions-actions', { actions: actions.join(', ') })] : [],
  ].join('\n')
}
