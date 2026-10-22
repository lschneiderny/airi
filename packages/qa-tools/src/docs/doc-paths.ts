import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve, sep } from 'node:path'

export type DocPathStatus = 'resolved' | 'missing' | 'external' | 'runtime-output' | 'pending-for-todo16'

export interface DocPathResult {
  source: string
  reference: string
  status: DocPathStatus
  resolvedPath: string | null
}

export interface DocPathReport {
  checkedReferences: DocPathResult[]
  count: number
  resolved: string[]
  pendingForTodo16: string[]
  /** `.temp/` references: outputs of QA runs, absent from a fresh checkout. Never counted as resolved or missing. */
  runtimeOutputs: string[]
  missing: DocPathResult[]
}

const pathPattern = /`([^`\r\n]+)`/g
const repoPathPattern = /^(?:\.{1,2}[\\/]|\.agents[\\/]|apps[\\/]|docs[\\/]|packages[\\/]|server[\\/]|services[\\/]|integrations[\\/]|plugins[\\/]|engines[\\/]|examples[\\/]|\.github[\\/]|\.omo[\\/]|\.temp[\\/]|node_modules[\\/]|(?:pnpm-lock\.yaml|package\.json|AGENTS\.md|README\.md|\.tool-versions|uno\.config\.ts|eslint\.config\.ts|vitest\.config\.ts|\.gitignore)$)/
const sourceExtensions = /\.(?:md|mdx|ts|tsx|js|mjs|cjs|json|ya?ml|txt|html|css|sh|ps1|toml)$/i

/** Run directories under `.temp/` are written by QA runs and are not committed, so a checkout need not contain them. */
function isRuntimeOutput(relative: string) {
  return relative === '.temp' || relative.startsWith('.temp/')
}

/**
 * Resolves the backtick-quoted repository paths in the given docs.
 *
 * Use when:
 * - A doc cites repository files and a check must show which no longer exist
 *
 * Expects:
 * - `repoRoot` is the checkout root and every `docs[].file` is readable
 *
 * Returns:
 * - Every reference with its status. `.temp/` references are `runtime-output` and never `missing`.
 */
export function checkDocPaths(params: {
  repoRoot: string
  docs: { file: string, source: string }[]
  pendingForTodo16?: ReadonlySet<string>
}): DocPathReport {
  const { repoRoot, docs, pendingForTodo16 = new Set<string>() } = params
  const references: { source: string, text: string }[] = []

  for (const doc of docs) {
    const contents = readFileSync(doc.file, 'utf8')
    for (const [, text] of contents.matchAll(pathPattern)) {
      if (text.includes('://') || text.includes('<') || text.includes('>') || text.includes('|'))
        continue
      references.push({ source: doc.source, text })
    }
  }

  const explicitPaths = references
    .map(({ text }) => text)
    .filter(text => repoPathPattern.test(text))
  const aliases = new Map<string, string[]>()
  for (const path of explicitPaths) {
    const key = basename(path.replaceAll('\\', '/'))
    aliases.set(key, [...(aliases.get(key) ?? []), path])
  }

  const candidates = references.filter(({ text }) => {
    if (repoPathPattern.test(text) || text.includes('/') || text.includes('\\'))
      return true
    return sourceExtensions.test(text) && aliases.has(basename(text))
  })

  const results: DocPathResult[] = candidates.map(({ source, text }) => {
    const normalized = text.replaceAll('\\', '/').replace(/\/+$/, '')
    const alias = !normalized.includes('/') && !repoPathPattern.test(normalized)
      ? aliases.get(normalized)?.[0]
      : undefined
    const repoPath = alias ?? normalized
    if (isAbsolute(repoPath))
      return { source, reference: text, status: 'external', resolvedPath: null }
    const absolute = resolve(repoRoot, repoPath)
    if (!absolute.startsWith(`${repoRoot}${sep}`) && absolute !== repoRoot)
      return { source, reference: text, status: 'external', resolvedPath: null }
    const relative = absolute.slice(repoRoot.length + 1).replaceAll(sep, '/')
    if (isRuntimeOutput(relative))
      return { source, reference: text, status: 'runtime-output', resolvedPath: relative }
    if (pendingForTodo16.has(relative))
      return { source, reference: text, status: 'pending-for-todo16', resolvedPath: relative }
    if (existsSync(absolute))
      return { source, reference: text, status: 'resolved', resolvedPath: relative }
    return { source, reference: text, status: 'missing', resolvedPath: relative }
  })

  const uniquePaths = (status: DocPathStatus) =>
    [...new Set(results.flatMap(result => result.status === status && result.resolvedPath ? [result.resolvedPath] : []))].sort()

  return {
    checkedReferences: results,
    count: results.filter(result => result.status === 'resolved' || result.status === 'pending-for-todo16').length,
    resolved: uniquePaths('resolved'),
    pendingForTodo16: uniquePaths('pending-for-todo16'),
    runtimeOutputs: uniquePaths('runtime-output'),
    missing: results.filter(result => result.status === 'missing'),
  }
}
