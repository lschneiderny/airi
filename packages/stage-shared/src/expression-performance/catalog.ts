import type { InferOutput } from 'valibot'

import type { NumberRange } from './settings'

import { array, boolean, check, finite, literal, maxValue, minLength, minValue, nullable, number, optional, parse, picklist, pipe, safeParse, startsWith, strictObject, string, transform } from 'valibot'

import { entrySlots, usableMembers } from './combos'

export const ExpressionKindSchema = picklist(['face', 'effect', 'outfit', 'prop', 'system', 'unsorted', 'combo'])
export type ExpressionKind = InferOutput<typeof ExpressionKindSchema>
export const llmAllowedKinds = ['face', 'effect', 'prop'] as const
export const ExpressionAreaSchema = picklist(['whole-look', 'eyes', 'mouth', 'cheeks', 'effects', 'outfit-hair', 'props', 'hidden'])
export type ExpressionArea = InferOutput<typeof ExpressionAreaSchema>
export const ComboMemberSchema = strictObject({ expressionId: string(), strength: pipe(number(), finite(), minValue(0), maxValue(1)) })
export const SlotNameSchema = picklist(['face', 'effect', 'prop'])
export type SlotName = InferOutput<typeof SlotNameSchema>

/** Persisted mapping weights: any positive finite value. */
export const mappingWeightRange: NumberRange = [Number.MIN_VALUE, Number.MAX_VALUE]

const bandSchema = picklist(['slight', 'clear', 'strong'])
function mappingFields([min, max]: NumberRange) {
  return {
    emotion: picklist(['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']),
    weight: optional(pipe(number(), finite(), minValue(min), maxValue(max)), 1),
  }
}
export const EmotionMappingSchema = strictObject({ ...mappingFields(mappingWeightRange), minBand: optional(bandSchema, 'clear') })
export type EmotionMapping = InferOutput<typeof EmotionMappingSchema>
function pendingMappingSchema(weights: NumberRange) {
  return strictObject({ ...mappingFields(weights), minBand: optional(bandSchema) })
}
const persistedPendingMappingSchema = pendingMappingSchema(mappingWeightRange)

function resolveMappings(mappings: InferOutput<typeof persistedPendingMappingSchema>[], kind: ExpressionKind): EmotionMapping[] {
  return mappings.map(mapping => ({ ...mapping, minBand: mapping.minBand ?? (kind === 'effect' ? 'strong' : 'clear') }))
}

/** Builds the catalog entry schema; effective catalogs use the persisted weights scaled by the profile multipliers. */
export function createCatalogEntrySchema(weights: NumberRange) {
  return pipe(strictObject({
    id: string(),
    label: string(),
    kind: ExpressionKindSchema,
    group: nullable(string()),
    /** Persisted review marker set by the settings editor; eligibility ignores it. */
    confirmed: boolean(),
    exposedToLlm: boolean(),
    inverted: optional(boolean()),
    mappings: array(pendingMappingSchema(weights)),
    fileName: string(),
    parameterIds: array(string()),
    area: optional(ExpressionAreaSchema),
    members: optional(array(ComboMemberSchema)),
    slots: optional(array(SlotNameSchema)),
    aliases: optional(array(string())),
    duplicateOf: optional(string()),
    labelSource: optional(picklist(['model', 'vtube', 'file', 'user'])),
  }), transform(entry => ({ ...entry, mappings: resolveMappings(entry.mappings, entry.kind) })))
}
export const CatalogEntrySchema = createCatalogEntrySchema(mappingWeightRange)
export type CatalogEntry = InferOutput<typeof CatalogEntrySchema>

export const CuratedOverrideSchema = strictObject({
  id: string(),
  label: optional(string()),
  kind: optional(ExpressionKindSchema),
  group: optional(nullable(string())),
  /** Persisted review marker set by the settings editor; eligibility ignores it. */
  confirmed: optional(boolean()),
  exposedToLlm: optional(boolean()),
  inverted: optional(boolean()),
  mappings: optional(array(persistedPendingMappingSchema)),
  area: optional(ExpressionAreaSchema),
  keepSeparate: optional(boolean()),
})
export type CuratedOverride = InferOutput<typeof CuratedOverrideSchema>
export const ComboDocumentSchema = strictObject({
  id: pipe(string(), startsWith('combo:')),
  label: pipe(string(), minLength(1)),
  members: pipe(array(ComboMemberSchema), minLength(1)),
  mappings: array(persistedPendingMappingSchema),
  exposedToLlm: boolean(),
  area: optional(ExpressionAreaSchema),
})
export type ComboDocument = InferOutput<typeof ComboDocumentSchema>
export const CustomExpressionDocumentSchema = strictObject({
  id: pipe(string(), startsWith('custom:')),
  label: pipe(string(), minLength(1)),
  kind: pipe(ExpressionKindSchema, check(kind => kind !== 'combo')),
  area: optional(ExpressionAreaSchema),
  parameterId: string(),
  delta: pipe(number(), finite()),
  mappings: array(persistedPendingMappingSchema),
  exposedToLlm: boolean(),
})
export type CustomExpressionDocument = InferOutput<typeof CustomExpressionDocumentSchema>
export const CuratedCatalogDocumentSchema = strictObject({
  version: literal(1),
  overrides: array(CuratedOverrideSchema),
  combos: optional(array(ComboDocumentSchema)),
  customs: optional(array(CustomExpressionDocumentSchema)),
})
export type CuratedCatalogDocument = InferOutput<typeof CuratedCatalogDocumentSchema>
export const RestSetSchema = strictObject({ version: literal(1), active: array(string()) })

/** Validation stays at the shared boundary so renderers need no schema dependency. */
export function parseCuratedCatalogDocument(input: unknown) {
  const result = safeParse(CuratedCatalogDocumentSchema, input)
  return result.success ? { success: true as const, value: result.output } : { success: false as const, issues: result.issues }
}

export function parseRestSet(input: unknown) {
  const result = safeParse(RestSetSchema, input)
  return result.success ? { success: true as const, value: result.output } : { success: false as const, issues: result.issues }
}

/** Own overrides take precedence over alias overrides; omitted fields retain derived values. */
export function mergeCatalog(derived: CatalogEntry[], curated: CuratedCatalogDocument | null, customEntries: CatalogEntry[] = []): CatalogEntry[] {
  const catalog = derived.map((entry) => {
    const override = curated?.overrides.find(candidate => candidate.id === entry.id)
      ?? entry.aliases?.map(alias => curated?.overrides.find(candidate => candidate.id === alias)).find(candidate => candidate !== undefined)
    if (!override)
      return entry
    const fields = Object.fromEntries(Object.entries(override).filter(([key, value]) => key !== 'id' && key !== 'keepSeparate' && value !== undefined))
    return parse(CatalogEntrySchema, { ...entry, ...fields })
  })
  catalog.push(...customEntries)
  for (const document of curated?.combos ?? []) {
    const entry: CatalogEntry = {
      ...document,
      kind: 'combo',
      group: null,
      confirmed: true,
      fileName: '',
      labelSource: 'user',
      parameterIds: [],
      mappings: resolveMappings(document.mappings, 'combo'),
    }
    const members = usableMembers(entry, catalog).map(member => catalog.find(candidate => candidate.id === member.expressionId)!)
    entry.parameterIds = [...new Set(members.flatMap(member => member.parameterIds))]
    const areas = [...new Set(members.map(member => member.area))]
    entry.area = document.area ?? (areas.length === 1 ? areas[0] : 'whole-look')
    entry.slots = entrySlots(entry, catalog)
    catalog.push(entry)
  }
  return catalog
}

export function customEntryFromDocument(document: CustomExpressionDocument): CatalogEntry {
  return parse(CatalogEntrySchema, {
    id: document.id,
    label: document.label,
    kind: document.kind,
    area: document.area,
    mappings: document.mappings,
    exposedToLlm: document.exposedToLlm,
    fileName: '',
    parameterIds: [document.parameterId],
    group: null,
    confirmed: true,
    labelSource: 'user',
  })
}

export function isAutoEligible(entry: CatalogEntry): boolean {
  if (entry.duplicateOf !== undefined)
    return false
  return entry.kind === 'face' || entry.kind === 'effect' || (entry.kind === 'combo' && (entry.slots?.length ?? 0) > 0 && !entry.slots!.includes('prop'))
}

export function isLlmEligible(entry: CatalogEntry): boolean {
  if (entry.duplicateOf !== undefined)
    return false
  return entry.exposedToLlm && ((llmAllowedKinds as readonly ExpressionKind[]).includes(entry.kind) || (entry.kind === 'combo' && (entry.slots?.length ?? 0) > 0))
}
