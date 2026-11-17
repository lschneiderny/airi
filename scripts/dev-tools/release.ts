import type { ExistingRelease } from './release-plan'

import process from 'node:process'

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { releaseRepository } from '../../apps/stage-tamagotchi/src/shared/release-repository'
import { capture, run } from './lib/exec'
import { git, repoRoot } from './lib/git'
import { bundleCheck, checkExistingRelease, checkGitState, isReleaseArtifact, parseReleaseArgs, releaseChecks, releaseTag, releaseTarget } from './release-plan'

const repo = `${releaseRepository.owner}/${releaseRepository.repo}`

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function findExistingRelease(root: string, tag: string): ExistingRelease | undefined {
  try {
    return JSON.parse(capture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,targetCommitish'], { cwd: root })) as ExistingRelease
  }
  catch {
    return undefined
  }
}

async function step(title: string, command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv }) {
  console.info(`\nrelease: ${title}\n  $ ${[command, ...args].join(' ')}`)
  const code = await run(command, args, options)
  if (code !== 0)
    fail(`${title} failed with exit code ${code}`)
}

async function main() {
  const args = parseReleaseArgs(process.argv.slice(2))
  if ('error' in args)
    fail(args.error)

  const target = releaseTarget(process.platform, process.arch)
  if (!target)
    fail(`${process.platform}-${process.arch} has no release target; run it on Linux or macOS`)

  const root = repoRoot(process.cwd())
  const tag = releaseTag(args.version)
  const godot = process.env.GODOT4
  if (!godot || !existsSync(godot))
    fail('set GODOT4 to the Godot .NET editor executable that exports the stage sidecar')
  const engineDir = join(root, 'engines/stage-tamagotchi-godot')
  try {
    // Run in the engine directory so `dotnet` resolves the SDK that its global.json pins.
    capture('dotnet', ['--version'], { cwd: engineDir })
  }
  catch {
    fail('no .NET SDK matches engines/stage-tamagotchi-godot/global.json; the Godot export needs one (Fedora: `sudo dnf install dotnet-sdk-10.0`)')
  }
  try {
    capture('gh', ['auth', 'status'], { cwd: root })
  }
  catch {
    fail('gh is not signed in; run `gh auth login`')
  }

  git(root, ['fetch', '--quiet', 'origin', 'main'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const errors = checkGitState({
    branch: git(root, ['branch', '--show-current']),
    dirty: git(root, ['status', '--porcelain', '--untracked-files=no']) !== '',
    head,
    originHead: git(root, ['rev-parse', 'origin/main']),
  })
  const existing = findExistingRelease(root, tag)
  const releaseError = checkExistingRelease(existing, head)
  if (releaseError)
    errors.push(releaseError)
  if (errors.length)
    fail(errors.join('\n  '))

  const appDir = join(root, 'apps/stage-tamagotchi')
  const distDir = join(appDir, 'dist')
  const godotOutDir = join(engineDir, 'out', target.godotOutDir)

  console.info(`release: ${tag} from ${head.slice(0, 12)} for ${process.platform}-${process.arch}, ${existing ? 'adding to the existing draft' : 'creating a draft'} on ${repo}`)
  if (args.dryRun)
    return

  for (const check of releaseChecks(process.platform))
    await step(check.title, check.command, check.args, { cwd: root })

  rmSync(godotOutDir, { recursive: true, force: true })
  mkdirSync(godotOutDir, { recursive: true })
  await step('Godot sidecar export', godot, ['--headless', '--path', engineDir, '--export-release', target.godotPreset, join(godotOutDir, target.godotFile)], { cwd: engineDir })
  // NOTICE:
  // The export rewrites the csproj to `Sdk="Godot.NET.Sdk/<version>"` and leaves a `.csproj.old` backup.
  // The repository pins the SDK version in global.json instead, so the rewrite would leave main dirty.
  // Observed with Godot 4.7.2 .NET on 2026-11-11.
  // Remove when a Godot export leaves an unversioned Sdk attribute unchanged.
  const csproj = join(engineDir, 'stage-tamagotchi-godot.csproj')
  git(root, ['restore', '--', csproj])
  rmSync(`${csproj}.old`, { force: true })

  rmSync(distDir, { recursive: true, force: true })
  await step('app build', 'pnpm', ['slots', 'run', '--class', 'build', '--', 'pnpm', '-F', '@proj-airi/stage-tamagotchi', 'run', 'build'], { cwd: root })
  await step(bundleCheck.title, bundleCheck.command, bundleCheck.args, { cwd: root })
  // The rpm step stages the unpacked app twice, about 4 GB, under the temporary directory. On Linux that is usually a
  // RAM-backed tmpfs with a per-user quota, and an interrupted run leaves its copies there, so the next run fails with
  // `Disk quota exceeded`. Packaging gets a directory on disk instead, emptied before and after.
  const packagingTmpDir = join(root, 'node_modules', '.cache', 'release-tmp')
  const packagingEnv: NodeJS.ProcessEnv = { ...process.env, AIRI_REQUIRE_GODOT_STAGE: 'true' }
  if (process.platform === 'linux') {
    rmSync(packagingTmpDir, { recursive: true, force: true })
    mkdirSync(packagingTmpDir, { recursive: true })
    packagingEnv.TMPDIR = packagingTmpDir
  }
  await step('installer packaging', 'pnpm', ['slots', 'run', '--class', 'build', '--', 'pnpm', '-F', '@proj-airi/stage-tamagotchi', 'exec', 'electron-builder', target.builderFlag, '--publish', 'never', `-c.extraMetadata.version=${args.version}`], {
    cwd: root,
    env: packagingEnv,
  })
  rmSync(packagingTmpDir, { recursive: true, force: true })

  const artifacts = readdirSync(distDir).filter(isReleaseArtifact).map(file => join(distDir, file))
  if (!artifacts.length)
    fail(`electron-builder wrote no installers to ${distDir}`)

  if (existing)
    await step('draft upload', 'gh', ['release', 'upload', tag, '--repo', repo, '--clobber', ...artifacts], { cwd: root })
  else
    await step('draft release', 'gh', ['release', 'create', tag, '--repo', repo, '--draft', '--target', head, '--title', tag, '--notes', '', ...artifacts], { cwd: root })

  console.info(`\nrelease: ${tag} is a draft. Install it on a real display, then publish it with \`gh release edit ${tag} --repo ${repo} --draft=false\`.`)
}

await main()
