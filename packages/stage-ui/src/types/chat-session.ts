import type { TurnRef, VoiceInterruptionEvent } from '@proj-airi/core-agent'

import type { ChatHistoryItem } from './chat'

/** Storage and cross-window transport contain text diagnostics instead of live Error objects. */
export interface StoredVoiceInterruption extends Omit<VoiceInterruptionEvent, 'playback'> {
  playback: Omit<VoiceInterruptionEvent['playback'], 'error'> & { errorMessage?: string }
}

/** Records that the character chose to stay silent on an unprompted turn. It is never sent to the model. */
export interface StoredUnpromptedDecline {
  kind: 'unprompted-declined'
  eventId: string
  turn: TurnRef
  /** The situation topic that the declined turn was about. */
  topicKey: string
  atMs: number
}

/**
 * Where a background task stands. `interrupted` means the owner stopped it or the app closed while it ran.
 */
export type ChatSessionTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface ChatSessionTask {
  status: ChatSessionTaskStatus
  /** When the task started. */
  startedAt: number
  endedAt?: number
}

export interface ChatSessionMeta {
  sessionId: string
  userId: string
  characterId: string
  /** External scene identities that recover this session within its user and persona partition. */
  bindings?: string[]
  /** Session from which this conversation branch was copied. */
  parentSessionId?: string
  /** Excludes task branches from conversation navigation. */
  hidden?: boolean
  /** The recipe whose own space this session is. Its runs read the recipe's steps, and only the host starts them. */
  recipeId?: string
  /** The background task that this session runs. Each task has its own session, so the status stays after the task ends. */
  task?: ChatSessionTask
  title?: string
  /** Title waiting for cloud delivery. An empty string means clear the title. */
  cloudTitlePending?: string
  createdAt: number
  updatedAt: number
  /**
   * Control events, newest last and capped to the newest 50. Interruptions (records without `kind`) inform later voice
   * requests without adding user messages. Unprompted declines stay local and never reach a prompt; only the newest 10
   * of them are kept.
   */
  controlEvents?: Array<StoredVoiceInterruption | StoredUnpromptedDecline>
}

export interface ChatSessionRecord {
  meta: ChatSessionMeta
  messages: ChatHistoryItem[]
}

export interface ChatCharacterSessionsIndex {
  activeSessionId: string
  sessions: Record<string, ChatSessionMeta>
}

export interface ChatSessionsIndex {
  userId: string
  characters: Record<string, ChatCharacterSessionsIndex>
}

export interface ChatSessionsExport {
  format: 'chat-sessions-index:v1'
  index: ChatSessionsIndex
  sessions: Record<string, ChatSessionRecord>
}
