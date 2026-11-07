import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env as processEnv } from 'node:process'
import { parseEnv } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

/** Loads only AIRI_QA_* defaults, preserving the shell's values. Warnings never abort a QA command. */
export function loadQaEnv(repoRoot: string, env: Record<string, string | undefined> = processEnv) {
  const file = join(repoRoot, '.env.qa')
  const loaded: string[] = []
  try {
    const content = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
    // parseEnv tolerates malformed lines and unmatched quotes. Check statement syntax before applying values.
    const statement = /\s*(?:#[^\n]*(?:\n|$)|(?:export[ \t]+)?[A-Z_]\w*[ \t]*=[ \t]*(?:(?:"[^"]*"|'[^']*'|`[^`]*`)[ \t]*(?:#[^\n]*)?|[^\s"'`][^\n]*)?(?:\n|$))/iy
    let offset = 0
    while (offset < content.length && content.slice(offset).trim()) {
      statement.lastIndex = offset
      if (!statement.test(content)) {
        console.warn(`qa-tools: ${file}: malformed environment file; no values loaded`)
        return { file, loaded }
      }
      offset = statement.lastIndex
    }
    const values = parseEnv(content)
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith('AIRI_QA_')) {
        console.warn(`qa-tools: ${file}: ignored non-AIRI_QA_ key ${key}`)
        continue
      }
      if (env[key] === undefined) {
        env[key] = value
        loaded.push(key)
      }
    }
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      console.warn(`qa-tools: ${file}: ${errorMessageFrom(error) ?? 'could not load environment file'}`)
  }
  return { file, loaded }
}
