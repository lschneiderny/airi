import process from 'node:process'

import { resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { parseServeArgs } from '../src/llm/cli'
import { replayModel, speechModel } from '../src/llm/protocol'
import { loadScript } from '../src/llm/script'
import { ReplayServer } from '../src/llm/server'

async function main(): Promise<void> {
  const options = parseServeArgs(process.argv.slice(2))
  const repoRoot = resolve(import.meta.dirname, '../../..')
  const script = await loadScript(options, repoRoot)
  const server = new ReplayServer({ ...options, script })
  const baseURL = await server.listen(options.port, options.host)
  let stopping = false
  const shutdown = () => {
    if (stopping)
      return
    stopping = true
    void server.close().then(() => {
      process.exitCode = 0
    }, (error) => {
      process.stderr.write(`qa:llm shutdown: ${errorMessageFrom(error) ?? 'failed'}\n`)
      process.exitCode = 1
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.stdout.write(`${JSON.stringify({ ready: true, baseURL, model: replayModel, speechModel, script: script.source, entries: script.entries.length, log: options.log })}\n`)
}

main().catch((error) => {
  process.stderr.write(`qa:llm: ${errorMessageFrom(error) ?? 'invalid setup'}\n`)
  process.exitCode = 2
})
