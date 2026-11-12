import { builtinModules } from 'node:module'
import { posix } from 'node:path'

/** The headless runner's entry modules: the scenario pipeline and the parser that turns a command line into its inputs. */
export const RUNNER_ROOTS = ['packages/qa-tools/src/t2-3d/runner/run.ts', 'packages/qa-tools/src/t2-3d/runner/arguments.ts'] as const

/** Files of one commit. `read` returns the text of every requested path the commit holds. */
export interface CommitSource {
  readonly paths: ReadonlySet<string>
  read: (paths: readonly string[]) => ReadonlyMap<string, string>
}

export interface RunnerClosure {
  /** Repository files the runner loads, transitively: code, JSON and assets named through `new URL(..., import.meta.url)`. */
  readonly files: ReadonlySet<string>
  /** The `package.json` of every package that owns a closure file: its dependencies decide what the runner resolves. */
  readonly manifests: ReadonlySet<string>
  /** `tsconfig*.json` beside those manifests and at the root: they change how tsx transforms the closure. */
  readonly configs: ReadonlySet<string>
  /** Reasons the closure may be incomplete; any one makes a "not affected" answer impossible. */
  readonly problems: readonly string[]
}

export type AffectedVerdict = 'affected' | 'not-affected' | 'cannot-tell'

export interface AffectedAnswer {
  readonly verdict: AffectedVerdict
  /** Changed files inside a closure, changed manifests (other than `scripts`) and changed configs. */
  readonly hits: readonly string[]
  readonly reasons: readonly string[]
}

const codeFile = /\.(?:[cm]?[jt]sx?|vue)$/
/** Dependency resolution of the whole workspace: a change can move a package the runner loads, and no file says which. */
const resolutionFiles = new Set(['pnpm-lock.yaml', 'pnpm-workspace.yaml'])
const builtins = new Set(builtinModules)

/**
 * Module specifiers a source file loads at runtime. Type-only imports and exports are left out: they are erased before
 * the code runs. Comments that start a line are removed first, so commented-out imports do not count; an import inside
 * a trailing comment is kept, which can only widen the closure. `dynamic` counts `import(...)` calls whose argument is
 * not a string literal: they make the graph unknowable.
 */
export function scanImports(source: string): { specifiers: string[], assets: string[], dynamic: number } {
  const code = source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '')
  const specifiers: string[] = []
  // Each statement runs from one import/export keyword to the next, so a type-only statement never hides a later import.
  const keywords = [...code.matchAll(/(?<![.\w$])(?:import|export)\b(?!\s*[.(])/g)].map(match => match.index)
  keywords.forEach((start, i) => {
    const statement = code.slice(start, keywords[i + 1] ?? code.length).replace(/^(?:import|export)/, '')
    const sideEffect = /^\s*['"]([^'"\n]+)['"]/.exec(statement)
    const from = /\bfrom\s*['"]([^'"\n]+)['"]/.exec(statement)
    if (sideEffect)
      specifiers.push(sideEffect[1])
    else if (from && !/^\s+type\s/.test(statement))
      specifiers.push(from[1])
  })
  for (const match of code.matchAll(/(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g))
    specifiers.push(match[2])
  const assets = [...code.matchAll(/new\s+URL\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*,\s*import\.meta\.url/g)].map(match => match[1])
  const dynamic = [...code.matchAll(/(?<![.\w$])import\s*\((?!\s*['"])/g)].length
  return { specifiers, assets, dynamic }
}

type ExportsValue = string | null | readonly ExportsValue[] | { readonly [key: string]: ExportsValue }

/** Every string target of an export value; condition objects are a union, because the runner's conditions are not modelled. */
function exportLeaves(value: ExportsValue): string[] {
  if (value === null)
    return []
  if (typeof value === 'string')
    return [value]
  if (Array.isArray(value))
    return value.flatMap(item => exportLeaves(item as ExportsValue))
  return Object.entries(value as Record<string, ExportsValue>).filter(([condition]) => condition !== 'types').flatMap(([, item]) => exportLeaves(item))
}

/** Targets of `subpath` (`.` or `./x`) in a package's `exports`; null when the map does not export it. */
export function exportTargets(exports: ExportsValue, subpath: string): string[] | null {
  if (typeof exports === 'string' || Array.isArray(exports))
    return subpath === '.' ? exportLeaves(exports) : null
  if (exports === null || typeof exports !== 'object')
    return null
  const map = exports as Record<string, ExportsValue>
  if (!Object.keys(map).some(key => key.startsWith('.')))
    return subpath === '.' ? exportLeaves(map) : null
  if (subpath in map)
    return exportLeaves(map[subpath])
  const targets = Object.entries(map).flatMap(([key, value]) => {
    const star = key.indexOf('*')
    if (star < 0)
      return []
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length)
      return []
    const matched = subpath.slice(prefix.length, subpath.length - suffix.length)
    return exportLeaves(value).map(target => target.replaceAll('*', matched))
  })
  return targets.length ? targets : null
}

function resolveFile(path: string, paths: ReadonlySet<string>): string | null {
  const candidates = [path, `${path}.ts`, `${path}.tsx`, `${path}.mts`, `${path}.js`, `${path}.mjs`, `${path}.json`, `${path}.vue`, path.replace(/\.js$/, '.ts'), path.replace(/\.mjs$/, '.mts'), path.replace(/\.jsx$/, '.tsx'), `${path}/index.ts`, `${path}/index.js`]
  return candidates.find(candidate => paths.has(candidate)) ?? null
}

interface WorkspacePackage {
  readonly dir: string
  readonly manifest: { readonly exports?: ExportsValue, readonly main?: string, readonly module?: string }
}

function workspacePackages(source: CommitSource): Map<string, WorkspacePackage> {
  const manifests = [...source.paths].filter(path => path.endsWith('/package.json'))
  const texts = source.read(manifests)
  const packages = new Map<string, WorkspacePackage>()
  for (const [path, text] of texts) {
    try {
      const manifest = JSON.parse(text) as { name?: unknown, exports?: ExportsValue, main?: string, module?: string }
      if (typeof manifest.name === 'string')
        packages.set(manifest.name, { dir: posix.dirname(path), manifest })
    }
    catch {
      // A fixture or template manifest that is not JSON cannot be a dependency of the runner.
    }
  }
  return packages
}

function resolveSpecifier(from: string, specifier: string, source: CommitSource, packages: ReadonlyMap<string, WorkspacePackage>): { files: string[] } | { external: true } | { problem: string } {
  const bare = specifier.split('?')[0]
  if (bare.startsWith('.')) {
    const file = resolveFile(posix.normalize(posix.join(posix.dirname(from), bare)), source.paths)
    return file ? { files: [file] } : { problem: `${from} imports ${specifier}, which this commit does not hold` }
  }
  if (bare.startsWith('node:') || builtins.has(bare.split('/')[0]))
    return { external: true }
  const name = [...packages.keys()].filter(candidate => bare === candidate || bare.startsWith(`${candidate}/`)).sort((a, b) => b.length - a.length)[0]
  if (!name)
    return { external: true }
  const pkg = packages.get(name)!
  const subpath = bare === name ? '.' : `.${bare.slice(name.length)}`
  const targets = pkg.manifest.exports !== undefined
    ? exportTargets(pkg.manifest.exports, subpath)
    : subpath === '.' ? [pkg.manifest.module ?? pkg.manifest.main ?? './index'] : [subpath]
  if (!targets?.length)
    return { problem: `${from} imports ${specifier}, which ${name} does not export` }
  const files = targets.map(target => resolveFile(posix.normalize(posix.join(pkg.dir, target)), source.paths))
  if (files.includes(null))
    return { problem: `${from} imports ${specifier}, whose target ${targets.join(', ')} is not a file of this commit (built output?)` }
  return { files: files as string[] }
}

/** The runner's static import graph at one commit, followed from its roots through relative and workspace imports. */
export function runnerClosure(source: CommitSource, roots: readonly string[] = RUNNER_ROOTS): RunnerClosure {
  const packages = workspacePackages(source)
  const files = new Set<string>()
  const problems: string[] = []
  let frontier = roots.filter((root) => {
    if (source.paths.has(root))
      return true
    problems.push(`runner root ${root} is missing at this commit`)
    return false
  })
  frontier.forEach(file => files.add(file))
  while (frontier.length) {
    const texts = source.read(frontier.filter(file => codeFile.test(file)))
    const next: string[] = []
    for (const [file, text] of texts) {
      const scanned = scanImports(text)
      if (scanned.dynamic)
        problems.push(`${file} has ${scanned.dynamic} import() call(s) with a computed specifier`)
      const resolved = [
        ...scanned.specifiers.map(specifier => resolveSpecifier(file, specifier, source, packages)),
        ...scanned.assets.map(asset => resolveSpecifier(file, asset, source, packages)),
      ]
      for (const result of resolved) {
        if ('problem' in result)
          problems.push(result.problem)
        else if ('files' in result)
          next.push(...result.files.filter(found => !files.has(found)))
      }
    }
    frontier = [...new Set(next)]
    frontier.forEach(file => files.add(file))
  }
  const manifests = new Set<string>()
  for (const file of files) {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const manifest = dir === '.' ? 'package.json' : `${dir}/package.json`
      if (source.paths.has(manifest)) {
        manifests.add(manifest)
        break
      }
      if (dir === '.')
        break
    }
  }
  const configDirs = new Set(['.', ...[...manifests].map(manifest => posix.dirname(manifest))])
  const configs = new Set([...source.paths].filter(path => /(?:^|\/)tsconfig[^/]*\.json$/.test(path) && configDirs.has(posix.dirname(path))))
  return { files, manifests, configs, problems }
}

/** Whether two versions of a `package.json` differ in anything but `scripts`, which cannot change what the runner loads. */
export function manifestDiffers(base: string | undefined, tip: string | undefined): boolean {
  if (base === undefined || tip === undefined)
    return base !== tip
  try {
    const strip = (text: string) => {
      const { scripts: _scripts, ...rest } = JSON.parse(text) as Record<string, unknown>
      return JSON.stringify(rest)
    }
    return strip(base) !== strip(tip)
  }
  catch {
    return true
  }
}

/**
 * Affected when a changed file is in the runner's closure at either commit, or a manifest or config of the closure
 * changed. A file removed from or added to the graph shows up as a change of the file that imports it, which is itself
 * in a closure; using both commits' closures also covers renames. Without such a change the answer is "not affected"
 * only when both closures are complete and dependency resolution did not change.
 */
export function decideAffected(input: { base: RunnerClosure, tip: RunnerClosure, changed: readonly string[], manifestChanged: (path: string) => boolean }): AffectedAnswer {
  const { base, tip, changed } = input
  const inClosure = (path: string) => base.files.has(path) || tip.files.has(path) || base.configs.has(path) || tip.configs.has(path)
  const hits = changed.filter(path => inClosure(path) || ((base.manifests.has(path) || tip.manifests.has(path)) && input.manifestChanged(path)))
  if (hits.length)
    return { verdict: 'affected', hits, reasons: [] }
  const reasons = [...new Set([...base.problems, ...tip.problems])]
  const resolution = changed.filter(path => resolutionFiles.has(path))
  if (resolution.length)
    reasons.push(`${resolution.join(', ')} changed: the versions of packages the runner loads may differ`)
  return reasons.length ? { verdict: 'cannot-tell', hits, reasons } : { verdict: 'not-affected', hits, reasons }
}
