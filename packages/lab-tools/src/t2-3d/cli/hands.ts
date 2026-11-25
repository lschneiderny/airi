import type { BodySide } from '@proj-airi/motion-driver-humanoid/performance'
import type { MMDBodyWeights } from '@proj-airi/stage-ui-mmd/composables/mmd/body/performer'
import type { MMDCleanPose } from '@proj-airi/stage-ui-mmd/composables/mmd/frame-pipeline'

import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { FrameRig } from '../frames/pose'
import type { Vec3 } from '../metrics'

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { readGitStateFromRepo } from '@proj-airi/qa-tools/evidence/run'
import { rotate } from '@proj-airi/qa-tools/t2-3d/metrics/math'
import { loadHeadlessMMD } from '@proj-airi/qa-tools/t2-3d/runner/loader'
import { MMDBody } from '@proj-airi/stage-ui-mmd/composables/mmd/body'
import { MMDBodyPerformer } from '@proj-airi/stage-ui-mmd/composables/mmd/body/performer'
import { MMDBodyPose } from '@proj-airi/stage-ui-mmd/composables/mmd/body/pose'
import { readMMDRigProfile } from '@proj-airi/stage-ui-mmd/composables/mmd/rig'

import { closeUpFraming } from '../frames/close-up'
import { armDegrees, CONTACT_CELLS, contactChannels, HAND_SHEET_CELLS, handSheetChannels } from '../frames/hand-sheet'
import { frameRigFromMMD, meshSpacePoses } from '../frames/model'
import { skin } from '../frames/pose'
import { cameraToward, contactSheet, encodePng, rasterize } from '../frames/render'

const usage = 'Usage: lab:motion3d hands --model <pmx> --out <directory> [--pixels <n>]'
/** Pixels across one view of one hand, unless `--pixels` sets them. */
const CELL_SIZE = 300
/** The view spans this many hand lengths (wrist to the middle finger's last joint), so a spread or bent hand still fits. */
const SPAN_HAND_LENGTHS = 2.2
/** The performer's seed; it draws the rest pose's small per-rig variation, and the index records it. */
const SEED = 1
/** No clip owns any bone: the performer writes every arm and finger group whole. */
const UNOWNED: MMDBodyWeights = { pelvis: 0, hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
/** The frame pipeline's solver pass after the pose stages, without physics: grants (twist children) and fixed axes apply. */
const SOLVE = { grant: true, ik: true, physics: false } as const
const SIDES: readonly BodySide[] = ['left', 'right']

/**
 * The views, in her frame at bind (x her left, z her forward), for the hand on side `sigma` (1 left, -1 right). With the
 * arm at its rest hang the palm faces the thigh, so lateral shows the back of the hand, medial the palm, front the
 * thumb side and rear the little-finger side.
 */
const VIEWS = {
  lateral: (sigma: number): Vec3 => [sigma, 0, 0],
  medial: (sigma: number): Vec3 => [-sigma, 0, 0],
  front: (): Vec3 => [0, 0, 1],
  rear: (): Vec3 => [0, 0, -1],
} as const
/**
 * A contact cell's views, in her frame at bind, for the hand on side `sigma`: from in front, from her own side, between
 * the two, and from in front and above. The whole mesh is drawn, so the body hides what lies behind it.
 */
const CONTACT_VIEWS = {
  front: (): Vec3 => [0, 0, 1],
  lateral: (sigma: number): Vec3 => [sigma, 0, 0],
  oblique: (sigma: number): Vec3 => [sigma * Math.SQRT1_2, 0, Math.SQRT1_2],
  above: (): Vec3 => [0, Math.SQRT1_2, Math.SQRT1_2],
} as const
/** A contact cell spans this many hand lengths, so the face, chest or other hand the hand meets is in view. */
const CONTACT_SPAN_HAND_LENGTHS = 3.2
const VIEW_NOTES = {
  lateral: 'from outside the arm: the back of the hand at rest',
  medial: 'from inside the arm, body cut away: the palm at rest',
  front: 'from in front: the thumb side at rest',
  rear: 'from behind: the little-finger side at rest',
} as const

export const HANDS_LIMITS = 'Only the forearm, hand and fingers are drawn: triangles whose vertices are skinned mostly to the lower arm or a bone under it, flat grey, no materials. The arm hangs at the performer\'s rest; the hand and wrist channels are set directly and written by MMDBodyPerformer.applyArms, then grants and fixed axes are solved as the frame pipeline does, without physics: cloth on physics bones under the forearm keeps its bind pose relative to its parent. Contact cells draw the whole mesh with both arms at the gesture layer\'s key and the trunk, head and legs at rest, so the emotion\'s or act\'s posture is absent; hair and cloth on physics bones keep their bind pose.'

class HandsUsageError extends Error {
  override readonly name = 'HandsUsageError'
}

function parse(args: readonly string[], cwd: string): { model: string, out: string, pixels: number } {
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--'))
      throw new HandsUsageError(`unexpected argument ${args[i]}`)
    if (!args[i + 1] || args[i + 1].startsWith('--'))
      throw new HandsUsageError(`${args[i]} needs a value`)
    values.set(args[i].slice(2), args[++i])
  }
  const unknown = [...values.keys()].find(key => key !== 'model' && key !== 'out' && key !== 'pixels')
  if (unknown)
    throw new HandsUsageError(`unknown option --${unknown}`)
  const model = values.get('model')
  const out = values.get('out')
  if (!model || !out)
    throw new HandsUsageError('--model and --out are required')
  const pixels = Number(values.get('pixels') ?? CELL_SIZE)
  if (!Number.isInteger(pixels) || pixels < 100 || pixels > 1200)
    throw new HandsUsageError('--pixels must be a whole number from 100 to 1200')
  return { model: resolve(cwd, model), out: resolve(cwd, out), pixels }
}

/** The rig bones one side's drawing needs, and the triangles skinned mostly to the forearm or a bone under it. */
function sideOf(rig: FrameRig, side: BodySide) {
  const slot = (name: string) => {
    const index = rig.bones.findIndex(bone => bone.slot === `${side}${name}`)
    if (index < 0)
      throw new HandsUsageError(`the model has no ${side}${name} bone; the hand sheet needs the forearm, the hand and the middle finger`)
    return index
  }
  const lower = slot('LowerArm')
  const hand = slot('Hand')
  const tip = slot('MiddleDistal')
  const under = (index: number): boolean => index === lower || (index >= 0 && rig.bones[index].parent >= 0 && under(rig.bones[index].parent))
  const inArm = rig.bones.map((_, index) => under(index))
  const dominant = (vertex: number) => {
    let best = 0
    for (let k = 1; k < 4; k++) {
      if (rig.skinWeights[vertex * 4 + k] > rig.skinWeights[vertex * 4 + best])
        best = k
    }
    return rig.skinIndices[vertex * 4 + best]
  }
  const triangles: number[] = []
  for (let t = 0; t + 2 < rig.triangles.length; t += 3) {
    if ([0, 1, 2].every(k => inArm[dominant(rig.triangles[t + k])]))
      triangles.push(rig.triangles[t], rig.triangles[t + 1], rig.triangles[t + 2])
  }
  const [h, d] = [rig.bones[hand].bindPosition, rig.bones[tip].bindPosition]
  return { hand, tip, triangles, length: Math.hypot(d[0] - h[0], d[1] - h[1], d[2] - h[2]) }
}

/**
 * `lab:motion3d hands`: a contact sheet of one rig's hands in every hand shape and at the ends of each wrist axis, posed
 * through the product's arm write. Exit 0 when the sheet is written, 2 on a usage error or a rig without the bones, 130
 * on interrupt.
 */
export async function handsMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  try {
    const options = parse(args, context.cwd)
    const loaded = await loadHeadlessMMD(options.model)
    try {
      const { mmd } = loaded
      const profile = readMMDRigProfile(mmd.pmx)
      const rig = frameRigFromMMD(mmd)
      const sides = { left: sideOf(rig, 'left'), right: sideOf(rig, 'right') }
      // The product body measures the rig's traits; the sheet's own performer then writes the arms it is given.
      const traits = new MMDBody(mmd, profile, { modelKey: 'hand-sheet', input: () => null }).traits
      if (!traits)
        throw new HandsUsageError('the body cannot read this rig\'s traits, so the performer cannot pose it')
      const performer = new MMDBodyPerformer(new MMDBodyPose(mmd, profile), traits, { seed: SEED, onEvent: () => {} })
      const bones = mmd.mesh.skeleton.bones
      const clean: MMDCleanPose = { positions: bones.map(bone => bone.position.clone()), quaternions: bones.map(bone => bone.quaternion.clone()), morphs: [], clipWeights: new Map() }
      const rest = performer.restChannels()
      const span = SPAN_HAND_LENGTHS * Math.max(sides.left.length, sides.right.length)
      const contactSpan = CONTACT_SPAN_HAND_LENGTHS * Math.max(sides.left.length, sides.right.length)
      const git = readGitStateFromRepo(context.repoRoot)
      console.info(`hands ${options.model}: ${HAND_SHEET_CELLS.length + CONTACT_CELLS.length} cells x 2 hands x ${Object.keys(VIEWS).length} views; ${span.toFixed(3)} model units across ${options.pixels} pixels`)
      const strips: Record<BodySide, { rgb: Uint8Array, caption: string[] }[]> = { left: [], right: [] }
      const cells = []
      const drawCell = async (name: string, channels: Float32Array, contact: { readonly reached: readonly BodySide[] } | null) => {
        // The frame pipeline's order: restore the clean pose, run the arm stage, then the solvers.
        mmd.beforeUpdate()
        bones.forEach((bone, i) => {
          bone.position.copy(clean.positions[i])
          bone.quaternion.copy(clean.quaternions[i])
        })
        performer.applyArms(clean, UNOWNED, channels)
        mmd.beforePhysics(SOLVE)
        mmd.afterPhysics(SOLVE)
        mmd.mesh.updateMatrixWorld(true)
        const posed = meshSpacePoses(mmd.mesh)
        const vertices = skin(rig, posed)
        const files: Partial<Record<BodySide, string>> = {}
        for (const side of SIDES) {
          const { hand, tip, triangles } = sides[side]
          const [a, b] = [rotate(rig.basis, posed.positions[hand]), rotate(rig.basis, posed.positions[tip])]
          const focus: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
          const degrees = armDegrees(channels, side)
          const views = contact ? CONTACT_VIEWS : VIEWS
          const row = Object.entries(views).map(([view, toward]) => {
            const camera = cameraToward(toward(side === 'left' ? 1 : -1))
            const { framing, centre } = closeUpFraming(camera, focus, contact ? contactSpan : span, options.pixels)
            const reach = contact && !contact.reached.includes(side) ? ' (not reached)' : ''
            return {
              rgb: rasterize(vertices, contact ? rig.triangles : triangles, camera, framing, centre),
              caption: [`${name} ${side} ${view}${reach}`, `pron ${degrees.Pron.toFixed(0)} wflex ${degrees.Wflex.toFixed(0)} wdev ${degrees.Wdev.toFixed(0)}`],
            }
          })
          strips[side].push(...row)
          const strip = contactSheet(row, options.pixels, options.pixels, row.length)
          files[side] = join(side, `${name}.png`)
          await mkdir(join(options.out, side), { recursive: true })
          await writeFile(join(options.out, files[side]), await encodePng(strip.rgb, strip.width, strip.height))
        }
        return files
      }
      for (const cell of HAND_SHEET_CELLS) {
        context.signal.throwIfAborted()
        const channels = handSheetChannels(rest, cell)
        const files = await drawCell(cell.name, channels, null)
        cells.push({ name: cell.name, shape: cell.shape, blend: cell.blend ?? null, walk: cell.walk ?? null, wristDeg: cell.wrist, files, channelsDeg: { left: armDegrees(channels, 'left'), right: armDegrees(channels, 'right') } })
      }
      for (const contact of CONTACT_CELLS) {
        context.signal.throwIfAborted()
        const { channels, reached } = contactChannels(rest, traits, contact)
        const files = await drawCell(contact, channels, { reached })
        cells.push({ name: contact, contact: { reached }, files, channelsDeg: { left: armDegrees(channels, 'left'), right: armDegrees(channels, 'right') } })
      }
      const sheets: Partial<Record<BodySide, string>> = {}
      for (const side of SIDES) {
        const sheet = contactSheet(strips[side], options.pixels, options.pixels, Object.keys(VIEWS).length)
        sheets[side] = `sheet-${side}.png`
        await writeFile(join(options.out, sheets[side]), await encodePng(sheet.rgb, sheet.width, sheet.height))
      }
      await writeFile(join(options.out, 'index.json'), `${JSON.stringify({
        kind: 'motion3d-hand-sheet',
        version: 1,
        model: options.model,
        modelSha256: loaded.assetSha256,
        commit: git.gitSha,
        dirty: git.dirty,
        seed: SEED,
        spanModelUnits: span,
        handLength: { left: sides.left.length, right: sides.right.length },
        cellPixels: options.pixels,
        views: VIEW_NOTES,
        sheets,
        limits: HANDS_LIMITS,
        cells,
      }, null, 2)}\n`)
      console.info(`  wrote ${sheets.left} and ${sheets.right} (rows are cells, columns ${Object.keys(VIEWS).join(', ')}), one strip per cell and hand, and index.json to ${options.out}`)
      console.info(`  limits: ${HANDS_LIMITS}`)
      return 0
    }
    finally {
      loaded.dispose()
    }
  }
  catch (error) {
    if (context.signal.aborted)
      return 130
    if (!(error instanceof HandsUsageError))
      throw error
    console.error(`lab:motion3d hands: ${errorMessageFrom(error) ?? 'refused'}\n${usage}`)
    return 2
  }
}
