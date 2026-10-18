import type { InferOutput } from 'valibot'

import { array, boolean, finite, literal, minValue, nullable, number, optional, parse, picklist, pipe, safeParse, strictObject, string, transform } from 'valibot'

export const ExpressionKindSchema = picklist(['face', 'effect', 'outfit', 'prop', 'system'])
export type ExpressionKind = InferOutput<typeof ExpressionKindSchema>
export const llmAllowedKinds = ['face', 'effect', 'prop'] as const

const bandSchema = picklist(['slight', 'clear', 'strong'])
const mappingFields = {
  emotion: picklist(['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious']),
  weight: optional(pipe(number(), finite(), minValue(Number.MIN_VALUE)), 1),
}
export const EmotionMappingSchema = strictObject({ ...mappingFields, minBand: optional(bandSchema, 'clear') })
export type EmotionMapping = InferOutput<typeof EmotionMappingSchema>
const pendingMappingSchema = strictObject({ ...mappingFields, minBand: optional(bandSchema) })

function resolveMappings(mappings: InferOutput<typeof pendingMappingSchema>[], kind: ExpressionKind): EmotionMapping[] {
  return mappings.map(mapping => ({ ...mapping, minBand: mapping.minBand ?? (kind === 'effect' ? 'strong' : 'clear') }))
}

export const CatalogEntrySchema = pipe(strictObject({
  id: string(),
  label: string(),
  kind: ExpressionKindSchema,
  group: nullable(string()),
  confirmed: boolean(),
  exposedToLlm: boolean(),
  mappings: array(pendingMappingSchema),
  fileName: string(),
  parameterIds: array(string()),
}), transform(entry => ({ ...entry, mappings: resolveMappings(entry.mappings, entry.kind) })))
export type CatalogEntry = InferOutput<typeof CatalogEntrySchema>

export const CuratedOverrideSchema = strictObject({
  id: string(),
  label: optional(string()),
  kind: optional(ExpressionKindSchema),
  group: optional(nullable(string())),
  confirmed: optional(boolean()),
  exposedToLlm: optional(boolean()),
  mappings: optional(array(pendingMappingSchema)),
})
export type CuratedOverride = InferOutput<typeof CuratedOverrideSchema>
export const CuratedCatalogDocumentSchema = strictObject({
  version: literal(1),
  overrides: array(CuratedOverrideSchema),
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

/** Only discovered ids can be curated; omitted fields retain their derived values. */
export function mergeCatalog(derived: CatalogEntry[], curated: CuratedCatalogDocument | null): CatalogEntry[] {
  return derived.map((entry) => {
    const override = curated?.overrides.find(candidate => candidate.id === entry.id)
    if (!override)
      return entry
    const fields = Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined))
    return parse(CatalogEntrySchema, { ...entry, ...fields })
  })
}

export function isAutoEligible(entry: CatalogEntry): boolean {
  return entry.confirmed && (entry.kind === 'face' || entry.kind === 'effect')
}

export function isLlmEligible(entry: CatalogEntry): boolean {
  return entry.confirmed && entry.exposedToLlm && (llmAllowedKinds as readonly ExpressionKind[]).includes(entry.kind)
}
