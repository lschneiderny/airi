import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MotionQaImportModelInput } from '@proj-airi/stage-shared/motion-scenario'

import type { MotionQaBridgeClient } from './bridge-client'

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import JSZip from 'jszip'

import { sha256Buffer } from '../evidence/run'

/** The Live2D rig variable: a directory holding the ForBOOTH `*.model3.json` at depth <= 2. */
const live2dRigEnv = 'AIRI_QA_RIG_FORBOOTH'

/** A rig that cannot be resolved from the environment; callers refuse before launching anything. */
export class RigSetupError extends Error {}

export interface ResolvedRig {
  /** The rig directory from the environment. */
  root: string
  /** The directory that holds the rig's `*.model3.json`; the harness zips this directory. */
  modelDir: string
  model3: string
}

/** Resolves the Live2D rig from `AIRI_QA_RIG_FORBOOTH`; throws `RigSetupError` when it is unset, missing, or has no `*.model3.json` at depth <= 2. */
export function resolveLive2DRig(env: Record<string, string | undefined>): ResolvedRig {
  const root = env[live2dRigEnv]
  if (!root)
    throw new RigSetupError(`${live2dRigEnv} is not set; point it at the forbooth rig directory`)
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new RigSetupError(`${live2dRigEnv}=${root} is not a directory`)
  const queue: { dir: string, depth: number }[] = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    const model = entries.find(entry => entry.isFile() && entry.name.endsWith('.model3.json'))
    if (model)
      return { root, modelDir: dir, model3: join(dir, model.name) }
    if (depth < 2)
      queue.push(...entries.filter(entry => entry.isDirectory()).map(entry => ({ dir: join(dir, entry.name), depth: depth + 1 })))
  }
  throw new RigSetupError(`${live2dRigEnv}=${root} has no *.model3.json at depth <= 2`)
}

/** The hidden file input the harness creates in the stage page. */
const rigInputId = 'qa-rig'

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort()
}

/** Zips the rig's model directory (relative paths, forward slashes) into `zipPath`. Rig bytes stay in the run dir and are deleted at teardown. */
export async function zipRig(modelDir: string, zipPath: string): Promise<{ files: number, bytes: number, sha256: string }> {
  const zip = new JSZip()
  const files = filesUnder(modelDir)
  for (const file of files)
    zip.file(relative(modelDir, file).split(sep).join('/'), readFileSync(file))
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  writeFileSync(zipPath, data)
  return { files: files.length, bytes: data.length, sha256: sha256Buffer(data) }
}

/**
 * Puts `zipPath` into a hidden `<input type=file id=qa-rig>` through `DOM.setFileInputFiles` and imports it with the
 * bridge's `importModelFromInput`, which resolves once the stage reports the model loaded.
 */
export async function importRig(stage: CdpClient, bridge: MotionQaBridgeClient, zipPath: string, timeoutMs: number, kind?: MotionQaImportModelInput['kind']): Promise<{ modelId: string }> {
  const created = await stage.send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('${rigInputId}')?.remove()
      const input = document.createElement('input')
      input.type = 'file'
      input.id = '${rigInputId}'
      input.style.display = 'none'
      document.body.appendChild(input)
      return input
    })()`,
  }, 10_000)
  const remote = created.result && typeof created.result === 'object' ? (created.result as { result?: { objectId?: unknown } }).result : undefined
  if (typeof remote?.objectId !== 'string')
    throw new Error('Could not create the rig file input in the stage page')
  await stage.send('DOM.setFileInputFiles', { files: [zipPath], objectId: remote.objectId }, 30_000)
  return await bridge.call('importModelFromInput', { inputId: rigInputId, kind }, timeoutMs)
}
