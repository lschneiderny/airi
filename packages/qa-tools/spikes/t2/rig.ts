import type { T2RigData } from './loop'

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface Model3Json {
  FileReferences?: { Moc?: string, Physics?: string, Pose?: string }
}

/** Depth 0 is the rig root; ForBOOTH keeps its `.model3.json` one folder below the root. */
const maxSearchDepth = 2

function findModelJson(dir: string, depth: number): string | undefined {
  const entries = readdirSync(dir, { withFileTypes: true })
  const direct = entries.find(entry => entry.isFile() && entry.name.endsWith('.model3.json'))
  if (direct)
    return join(dir, direct.name)
  if (depth >= maxSearchDepth)
    return undefined
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const nested = findModelJson(join(dir, entry.name), depth + 1)
    if (nested)
      return nested
  }
  return undefined
}

/**
 * Reads a local rig for the spike. The rig never enters git: it is read from the folder that
 * `AIRI_QA_RIG_FORBOOTH` names. Throws an error that names the missing piece when the variable is
 * unset, the folder is missing or empty, or the `.model3.json` / `.moc3` cannot be found.
 */
export function readRig(root: string | undefined): T2RigData & { modelJsonPath: string } {
  if (!root)
    throw new Error('AIRI_QA_RIG_FORBOOTH is not set; point it at the local ForBOOTH rig folder.')
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error(`Rig folder does not exist: ${root}`)
  const modelJsonPath = findModelJson(root, 0)
  if (!modelJsonPath)
    throw new Error(`No .model3.json found within ${maxSearchDepth} folder levels of ${root}; the .moc3 cannot be located.`)

  const dir = join(modelJsonPath, '..')
  const modelJson = JSON.parse(readFileSync(modelJsonPath, 'utf8')) as Model3Json & Record<string, unknown>
  const refs = modelJson.FileReferences ?? {}
  if (!refs.Moc || !existsSync(join(dir, refs.Moc)))
    throw new Error(`The .moc3 named by ${modelJsonPath} is missing: ${refs.Moc ?? '(no FileReferences.Moc)'}`)

  const mocBytes = readFileSync(join(dir, refs.Moc))
  const readJson = (file: string | undefined) => (file ? JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown : undefined)
  return {
    modelJsonPath,
    modelUrl: modelJsonPath.replaceAll('\\', '/'),
    modelJson,
    // Copy into a standalone ArrayBuffer: Node's Buffer may be a view into a shared pool.
    moc: mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength) as ArrayBuffer,
    physicsJson: readJson(refs.Physics),
    poseJson: readJson(refs.Pose),
  }
}
