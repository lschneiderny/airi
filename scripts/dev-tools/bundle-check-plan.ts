import { posix } from 'node:path'

/**
 * three.js sets `window.__THREE__` when it loads, and the property name survives minification.
 * three-mmd, three-vrm, and Tres all import three, so a chunk that brings any of them in at
 * startup also brings this marker into the startup chunks.
 */
export const threeMarker = '__THREE__'

export interface BundleCheckResult {
  /** Chunks the window loads before any dynamic import, relative to the output directory. */
  eager: string[]
  /** Eager chunks that contain three. */
  heavy: string[]
  /** Statically imported chunks that are missing from the output. */
  missing: string[]
}

/** The module scripts an HTML entry loads, relative to the HTML file. */
export function entryScripts(html: string): string[] {
  const scripts: string[] = []
  for (const [tag] of html.matchAll(/<script\s[^>]*>/g)) {
    const src = /\ssrc=["']([^"']+)["']/.exec(tag)?.[1]
    if (src && /\stype=["']module["']/.test(tag))
      scripts.push(src)
  }
  return scripts
}

/**
 * The relative specifiers a chunk imports statically. Rollup emits a chunk's static imports and
 * re-exports as a header of `import` and `export ... from` statements before any other code, so
 * only that header is read: library code later in the chunk can contain the same text in strings.
 * Vite's one-line `__vite__mapDeps` helper, which precedes the header in chunks with dynamic
 * imports, is skipped.
 * Dynamic `import()` is excluded, because it loads only when the code runs.
 */
export function staticImports(code: string): string[] {
  const specifiers: string[] = []
  let index = 0
  while (index < code.length) {
    const rest = code.slice(index)
    const skipped = /^(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*|const __vite__mapDeps\s*=[^\n]*)/.exec(rest)
    if (skipped) {
      index += skipped[0].length
      continue
    }
    const statement = /^(?:import(?![\w$.(])|export(?=\s*[{*]))[^;\n]*/.exec(rest)
    if (!statement)
      break
    const specifier = /["'](\.{1,2}\/[^"']+)["']\s*$/.exec(statement[0])?.[1]
    if (statement[0].startsWith('export') && !/from\s*["']/.test(statement[0]))
      break
    if (specifier)
      specifiers.push(specifier)
    index += statement[0].length + 1
  }
  return specifiers
}

/** Follows static imports from the HTML entry and reports eager chunks that contain three. */
export function checkEagerChunks(html: string, chunks: ReadonlyMap<string, string>): BundleCheckResult {
  const eager: string[] = []
  const heavy: string[] = []
  const missing: string[] = []
  const queue = entryScripts(html).map(src => posix.normalize(src))
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file))
      continue
    seen.add(file)
    const code = chunks.get(file)
    if (code === undefined) {
      missing.push(file)
      continue
    }
    eager.push(file)
    if (code.includes(threeMarker))
      heavy.push(file)
    for (const specifier of staticImports(code))
      queue.push(posix.join(posix.dirname(file), specifier))
  }
  return { eager, heavy, missing }
}
