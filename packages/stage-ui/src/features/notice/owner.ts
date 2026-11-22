import type { ChatHistoryItem, ChatToolReference, StoredNoticeTarget } from '@proj-airi/core-agent'

import type { ChatUnpromptedResult } from '../../stores/chat'

export interface NoticeOptions {
  waitForCompletion?: boolean
  signal?: AbortSignal
  /** The loaded source turn and the intersection the caller still permits. */
  continueFrom?: { turnId: string, tools: ChatToolReference[] }
}

export interface NoticeRecord {
  target: StoredNoticeTarget
  characterId: string
  acceptedAtMs: number
  ownerTurnId: string | null
  text: string
  tools: ChatToolReference[]
  sourceTurnId: string | null
}

type Receipt = Pick<StoredNoticeTarget, 'sessionId' | 'messageId'>

export interface NoticePorts {
  session: {
    target: (sessionId: string) => { characterId: string, generation: number, owner: boolean } | null
    load: (sessionId: string) => Promise<boolean>
    messages: (sessionId: string) => readonly ChatHistoryItem[] | undefined
    commit: (sessionId: string, message: Extract<ChatHistoryItem, { role: 'user' }> & { id: string }) => Promise<{ status: 'inserted' | 'existing', messageId: string }>
    store: (sessionId: string, message: Extract<ChatHistoryItem, { role: 'user' }> & { id: string }) => Promise<void>
  }
  now: () => number
  createId: () => string
  /** Owns announcement admission. It receives no cancellation authority from the original delivery. */
  request: (record: NoticeRecord) => Promise<unknown>
  run: (record: NoticeRecord) => Promise<ChatUnpromptedResult>
  cancel: (target: StoredNoticeTarget) => void
}

interface PendingNotice {
  source: string
  accepted: PromiseWithResolvers<Receipt | undefined>
  finished: PromiseWithResolvers<void>
  record?: NoticeRecord
  execution?: Promise<ChatUnpromptedResult>
}

/**
 * Owns durable result delivery and the transient continuation data needed to answer it.
 * Concurrent deliveries join one receipt. A previously stored identity never requests another announcement.
 * Storage precedes admission; a caller's abort owns only the work before the durable commit begins.
 */
export class NoticeOwner {
  private readonly pending = new Map<string, PendingNotice>()
  private disposed = false

  constructor(private readonly ports: NoticePorts) {}

  async deliver(sessionId: string, notice: { source: string, text: string, messageId?: string }, options: NoticeOptions = {}): Promise<Receipt | undefined> {
    if (this.disposed || options.signal?.aborted)
      return
    const messageId = notice.messageId ?? this.ports.createId()
    const key = JSON.stringify([sessionId, messageId])
    let entry = this.pending.get(key)
    if (entry && entry.source !== notice.source)
      throw new Error('Notice identity belongs to another source')
    if (!entry) {
      const created: PendingNotice = { source: notice.source, accepted: Promise.withResolvers(), finished: Promise.withResolvers() }
      entry = created
      this.pending.set(key, entry)
      // Capture only loaded source references, before loading can resurrect permissions from an old conversation.
      const source = this.ports.session.messages(sessionId)?.find(message => message.role === 'user' && message.id === options.continueFrom?.turnId)
      const tools = source?.tools?.filter(tool => options.continueFrom?.tools.some(selected => selected.name === tool.name)).map(tool => ({ ...tool })) ?? []
      void this.store(key, created, sessionId, messageId, notice, options, tools).catch((error: unknown) => {
        created.accepted.reject(error)
      }).finally(() => {
        created.finished.resolve()
        if (this.pending.get(key) === created)
          this.pending.delete(key)
      })
    }
    const receipt = await entry.accepted.promise
    if (options.waitForCompletion !== false)
      await entry.finished.promise
    return receipt
  }

  private async store(key: string, entry: PendingNotice, sessionId: string, messageId: string, notice: { source: string, text: string }, options: NoticeOptions, tools: ChatToolReference[]) {
    const before = this.ports.session.target(sessionId)
    if (!before?.owner || !await this.ports.session.load(sessionId)) {
      entry.accepted.resolve(undefined)
      return
    }
    const target = this.ports.session.target(sessionId)
    if (options.signal?.aborted || this.disposed || !target?.owner || target.characterId !== before.characterId || target.generation !== before.generation) {
      entry.accepted.resolve(undefined)
      return
    }
    const existing = this.ports.session.messages(sessionId)?.find(message => message.id === messageId)
    if (existing && (existing.role !== 'user' || existing.notice?.source !== notice.source))
      throw new Error('Notice identity belongs to another message')

    const receipt = await this.ports.session.commit(sessionId, {
      role: 'user',
      id: messageId,
      createdAt: this.ports.now(),
      content: notice.text,
      notice: { source: notice.source },
      ...(tools.length ? { tools } : {}),
    })
    entry.accepted.resolve({ sessionId, messageId: receipt.messageId })
    if (receipt.status === 'existing' || this.pending.get(key) !== entry)
      return
    const messages = this.ports.session.messages(sessionId) ?? []
    const ownerTurn = messages.findLast(message => message.role === 'user' && !message.notice && message.origin !== 'unprompted')
    const record: NoticeRecord = {
      target: { sessionId, messageId, source: notice.source, generation: target.generation },
      characterId: target.characterId,
      acceptedAtMs: this.ports.now(),
      ownerTurnId: ownerTurn?.id ?? null,
      text: notice.text,
      tools,
      sourceTurnId: options.continueFrom?.turnId ?? null,
    }
    entry.record = record
    await this.ports.request(record)
  }

  /** Executes only the pending accepted identity; permissions can shrink while admission waits, never grow. */
  execute(target: StoredNoticeTarget): Promise<ChatUnpromptedResult> {
    const entry = this.pending.get(JSON.stringify([target.sessionId, target.messageId]))
    const record = entry?.record
    const session = this.ports.session.target(target.sessionId)
    const messages = this.ports.session.messages(target.sessionId)
    const stored = messages?.find(message => message.id === target.messageId)
    if (!entry || !record || !session?.owner || session.generation !== target.generation || session.characterId !== record.characterId
      || record.target.source !== target.source || stored?.role !== 'user' || stored.notice?.source !== target.source) {
      return Promise.resolve({ status: 'cancelled' })
    }
    if (!entry.execution) {
      const source = messages?.find(message => message.role === 'user' && message.id === record.sourceTurnId)
      const tools = record.tools.filter(tool => source?.tools?.some(current => current.name === tool.name))
      entry.execution = (async () => {
        // A later continuation reads this notice's references. Persist the smaller intersection before tools run.
        if (tools.length !== record.tools.length)
          await this.ports.session.store(target.sessionId, { ...stored, id: target.messageId, tools })
        return this.ports.run({ ...record, tools })
      })()
    }
    return entry.execution
  }

  /** Teardown settles every waiter and cancels generations without deleting stored results. */
  dispose() {
    this.disposed = true
    for (const entry of this.pending.values()) {
      if (entry.record)
        this.ports.cancel(entry.record.target)
      entry.accepted.resolve(undefined)
      entry.finished.resolve()
    }
    this.pending.clear()
  }
}
