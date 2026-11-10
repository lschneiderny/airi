import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { ElectronWindowLifecycleState } from '../../../shared/eventa'

import { defineInvokeHandler } from '@moeru/eventa'
import { bounds, startLoopGetBounds } from '@proj-airi/electron-eventa'
import { createRendererLoop, safeClose } from '@proj-airi/electron-vueuse/main'
import { isWindows } from 'std-env'

import {
  electron,
  electronGetWindowLifecycleState,
  electronWindowClose,
  electronWindowLifecycleChanged,
  electronWindowSetAlwaysOnTop,
} from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { onWindowClosed } from '../../libs/electron/on-window-closed'
import { placeWindow } from '../../windows/shared/placement'
import { resizeWindowByDelta, setWindowAlwaysOnTop } from '../../windows/shared/window'
import { readRendererWindowBounds } from './coordinates'

export function createWindowService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  function getWindowLifecycleState(reason: ElectronWindowLifecycleState['reason']): ElectronWindowLifecycleState {
    return {
      focused: params.window.isFocused(),
      minimized: params.window.isMinimized(),
      reason,
      updatedAt: Date.now(),
      visible: params.window.isVisible(),
    }
  }

  function emitWindowLifecycle(reason: ElectronWindowLifecycleState['reason']) {
    params.context.emit(electronWindowLifecycleChanged, getWindowLifecycleState(reason))
  }

  let withheld = false
  const { start, stop } = createRendererLoop({
    window: params.window,
    run: () => {
      const rect = readRendererWindowBounds(params.window)
      // A withheld rectangle is announced once, so the renderer stops using its cached origin.
      if (!rect && withheld)
        return
      withheld = !rect
      params.context.emit(bounds, rect)
    },
  })

  // The loop stops with its window; these cover the app closing first.
  const offAllClosed = onAppWindowAllClosed(() => stop())
  const offBeforeQuit = onAppBeforeQuit(() => stop())
  onWindowClosed(params.window, () => {
    offAllClosed()
    offBeforeQuit()
  })
  defineInvokeHandler(params.context, startLoopGetBounds, () => {
    withheld = false
    start()
  })
  defineInvokeHandler(params.context, electronGetWindowLifecycleState, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id)
      return getWindowLifecycleState('snapshot')
  })

  params.window.on('show', () => emitWindowLifecycle('show'))
  params.window.on('hide', () => emitWindowLifecycle('hide'))
  params.window.on('minimize', () => emitWindowLifecycle('minimize'))
  params.window.on('restore', () => emitWindowLifecycle('restore'))
  params.window.on('focus', () => emitWindowLifecycle('focus'))
  params.window.on('blur', () => emitWindowLifecycle('blur'))

  defineInvokeHandler(params.context, electron.window.getBounds, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      return readRendererWindowBounds(params.window)
    }

    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  })

  defineInvokeHandler(params.context, electron.window.setBounds, (newBounds, options) => {
    if (newBounds && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      placeWindow(params.window, newBounds[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.setIgnoreMouseEvents, (opts, options) => {
    if (opts && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setIgnoreMouseEvents(...opts)
    }
  })

  defineInvokeHandler(params.context, electronWindowSetAlwaysOnTop, (flag, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      setWindowAlwaysOnTop(params.window, Boolean(flag))
    }
  })

  defineInvokeHandler(params.context, electron.window.setVibrancy, (vibrancy, options) => {
    if (vibrancy && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setVibrancy(vibrancy[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.setBackgroundMaterial, (backgroundMaterial, options) => {
    if (isWindows && backgroundMaterial && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setBackgroundMaterial(backgroundMaterial[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.resize, (payload, options) => {
    if (!payload || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    resizeWindowByDelta({
      window: params.window,
      deltaX: payload.deltaX,
      deltaY: payload.deltaY,
      direction: payload.direction,
    })
  })

  defineInvokeHandler(params.context, electronWindowClose, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      safeClose(params.window)
    }
  })
}
