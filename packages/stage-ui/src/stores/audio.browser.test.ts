import { createPinia, disposePinia } from 'pinia'
import { expect, it } from 'vitest'

import { useAudioContext } from './audio'

// ROOT CAUSE:
//
// Every Pinia opened an audio context that nothing closed. Chromium renders only about 60 contexts at once, so the
// stage of a later test in a crowded browser played into a context whose clock stood still, and its speech never ended.
it('closes its audio context when its Pinia is disposed', async () => {
  const pinia = createPinia()
  const { audioContext } = useAudioContext(pinia)
  const closed = new Promise<void>((resolve, reject) => {
    AbortSignal.timeout(5000).addEventListener('abort', () => reject(new Error('The audio context did not close')))
    audioContext.addEventListener('statechange', () => {
      if (audioContext.state === 'closed')
        resolve()
    })
  })

  disposePinia(pinia)

  await closed
  expect(audioContext.state).toBe('closed')
})
