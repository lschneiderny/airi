import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** A test file that runs only when environment variables are set, as `it.runIf(process.env.NAME)` states. */
export interface GatedTestFile {
  /** Repository-relative path with `/` separators. */
  file: string
  variables: string[]
}

// The two gate spellings that need a variable set: `.runIf(process.env.X ...)` and `.skipIf(!process.env.X ...)`,
// optionally through `Boolean(...)`. `.skipIf(process.env.X)` runs when X is unset, so it is no requirement.
const gatePatterns = [
  /\.runIf\(\s*(?:Boolean\(\s*)?process\.env\.([A-Z_]\w*)/g,
  /\.skipIf\(\s*!\s*(?:Boolean\(\s*)?process\.env\.([A-Z_]\w*)/g,
]

/** The variables a test file's `runIf` and `skipIf` gates require, in source order without repeats. */
export function gateVariables(source: string): string[] {
  const found = gatePatterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => ({ index: match.index, name: match[1] })))
  return [...new Set(found.sort((a, b) => a.index - b.index).map(item => item.name))]
}

/** Gated files `.env.qa` can enable: every gate is an `AIRI_QA_*` key, the only keys `loadQaEnv` applies. */
export function qaGatedFiles(files: GatedTestFile[]): GatedTestFile[] {
  return files.filter(file => file.variables.every(name => name.startsWith('AIRI_QA_')))
}

function unsetVariables(files: GatedTestFile[], env: Record<string, string | undefined>): string[] {
  return [...new Set(files.flatMap(file => file.variables.filter(name => !env[name])))].sort()
}

/**
 * Why `pnpm qa:test:model` must not run `files`, or `null`: a gate variable is unset, or names an absolute path that
 * does not exist (the model moved or its mount is down).
 */
export function gatedRunRefusal(files: GatedTestFile[], env: Record<string, string | undefined>, envFile: string, exists: (path: string) => boolean): string | null {
  if (!files.length)
    return 'No test file is gated on an AIRI_QA_* variable.'
  const unset = unsetVariables(files, env)
  if (unset.length)
    return `${unset.join(', ')} ${unset.length === 1 ? 'is' : 'are'} unset. Put ${unset[0]}=<path> in ${envFile} or set it in the environment; \`pnpm wt new <name> --qa\` writes it for a new worktree.`
  const missing = [...new Set(files.flatMap(file => file.variables))].filter(name => isAbsolute(env[name]!) && !exists(env[name]!))
  if (missing.length)
    return missing.map(name => `${name}=${env[name]} does not exist.`).join(' ')
  return null
}

/**
 * The one line `pnpm verify` prints when its test step skipped gated files related to the change. A file is related
 * when it changed itself or lies in a package the change affects (a changed package or one that depends on it), the
 * same package scope verify uses to choose browser projects.
 */
export function gatedNotice(files: GatedTestFile[], affectedPackagePaths: string[], changedFiles: string[], env: Record<string, string | undefined>): string | null {
  const related = files.filter(file => changedFiles.includes(file.file) || affectedPackagePaths.some(path => file.file.startsWith(`${path}/`)))
  const skipped = related.filter(file => file.variables.some(name => !env[name]))
  if (!skipped.length)
    return null
  const unset = unsetVariables(skipped, env)
  const hint = unset.some(name => name.startsWith('AIRI_QA_'))
    ? 'Run `pnpm qa:test:model` for the AIRI_QA_* gates.'
    : 'Set the variables to run them.'
  return `verify notice: skipped ${skipped.length} env-gated test file(s) related to the change (${unset.join(', ')} unset): ${skipped.map(file => file.file).join(', ')}. ${hint}`
}

/** Every tracked or untracked test file under `root` with a variable gate, found with `git grep`. */
export function listGatedTestFiles(root: string): GatedTestFile[] {
  const result = spawnSync('git', ['grep', '-l', '--untracked', '-E', '\\.(runIf|skipIf)\\(', '--', '*.test.ts', '*.test.mts', '*.test.js', '*.test.mjs'], { cwd: root, encoding: 'utf8' })
  // `git grep` exits 1 when nothing matches.
  if (result.status === 1)
    return []
  if (result.status !== 0)
    throw new Error(`git grep failed: ${result.stderr || result.error?.message || `exit ${result.status}`}`)
  return result.stdout.split('\n').filter(Boolean).flatMap((file) => {
    const variables = gateVariables(readFileSync(join(root, file), 'utf8'))
    return variables.length ? [{ file, variables }] : []
  })
}
