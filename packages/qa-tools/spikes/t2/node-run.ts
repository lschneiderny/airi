/**
 * T2 spike, Node side. Not part of the package build, typecheck, or test run.
 *
 * Usage (from packages/qa-tools):
 *   tsx spikes/t2/node-run.ts parity --physics on|off [--deform on|off] --out <file.json>
 *   tsx spikes/t2/node-run.ts speed [--seconds 600] [--deform on|off]
 *
 * Inputs: AIRI_QA_RIG_FORBOOTH (rig folder), AIRI_QA_CUBISM_CORE (optional core path).
 */
import type { Cubism4Module } from './loop'

import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { defaultCorePath, installWindowShim, loadCubismCoreInNode } from './core-node'
import { runT2Loop } from './loop'
import { readRig } from './rig'

const fps = 60
const dt = 1 / fps
const seed = 1

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      physics: { type: 'string', default: 'on' },
      deform: { type: 'string', default: 'on' },
      out: { type: 'string' },
      seconds: { type: 'string', default: '600' },
    },
  })
  const mode = positionals[0]
  if (mode !== 'parity' && mode !== 'speed')
    throw new Error('Usage: node-run.ts parity --physics on|off [--deform on|off] --out <file> | speed [--seconds N] [--deform on|off]')
  const deform = values.deform !== 'off'

  console.info(`[env] node ${process.version}; window=${typeof (globalThis as { window?: unknown }).window}; document=${typeof (globalThis as { document?: unknown }).document}; WebGLRenderingContext=${typeof (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext}`)
  const rig = readRig(process.env.AIRI_QA_RIG_FORBOOTH)
  console.info(`[step 3] rig model3.json: ${rig.modelJsonPath}; moc3 ${rig.moc.byteLength} bytes; physics ${rig.physicsJson ? 'present' : 'absent'}; pose ${rig.poseJson ? 'present' : 'absent'}`)

  const corePath = process.env.AIRI_QA_CUBISM_CORE ?? defaultCorePath
  const core = await loadCubismCoreInNode(corePath)
  console.info(`[step 2] core ${core.version} (latest moc version ${core.latestMocVersion}) ready after ${core.readyAfterYields} macrotask yield(s); shims: ${core.shims.join(', ') || 'none'}`)

  const windowShims = installWindowShim()
  // The package's `import` export condition points at dist/cubism4.es.js; resolve it through the
  // stage-ui-live2d dependency, since qa-tools does not depend on pixi-live2d-display directly.
  const cjsEntry = createRequire(join(import.meta.dirname, '../../../stage-ui-live2d/package.json')).resolve('pixi-live2d-display/cubism4')
  const cubism4 = await import(pathToFileURL(join(dirname(cjsEntry), 'cubism4.es.js')).href) as Cubism4Module
  console.info(`[step 4] path A: pixi-live2d-display/cubism4 imported; shims: ${windowShims.join(', ') || 'none'}`)

  if (mode === 'parity') {
    const physics = values.physics !== 'off'
    const result = runT2Loop(cubism4, rig, { frames: 600, dt, seed, physics, recordParameters: true, deform, profile: false })
    console.info(`[step 5] Cubism4InternalModel built and updated without a GL context; ${result.frames.length} frames x ${result.parameterIds.length} parameters; trace ${result.trace.t.length} samples; physics ${physics ? 'on' : 'off'}; deform ${deform ? 'on' : 'off'}; adapter weightMean ${result.trace.meta.adapter.weightMean.toFixed(4)}`)
    if (!values.out)
      throw new Error('--out is required for parity mode')
    mkdirSync(dirname(values.out), { recursive: true })
    writeFileSync(values.out, JSON.stringify({ side: 'node', physics, deform, seed, dt, parameterIds: result.parameterIds, frames: result.frames, trace: result.trace }))
    console.info(`[out] ${values.out}`)
    return
  }

  const seconds = Number(values.seconds)
  const frames = Math.round(seconds * fps)
  const result = runT2Loop(cubism4, rig, { frames, dt, seed, physics: true, recordParameters: false, deform, profile: true })
  const multiple = seconds / (result.loopMs / 1000)
  console.info(`[step 7] simulated ${seconds} s (${frames} frames at ${fps} Hz) in ${(result.loopMs / 1000).toFixed(3)} s loop wall (+${(result.setupMs / 1000).toFixed(3)} s setup); deform ${deform ? 'on' : 'off'}; speed multiple ${multiple.toFixed(2)}x; trace ${result.trace.t.length} samples`)
  console.info(JSON.stringify({ speed: { deform, simulatedSeconds: seconds, frames, loopWallSeconds: result.loopMs / 1000, setupWallSeconds: result.setupMs / 1000, speedMultiple: multiple, stageMs: result.profile } }))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
