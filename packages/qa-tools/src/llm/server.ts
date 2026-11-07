import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ReplayScript } from './script'

import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { completion, replayModel, speechModel, streamChunks } from './protocol'
import { ReplayError } from './script'
import { encodeSpeech } from './speech'

const chatSchema = v.object({
  model: v.pipe(v.string(), v.nonEmpty()),
  messages: v.pipe(v.array(v.object({
    role: v.picklist(['system', 'developer', 'user', 'assistant', 'tool', 'function']),
    content: v.optional(v.nullable(v.union([
      v.string(),
      v.array(v.object({ type: v.string(), text: v.optional(v.string()) })),
    ]))),
  })), v.minLength(1)),
  stream: v.optional(v.boolean(), false),
})
const speechSchema = v.object({
  model: v.pipe(v.string(), v.nonEmpty()),
  input: v.string(),
  voice: v.pipe(v.string(), v.nonEmpty()),
  response_format: v.optional(v.string()),
  speed: v.optional(v.number()),
})

interface ServerOptions {
  readonly script: ReplayScript
  readonly log: string
  readonly chunkChars?: number
  readonly delayMs?: number
}

/** Node-only development server. Logs full request bodies, never authorization headers. */
export class ReplayServer {
  private readonly server = createServer((request, response) => {
    void this.handle(request, response)
  })

  constructor(private readonly options: ServerOptions) {
    mkdirSync(dirname(options.log), { recursive: true })
    appendFileSync(options.log, '')
  }

  async listen(port = 0, host = '127.0.0.1'): Promise<string> {
    this.server.listen(port, host)
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string')
      throw new ReplayError('Expected a TCP listening address')
    return `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/v1/`
  }

  async close(): Promise<void> {
    const closed = new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()))
    this.server.closeAllConnections()
    await closed
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const timestamp = new Date().toISOString()
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    let body: unknown = null
    let selectedEntryIndex: number | null = null
    let logged = false
    const log = (status: number) => {
      appendFileSync(this.options.log, `${JSON.stringify({ method: request.method, path, body, selectedEntryIndex, status, timestamp })}\n`)
      logged = true
    }
    const json = (status: number, value: unknown) => {
      log(status)
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    try {
      if (request.method === 'OPTIONS') {
        log(204)
        response.writeHead(204).end()
        return
      }
      const buffers: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 8 * 1024 * 1024)
          throw new ReplayError('Request body exceeds 8 MiB')
        buffers.push(buffer)
      }
      const text = Buffer.concat(buffers).toString('utf8')
      if (text) {
        try {
          body = JSON.parse(text)
        }
        catch (error) {
          throw new ReplayError(`Malformed JSON body: ${errorMessageFrom(error) ?? 'parse error'}`)
        }
      }
      if (request.method === 'GET' && path === '/v1/models') {
        json(200, { object: 'list', data: [replayModel, speechModel].map(id => ({ id, object: 'model', created: 0, owned_by: 'airi-replay' })) })
        return
      }
      if (request.method === 'POST' && path === '/v1/audio/speech') {
        const parsed = v.safeParse(speechSchema, body)
        if (!parsed.success)
          throw new ReplayError(`Invalid speech body: ${parsed.issues[0].message}`)
        const wav = encodeSpeech(parsed.output.input)
        log(200)
        response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length })
        response.end(wav)
        return
      }
      if (request.method !== 'POST' || path !== '/v1/chat/completions') {
        json(404, { error: { message: `Unknown route: ${request.method} ${path}`, type: 'not_found' } })
        return
      }
      const parsed = v.safeParse(chatSchema, body)
      if (!parsed.success)
        throw new ReplayError(`Invalid chat body: ${parsed.issues[0].message}`)
      const lastUser = parsed.output.messages.findLast(message => message.role === 'user')?.content
      const userText = typeof lastUser === 'string' ? lastUser : lastUser?.map(part => part.text ?? '').join('') ?? ''
      const { entry, index } = this.options.script.take(userText)
      selectedEntryIndex = index
      if (!parsed.output.stream) {
        json(200, completion(entry, index))
        return
      }
      log(200)
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.flushHeaders()
      const abort = new AbortController()
      response.once('close', () => abort.abort())
      for (const chunk of streamChunks(entry, { index, chunkChars: this.options.chunkChars ?? 16 })) {
        if (abort.signal.aborted)
          return
        if (this.options.delayMs)
          await setTimeout(this.options.delayMs, undefined, { signal: abort.signal })
        if (!response.write(`data: ${JSON.stringify(chunk)}\n\n`))
          await once(response, 'drain', { signal: abort.signal })
      }
      response.end('data: [DONE]\n\n')
    }
    catch (error) {
      if (response.destroyed)
        return
      const status = error instanceof ReplayError ? error.status : 500
      const message = errorMessageFrom(error) ?? 'Replay server failure'
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new ReplayError(message, status))
        return
      }
      if (!logged)
        log(status)
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message, type: status === 409 ? 'replay_exhausted' : 'invalid_request_error' } }))
    }
  }
}
