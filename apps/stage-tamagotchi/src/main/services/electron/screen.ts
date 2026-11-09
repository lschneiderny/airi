import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, Point } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { screen } from 'electron'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { readTrustedCursor, windowOriginTrusted } from './host-capabilities'

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  // The last position that the renderer received. The renderer keeps it, so a cursor that did not move needs no
  // message. Each message costs the renderer an IPC dispatch on its main thread, where the Stage renders.
  let sent: Point | null | undefined
  function publishCursor(point: Point | null) {
    if (point === null ? sent === null : sent?.x === point.x && sent?.y === point.y)
      return
    sent = point
    params.context.emit(cursorScreenPoint, point)
  }

  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => publishCursor(readTrustedCursor()),
  })

  // NOTICE:
  // No capability listener invalidates a cached point. The cursor status derives only from the static
  // waylandSession fact, so no runtime report can change it after the first tick reads the snapshot.
  // Source: resolveHostCapabilities in packages/stage-shared/src/host-capabilities/index.ts.
  // Removal condition: add a listener when a runtime fact can change the cursorScreenPoint status.
  function dispose() {
    stop()
  }

  // The loop stops with its window; these cover the app closing first.
  const offAllClosed = onAppWindowAllClosed(dispose)
  const offBeforeQuit = onAppBeforeQuit(dispose)
  params.window.once('closed', () => {
    dispose()
    offAllClosed()
    offBeforeQuit()
  })
  // A reloaded renderer starts the loop again with no position, so the next tick sends the position even if it did not change.
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, () => {
    sent = undefined
    start()
  })

  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => screen.getAllDisplays())
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => screen.getPrimaryDisplay())
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => point ? screen.dipToScreenPoint(point) : readTrustedCursor())
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, rect => rect ? screen.dipToScreenRect(params.window, rect) : windowOriginTrusted() ? params.window.getBounds() : null)
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => point ? screen.screenToDipPoint(point) : readTrustedCursor())
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, rect => rect ? screen.screenToDipRect(params.window, rect) : windowOriginTrusted() ? params.window.getBounds() : null)
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, readTrustedCursor)
}
