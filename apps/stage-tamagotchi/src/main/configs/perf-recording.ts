import { boolean, object, optional } from 'valibot'

import { createConfig } from '../libs/electron/persistence'

/** `enabled` stays unset until the user flips the toggle, so the build-mode default applies until then. */
export function createPerfRecordingConfig() {
  const config = createConfig('perf-recording', 'options.json', object({ enabled: optional(boolean()) }), {
    default: {},
    autoHeal: true,
  })
  config.setup()
  return config
}
