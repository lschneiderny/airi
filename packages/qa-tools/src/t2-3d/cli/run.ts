import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { RunHandle } from '../../evidence/run'

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'
import { acquire, CpuSlotsError } from '@proj-airi/cpu-slots'

import { createRun, readGitStateFromRepo } from '../../evidence/run'
import { Motion3dUsageError, parseRunArguments } from '../runner/arguments'
import { runMotion3dScenario } from '../runner/run'

/** Owns preflight, the gate lease and the standard QA evidence lifecycle. */
export async function runMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  let run: RunHandle | undefined
  try {
    const options = parseRunArguments(args, context.cwd)
    const lease = await acquire({
      class: 'gate',
      command: `qa:motion3d run --scenario ${options.scenario.id} --seed ${options.seed}`,
      cwd: context.repoRoot,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(30 * 60_000)]),
    })
    try {
      context.signal.throwIfAborted()
      const git = readGitStateFromRepo(context.repoRoot)
      run = createRun({
        tool: 'motion3d',
        label: `${options.scenario.id}-s${options.seed}`,
        repoRoot: context.repoRoot,
        outDir: options.out,
        readGitState: () => git,
      })
      const input = { ...options, git, signal: context.signal }
      const result = await runMotion3dScenario(input)
      const blockHash = (trace: typeof result.trace) => createHash('sha256').update(JSON.stringify([trace.rot, trace.root, trace.channels])).digest('hex')
      const hash = blockHash(result.trace)
      if (options.verifyDeterminism) {
        const replay = await runMotion3dScenario(input)
        const replayHash = blockHash(replay.trace)
        if (hash !== replayHash)
          throw new Error(`determinism mismatch: ${hash} != ${replayHash}`)
      }
      result.summary.provenance.blockSha256 = hash
      result.summary.provenance.determinismVerified = options.verifyDeterminism
      writeFileSync(run.path('trace.json'), `${JSON.stringify(result.trace)}\n`)
      run.addArtifact('trace.json', 'motion-trace')
      writeFileSync(run.path('summary.json'), `${JSON.stringify(result.summary, null, 2)}\n`)
      run.addArtifact('summary.json', 'motion3d-run-summary')
      const { collisions } = result.summary
      if (collisions.count > 0) {
        const message = `${collisions.count} performer ticks without a clear arm pose; last ${JSON.stringify(collisions.last)}`
        run.finish({ exitCode: 1, summary: message })
        console.error(`qa:motion3d run: ${message}`)
        return 1
      }
      run.finish({ exitCode: 0, summary: `${result.trace.frames} frames; ${options.scenario.id}; seed ${options.seed}` })
      console.info(JSON.stringify({
        ok: true,
        runDir: run.dir,
        frames: result.trace.frames,
        wallMs: result.summary.timing.wallMs,
        realtime: result.summary.timing.realtime,
      }))
      return 0
    }
    finally {
      lease.release()
    }
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'unknown run failure'
    const exitCode = context.signal.aborted ? 130 : error instanceof Motion3dUsageError || error instanceof CpuSlotsError ? 2 : 1
    run?.finish({ exitCode, summary: message })
    console.error(`qa:motion3d run: ${message}`)
    return exitCode
  }
}
