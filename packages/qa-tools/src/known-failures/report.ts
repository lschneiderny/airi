import type { KnownFailureProject, TestIdentity } from './schema'

import { relative, sep } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

export type TestStatus = 'passed' | 'failed' | 'skipped'

export interface TestResult extends TestIdentity {
  status: TestStatus
  /** First line of the first failure message, for failed tests. */
  firstError?: string
}

/**
 * Name used for a test file that failed without a failing test, for example an import error or a failing
 * `beforeAll`. It can be matched by a registry entry like any other test name.
 */
export const fileFailureName = '(test file failed outside a test)'

// Only the fields the diff needs; Vitest adds more (meta, tags, duration) that are ignored.
const assertionSchema = v.looseObject({
  ancestorTitles: v.array(v.string()),
  title: v.string(),
  status: v.string(),
  failureMessages: v.nullish(v.array(v.string())),
})

const fileSchema = v.looseObject({
  name: v.string(),
  status: v.string(),
  message: v.string(),
  assertionResults: v.array(assertionSchema),
})

const reportSchema = v.looseObject({
  success: v.boolean(),
  testResults: v.array(fileSchema),
})

export interface ParseReportOptions {
  package: string
  project: KnownFailureProject
  /** Absolute package directory; report file paths are made relative to it. */
  packageDir: string
}

function firstLine(message: string | undefined): string | undefined {
  const line = message?.split(/\r?\n/).find(part => part.trim() !== '')
  return line?.trim()
}

/**
 * Parses the output of Vitest's `--reporter=json`.
 *
 * Returns:
 * - One result per test; tests that share a file and full name collapse to one result that fails if any of them failed.
 * - One extra failed result named {@link fileFailureName} per file that failed while none of its tests did.
 */
export function parseVitestJsonReport(text: string, options: ParseReportOptions): TestResult[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  }
  catch (error) {
    throw new Error(`qa-tools: Vitest JSON report for ${options.package} [${options.project}] is not valid JSON: ${errorMessageFrom(error) ?? 'unknown parse error'}`)
  }
  const parsed = v.safeParse(reportSchema, json)
  if (!parsed.success)
    throw new Error(`qa-tools: Vitest JSON report for ${options.package} [${options.project}] has an unexpected shape: ${parsed.issues.map(issue => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`).join('; ')}`)

  const results = new Map<string, TestResult>()
  for (const testFile of parsed.output.testResults) {
    const file = relative(options.packageDir, testFile.name).split(sep).join('/')
    let anyTestFailed = false
    for (const assertion of testFile.assertionResults) {
      const name = [...assertion.ancestorTitles, assertion.title].join(' > ')
      const status: TestStatus = assertion.status === 'passed' ? 'passed' : assertion.status === 'failed' ? 'failed' : 'skipped'
      anyTestFailed ||= status === 'failed'
      const key = `${file}\u0000${name}`
      const previous = results.get(key)
      if (previous?.status === 'failed')
        continue
      if (previous?.status === 'passed' && status === 'skipped')
        continue
      results.set(key, {
        package: options.package,
        project: options.project,
        file,
        name,
        status,
        firstError: status === 'failed' ? firstLine(assertion.failureMessages?.[0]) ?? '(no error message)' : undefined,
      })
    }
    if (testFile.status === 'failed' && !anyTestFailed) {
      results.set(`${file}\u0000${fileFailureName}`, {
        package: options.package,
        project: options.project,
        file,
        name: fileFailureName,
        status: 'failed',
        firstError: firstLine(testFile.message) ?? '(no error message)',
      })
    }
  }
  return [...results.values()]
}
