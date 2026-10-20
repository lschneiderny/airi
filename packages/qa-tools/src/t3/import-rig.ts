import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import type { MotionQaBridgeClient } from './bridge-client'

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import JSZip from 'jszip'

import { sha256Buffer } from '../evidence/run'

/** The hidden file input the harness creates in the stage page. */
export const rigInputId = 'qa-rig'

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
export async function importRig(stage: CdpClient, bridge: MotionQaBridgeClient, zipPath: string, timeoutMs: number): Promise<{ modelId: string }> {
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
  return await bridge.call('importModelFromInput', { inputId: rigInputId }, timeoutMs)
}
