import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

/** `default` is a package whose Vitest config declares no projects, so the runner passes no `--project`. */
export const knownFailureProjectSchema = v.picklist(['node', 'browser', 'default'])

const requiredText = (field: string) => v.pipe(v.string(), v.trim(), v.nonEmpty(`${field} must not be empty`))

export const knownFailureEntrySchema = v.strictObject({
  package: requiredText('package'),
  project: knownFailureProjectSchema,
  /** Test file path relative to the package directory, with forward slashes. */
  file: requiredText('file'),
  /** Describe titles and the test title joined with " > ". */
  name: requiredText('name'),
  reason: requiredText('reason'),
  since: v.pipe(v.string(), v.regex(isoDatePattern, 'since must be YYYY-MM-DD')),
  removeWhen: requiredText('removeWhen'),
  /** The test fails intermittently: a failure is known, a pass is reported but not "fixed". */
  flaky: v.optional(v.literal(true)),
})

export const knownFailureRegistrySchema = v.strictObject({
  version: v.literal(1),
  entries: v.array(knownFailureEntrySchema),
})

export type KnownFailureProject = v.InferOutput<typeof knownFailureProjectSchema>
export type KnownFailureEntry = v.InferOutput<typeof knownFailureEntrySchema>
export type KnownFailureRegistry = v.InferOutput<typeof knownFailureRegistrySchema>

export interface TestIdentity {
  package: string
  project: KnownFailureProject
  file: string
  name: string
}

/** Registry matching key: package + project + file + full test name. */
export function failureKey(test: TestIdentity): string {
  return JSON.stringify([test.package, test.project, test.file, test.name])
}

/**
 * Parses registry file text.
 *
 * Returns:
 * - The validated registry; throws an error naming `source`, the JSON path of every issue, and duplicate keys.
 */
export function parseKnownFailureRegistry(text: string, source: string): KnownFailureRegistry {
  let json: unknown
  try {
    json = JSON.parse(text)
  }
  catch (error) {
    throw new Error(`qa-tools: known-failures registry ${source} is not valid JSON: ${errorMessageFrom(error) ?? 'unknown parse error'}`)
  }

  const parsed = v.safeParse(knownFailureRegistrySchema, json)
  if (!parsed.success) {
    const issues = parsed.issues.map(issue => `  - ${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`)
    throw new Error([`qa-tools: known-failures registry ${source} does not match the schema:`, ...issues].join('\n'))
  }

  const seen = new Set<string>()
  for (const entry of parsed.output.entries) {
    const key = failureKey(entry)
    if (seen.has(key))
      throw new Error(`qa-tools: known-failures registry ${source} lists ${entry.package} [${entry.project}] ${entry.file} > ${entry.name} more than once`)
    seen.add(key)
  }
  return parsed.output
}
