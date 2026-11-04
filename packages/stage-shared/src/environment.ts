export enum StageEnvironment {
  Web = 'web',
  Tamagotchi = 'tamagotchi',
}

/**
 * Build-time dev flag, replaced by Vite as a literal `true`/`false` so the
 * unused branch is tree-shaken in production bundles.
 */
export const IS_DEV: boolean = import.meta.env.DEV

export function isStageWeb(): boolean {
  return !import.meta.env.RUNTIME_ENVIRONMENT || import.meta.env.RUNTIME_ENVIRONMENT === 'browser'
}

export function isStageTamagotchi(): boolean {
  return import.meta.env.RUNTIME_ENVIRONMENT === 'electron'
}

export function getStage() {
  if (isStageTamagotchi())
    return StageEnvironment.Tamagotchi

  return StageEnvironment.Web
}

export function isUrlMode(mode: 'file' | 'server'): boolean {
  if (!import.meta.env.URL_MODE) {
    return mode === 'server'
  }

  return import.meta.env.URL_MODE === mode
}
