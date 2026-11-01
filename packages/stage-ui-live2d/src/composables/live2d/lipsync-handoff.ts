/**
 * Timing of the lipsync mouth handoff. The lipsync plugin is the only owner of these values;
 * other writers read whether it owned `ParamMouthOpenY` this frame instead of copying them.
 */

/** Cross-fade from the last lipsync value back to the motion value once speech ends. */
export const lipSyncReleaseMs = 200

/** After the release, lipsync keeps forcing the mouth shut this long before other writers take it. */
export const lipSyncHandoffHoldMs = 500
