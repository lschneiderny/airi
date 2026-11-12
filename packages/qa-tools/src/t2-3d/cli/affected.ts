import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { CommitSource } from '../affected'

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'

import { errorMessageFrom } from '@moeru/std'

import { decideAffected, manifestDiffers, RUNNER_ROOTS, runnerClosure } from '../affected'

const usage = 'Usage: qa:motion3d affected <base commit> <tip commit>'

function git(repoRoot: string, args: string[], input?: string): Buffer {
  return execFileSync('git', args, { cwd: repoRoot, input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}

/** Files of one commit read from git objects, so any two commits can be compared without a checkout. */
function commitSource(repoRoot: string, commit: string): CommitSource {
  const paths = new Set(git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', commit]).toString('utf8').split('\0').filter(Boolean))
  return {
    paths,
    read: (wanted) => {
      const texts = new Map<string, string>()
      const present = wanted.filter(path => paths.has(path))
      if (!present.length)
        return texts
      const output = git(repoRoot, ['cat-file', '--batch'], present.map(path => `${commit}:${path}\n`).join(''))
      let offset = 0
      for (const path of present) {
        const header = output.subarray(offset, output.indexOf(0x0A, offset)).toString('utf8')
        offset += Buffer.byteLength(header) + 1
        const [, type, size] = header.split(' ')
        if (type !== 'blob')
          continue
        texts.set(path, output.subarray(offset, offset + Number(size)).toString('utf8'))
        offset += Number(size) + 1
      }
      return texts
    },
  }
}

/**
 * `qa:motion3d affected <base> <tip>`: whether any file the headless runner loads changed between two commits.
 * Exit 0 not affected, 1 affected, 2 cannot tell (or a usage error).
 */
export async function affectedMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) {
    console.error(usage)
    return 2
  }
  let commits: string[]
  try {
    commits = args.map(rev => git(context.repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).toString('utf8').trim())
  }
  catch (error) {
    console.error(`qa:motion3d affected: ${args.join(' or ')} is not a commit: ${errorMessageFrom(error) ?? 'git rev-parse failed'}\n${usage}`)
    return 2
  }
  const [base, tip] = commits
  const sources = commits.map(commit => commitSource(context.repoRoot, commit))
  const [baseClosure, tipClosure] = sources.map(source => runnerClosure(source))
  const changed = git(context.repoRoot, ['diff', '--name-only', '--no-renames', '-z', base, tip]).toString('utf8').split('\0').filter(Boolean)
  const manifests = changed.filter(path => baseClosure.manifests.has(path) || tipClosure.manifests.has(path))
  const [baseManifests, tipManifests] = sources.map(source => source.read(manifests))
  const answer = decideAffected({ base: baseClosure, tip: tipClosure, changed, manifestChanged: path => manifestDiffers(baseManifests.get(path), tipManifests.get(path)) })
  const verdict = { 'affected': 'AFFECTED', 'not-affected': 'NOT AFFECTED', 'cannot-tell': 'CANNOT TELL' }[answer.verdict]
  console.info(`affected ${base.slice(0, 9)}..${tip.slice(0, 9)}: ${verdict}`)
  console.info(`  runner roots: ${RUNNER_ROOTS.join(', ')}`)
  console.info(`  closure: ${tipClosure.files.size} file(s) at tip, ${baseClosure.files.size} at base; ${new Set([...tipClosure.manifests, ...baseClosure.manifests]).size} manifest(s); ${changed.length} changed file(s) between the commits`)
  if (answer.hits.length)
    console.info(`  changed inside the closure (${answer.hits.length}):\n${answer.hits.map(path => `    ${path}`).join('\n')}`)
  for (const reason of answer.reasons)
    console.info(`  cannot tell: ${reason}`)
  console.info('  limits: static imports, literal import() and new URL(..., import.meta.url) only; files read through fs at runtime are not followed (the runner reads only dependency package.json versions that way).')
  return { 'not-affected': 0, 'affected': 1, 'cannot-tell': 2 }[answer.verdict]
}
