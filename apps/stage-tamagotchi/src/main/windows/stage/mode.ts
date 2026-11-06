import type { StageHostMode } from '../../../shared/eventa'
import type { StageConfig } from './config'

/**
 * Chooses which host this launch builds.
 *
 * Precedence:
 * 1. In a development build (`development`), `AIRI_STAGE_HOST=window|desktop` overrides everything, for QA runs.
 *    A production build ignores it and obeys the setting.
 * 2. While the Experimental 3D stage setting (`config.experimental`) is off, the classic window.
 * 3. Linux always gets the classic window.
 * 4. A stage model that is not MMD (or has never been reported, `null`) gets the classic window.
 * 5. Otherwise the saved `config.mode`.
 *
 * @example
 * selectHostMode({ ...defaultStageConfig, experimental: true, mode: 'desktop', activeRenderer: 'mmd' }, 'darwin', {}, { development: false })
 * // => 'desktop'
 */
export function selectHostMode(
  config: Pick<StageConfig, 'experimental' | 'mode' | 'activeRenderer'>,
  platform: string,
  environment: Record<string, string | undefined>,
  build: { development: boolean },
): StageHostMode {
  const override = environment.AIRI_STAGE_HOST
  if (build.development && (override === 'window' || override === 'desktop'))
    return override

  // The desktop stage changes how the character's window behaves, so it stays behind an off-by-default setting.
  if (!config.experimental)
    return 'window'

  // NOTICE:
  // Linux keeps the classic window: the stage needs per-pixel click-through, which Wayland lacks.
  // `setIgnoreMouseEvents(true, { forward: true })` does not forward there (Wayland branch in `pages/index.vue`).
  // Source: https://github.com/electron/electron/issues/37789; plan fullscreen-stage-locomotion IS-9.
  // Removal condition: forwarded click-through works on Wayland and the stage is verified on Linux.
  if (platform === 'linux')
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
