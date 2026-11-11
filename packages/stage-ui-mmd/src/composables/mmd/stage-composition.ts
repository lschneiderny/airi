import type { MMDFrameStage } from './frame-pipeline'

/** Pose stage ids in pipeline order. The body stages come from `MMDBody`; the others belong to the host. */
export const MMD_POSE_STAGE_IDS = ['natural', 'locomotion', 'body-torso', 'foot-contact', 'body-head', 'body-arms', 'eyes', 'classic-gaze', 'classic-face', 'lip-sync', 'bone-morphs'] as const
/** Surface stage ids in pipeline order; the read-only `motion-trace` recorder is always last. */
export const MMD_SURFACE_STAGE_IDS = ['body-diagnostics', 'morphs', 'motion-trace'] as const

export type MMDPoseStageId = typeof MMD_POSE_STAGE_IDS[number]
export type MMDSurfaceStageId = typeof MMD_SURFACE_STAGE_IDS[number]
const MMD_BODY_POSE_STAGE_IDS = ['locomotion', 'body-torso', 'foot-contact', 'body-head', 'body-arms', 'eyes'] as const
type MMDBodyPoseStageId = typeof MMD_BODY_POSE_STAGE_IDS[number]
export type MMDHostStageId = Exclude<MMDPoseStageId, MMDBodyPoseStageId> | Exclude<MMDSurfaceStageId, 'body-diagnostics'>

export interface MMDStageParts {
  readonly body: { readonly poseStages: readonly MMDFrameStage[], readonly surfaceStage: MMDFrameStage }
  /**
   * The host's stages. A host that does not run one (the headless runner has no lip-sync, surface morphs or Classic
   * driver) leaves it out; the stage keeps its id and slot and does nothing, so every host reports the same list.
   */
  readonly host: Partial<Record<MMDHostStageId, MMDFrameStage['run']>>
}

const inert: MMDFrameStage['run'] = () => {}
const bodyStageIds: ReadonlySet<string> = new Set(MMD_BODY_POSE_STAGE_IDS)

/**
 * The one ordered stage list of an MMD scene. The scene registers it, the headless runner composes from it, and
 * `qa:stage capture` refuses a scene whose reported ids differ from `MMD_POSE_STAGE_IDS` and `MMD_SURFACE_STAGE_IDS`.
 */
export function composeMMDStages(parts: MMDStageParts): { pose: MMDFrameStage[], surface: MMDFrameStage[] } {
  const body = new Map(parts.body.poseStages.map(stage => [stage.id, stage]))
  const host = new Map<string, MMDFrameStage['run']>(Object.entries(parts.host))
  const pose = MMD_POSE_STAGE_IDS.map((id): MMDFrameStage => {
    const stage = body.get(id)
    if (stage)
      return stage
    if (bodyStageIds.has(id))
      throw new TypeError(`MMDBody has no pose stage ${id}`)
    return { id, run: host.get(id) ?? inert }
  })
  const surface = MMD_SURFACE_STAGE_IDS.map((id): MMDFrameStage =>
    id === 'body-diagnostics' ? parts.body.surfaceStage : { id, run: host.get(id) ?? inert })
  return { pose, surface }
}
