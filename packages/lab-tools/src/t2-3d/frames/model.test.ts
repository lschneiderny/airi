import process from 'node:process'

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, it, vi } from 'vitest'

import { readGitStateFromRepo } from '../../evidence/run'
import { framesMotion3d } from '../cli/frames'
import { runMotion3dScenario } from '../runner/run'
import { motion3dScenarios } from '../scenarios'

const repoRoot = resolve(import.meta.dirname, '../../../../..')

it.runIf(process.env.AIRI_QA_MMD_MODEL)('poses a real run from its trace and a re-run that reproduces it, and draws the frame', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  const scenario = motion3dScenarios.find(s => s.id === 'idle')
  if (!model || !scenario)
    throw new Error('AIRI_QA_MMD_MODEL and the idle scenario are required')
  const dir = await mkdtemp(join(tmpdir(), 'motion3d-frames-'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const signal = new AbortController().signal
    const run = await runMotion3dScenario({ model, scenario, seed: 1, seconds: 2, warmupSeconds: 0.5, git: readGitStateFromRepo(repoRoot), signal, acts: 'on' })
    await writeFile(join(dir, 'trace.json'), JSON.stringify(run.trace))
    await writeFile(join(dir, 'summary.json'), JSON.stringify(run.summary))
    const code = await framesMotion3d([dir, '--model', model, '--at', '1.5', '--views', 'front', '--out', join(dir, 'frames')], { repoRoot, cwd: repoRoot, signal })
    expect(code).toBe(0)
    const index = JSON.parse(await readFile(join(dir, 'frames', 'index.json'), 'utf8'))
    expect(index.pose.rerun.largestTurnDeg).toBe(0)
    expect(index.pose.rerun.posedAgainstRerunDeg).toBeLessThan(0.01)
    expect(existsSync(join(dir, 'frames', index.frames[0].files.front))).toBe(true)
  }
  finally {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  }
}, 600_000)

it.runIf(process.env.AIRI_QA_MMD_MODEL)('re-runs a stored acts-off run with acts off, so its trace source detail is reproduced too', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  const scenario = motion3dScenarios.find(s => s.id === 'idle')
  if (!model || !scenario)
    throw new Error('AIRI_QA_MMD_MODEL and the idle scenario are required')
  const dir = await mkdtemp(join(tmpdir(), 'motion3d-frames-'))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const signal = new AbortController().signal
    const run = await runMotion3dScenario({ model, scenario, seed: 1, seconds: 2, warmupSeconds: 0.5, git: readGitStateFromRepo(repoRoot), signal, acts: 'off' })
    await writeFile(join(dir, 'trace.json'), JSON.stringify(run.trace))
    await writeFile(join(dir, 'summary.json'), JSON.stringify(run.summary))
    const code = await framesMotion3d([dir, '--model', model, '--at', '1.5', '--views', 'front', '--out', join(dir, 'frames')], { repoRoot, cwd: repoRoot, signal })
    expect(code).toBe(0)
    const index = JSON.parse(await readFile(join(dir, 'frames', 'index.json'), 'utf8'))
    expect(index.pose.rerun.blocks).toContainEqual({ block: 'detail', identical: true })
  }
  finally {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  }
}, 600_000)
