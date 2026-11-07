import type { DebugTarget } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import type { MotionQaBridgeClient } from '../t3/bridge-client'
import type { SendPath } from './summary'

import { CdpClient, fetchJson } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

/** Chooses the actual floating composer when present. A failure after inserting text never retries through the bridge. */
export async function sendMessage(options: { port: number, bridge: MotionQaBridgeClient, text: string, timeoutMs: number }): Promise<SendPath> {
  const targets = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${options.port}/json/list`, AbortSignal.timeout(options.timeoutMs))
  const target = targets.find(target => target.type === 'page' && /#\/chat-floating(?:\?|$)/.test(target.url))
  if (!target) {
    await options.bridge.call('chatSend', { text: options.text }, options.timeoutMs)
    return 'chatSend'
  }
  if (!target.webSocketDebuggerUrl)
    throw new Error('The floating chat target has no CDP URL')
  const composer = await CdpClient.connect(target.webSocketDebuggerUrl, options.timeoutMs)
  try {
    const focused = await composer.evaluate<boolean>(`(() => {
      if (document.visibilityState !== 'visible') return false
      const input = [...document.querySelectorAll('textarea')].find(input => !input.disabled && !input.readOnly && input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      if (!input) return false
      input.focus()
      return document.activeElement === input
    })()`, options.timeoutMs)
    if (!focused) {
      await options.bridge.call('chatSend', { text: options.text }, options.timeoutMs)
      return 'chatSend'
    }
    await composer.send('Input.insertText', { text: options.text }, options.timeoutMs)
    await composer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, options.timeoutMs)
    await composer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, options.timeoutMs)
    return 'composer'
  }
  finally {
    composer.close()
  }
}
