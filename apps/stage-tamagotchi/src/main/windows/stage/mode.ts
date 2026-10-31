import type { StageHostMode } from '../../../shared/eventa'
import type { StageConfig } from './config'

/**
 * Chooses which host this launch builds.
 *
 * Precedence:
 * 1. `AIRI_STAGE_HOST=window|desktop` overrides everything, for QA runs.
 * 2. Linux always gets the classic window.
 * 3. A stage model that is not MMD (or has never been reported, `null`) gets the classic window.
 * 4. Otherwise the saved `config.mode`.
 *
 * @example
 * selectHostMode({ ...defaultStageConfig, mode: 'desktop', activeRenderer: 'mmd' }, 'darwin', {})
 * // => 'desktop'
 */
export function selectHostMode(
  config: Pick<StageConfig, 'mode' | 'activeRenderer'>,
  platform: string,
  environment: Record<string, string | undefined>,
): StageHostMode {
  const override = environment.AIRI_STAGE_HOST
  if (override === 'window' || override === 'desktop')
    return override

  // NOTICE:
  // Linux keeps the classic window: the stage needs per-pixel click-through, which Wayland lacks.
  // `setIgnoreMouseEvents(true, { forward: true })` does not forward there (Wayland branch in `pages/index.vue`).
  // Source: https://github.com/electron/electron/issues/37789; plan fullscreen-stage-locomotion IS-9.
  // Removal condition: forwarded click-through works on Wayland and the stage is verified on Linux.
  if (platform === 'linux')
    return 'window'

  if (config.activeRenderer !== 'mmd')
    return 'window'

  return config.mode
}
