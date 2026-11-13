import type { Worktree } from './lib/git'
import type { WorktreeState } from './wt-plan'

import process from 'node:process'

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { compileCacheEnv } from './lib/compile-cache'
import { git, listWorktrees, repoRoot } from './lib/git'
import { ancestry, attribute, normalizePath, snapshotProcesses, withoutCommands } from './lib/processes'
import { defaultBranch, envQaLine, gcDecision, qaModelSource, rmBlocker, tempWorktreeRefusal, validName } from './wt-plan'

const usage = `Usage: pnpm wt ls
       pnpm wt new <name> [--base <ref>] [--branch <branch>] [--no-install | --qa]
       pnpm wt rm <name> [--force] [--delete-branch]
       pnpm wt gc [--days N] [--yes]

  ls    list worktrees with branch, idle time, uncommitted files, merge state, and live processes
  new   create <worktrees dir>/<name> on a new branch (default <prefix>/feat/<name>, prefix from
        \`git config airi.branchPrefix\` or the OS user name) and install with the shared store;
        --qa also writes .env.qa with AIRI_QA_MMD_MODEL (from the environment or this checkout's
        .env.qa), runs pnpm qa:setup cubism, and checks the install
  rm    remove one worktree; refuses while processes run from it or files are uncommitted
  gc    list removable worktrees (merged, gone, or clean and idle for --days, default 14);
        --yes removes them. Removal keeps branches, so their commits stay reachable.`

function mainBranch(root: string): string {
  for (const candidate of ['main', 'master']) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])
      return candidate
    }
    catch {
      // Not this name; try the next.
    }
  }
  throw new Error('No main or master branch')
}

function stateOf(worktree: Worktree, index: number, main: string, liveByWorktree: Map<string, number>): WorktreeState {
  const base = { name: basename(worktree.path), path: worktree.path, branch: worktree.branch, main: index === 0, locked: worktree.locked, prunable: worktree.prunable, liveProcesses: liveByWorktree.get(normalizePath(worktree.path)) ?? 0 }
  if (worktree.prunable || !existsSync(worktree.path))
    return { ...base, prunable: true, dirtyFiles: 0, merged: false, lastCommitAt: null }
  const dirtyFiles = git(worktree.path, ['status', '--porcelain']).split('\n').filter(Boolean).length
  const lastCommitAt = Number(git(worktree.path, ['log', '-1', '--format=%ct'])) * 1000
  const merged = spawnSync('git', ['-C', worktree.path, 'merge-base', '--is-ancestor', 'HEAD', main], { stdio: 'ignore' }).status === 0
  return { ...base, dirtyFiles, merged, lastCommitAt }
}

function collect(root: string): { states: WorktreeState[], main: string } {
  const main = mainBranch(root)
  const worktrees = listWorktrees(root)
  const live = new Map<string, number>()
  const snapshot = snapshotProcesses()
  for (const info of attribute(withoutCommands(snapshot, ancestry(snapshot, process.pid)), worktrees.map(worktree => worktree.path))) {
    if (info.worktree)
      live.set(info.worktree, (live.get(info.worktree) ?? 0) + 1)
  }
  return { states: worktrees.map((worktree, index) => stateOf(worktree, index, main, live)), main }
}

function ago(at: number | null): string {
  if (at === null)
    return '-'
  const days = (Date.now() - at) / (24 * 60 * 60 * 1000)
  return days < 1 ? `${Math.round(days * 24)}h` : `${Math.floor(days)}d`
}

function list(root: string): number {
  const { states, main } = collect(root)
  console.info(`${'name'.padEnd(34)} ${'branch'.padEnd(44)} idle  dirty  ${`in ${main}`.padEnd(8)} procs`)
  for (const state of states) {
    const branch = state.prunable ? '(directory gone)' : state.branch ?? '(detached)'
    console.info(`${state.name.padEnd(34)} ${branch.padEnd(44)} ${ago(state.lastCommitAt).padStart(4)}  ${String(state.dirtyFiles).padStart(5)}  ${(state.merged ? 'yes' : 'no').padEnd(8)} ${state.liveProcesses}`)
  }
  return 0
}

async function install(path: string): Promise<number> {
  console.info(`\nInstalling in ${path}`)
  // The lease comes from this checkout's cpu-slots; the new worktree may predate the package.
  const lease = await acquire({ class: 'install', cwd: path, command: `pnpm install (${basename(path)})` })
  try {
    return await new Promise<number>((resolve, reject) => {
      // pnpm is a .cmd/.ps1 shim on Windows, which only a shell can start.
      const child = spawn('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: path, env: { ...process.env, ...compileCacheEnv(process.env, path), ...lease.env }, stdio: 'inherit', shell: process.platform === 'win32' })
      child.once('error', reject)
      if (child.pid !== undefined)
        lease.addWorkload(child.pid)
      child.once('close', code => resolve(code ?? 1))
    })
  }
  finally {
    lease.release()
  }
}

/** `pnpm qa:setup cubism` in the new worktree. */
function setupCubism(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    // pnpm is a .cmd/.ps1 shim on Windows, which only a shell can start.
    const child = spawn('pnpm', ['qa:setup', 'cubism'], { cwd: path, env: { ...process.env, ...compileCacheEnv(process.env, path) }, stdio: 'inherit', shell: process.platform === 'win32' })
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 1))
  })
}

/** The steps every QA worktree needed by hand: `.env.qa`, Cubism Core, and a checked install. */
async function prepareQa(path: string, model: { model: string, from: string }): Promise<number> {
  // `wx` never replaces an existing file; a new worktree has none because `.env.qa` is ignored.
  writeFileSync(join(path, '.env.qa'), envQaLine(model.model), { flag: 'wx' })
  const cubism = await setupCubism(path)
  if (cubism !== 0) {
    console.error(`pnpm qa:setup cubism exited ${cubism} in ${path}`)
    return 1
  }
  if (!existsSync(join(path, 'node_modules', '.modules.yaml'))) {
    console.error(`${path}/node_modules/.modules.yaml is missing after the install`)
    return 1
  }
  return 0
}

async function create(root: string, argv: string[]): Promise<number> {
  const name = argv[0]
  if (!name || !validName(name)) {
    console.error(`A worktree name of letters, digits, '.', '_' or '-' is required.\n${usage}`)
    return 2
  }
  const option = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const qa = argv.includes('--qa')
  if (qa && argv.includes('--no-install')) {
    console.error(`--qa needs the install; drop --no-install.\n${usage}`)
    return 2
  }
  const mainRoot = listWorktrees(root)[0].path
  const path = join(dirname(mainRoot), `${basename(mainRoot)}-wt`, name)
  const refusal = tempWorktreeRefusal(path, tmpdir())
  if (refusal) {
    console.error(refusal)
    return 2
  }
  const envQaFile = join(root, '.env.qa')
  const model = qa ? qaModelSource(process.env, existsSync(envQaFile) ? readFileSync(envQaFile, 'utf8') : undefined, envQaFile) : undefined
  if (model && 'error' in model) {
    console.error(model.error)
    return 2
  }
  if (model && !existsSync(model.model)) {
    console.error(`The MMD model ${model.model} (from ${model.from}) does not exist.`)
    return 2
  }
  if (existsSync(path)) {
    console.error(`${path} already exists`)
    return 1
  }
  let prefix = userInfo().username.toLowerCase()
  try {
    prefix = git(root, ['config', 'airi.branchPrefix']) || prefix
  }
  catch {
    // Unset; the OS user name is the prefix.
  }
  const branch = option('--branch') ?? defaultBranch(prefix, name)
  const base = option('--base') ?? mainBranch(root)
  git(root, ['worktree', 'add', '-b', branch, path, base])
  console.info(`Created ${path} on ${branch} from ${base}`)
  if (argv.includes('--no-install'))
    return 0
  const installed = await install(path)
  if (installed !== 0 || !model)
    return installed
  const prepared = await prepareQa(path, model)
  if (prepared === 0)
    console.info(`wt: ready ${name} at ${path} on ${branch} (${git(path, ['rev-parse', '--short', 'HEAD'])}); .env.qa model from ${model.from}; Cubism Core set up; dependencies installed`)
  return prepared
}

function removeDirectory(path: string): void {
  if (!existsSync(path))
    return
  if (process.platform === 'win32') {
    // NOTICE:
    // `git worktree remove` can unregister a worktree yet fail on node_modules paths over MAX_PATH.
    // The \\?\ prefix makes rmdir use extended-length paths.
    // Source: dtuber worktree cleanup, 2026-10-20.
    // Removal condition: Git for Windows deletes long paths itself.
    execFileSync('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', `\\\\?\\${path}`], { stdio: 'inherit' })
  }
  else {
    execFileSync('rm', ['-rf', path], { stdio: 'inherit' })
  }
}

function removeOne(root: string, state: WorktreeState, force: boolean, deleteBranch: boolean): boolean {
  const blocker = rmBlocker(state, force)
  if (blocker) {
    console.error(`${state.name}: ${blocker}`)
    return false
  }
  try {
    if (!state.prunable)
      git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), state.path])
  }
  catch (error) {
    console.info(`${state.name}: git worktree remove failed (${(errorMessageFrom(error) ?? 'unknown error').split('\n')[0]}); deleting the directory directly`)
  }
  removeDirectory(state.path)
  git(root, ['worktree', 'prune'])
  console.info(`${state.name}: removed ${state.path}`)
  if (deleteBranch && state.branch) {
    try {
      git(root, ['branch', '-d', state.branch])
      console.info(`${state.name}: deleted merged branch ${state.branch}`)
    }
    catch {
      console.info(`${state.name}: kept branch ${state.branch} (not merged)`)
    }
  }
  return true
}

function remove(root: string, argv: string[]): number {
  const name = argv[0]
  const { states } = collect(root)
  const state = states.find(item => item.name === name)
  if (!state) {
    console.error(`No worktree named ${JSON.stringify(name)}. Run \`pnpm wt ls\`.`)
    return 2
  }
  return removeOne(root, state, argv.includes('--force'), argv.includes('--delete-branch')) ? 0 : 1
}

function gc(root: string, argv: string[]): number {
  const daysIndex = argv.indexOf('--days')
  const days = daysIndex === -1 ? 14 : Number(argv[daysIndex + 1])
  if (!Number.isFinite(days) || days < 0) {
    console.error(`--days needs a non-negative number\n${usage}`)
    return 2
  }
  const confirmed = argv.includes('--yes')
  const now = Date.now()
  let failures = 0
  for (const state of collect(root).states) {
    const decision = gcDecision(state, days, now)
    if (!decision.remove) {
      console.info(`keep    ${state.name.padEnd(34)} ${decision.reason}`)
      continue
    }
    if (!confirmed) {
      console.info(`remove  ${state.name.padEnd(34)} ${decision.reason}`)
      continue
    }
    if (!removeOne(root, state, false, false))
      failures++
  }
  if (!confirmed)
    console.info('\nDry run. Add --yes to remove the worktrees marked remove.')
  return failures ? 1 : 0
}

async function main(argv: string[]): Promise<number> {
  const root = repoRoot(process.cwd())
  const [command, ...rest] = argv
  if (command === 'ls')
    return list(root)
  if (command === 'new')
    return await create(root, rest)
  if (command === 'rm')
    return remove(root, rest)
  if (command === 'gc')
    return gc(root, rest)
  console.error(usage)
  return 2
}

try {
  process.exitCode = await main(process.argv.slice(2))
}
catch (error) {
  console.error(`wt broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exitCode = 1
}
