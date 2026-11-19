import type { IncomingMessage, ServerResponse } from 'node:http'

import type { JudgePair, JudgeReply, PersonaJudgment } from './pairs'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { appendFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { PERSONA_TAG_IDS, PERSONA_TAGS, PersonaJudgmentSchema, VERDICTS } from './pairs'

const judgmentBody = v.strictObject({
  pairId: v.string(),
  verdict: v.picklist(VERDICTS),
  leftTags: v.array(v.picklist(PERSONA_TAG_IDS)),
  rightTags: v.array(v.picklist(PERSONA_TAG_IDS)),
  note: v.pipe(v.string(), v.maxLength(2000)),
  elapsedMs: v.nullable(v.pipe(v.number(), v.minValue(0))),
})
const skipBody = v.strictObject({ pairId: v.string() })

/** Judgment bodies are a few hundred bytes; anything larger is not from the page. */
const MAX_BODY_BYTES = 64 * 1024

export interface JudgeServerOptions {
  pairs: readonly JudgePair[]
  /** The JSONL file that receives one judgment per line. Earlier lines are kept. */
  out: string
  judge: string
  page: string
  /** Pairs judged before this session, for the progress count. */
  judgedBefore?: number
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * Serves one judging session on loopback.
 *
 * The server owns the session's queue: `GET /api/next` returns its head without removing it, so a reload shows the
 * same pair, and a verdict or a skip for that pair removes it. Contender names leave the server only in the answer to a
 * saved verdict. Each verdict is appended to `out` before the answer is sent, so a closed tab loses nothing that was
 * saved.
 */
export class JudgeServer {
  readonly sessionId = randomUUID()
  private readonly queue: JudgePair[]
  private done: number
  private readonly server = createServer((request, response) => {
    void this.handle(request, response)
  })

  constructor(private readonly options: JudgeServerOptions) {
    this.queue = [...options.pairs]
    this.done = options.judgedBefore ?? 0
  }

  async listen(port = 0, host = '127.0.0.1'): Promise<string> {
    this.server.listen(port, host)
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP listening address')
    return `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/`
  }

  async close(): Promise<void> {
    const closed = new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()))
    this.server.closeAllConnections()
    await closed
  }

  private progress() {
    return { done: this.done, remaining: this.queue.length }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (request.method === 'GET' && path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(this.options.page)
        return
      }
      if (request.method === 'GET' && path === '/api/state') {
        json(200, { judge: this.options.judge, tags: PERSONA_TAGS, verdicts: VERDICTS, progress: this.progress() })
        return
      }
      if (request.method === 'GET' && path === '/api/next') {
        const head = this.queue[0]
        json(200, { pair: head ? view(head) : null, progress: this.progress() })
        return
      }
      if (request.method === 'POST' && (path === '/api/judgment' || path === '/api/skip')) {
        // A page on another origin could post to loopback; only the page this server served may write.
        const origin = request.headers.origin
        if (origin !== undefined && origin !== `http://${request.headers.host}`)
          throw new HttpError(403, `Refusing a write from origin ${origin}`)
        const body = await readJson(request)
        if (path === '/api/skip') {
          const { pairId } = parse(skipBody, body)
          this.take(pairId)
          json(200, { progress: this.progress() })
          return
        }
        const input = parse(judgmentBody, body)
        const pair = this.take(input.pairId, false)
        const judgment: PersonaJudgment = v.parse(PersonaJudgmentSchema, {
          schema: 'airi.persona-judgment/v1',
          judgmentId: randomUUID(),
          sessionId: this.sessionId,
          judge: this.options.judge,
          at: new Date().toISOString(),
          elapsedMs: input.elapsedMs,
          slot: pair.left.slot,
          left: { replyId: pair.left.replyId, runKey: pair.left.runKey, contender: pair.left.contender, tags: input.leftTags },
          right: { replyId: pair.right.replyId, runKey: pair.right.runKey, contender: pair.right.contender, tags: input.rightTags },
          verdict: input.verdict,
          note: input.note,
        })
        await mkdir(dirname(this.options.out), { recursive: true })
        await appendFile(this.options.out, `${JSON.stringify(judgment)}\n`, 'utf8')
        // Remove the pair only after the line is written, so a failed write leaves it to judge again.
        this.take(pair.id)
        this.done++
        json(200, { reveal: { left: pair.left.contender, right: pair.right.contender }, progress: this.progress() })
        return
      }
      throw new HttpError(404, `Unknown route: ${request.method} ${path}`)
    }
    catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      json(error instanceof HttpError ? error.status : 500, { error: errorMessageFrom(error) ?? 'Judge server failure' })
    }
  }

  /** Finds a queued pair by id, removing it unless `remove` is false. A stale id from another tab is a 409. */
  private take(pairId: string, remove = true): JudgePair {
    const index = this.queue.findIndex(pair => pair.id === pairId)
    if (index === -1)
      throw new HttpError(409, 'That pair is no longer queued; reload to get the next one')
    const [pair] = remove ? this.queue.splice(index, 1) : [this.queue[index]!]
    return pair!
  }
}

/** The blind view of a pair: everything the judge needs to read it, and nothing that names a contender. */
function view(pair: JudgePair) {
  const side = (reply: JudgeReply) => ({ spoken: reply.spoken, cues: reply.cues, previous: reply.previous })
  return {
    id: pair.id,
    turn: pair.left.slot.turn,
    user: pair.left.slot.user,
    seed: pair.left.slot.seed,
    stage: pair.left.slot.stage,
    earlier: pair.left.previous?.user ?? null,
    left: side(pair.left),
    right: side(pair.right),
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES)
      throw new HttpError(413, 'Request body too large')
    buffers.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString('utf8'))
  }
  catch (error) {
    throw new HttpError(400, `Malformed JSON body: ${errorMessageFrom(error) ?? 'parse error'}`)
  }
}

function parse<T extends v.GenericSchema>(schema: T, body: unknown): v.InferOutput<T> {
  const parsed = v.safeParse(schema, body)
  if (!parsed.success)
    throw new HttpError(400, `Invalid body: ${parsed.issues.map(issue => `${v.getDotPath(issue) ?? '(root)'} ${issue.message}`).join('; ')}`)
  return parsed.output
}
