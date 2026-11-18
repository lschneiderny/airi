import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, posix } from 'node:path'

import ts from 'typescript'

/** A test file that runs some of its tests only when environment variables are set. */
export interface GatedTestFile {
  /** Repository-relative path with `/` separators. */
  file: string
  variables: string[]
}

const testCalls = new Set(['it', 'test', 'describe', 'expect'])

function isEnvRead(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'env'
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
}

/** `process.env.X ?? fallback` and `process.env.X || fallback` work without X, so X is no requirement. */
function hasFallback(node: ts.Node): boolean {
  const parent = node.parent
  return ts.isBinaryExpression(parent) && parent.left === node
    && (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
}

function calledName(call: ts.CallExpression): string | undefined {
  let callee: ts.Expression = call.expression
  while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee))
    callee = callee.expression
  return ts.isIdentifier(callee) ? callee.text : undefined
}

/** Whether `node` declares a test or asserts, so a condition around it decides what the file tests. */
function holdsTest(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && testCalls.has(calledName(node) ?? ''))
    return true
  return ts.forEachChild(node, holdsTest) ?? false
}

/**
 * The variables a test file's gates require, in source order without repeats. A gate is the condition of a `runIf` or
 * `skipIf` call, or of an `if` that declares tests or asserts. Conditions may read `process.env` through constants
 * declared in the file, such as `const enabled = Boolean(process.env.X)`. `.skipIf(process.env.X)` runs when X is
 * unset, so it is no requirement.
 */
export function gateVariables(source: string): string[] {
  const file = ts.createSourceFile('gate.test.ts', source, ts.ScriptTarget.Latest, true)
  const constants = new Map<string, ts.Expression>()
  const gates: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !constants.has(node.name.text))
      constants.set(node.name.text, node.initializer)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length) {
      const method = node.expression.name.text
      const condition = node.arguments[0]
      if (method === 'runIf' || (method === 'skipIf' && !isEnvRead(condition)))
        gates.push(condition)
    }
    if (ts.isIfStatement(node) && holdsTest(node.thenStatement))
      gates.push(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(file)

  const found: { position: number, name: string }[] = []
  const collect = (node: ts.Node, seen: Set<string>): void => {
    if (isEnvRead(node)) {
      if (!hasFallback(node))
        found.push({ position: node.getStart(), name: node.name.text })
      return
    }
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
      collect(constants.get(node.text)!, new Set([...seen, node.text]))
      return
    }
    ts.forEachChild(node, child => collect(child, seen))
  }
  for (const gate of gates)
    collect(gate, new Set())
  return [...new Set(found.sort((a, b) => a.position - b.position).map(item => item.name))]
}

/** Gated files `.env.qa` can enable: every gate is an `AIRI_QA_*` key, the only keys `loadQaEnv` applies. */
export function qaGatedFiles(files: GatedTestFile[]): GatedTestFile[] {
  return files.filter(file => file.variables.every(name => name.startsWith('AIRI_QA_')))
}

function unsetVariables(files: GatedTestFile[], env: Record<string, string | undefined>): string[] {
  return [...new Set(files.flatMap(file => file.variables.filter(name => !env[name])))].sort()
}

export type GatedRun = { ok: true, run: GatedTestFile[], skipped: GatedTestFile[] } | { ok: false, message: string }

/**
 * Which gated files `pnpm qa:test:model` runs: those whose variables are all set. It refuses when none is, or when a
 * set variable names an absolute path that does not exist (the model moved or its mount is down).
 */
export function planGatedRun(files: GatedTestFile[], env: Record<string, string | undefined>, envFile: string, exists: (path: string) => boolean): GatedRun {
  if (!files.length)
    return { ok: false, message: 'No test file is gated on an AIRI_QA_* variable.' }
  const run = files.filter(file => file.variables.every(name => env[name]))
  if (!run.length) {
    const unset = unsetVariables(files, env)
    return { ok: false, message: `${unset.join(', ')} ${unset.length === 1 ? 'is' : 'are'} unset. Put ${unset[0]}=<path> in ${envFile} or set it in the environment; \`pnpm wt new <name> --qa\` writes AIRI_QA_MMD_MODEL for a new worktree.` }
  }
  const missing = [...new Set(run.flatMap(file => file.variables))].filter(name => isAbsolute(env[name]!) && !exists(env[name]!))
  if (missing.length)
    return { ok: false, message: missing.map(name => `${name}=${env[name]} does not exist.`).join(' ') }
  return { ok: true, run, skipped: files.filter(file => !run.includes(file)) }
}

/** The line `pnpm qa:test:model` prints for gated files it did not run, or `null` when it ran them all. */
export function skippedGatedNotice(skipped: GatedTestFile[], env: Record<string, string | undefined>): string | null {
  if (!skipped.length)
    return null
  return `skipped ${skipped.length} file(s) (${unsetVariables(skipped, env).join(', ')} unset): ${skipped.map(file => file.file).join(', ')}`
}

/**
 * The one line `pnpm verify` prints when its test step skipped gated files related to the change. A file is related
 * when it changed itself or lies in a package the change affects (a changed package or one that depends on it), the
 * same packages verify runs related tests in.
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

/**
 * Groups test files by the package that runs them: the nearest directory at or above each file that holds a
 * `vitest.config.ts`. Each group's files are relative to that directory, as Vitest expects when it starts there.
 */
export function groupByVitestConfig(files: string[], hasConfig: (directory: string) => boolean): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    let directory = posix.dirname(file)
    while (directory !== '.' && !hasConfig(directory))
      directory = posix.dirname(directory)
    groups.set(directory, [...(groups.get(directory) ?? []), posix.relative(directory, file)])
  }
  return groups
}

/** Every tracked or untracked test file under `root` with a variable gate, found with `git grep`. */
export function listGatedTestFiles(root: string): GatedTestFile[] {
  const result = spawnSync('git', ['grep', '-l', '--untracked', '-F', 'process.env.', '--', '*.test.ts', '*.test.mts', '*.test.js', '*.test.mjs'], { cwd: root, encoding: 'utf8' })
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
