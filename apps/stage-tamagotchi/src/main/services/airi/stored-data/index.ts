import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { FileLoggerHandle } from '../../../app/file-logger'

import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { storedDataDeleteActivity } from '../../../../shared/eventa/stored-data'

/**
 * Deletes the activity records under one user data directory.
 *
 * Expects:
 * - `keepLogFile` is the session log that is open for writing, or `null`. The caller empties it instead, because
 *   removing an open file leaves the writer on a file nobody can read (and fails on Windows)
 *
 * Returns:
 * - Nothing, once every earlier session log, every IO trace, and the computer-use store are gone.
 *   The `logs` and `io-traces` directories stay, because their writers append by path and never recreate them.
 */
export async function deleteActivityFiles(userData: string, keepLogFile: string | null): Promise<void> {
  for (const directory of [join(userData, 'logs'), join(userData, 'io-traces')]) {
    await mkdir(directory, { recursive: true })
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      if (path !== keepLogFile)
        await rm(path, { recursive: true, force: true })
    }
  }
  await rm(join(userData, 'computer-use'), { recursive: true, force: true })
}

/**
 * Registers the deletion of the main process's activity records.
 *
 * Use when:
 * - The Data settings page deletes all data, and the renderer cannot reach files the main process wrote
 *
 * Expects:
 * - `fileLogger` returns the handle of the session log at call time; it is assigned after startup begins
 *
 * Returns:
 * - Nothing. The handler stays registered for the lifetime of the application.
 */
export function setupStoredData(context: ReturnType<typeof createContext>['context'], params: { fileLogger: () => FileLoggerHandle }) {
  defineInvokeHandler(context, storedDataDeleteActivity, async () => {
    const fileLogger = params.fileLogger()
    await deleteActivityFiles(app.getPath('userData'), fileLogger.logFilePath)
    await fileLogger.clear()
  })
}
