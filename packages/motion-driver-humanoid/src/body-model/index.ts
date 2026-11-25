import type { BodyMeshSource, BodyModel, BodyModelAdjustment } from './contracts'

import { fitBody } from './fit'
import { restTraits, solveRest } from './rest'

export type * from './contracts'
export { REST_GARMENT_CLEARANCE_MAX } from './rest'

/**
 * Builds the body model of one character from her bind-pose mesh: the hard volumes, the soft garments, the limb radii
 * and each arm's rest clearance. The source must name a hips bone, one to four spine bones, a neck, a head and both arms
 * with elbows and wrists of non-zero length, as `BodyRigTraits` does.
 *
 * The build is pure: no time, no random input, no renderer type. The same source gives the same model.
 */
export function buildBodyModel(source: BodyMeshSource): BodyModel {
  const fit = fitBody(source)
  const solved = solveRest(restTraits(source), fit.volumes, fit.garments)
  // Adjustments name volumes by their place in the final list; a dropped volume has none.
  const adjustments: BodyModelAdjustment[] = [...fit.adjustments, ...solved.adjustments].map(adjustment => ({
    ...adjustment,
    volume: solved.kept.indexOf(adjustment.volume),
  }))
  return {
    volumes: solved.volumes,
    garments: fit.garments.map((garment, index) => ({ ...garment, pinched: solved.pinched[index] })),
    limbs: fit.limbs,
    rest: solved.rest,
    report: { vertices: fit.vertices, adjustments },
  }
}
