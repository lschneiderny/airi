import type { ExposedAction } from '../exposed-actions'

import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { CLOSENESS_STAGES } from '@proj-airi/stage-shared/character-state'
import { CONVERSATION_REGISTERS, TEXTING_FLAVORS } from '@proj-airi/stage-shared/conversation-register'

import * as v from 'valibot'

import { sha256Buffer } from '../../evidence/run'
import { parseExposedActions } from '../exposed-actions'

// A scenario id names the run directory, so it has no dot. A config name may have one, as in `temp-0.6`.
const scenarioId = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'use lowercase letters, digits and \'-\' (at most 64 characters)'))
const configName = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9.-]{0,31}$/, 'use lowercase letters, digits, \'.\' and \'-\' (at most 32 characters)'))

/**
 * One named set of request options. The keys are the wire names of an OpenAI-compatible chat completion request and
 * reach the request body unchanged; an omitted key is not sent, so the endpoint's own default applies.
 * A context size is not here: this endpoint shape has no request field for it.
 */
const ConfigSchema = v.strictObject({
  temperature: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(2))),
  top_p: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  max_tokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  seed: v.optional(v.pipe(v.number(), v.integer())),
  /** The values the app's Ollama provider sends for its thinking mode; `none` turns reasoning off. */
  reasoning_effort: v.optional(v.picklist(['none', 'low', 'medium', 'high'])),
})
export type ModelScenarioConfig = v.InferOutput<typeof ConfigSchema>

/**
 * Everything a live run fixes besides the endpoint and the model. Bump `version` with any change that alters a
 * request, so records of two versions are never read as one run.
 */
export const ModelScenarioSchema = v.strictObject({
  schema: v.literal('airi.model-scenario/v1'),
  id: scenarioId,
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  description: v.pipe(v.string(), v.nonEmpty()),
  /** Inputs of the production prompt composer. The stage contract is never an input: the run renders the current one. */
  prompt: v.strictObject({
    /** A card prompt file beside the scenario file. Without it, the run uses the app's built-in card. */
    cardFile: v.optional(v.pipe(v.string(), v.nonEmpty())),
    register: v.picklist(CONVERSATION_REGISTERS),
    textingFlavor: v.optional(v.picklist(TEXTING_FLAVORS)),
    /** Exposed clips in the `--exposed-actions` syntax, for example `wave:gesture`. Pass the same value to `score`. */
    exposedActions: v.optional(v.string()),
  }),
  /** Wall-clock time of the first user turn, `YYYY-MM-DDTHH:MM`. Each later turn is one minute after the one before. */
  startsAt: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'use YYYY-MM-DDTHH:MM')),
  /**
   * Relationship stages to compare. Each stage is its own conversation over the same turns. Without it, the turns
   * run once and the request carries no character context.
   */
  stages: v.optional(v.pipe(
    v.array(v.picklist(CLOSENESS_STAGES)),
    v.minLength(1),
    v.check(stages => new Set(stages).size === stages.length, 'a stage appears twice'),
  )),
  configs: v.pipe(
    v.record(configName, ConfigSchema),
    v.check(configs => Object.keys(configs).length > 0, 'define at least one config'),
  ),
  turns: v.pipe(v.array(v.pipe(v.string(), v.trim(), v.nonEmpty())), v.minLength(1)),
})
export type ModelScenario = v.InferOutput<typeof ModelScenarioSchema>

export interface LoadedScenario {
  scenario: ModelScenario
  /** Repository-relative path with forward slashes, as records name it. */
  file: string
  fileSha256: string
  /** The card prompt of `prompt.cardFile`, or `null` when the scenario uses the built-in card. */
  cardPrompt: string | null
  exposedActions: ExposedAction[]
}

function describeIssues(issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]): string {
  return issues.map(issue => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`).join('; ')
}

/**
 * Validates scenario JSON and the rules a schema cannot express.
 *
 * Throws:
 * - An `Error` naming each invalid field, or the exposed clip that needs a tool.
 */
export function parseScenario(value: unknown): { scenario: ModelScenario, exposedActions: ExposedAction[] } {
  const parsed = v.safeParse(ModelScenarioSchema, value)
  if (!parsed.success)
    throw new Error(describeIssues(parsed.issues))
  const scenario = parsed.output
  const exposedActions = scenario.prompt.exposedActions === undefined ? [] : parseExposedActions(scenario.prompt.exposedActions)
  // The prompt tells the model to call `perform_action` for an action or a dance. A run sends no tools, so that
  // instruction would name a tool the model does not have.
  const needsTool = exposedActions.find(action => action.kind !== 'gesture')
  if (needsTool)
    throw new Error(`prompt.exposedActions: ${JSON.stringify(needsTool.label)} is a ${needsTool.kind}, which needs the perform_action tool; a run sends no tools, so expose gestures only`)
  return { scenario, exposedActions }
}

/**
 * Loads a scenario by id from `packages/qa-tools/fixtures/model/scenarios/`, or from a `.json` path that resolves
 * against the repository root.
 *
 * Throws:
 * - An `Error` that names the file when it is missing, is not JSON, or is not a valid scenario.
 */
export async function loadScenario(reference: string, repoRoot: string): Promise<LoadedScenario> {
  const path = reference.endsWith('.json')
    ? resolve(repoRoot, reference)
    : resolve(repoRoot, 'packages/qa-tools/fixtures/model/scenarios', `${reference}.json`)
  try {
    const bytes = await readFile(path)
    const { scenario, exposedActions } = parseScenario(JSON.parse(bytes.toString('utf8')))
    return {
      scenario,
      file: relative(repoRoot, path).replaceAll('\\', '/'),
      fileSha256: sha256Buffer(bytes),
      cardPrompt: scenario.prompt.cardFile === undefined ? null : await readFile(resolve(dirname(path), scenario.prompt.cardFile), 'utf8'),
      exposedActions,
    }
  }
  catch (error) {
    throw new Error(`${path}: ${errorMessageFrom(error) ?? 'unreadable scenario'}`)
  }
}
