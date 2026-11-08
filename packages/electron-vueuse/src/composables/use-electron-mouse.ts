import type { Position, UseMouseOptions } from '@vueuse/core'

import { defineInvoke } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { useMouse } from '@vueuse/core'
import { ref } from 'vue'

import { getElectronEventaContext } from './use-electron-eventa-context'

let sharedEventTarget: EventTarget | undefined
// The main process sends a position only when it changes. A consumer that mounts while the cursor stays still starts
// from this position, because no later message brings it one.
let lastPosition: Position | undefined
const cursorAvailable = ref(false)
let startedTracking = false

export function useElectronMouseEventTarget() {
  const context = getElectronEventaContext()

  if (!sharedEventTarget) {
    sharedEventTarget = new EventTarget()

    context.on(cursorScreenPoint, (event) => {
      cursorAvailable.value = event.body != null
      if (!event.body)
        return
      lastPosition = { x: event.body.x, y: event.body.y }
      const e = new MouseEvent('mousemove', { screenX: event.body.x, screenY: event.body.y })
      sharedEventTarget?.dispatchEvent(e)
    })
  }

  if (!startedTracking) {
    startedTracking = true
    void defineInvoke(context, startLoopGetCursorScreenPoint)()
  }

  return ref(sharedEventTarget)
}

export function useElectronMouse(options?: UseMouseOptions) {
  const eventTarget = useElectronMouseEventTarget()
  return useMouse({ ...options, initialValue: lastPosition ?? options?.initialValue, target: eventTarget, type: 'screen' })
}

/** False until a trusted point arrives, and after a withheld reading. Coordinates stay cached. */
export function useElectronCursorAvailable() {
  useElectronMouseEventTarget()
  return cursorAvailable
}
