import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { T2SetupError } from './errors'

interface Model3Json {
  FileReferences?: { Moc?: string, Physics?: string, Pose?: string, DisplayInfo?: string }
}

/** Rig files the loop needs. Textures are never read. */
export interface T2RigData {
  /** Directory that holds the `.model3.json`; catalog expression files resolve against it. */
  dir: string
  modelJsonPath: string
  /** Absolute model3.json path as a URL-like string; the SDK only uses it to resolve relative file names. */
  modelUrl: string
  modelJson: Record<string, unknown>
  moc: ArrayBuffer
  physicsJson: unknown
  poseJson: unknown
  displayInfoJson: unknown
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
 * Reads a local rig. The rig never enters git: it is read from the folder that `AIRI_QA_RIG_FORBOOTH`
 * names. Throws a `T2SetupError` that names the missing piece when the variable is unset, the folder
 * is missing or empty, or the `.model3.json` / `.moc3` cannot be found.
 */
export function readRig(root: string | undefined): T2RigData {
  if (!root)
    throw new T2SetupError('AIRI_QA_RIG_FORBOOTH is not set; point it at the local ForBOOTH rig folder (it must contain a .moc3).')
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new T2SetupError(`Rig folder does not exist: ${root} (expected a folder that contains a .moc3)`)
  const modelJsonPath = findModelJson(root, 0)
  if (!modelJsonPath)
    throw new T2SetupError(`No .moc3 found: no .model3.json within ${maxSearchDepth} folder levels of ${root}, so the .moc3 cannot be located.`)

  const dir = dirname(modelJsonPath)
  let modelJson: Model3Json & Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(modelJsonPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Expected a model3.json object')
    modelJson = parsed as Model3Json & Record<string, unknown>
  }
  catch (error) {
    throw new T2SetupError(`Invalid .model3.json: ${modelJsonPath}`, { cause: error })
  }
  const refs = modelJson.FileReferences ?? {}
  if (!refs.Moc || !existsSync(join(dir, refs.Moc)))
    throw new T2SetupError(`The .moc3 named by ${modelJsonPath} is missing: ${refs.Moc ?? '(no FileReferences.Moc)'}`)

  const mocBytes = readFileSync(join(dir, refs.Moc))
  const readJson = (file: string | undefined) => (file ? JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown : undefined)
  return {
    dir,
    modelJsonPath,
    modelUrl: modelJsonPath.replaceAll('\\', '/'),
    modelJson,
    // Copy into a standalone ArrayBuffer: Node's Buffer may be a view into a shared pool.
    moc: mocBytes.buffer.slice(mocBytes.byteOffset, mocBytes.byteOffset + mocBytes.byteLength) as ArrayBuffer,
    physicsJson: readJson(refs.Physics),
    poseJson: readJson(refs.Pose),
    displayInfoJson: readJson(refs.DisplayInfo),
  }
}
