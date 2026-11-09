import type { StageHostMode } from '../../../shared/eventa'
import type { StageConfig } from './config'

import { detectLinuxDesktop, hasLinuxClickThroughToggle } from '../../services/linux-desktop/detect'

/**
 * Whether this Linux launch may build the desktop stage: KWin or an EWMH X11 session, with an Electron whose
 * click-through toggle works there.
 *
 * This is a launch gate beside the host capability service, not a capability claim. The stage still starts
 * click-through and captures the pointer only once `clickThroughForward` resolves usable at runtime.
 */
export function isLinuxStageEligible(environment: Record<string, string | undefined>, electronVersion: string | undefined): boolean {
  const { candidate } = detectLinuxDesktop(environment)
  return (candidate === 'kwin' || candidate === 'x11-ewmh') && hasLinuxClickThroughToggle(electronVersion)
}

/**
 * Chooses which host this launch builds.
 *
 * Precedence:
 * 1. In a development build (`development`), `AIRI_STAGE_HOST=window|desktop` overrides everything, for QA runs.
 *    A production build ignores it and obeys the setting.
 * 2. While the Experimental 3D stage setting (`config.experimental`) is off, the classic window.
 * 3. Linux gets the classic window unless `linuxStageEligible` ({@link isLinuxStageEligible}) holds.
 * 4. A stage model that is not MMD (or has never been reported, `null`) gets the classic window.
 * 5. Otherwise the saved `config.mode`.
 *
 * @example
 * selectHostMode({ ...defaultStageConfig, experimental: true, mode: 'desktop', activeRenderer: 'mmd' }, 'darwin', {}, { development: false }, false)
 * // => 'desktop'
 */
export function selectHostMode(
  config: Pick<StageConfig, 'experimental' | 'mode' | 'activeRenderer'>,
  platform: string,
  environment: Record<string, string | undefined>,
  build: { development: boolean },
  linuxStageEligible: boolean,
): StageHostMode {
  const override = environment.AIRI_STAGE_HOST
  if (build.development && (override === 'window' || override === 'desktop'))
    return override

  // The desktop stage changes how the character's window behaves, so it stays behind an off-by-default setting.
  if (!config.experimental)
    return 'window'

  // Linux has no forwarded click-through, so the stage runs only where the desktop bridge can emulate it.
  if (platform === 'linux' && !linuxStageEligible)
    return 'window'

  if (config.activeRenderer !== 'mmd')
    return 'window'

  // NOTICE:
  // The saved mode can still pick the classic window for an MMD model, as a rollback path.
  // Window flags are fixed at creation, so the host is chosen once per launch.
  // Source: docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md, Follow-ups.
  // Removal condition: roaming, chat anchoring and display hand-off ship, plus one feedback cycle.
  return config.mode
}
