import { afterEach, describe, expect, it, vi } from 'vitest'

import { perfRecordingRendererReload } from '../../../../shared/eventa'
import { createWindowIpc } from '../../../libs/electron/testing/window-ipc'
import { createWindowContext } from '../../../libs/electron/window-context'
import { registerPerfRecording } from './register'

vi.mock('electron', async () => ({ ipcMain: new (await import('node:events')).EventEmitter() }))

const opened: Array<ReturnType<typeof createWindowIpc>> = []

async function openWindow(url: string) {
  const { ipcMain } = await import('electron')
  const ipc = createWindowIpc(ipcMain)
  Object.assign(ipc.window.webContents, { getURL: () => url })
  opened.push(ipc)
  return ipc
}

afterEach(() => {
  opened.splice(0).forEach(ipc => ipc.close())
})

describe('registerPerfRecording', () => {
  it('labels a reload notice with the window that sent it', async () => {
    const service = {
      getState: vi.fn(),
      setEnabled: vi.fn(),
      onStateChange: vi.fn(() => () => {}),
      rendererReloaded: vi.fn(),
      trace: { capture: vi.fn(), getState: vi.fn(), onStateChange: vi.fn(() => () => {}) },
    }
    const windows = [await openWindow('http://localhost:5173/#/'), await openWindow('http://localhost:5173/#/stage')]
    windows.forEach(({ window }) => registerPerfRecording(createWindowContext(window).context, window, service))

    const received = new Promise<void>(resolve => service.rendererReloaded.mockImplementationOnce(() => resolve()))
    await windows[1].context.emit(perfRecordingRendererReload, undefined)
    await received

    expect(service.rendererReloaded.mock.calls).toEqual([['stage']])
  })
})
