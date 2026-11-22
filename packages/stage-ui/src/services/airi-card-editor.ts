import type { Card } from '@proj-airi/ccc'
import type { CatalogEntry, PerformanceProfile } from '@proj-airi/stage-shared/expression-performance'

import type { AiriExtension } from '../types/airiCard'

import { PerformanceProfileSchema } from '@proj-airi/stage-shared/expression-performance'
import { omit } from 'es-toolkit'
import {
  check,
  nonEmpty,
  object,
  objectWithRest,
  parse,
  parseJson,
  pipe,
  regex,
  safeParse,
  string,
  trim,
  unknown,
} from 'valibot'

import { normalizeContextWindow, normalizeTemperature } from '../types/airiCard'

export type AiriCardDraftValidationError = 'name' | 'version' | 'invalid_artistry_json'

/** Only the selected character model's live catalog may supply mapping controls. */
export function getAiriCardMappingEditor(modelId: string, backend: { readonly modelId: string, readonly catalog: readonly CatalogEntry[] }) {
  if (!modelId || backend.modelId !== modelId || backend.catalog.length === 0)
    return { loaded: false as const }
  return { loaded: true as const, modelId, entries: backend.catalog.filter(entry => entry.mappings.length > 0) }
}

/** Returns a new profile; identity removes the entry override and leaves other models untouched. */
export function setAiriCardMappingWeight(profile: PerformanceProfile | undefined, modelId: string, entryId: string, weight: number): PerformanceProfile {
  const weights = { ...profile?.mappingWeights?.[modelId] }
  if (weight === 1)
    delete weights[entryId]
  else
    weights[entryId] = weight
  const mappingWeights = { ...profile?.mappingWeights }
  if (Object.keys(weights).length === 0)
    delete mappingWeights[modelId]
  else
    mappingWeights[modelId] = weights
  return parse(PerformanceProfileSchema, { ...profile, mappingWeights })
}

/** Module settings owned by the AIRI Card editor form. */
interface AiriCardEditorModules {
  /** Stored at the extension level, not under `modules`. */
  contextWindow?: number
  /** Stored at the extension level, not under `modules`. `undefined` removes the stored temperature. */
  temperature: number | undefined
  performance?: AiriExtension['modules']['performance']
  consciousness: AiriExtension['modules']['consciousness']
  vision: AiriExtension['modules']['vision']
  speech: Pick<AiriExtension['modules']['speech'], 'provider' | 'model' | 'voice_id'>
  artistry: Pick<
    NonNullable<AiriExtension['modules']['artistry']>,
    | 'provider'
    | 'model'
    | 'promptPrefix'
    | 'widgetInstruction'
    | 'spawnMode'
    | 'options'
    | 'autonomousEnabled'
    | 'autonomousThreshold'
  >
}

/**
 * Reads the module fields that the AIRI Card editor owns.
 *
 * Empty strings mean that the card inherits the corresponding global setting.
 */
export function getAiriCardEditorModuleSettings(
  card: Card | undefined,
): Pick<AiriCardEditorModules, 'consciousness' | 'vision' | 'speech' | 'performance' | 'temperature'> & { contextWindow: number, displayModelId: string } {
  const stored = card?.extensions?.airi
  const extension = isAiriExtension(stored) ? stored : undefined
  const modules = getAiriCardModules(extension)

  return {
    contextWindow: normalizeContextWindow(isRecord(stored) ? stored.contextWindow : undefined),
    temperature: normalizeTemperature(isRecord(stored) ? stored.temperature : undefined),
    ...(modules?.performance === undefined ? {} : { performance: parse(PerformanceProfileSchema, modules.performance) }),
    consciousness: {
      provider: getModuleString(modules?.consciousness, 'provider'),
      model: getModuleString(modules?.consciousness, 'model'),
    },
    vision: {
      provider: getModuleString(modules?.vision, 'provider'),
      model: getModuleString(modules?.vision, 'model'),
    },
    speech: {
      provider: getModuleString(modules?.speech, 'provider'),
      model: getModuleString(modules?.speech, 'model'),
      voice_id: getModuleString(modules?.speech, 'voice_id'),
    },
    displayModelId: extension?.avatarModels?.find(model => model.id === extension.defaultAvatarModelId)?.displayModelId ?? '',
  }
}

type CardWithAiriExtension = Card & {
  extensions: NonNullable<Card['extensions']> & {
    airi: AiriExtension
  }
}

export type AiriCardDraftValidationResult
  = | {
    success: true
    output: {
      card: Card
      artistryOptions: Record<string, unknown> | undefined
    }
  }
  | {
    success: false
    error: AiriCardDraftValidationError
  }

const cardDraftSchema = object({
  name: pipe(string(), trim(), nonEmpty()),
  version: pipe(string(), trim(), regex(/^(?:\d+\.)+\d+$/)),
})

const artistryOptionsSchema = pipe(
  string(),
  trim(),
  parseJson(),
  check(isRecord),
  objectWithRest({}, unknown()),
)

/**
 * Validates and normalizes the fields owned by the AIRI Card editor.
 *
 * Display text remains untouched except for boundary whitespace on the
 * required name and version fields. Artistry options must be a JSON object
 * when present.
 */
export function safeParseAiriCardDraft(card: Card, artistryOptionsJson: string): AiriCardDraftValidationResult {
  const cardResult = safeParse(cardDraftSchema, card)
  if (!cardResult.success) {
    const invalidField = cardResult.issues[0]?.path?.[0]?.key
    return {
      success: false,
      error: invalidField === 'version' ? 'version' : 'name',
    }
  }

  const normalizedArtistryOptions = artistryOptionsJson.trim()
  if (!normalizedArtistryOptions) {
    return {
      success: true,
      output: {
        card: { ...card, ...cardResult.output },
        artistryOptions: undefined,
      },
    }
  }

  const artistryResult = safeParse(artistryOptionsSchema, normalizedArtistryOptions)
  if (!artistryResult.success) {
    return {
      success: false,
      error: 'invalid_artistry_json',
    }
  }

  return {
    success: true,
    output: {
      card: { ...card, ...cardResult.output },
      artistryOptions: artistryResult.output,
    },
  }
}

/**
 * Applies editor-owned module fields to a complete character card.
 *
 * The returned card preserves extension fields the form cannot display,
 * including body models, backgrounds, advanced speech/artistry settings, and
 * agent configuration.
 */
export function applyAiriCardEditorModules(
  card: Card,
  edited: AiriCardEditorModules,
): CardWithAiriExtension {
  const existing = isAiriExtension(card.extensions?.airi)
    ? card.extensions.airi
    : undefined
  const temperature = normalizeTemperature(edited.temperature)
  const existingModules = { ...existing?.modules }
  Reflect.deleteProperty(existingModules, 'displayModelId')

  return {
    ...card,
    extensions: {
      ...card.extensions,
      airi: {
        // The form states the temperature on every save, so the stored one is replaced or removed, never kept.
        ...(existing && omit(existing, ['temperature'])),
        ...(edited.contextWindow === undefined ? {} : { contextWindow: normalizeContextWindow(edited.contextWindow) }),
        ...(temperature === undefined ? {} : { temperature }),
        avatarModels: existing?.avatarModels ?? [],
        modules: {
          ...existingModules,
          consciousness: edited.consciousness,
          vision: edited.vision,
          ...(edited.performance === undefined
            ? {}
            : {
                performance: parse(PerformanceProfileSchema, { ...existing?.modules.performance, ...edited.performance }),
              }),
          speech: {
            ...existing?.modules.speech,
            ...edited.speech,
          },
          artistry: {
            ...existing?.modules.artistry,
            ...edited.artistry,
          },
        },
        agents: existing?.agents ?? {},
      },
    },
  }
}

function isAiriExtension(value: unknown): value is AiriExtension {
  return isRecord(value)
    && isRecord(value.modules)
    && isRecord(value.agents)
}

function getAiriCardModules(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.modules))
    return undefined

  return value.modules
}

function getModuleString(module: unknown, key: string): string {
  if (!isRecord(module))
    return ''

  const value = module[key]
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
