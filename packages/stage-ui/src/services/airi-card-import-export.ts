import type { Card, ccv3 } from '@proj-airi/ccc'
import type { CharacterStateRecordV1 } from '@proj-airi/stage-shared/character-state'
import type { GenericSchema, InferOutput } from 'valibot'

import type { DisplayModel, useDisplayModelsStore } from '../stores/display-models'
import type { AiriCard, AiriExtension } from '../types/airiCard'
import type { MemoryWrite } from '../types/memory'

import JSZip from 'jszip'

import { errorMessageFrom } from '@moeru/std'
import { exportToJSON } from '@proj-airi/ccc'
import { migrateCharacterState } from '@proj-airi/stage-shared/character-state'
import { array, literal, object, optional, parse, picklist, record, string, unknown as unknownSchema } from 'valibot'

import { wakeWordSchema } from '../libs/voice/wake-words'
import { characterProfileOf, characterStateContext } from '../stores/character-state'
import { DisplayModelFormat } from '../stores/display-models'

const FORMAT = 'airi-character-card'
const VERSION = 1
const CARD_PATH = 'card.json'
const MANIFEST_PATH = 'manifest.json'
const MEMORIES_PATH = 'memories.json'
const CHARACTER_STATE_PATH = 'character-state.json'
/**
 * The card id an imported state record carries until the card exists. `importRecord` of the character-state store
 * migrates the record again under the new card's id.
 */
const IMPORTED_CARD_ID = 'imported-card'
const MODEL_EXT: Partial<Record<DisplayModelFormat, string>> = {
  [DisplayModelFormat.Live2dZip]: 'zip',
  [DisplayModelFormat.SpineZip]: 'zip',
  [DisplayModelFormat.TachieZip]: 'tachie.zip',
  [DisplayModelFormat.VRM]: 'vrm',
}

type DisplayModelsStore = ReturnType<typeof useDisplayModelsStore>
type ShareableAiriCard = Card & { extensions: { airi: AiriExtension } }

const manifestSchema = object({
  format: literal(FORMAT),
  version: literal(VERSION),
  card: object({ path: literal(CARD_PATH), spec: literal('chara_card_v3') }),
  resources: optional(object({
    displayModel: optional(object({
      path: string(),
      format: picklist([DisplayModelFormat.Live2dZip, DisplayModelFormat.SpineZip, DisplayModelFormat.TachieZip, DisplayModelFormat.VRM]),
      name: string(),
    })),
    memories: optional(object({ path: literal(MEMORIES_PATH) })),
    characterState: optional(object({ path: literal(CHARACTER_STATE_PATH) })),
  })),
})

const memoriesFileSchema = array(object({ description: string(), body: string() }))

const characterCardV3Schema = object({
  spec: literal('chara_card_v3'),
  spec_version: literal('3.0'),
  data: object({
    name: string(),
    nickname: optional(string()),
    character_version: optional(string(), '1.0.0'),
    description: optional(string(), ''),
    personality: optional(string(), ''),
    scenario: optional(string(), ''),
    first_mes: optional(string(), ''),
    alternate_greetings: optional(array(string()), []),
    creator_notes: optional(string(), ''),
    system_prompt: optional(string(), ''),
    post_history_instructions: optional(string(), ''),
    extensions: optional(record(string(), unknownSchema()), {}),
  }),
})

type CharacterCardPackageJson = InferOutput<typeof characterCardV3Schema>

type AiriCardPackageErrorCode = 'missing-file' | 'invalid-file'
type Manifest = InferOutput<typeof manifestSchema>

export class AiriCardPackageError extends Error {
  constructor(public readonly code: AiriCardPackageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AiriCardPackageError'
  }
}

/**
 * Creates a portable AIRI Card share package.
 *
 * This format is intentionally not a lossless backup. It includes fields the
 * creation editor lets the sender review, a sanitized AIRI module subset, and
 * the selected display model, the card's own memories, never shared ones, and
 * the card's character state (mood, temperament, relationship) when given.
 * Unreviewed CCv3 metadata, custom extensions,
 * agent prompts, and machine-local runtime references are omitted.
 */
export async function exportAiriCardPackage({ card, displayModelsStore, memories, characterState }: { card: AiriCard, displayModelsStore: DisplayModelsStore, memories?: MemoryWrite[], characterState?: CharacterStateRecordV1 | null }): Promise<Blob> {
  const exportableCard = cardFromAiriCard(card)
  const displayModel = await exportDisplayModel(exportableCard, displayModelsStore)
  const manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    card: { path: CARD_PATH, spec: 'chara_card_v3' },
    resources: {
      ...(displayModel ? { displayModel: displayModel.manifest } : {}),
      ...(memories?.length ? { memories: { path: MEMORIES_PATH } } : {}),
      ...(characterState ? { characterState: { path: CHARACTER_STATE_PATH } } : {}),
    },
  }
  const zip = new JSZip()

  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  zip.file(CARD_PATH, JSON.stringify(exportToJSON(exportableCard), null, 2))
  if (memories?.length)
    zip.file(MEMORIES_PATH, JSON.stringify(memories, null, 2))
  if (characterState)
    zip.file(CHARACTER_STATE_PATH, JSON.stringify(characterState, null, 2))
  if (displayModel)
    zip.file(displayModel.manifest.path, displayModel.data)

  return zip.generateAsync({ type: 'blob' })
}

/**
 * Imports a portable package through the same share-field whitelist.
 *
 * The returned CCv3 object is safe to pass through the normal card creation
 * path: package authors cannot smuggle custom extensions, agent prompts, or
 * machine-local references into persisted AIRI state.
 *
 * `characterState` is the packaged state record through `migrateCharacterState`,
 * or `null` when the package has none or its entry cannot be read; the caller
 * then starts the card's state fresh from its profile. A damaged state entry
 * never fails the import.
 */
export async function importAiriCardPackage({ file, displayModelsStore }: { file: File, displayModelsStore: DisplayModelsStore }): Promise<{ card: ccv3.CharacterCardV3, memories: MemoryWrite[], characterState: CharacterStateRecordV1 | null }> {
  const zip = await loadZip(file)
  const manifest = await readJsonFile(zip, MANIFEST_PATH, manifestSchema)
  const cardJson = await readJsonFile(zip, manifest.card.path, characterCardV3Schema)
  const memories = manifest.resources?.memories
    ? await readJsonFile(zip, manifest.resources.memories.path, memoriesFileSchema)
    : []
  const displayModelId = await importDisplayModel(zip, manifest, displayModelsStore)
  const card = cardFromCharacterCard(cardJson, displayModelId)
  const characterState = manifest.resources?.characterState
    ? await readCharacterState(zip, manifest.resources.characterState.path, card.extensions.airi)
    : null

  return { card: exportToJSON(card), memories, characterState }
}

/** The packaged state record through `migrateCharacterState`, or `null` with a warning when the entry is missing or not JSON. */
async function readCharacterState(zip: JSZip, path: string, airi: AiriExtension): Promise<CharacterStateRecordV1 | null> {
  try {
    const file = zip.file(path)
    if (!file)
      throw new Error(`Missing ${path}`)
    const value: unknown = JSON.parse(await file.async('string'))
    return migrateCharacterState(value, IMPORTED_CARD_ID, characterProfileOf(airi.modules.character), characterStateContext(Date.now()))
  }
  catch (cause) {
    console.warn('[airi-card-import-export] Ignoring the unreadable character state:', errorMessageFrom(cause) ?? 'unknown error')
    return null
  }
}

async function exportDisplayModel(card: ShareableAiriCard, store: DisplayModelsStore) {
  const displayModelId = card.extensions.airi.modules.displayModelId
  if (!displayModelId)
    return

  const model = await store.getDisplayModel(displayModelId)
  if (!model) {
    if (displayModelId.startsWith('display-model-'))
      throw error('invalid-file', 'Missing local display model')
    return
  }

  const modelExt = MODEL_EXT[model.format]
  if (!modelExt)
    throw error('invalid-file', 'Unsupported or empty local display model')

  const payload = await displayModelPayload(model)

  return {
    data: payload.data,
    manifest: {
      format: model.format,
      name: payload.file.name,
      path: `models/body-model.${modelExt}`,
    },
  }
}

async function importDisplayModel(zip: JSZip, manifest: Manifest, store: DisplayModelsStore) {
  const resource = manifest.resources?.displayModel
  if (!resource)
    return

  const file = zip.file(resource.path)
  if (!file)
    throw error('missing-file', 'Missing display model file')

  try {
    const data = await file.async('arraybuffer')
    return (await store.addDisplayModel(resource.format, new File([data], resource.name))).id
  }
  catch (cause) {
    throw error('invalid-file', 'Failed to import display model file', { cause })
  }
}

async function loadZip(file: File) {
  try {
    return await JSZip.loadAsync(await file.arrayBuffer())
  }
  catch (cause) {
    throw error('invalid-file', 'Invalid zip file', { cause })
  }
}

async function readJsonFile<S extends GenericSchema>(zip: JSZip, path: string, schema: S): Promise<InferOutput<S>> {
  const file = zip.file(path)
  if (!file)
    throw error('missing-file', `Missing ${path}`)

  try {
    return parse(schema, JSON.parse(await file.async('string')))
  }
  catch (cause) {
    throw error('invalid-file', `Invalid ${path}`, { cause })
  }
}

function cardFromAiriCard(card: AiriCard): ShareableAiriCard {
  return {
    name: card.name,
    nickname: card.nickname,
    version: card.version,
    description: card.description ?? '',
    personality: card.personality ?? '',
    scenario: card.scenario ?? '',
    greetings: card.greetings ?? [],
    notes: card.notes ?? '',
    systemPrompt: card.systemPrompt ?? '',
    postHistoryInstructions: card.postHistoryInstructions ?? '',
    extensions: { airi: sanitizeAiri(card.extensions?.airi) },
  }
}

function cardFromCharacterCard(card: CharacterCardPackageJson, displayModelId?: string): ShareableAiriCard {
  const data = card.data
  return {
    name: data.name,
    nickname: data.nickname,
    version: data.character_version,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    greetings: [data.first_mes, ...(data.alternate_greetings ?? [])],
    notes: data.creator_notes,
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    extensions: { airi: sanitizeAiri(data.extensions?.airi, displayModelId) },
  }
}

function sanitizeAiri(value: unknown, displayModelIdOverride?: string): AiriExtension {
  const source = isRecord(value) ? value : {}
  const modules = isRecord(source.modules) ? source.modules : {}
  const artistry = isRecord(modules.artistry) ? modules.artistry : {}
  const speech = isRecord(modules.speech) ? modules.speech : {}
  const displayModelId = displayModelIdOverride ?? stringValue(modules.displayModelId)

  return {
    ...(source.wakeWords === undefined ? {} : { wakeWords: parse(array(wakeWordSchema), source.wakeWords) }),
    modules: {
      character: characterProfileOf(modules.character),
      consciousness: providerModel(modules.consciousness),
      vision: providerModel(modules.vision),
      speech: {
        ...providerModel(modules.speech),
        voice_id: stringValue(speech.voice_id),
      },
      ...(displayModelId ? { displayModelId } : {}),
      artistry: {
        ...(typeof artistry.provider === 'string' ? { provider: artistry.provider } : {}),
        ...(typeof artistry.model === 'string' ? { model: artistry.model } : {}),
        ...(typeof artistry.promptPrefix === 'string' ? { promptPrefix: artistry.promptPrefix } : {}),
        ...(typeof artistry.widgetInstruction === 'string' ? { widgetInstruction: artistry.widgetInstruction } : {}),
        ...(isSpawnMode(artistry.spawnMode) ? { spawnMode: artistry.spawnMode } : {}),
        ...(isRecord(artistry.options) ? { options: artistry.options } : {}),
        ...(typeof artistry.autonomousEnabled === 'boolean' ? { autonomousEnabled: artistry.autonomousEnabled } : {}),
        ...(typeof artistry.autonomousThreshold === 'number' ? { autonomousThreshold: artistry.autonomousThreshold } : {}),
      },
    },
    agents: {},
  }
}

function providerModel(value: unknown) {
  const source = isRecord(value) ? value : {}
  return { provider: stringValue(source.provider), model: stringValue(source.model) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isSpawnMode(value: unknown): value is NonNullable<AiriExtension['modules']['artistry']>['spawnMode'] {
  return value === 'bg' || value === 'widget' || value === 'inline' || value === 'bg_widget'
}

async function displayModelPayload(model: DisplayModel): Promise<{ data: ArrayBuffer, file: File }> {
  try {
    const response = model.type === 'url' ? await fetch(model.url) : undefined
    if (response && !response.ok)
      throw new Error(`Failed to read display model URL: ${response.status} ${response.statusText}`)

    const file = model.type === 'file' ? model.file : new File([await response!.blob()], `${model.name}.${MODEL_EXT[model.format]}`)
    if (file.size <= 0)
      throw new Error('Display model file is empty')
    return { data: await file.arrayBuffer(), file }
  }
  catch (cause) {
    throw error('invalid-file', 'Failed to read display model file', { cause })
  }
}

function error(code: AiriCardPackageErrorCode, message: string, options?: { cause?: unknown }) {
  return new AiriCardPackageError(code, message, options)
}
