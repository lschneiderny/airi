import process from 'node:process'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { errorMessageFrom } from '@moeru/std'

import { loadQaEnv } from '../src/env/load'
import { createAiriQaServer } from '../src/mcp/server'
import { AppSession } from '../src/mcp/session'

const repoRoot = resolve(import.meta.dirname, '../../..')
loadQaEnv(repoRoot)
const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }

const session = new AppSession(repoRoot)
const server = createAiriQaServer(session, version)
let closing = false

/** The client closing stdin or a signal ends the server; a running app is torn down first so nothing outlives it. */
async function shutdown(code: number) {
  if (closing)
    return
  closing = true
  try {
    await session.stop()
  }
  catch (error) {
    process.stderr.write(`qa:mcp: teardown failed: ${errorMessageFrom(error) ?? 'unknown error'}\n`)
    code = code || 1
  }
  await server.close().catch(() => {})
  process.exit(code)
}

process.on('SIGINT', () => void shutdown(130))
process.on('SIGTERM', () => void shutdown(143))
process.stdin.on('close', () => void shutdown(0))

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(`qa:mcp: ${errorMessageFrom(error) ?? 'could not start'}\n`)
  process.exit(2)
})
