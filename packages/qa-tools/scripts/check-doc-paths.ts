import process from 'node:process'

import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const args = process.argv.slice(2)
let adrPath = resolve(repoRoot, 'docs/ai/adr/2026-10-20-motion-qa-levels.md')
if (args.length === 2 && args[0] === '--adr') {
  adrPath = resolve(args[1])
}
else if (args.length > 0) {
  console.error('Usage: check-doc-paths.ts [--adr <copy of ADR>]')
  process.exit(2)
}

const docs = [
  { file: adrPath, source: 'ADR' },
  { file: resolve(repoRoot, '.agents/skills/motion-qa/SKILL.md'), source: 'skill' },
]
const todo16Pending = new Set<string>()
const pathPattern = /`([^`\r\n]+)`/g
const repoPathPattern = /^(?:\.{1,2}[\\/]|\.agents[\\/]|apps[\\/]|docs[\\/]|packages[\\/]|server[\\/]|services[\\/]|integrations[\\/]|plugins[\\/]|engines[\\/]|examples[\\/]|\.github[\\/]|\.omo[\\/]|\.temp[\\/]|node_modules[\\/]|(?:pnpm-lock\.yaml|package\.json|AGENTS\.md|README\.md|\.tool-versions|uno\.config\.ts|eslint\.config\.ts|vitest\.config\.ts|\.gitignore)$)/
const sourceExtensions = /\.(?:md|mdx|ts|tsx|js|mjs|cjs|json|ya?ml|txt|html|css|sh|ps1|toml)$/i
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

const results = candidates.map(({ source, text }) => {
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
  if (todo16Pending.has(relative))
    return { source, reference: text, status: 'pending-for-todo16', resolvedPath: relative }
  if (existsSync(absolute))
    return { source, reference: text, status: 'resolved', resolvedPath: relative }
  return { source, reference: text, status: 'missing', resolvedPath: relative }
})

const resolved = [...new Set(results.flatMap(result => result.status === 'resolved' && result.resolvedPath ? [result.resolvedPath] : []))].sort()
const pending = [...new Set(results.flatMap(result => result.status === 'pending-for-todo16' && result.resolvedPath ? [result.resolvedPath] : []))].sort()
const missing = results.filter(result => result.status === 'missing')

process.stdout.write(`${JSON.stringify({
  checkedReferences: results,
  count: results.filter(result => result.status === 'resolved' || result.status === 'pending-for-todo16').length,
  resolved,
  pendingForTodo16: pending,
  missing,
}, null, 2)}\n`)

if (missing.length > 0)
  process.exitCode = 1
