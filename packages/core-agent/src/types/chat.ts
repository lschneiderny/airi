import type { ContextUpdate, MetadataEventSource, WebSocketEventInputs } from '@proj-airi/server-shared/types'
import type { AssistantMessage, CommonContentPart, CompletionToolCall, Message, SystemMessage, ToolMessage, UserMessage } from '@xsai/shared-chat'

import type { AssistantTurn } from '../messages/types'

export interface ChatSlicesText {
  type: 'text'
  text: string
}

export interface ChatSlicesToolCall {
  type: 'tool-call'
  toolCall: CompletionToolCall
}

export interface ChatSlicesToolCallResult {
  type: 'tool-call-result'
  id: string
  isError?: boolean
  result?: string | CommonContentPart[]
}

/** A local catalog ID. Renderers never treat this value as an image URL. */
export interface ChatSlicesSticker {
  type: 'sticker'
  stickerId: string
}

export type ChatSlices = ChatSlicesText | ChatSlicesToolCall | ChatSlicesToolCallResult | ChatSlicesSticker

export interface ChatAssistantMessage extends AssistantMessage {
  /** True when transport failure ended this locally preserved response before completion. */
  interrupted?: true
  /** Sources returned by the provider, separate from text consumed by speech. */
  citations?: import('../messages/types').Citation[]
  search?: { id: string, status: 'in_progress' | 'searching' | 'completed' | 'failed' }
  slices: ChatSlices[]
  tool_results: {
    id: string
    isError?: boolean
    result?: string | CommonContentPart[]
  }[]
  /**
   * Exact provider messages that xsAI added for this assistant turn.
   *
   * The chat UI keeps one aggregated assistant message. Tool loops can contain
   * multiple assistant and tool messages, so this transcript preserves their
   * protocol order for the next provider request.
   */
  providerTranscript?: Message[]
  /** Portable turn history and adapter-owned continuation data. */
  generationTranscript?: AssistantTurn
  categorization?: {
    speech: string
    reasoning: string
  }
}

/** Topic that started a turn the user did not write. */
export interface ChatTurnTrigger {
  /** Stable topic identity that hosts use to deduplicate topics and record declines. */
  topicKey: string
  /** Topic text that hosts show in place of the trigger message. */
  text: string
  /** Why the host started the turn. Hosts use it to label the cue in history. */
  kind?: string
}

/** User-role message. Only user messages can carry an unprompted origin. */
export interface ChatUserMessage extends UserMessage {
  /** Set when the host started the turn without user input. User-written messages omit it. */
  origin?: 'unprompted'
  /** Topic of an unprompted turn. */
  trigger?: ChatTurnTrigger
}

export type ChatMessage = ChatAssistantMessage | SystemMessage | ToolMessage | ChatUserMessage

/** Identifies one model-facing tool without storing its runtime executor. */
export interface ChatToolReference {
  name: string
}

export interface ErrorMessage {
  role: 'error'
  content: string
}

export interface ContextMessage extends ContextUpdate<Record<string, unknown>, unknown> {
  metadata?: {
    source: MetadataEventSource
  }
  createdAt: number
}

export type ChatHistoryItem = (ChatMessage | ErrorMessage) & {
  context?: ContextMessage
  createdAt?: number
  /**
   * When an assistant message stopped receiving output: at its end, or when it
   * was interrupted. `createdAt` of an assistant message is when it started.
   * Windows that do not run the generation read it, for example to time how
   * long a reply shows.
   */
  completedAt?: number
  id?: string
  /** Vision output stored by image order so later turns can reuse it without copying the image URL. */
  imageDescriptions?: Array<{
    description: string
    imageIndex: number
  }>
  /** ASR results indexed by the audio parts in the original user message. */
  audioTranscripts?: string[]
  /** Message that this message replies to in the same chat session. */
  replyToMessageId?: string
  /** Tools selected for this message. The runtime rebuilds executors from these names. */
  tools?: ChatToolReference[]
}

export interface ChatStreamEventContext {
  /** Session ownership travels with the event across concurrent turns and renderer transports. */
  sessionId: string
  /** Stable correlation id shared by every hook emitted for one user turn. */
  turnId: string
  message: ChatHistoryItem
  contexts: Record<string, ContextMessage[]>
  composedMessage: Array<Message>
  input?: WebSocketEventInputs
  /** Set for a turn the host started without user input. User turns omit it. */
  origin?: 'unprompted'
  /** Cue counts of the reply. The runtime sets it before the stream-end hooks run, and only then. */
  cueStats?: ChatTurnCueStats
}

/** How a reply used the ACT cue channel, counted by the runtime for one turn. */
export interface ChatTurnCueStats {
  /** ACT markers the reply emitted, including recovered near-misses. */
  act: number
  /** Near-miss cues (`[ACT ...]`, `<ACT ...>` and similar) the parser rewrote into markers. Stripped near-misses count as `rejected`, not here. */
  recovered: number
  /** Near-miss cues stripped from speech without being performed, because their marker-shaped body is no valid payload. */
  rejected: number
  origin: 'user' | 'unprompted'
  /** The unprompted turn ended without speech. Its cues were never performed. */
  declined: boolean
}

export type ChatStreamEvent
  = | { type: 'before-compose', message: string, sessionId: string, context: Omit<ChatStreamEventContext, 'composedMessage'> }
    | { type: 'after-compose', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'before-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'after-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-literal', literal: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-special', special: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'stream-end', sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-end', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-message', message: ChatAssistantMessage, sessionId: string, messageText: string, context: ChatStreamEventContext }

export type StreamingAssistantMessage = ChatAssistantMessage & { context?: ContextMessage } & { createdAt?: number, completedAt?: number, id?: string }
