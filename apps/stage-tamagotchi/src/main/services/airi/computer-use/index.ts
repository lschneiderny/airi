import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { rm } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { binaryPath } from '@auv-js/cli/binary'
import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { computerUseReadImage, computerUseRun } from '../../../../shared/eventa/computer-use'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { createComputerUseRuntime } from './runtime'

/**
 * Registers host-owned computer use. The executable is resolved only on the first call.
 * Returns `clearStore`, which removes every stored capture. A runtime that has started clears its own store in turn
 * with its desktop operations; before that no daemon exists, and the store is removed directly.
 */
export function setupComputerUse(context: ReturnType<typeof createContext>['context']) {
  let runtime: ReturnType<typeof createComputerUseRuntime> | undefined
  let stopped = false
  const storeRoot = () => join(app.getPath('userData'), 'computer-use')
  function getRuntime() {
    if (stopped)
      throw new Error('Computer use has stopped.')
    if (!runtime) {
      const executable = binaryPath()
      runtime = createComputerUseRuntime({
        // Native executables cannot run inside Electron's archive.
        binaryPath: app.isPackaged ? executable.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`) : executable,
        storeRoot: storeRoot(),
      })
    }
    return runtime
  }
  defineInvokeHandler(context, computerUseRun, input => getRuntime().run(input))
  defineInvokeHandler(context, computerUseReadImage, input => getRuntime().readImage(input))
  onAppBeforeQuit(async () => {
    stopped = true
    await runtime?.dispose()
  })
  return {
    clearStore: (): Promise<void> => runtime && !stopped ? runtime.clearStore() : rm(storeRoot(), { recursive: true, force: true }),
  }
}
