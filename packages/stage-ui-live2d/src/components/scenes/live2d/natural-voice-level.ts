/**
 * Maps the scene's lipsync mouth opening to the Natural voice level that drives speech emphasis.
 *
 * Stage writes `getMouthOpen()` from the lipsync driver into `mouthOpenSize`, already on the
 * `ParamMouthOpenY` scale (0 to the 0.7 lipsync cap), so it is forwarded unscaled. The adapter
 * contract is [0, 1]; the upper clamp only matters for hosts that raise the lipsync cap above 1.
 */
export function naturalVoiceLevel(mouthOpenSize: number) {
  return Math.min(1, Math.max(0, mouthOpenSize))
}
