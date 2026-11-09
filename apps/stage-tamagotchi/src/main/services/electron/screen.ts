import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, Point } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { screen } from 'electron'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { readCursor, readDisplays, readPrimaryDisplay, readWindowRect, setCursorLoopActive } from './coordinates'
import { onHostCapabilitiesChange } from './host-capabilities'

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  // The last position that the renderer received. The renderer keeps it, so a cursor that did not move needs no
  // message. Each message costs the renderer an IPC dispatch on its main thread, where the Stage renders.
  let sent: Point | null | undefined
  let running = false
  function publishCursor(point: Point | null) {
    if (point === null ? sent === null : sent?.x === point.x && sent?.y === point.y)
      return
    sent = point
    params.context.emit(cursorScreenPoint, point)
  }

  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => publishCursor(readCursor()),
  })

  // A status change can make the cached point wrong in either direction: a
  // revoked cursor must reach the renderer as `null`, a verified one as a point.
  const offCapabilities = onHostCapabilitiesChange(() => {
    sent = undefined
    if (running)
      publishCursor(readCursor())
  })

  function dispose() {
    running = false
    stop()
    setCursorLoopActive(params.window, false)
  }

  // The loop stops with its window; these cover the app closing first.
  const offAllClosed = onAppWindowAllClosed(dispose)
  const offBeforeQuit = onAppBeforeQuit(dispose)
  params.window.webContents?.once('render-process-gone', dispose)
  params.window.once('closed', () => {
    dispose()
    offCapabilities()
    offAllClosed()
    offBeforeQuit()
  })
  // A reloaded renderer starts the loop again with no position, so the next tick sends the position even if it did not change.
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, () => {
    sent = undefined
    running = true
    setCursorLoopActive(params.window, true)
    start()
  })

  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => readDisplays())
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => readPrimaryDisplay())
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => point ? screen.dipToScreenPoint(point) : readCursor())
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, rect => rect ? screen.dipToScreenRect(params.window, rect) : readWindowRect(params.window))
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => point ? screen.screenToDipPoint(point) : readCursor())
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, rect => rect ? screen.screenToDipRect(params.window, rect) : readWindowRect(params.window))
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, readCursor)
}
