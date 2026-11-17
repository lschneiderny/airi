import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** `pnpm verify` runs this test when a doc here changes (`docGuards` in `verify-plan.ts`). */
const contextDir = join(repoRoot, 'docs/ai/context')

/** A doc opts in by stating that it describes the code; the check then holds it to that. */
const codeDocMarker = 'This file describes the code on `main`.'

const repoPath = /^(?:\.agents|\.github|\.omo|apps|docs|engines|integrations|packages|plugins|scripts|server|services)\/[^\s*<>|]+$/
/** CamelCase, PascalCase, or SCREAMING_SNAKE names. Plain lowercase words are too common to prove anything. */
const identifier = /^[A-Z$][\w$]*$/i
const distinctive = /[A-Z_]/
/** Names that live only in `node_modules`, with the dependency that defines them. */
const externalNames = new Map([
  ['updateNaturalMovements', 'pixi-live2d-display: the Cubism 4 internal model update the Live2D per-frame order cites'],
])
/**
 * Sections whose names are not current code: `Target` rules describe code that does not exist yet, and the glossary's
 * `Conflicting usages` quotes the names older ADRs used.
 */
const skippedSection = /^(?:Target|Conflicting usages)/

/** Drops each section that {@link skippedSection} matches, with its subsections. */
function currentSections(source: string): string {
  const kept: string[] = []
  let skipDepth = 0
  for (const line of source.split('\n')) {
    const heading = /^(#+) (.*)$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      if (skipDepth > 0 && depth <= skipDepth)
        skipDepth = 0
      if (skipDepth === 0 && skippedSection.test(heading[2]))
        skipDepth = depth
    }
    if (skipDepth === 0)
      kept.push(line)
  }
  return kept.join('\n')
}

function backticked(source: string): string[] {
  return [...source.matchAll(/`([^`\n]+)`/g)].map(match => match[1])
}

function linkTargets(source: string): string[] {
  return [...source.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => match[1].split('#')[0])
    .filter(target => target !== '' && !target.includes('://'))
}

/**
 * The subset of `names` that occurs as a whole word in a tracked source file. Searching data files as well costs about
 * ten times as long, because `-o` prints every match in the large fixtures.
 */
function namesInCode(names: string[]): Set<string> {
  const result = spawnSync('git', ['grep', '-h', '-o', '-w', '-F', ...names.flatMap(name => ['-e', name]), '--', '*.ts', '*.tsx', '*.vue', '*.mjs', '*.js', '*.cs', ':!.omo'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return new Set(result.stdout.split('\n'))
}

const codeDocs = readdirSync(contextDir)
  .filter(name => name.endsWith('.md'))
  .map(name => ({ name, file: join(contextDir, name), text: readFileSync(join(contextDir, name), 'utf8') }))
  .filter(doc => doc.text.includes(codeDocMarker))
  .map(doc => ({ name: doc.name, file: doc.file, source: currentSections(doc.text) }))

function citedNames(source: string): string[] {
  return [...new Set(backticked(source).filter(text => identifier.test(text) && distinctive.test(text) && !externalNames.has(text)))]
}

// One search for every doc.
const foundInCode = namesInCode([...new Set(codeDocs.flatMap(doc => citedNames(doc.source)))])

describe('policy docs that describe the code', () => {
  it('include the four policy docs and the glossary', () => {
    expect(codeDocs.map(doc => doc.name).sort()).toEqual(['autonomous-behavior.md', 'body-ownership.md', 'glossary.md', 'llm-prompt.md', 'state-persistence.md'])
  })

  it.each(codeDocs)('$name cites only repository paths that exist', ({ file, source }) => {
    const cited = backticked(source).filter(text => repoPath.test(text)).map(text => join(repoRoot, text))
    const linked = linkTargets(source).map(target => resolve(dirname(file), target))
    expect([...cited, ...linked].filter(path => !existsSync(path)).map(path => path.slice(repoRoot.length + 1))).toEqual([])
  })

  it.each(codeDocs)('$name cites only identifiers that occur in the code', ({ source }) => {
    expect(citedNames(source).filter(name => !foundInCode.has(name))).toEqual([])
  })
})
