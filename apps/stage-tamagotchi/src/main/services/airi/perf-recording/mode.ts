export type PerfBuildMode = 'dev' | 'preview' | 'packaged'
export type PerfRecordingSource = 'env' | 'toggle' | 'default'

export interface PerfRecordingResolution {
  buildMode: PerfBuildMode
  enabled: boolean
  source: PerfRecordingSource
}

/**
 * Decides whether this launch records performance, and why.
 *
 * `dev` is `import.meta.env.DEV`: true for `pnpm dev`, false for a production bundle. `packaged` tells a
 * packaged app apart from a production bundle started from source (`preview`).
 *
 * Precedence:
 * 1. In a development build, `AIRI_PERF_RECORD=1|0` overrides everything, for QA runs. Other builds ignore it.
 * 2. The stored toggle (`stored`), once the user has set it.
 * 3. On in a development build, off otherwise.
 *
 * @example
 * resolvePerfRecording({ dev: false, packaged: true, env: { AIRI_PERF_RECORD: '1' }, stored: undefined })
 * // => { buildMode: 'packaged', enabled: false, source: 'default' }
 */
export function resolvePerfRecording(input: {
  dev: boolean
  packaged: boolean
  env: Record<string, string | undefined>
  stored: boolean | undefined
}): PerfRecordingResolution {
  const buildMode: PerfBuildMode = input.dev ? 'dev' : input.packaged ? 'packaged' : 'preview'

  const override = input.env.AIRI_PERF_RECORD
  if (input.dev && (override === '1' || override === '0'))
    return { buildMode, enabled: override === '1', source: 'env' }

  if (input.stored !== undefined)
    return { buildMode, enabled: input.stored, source: 'toggle' }

  return { buildMode, enabled: input.dev, source: 'default' }
}

/** The directory `AIRI_PERF_DIR` points recordings at. Only a development build honors it. */
export function resolvePerfDirectoryOverride(dev: boolean, env: Record<string, string | undefined>): string | null {
  const directory = env.AIRI_PERF_DIR
  return dev && directory ? directory : null
}
