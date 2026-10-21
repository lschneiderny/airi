import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { waitFor } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

/**
 * Marks onboarding complete in the fresh profile (the flags from `.agents/skills/use-agent-browser-for-airi`) and
 * reloads the stage page so it starts without the onboarding flow. The caller waits for the bridge afterwards.
 */
export async function completeOnboarding(stage: CdpClient, timeoutMs = 60_000): Promise<void> {
  await waitFor('stage page ready for onboarding flags', async () => {
    const done = await stage.evaluate<boolean>(`(() => {
      if (document.readyState === 'loading')
        return false
      localStorage.setItem('onboarding/completed', 'true')
      localStorage.setItem('onboarding/skipped', 'false')
      return localStorage.getItem('onboarding/completed') === 'true'
    })()`, 10_000)
    return done ? true : undefined
  }, timeoutMs, 250)
  await stage.send('Page.reload', { ignoreCache: false }, 30_000)
}
