import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { FileLoggerHandle } from '../../../app/file-logger'

import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { storedDataDeleteActivity } from '../../../../shared/eventa/stored-data'

/**
 * Deletes the session logs and IO traces under one user data directory.
 *
 * Expects:
 * - `keepLogFile` is the session log that is open for writing, or `null`. The caller empties it instead, because
 *   removing an open file leaves the writer on a file nobody can read (and fails on Windows)
 *
 * Returns:
 * - Nothing, once every earlier session log and every IO trace is gone. The two directories stay, because their
 *   writers append by path. A directory that does not exist yet is left for its writer to create with its own mode.
 */
export async function deleteActivityFiles(userData: string, keepLogFile: string | null): Promise<void> {
  for (const directory of [join(userData, 'logs'), join(userData, 'io-traces')]) {
    if (!existsSync(directory))
      continue
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      if (path !== keepLogFile)
        await rm(path, { recursive: true, force: true })
    }
  }
}

/**
 * Registers the deletion of the main process's activity records.
 *
 * Use when:
 * - The Data settings page deletes all data, and the renderer cannot reach files the main process wrote
 *
 * Expects:
 * - `fileLogger` returns the handle of the session log at call time; it is assigned after startup begins
 * - `clearComputerUseStore` removes the computer-use captures through their owner, which may have a daemon running
 *
 * Returns:
 * - Nothing. The handler stays registered for the lifetime of the application.
 */
export function setupStoredData(context: ReturnType<typeof createContext>['context'], params: { fileLogger: () => FileLoggerHandle, clearComputerUseStore: () => Promise<void> }) {
  defineInvokeHandler(context, storedDataDeleteActivity, async () => {
    const fileLogger = params.fileLogger()
    await deleteActivityFiles(app.getPath('userData'), fileLogger.logFilePath)
    await fileLogger.clear()
    await params.clearComputerUseStore()
  })
}
