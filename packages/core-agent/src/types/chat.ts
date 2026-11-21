import type { StreamingControlEmotion, StreamingControlGesture } from '@proj-airi/pipelines-audio'
import type { ContextUpdate, MetadataEventSource, WebSocketEventInputs } from '@proj-airi/server-shared/types'
import type { AssistantMessage, CommonContentPart, CompletionToolCall, Message, SystemMessage, ToolMessage, UserMessage } from '@xsai/shared-chat'

import type { AssistantTurn, UserTurn } from '../messages/types'
import type { DecisionQuestion } from '../runtime/recipe'

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

/** A pause between two text slices of one reply. Renderers start a new bubble after it. */
export interface ChatSlicesBreak {
  type: 'break'
  /** Pause length in seconds, within 0.3-3.0. */
  seconds: number
}

/**
 * A card that the model drew as part of its answer. The host draws `program`. Places that cannot draw it, such as copy,
 * cloud sync, and export, use `text`.
 */
export interface ChatSlicesCard {
  type: 'card'
  program: string
  /** The card as plain text: the answer and its key values. */
  text: string
}

/** Content that a tool call adds to a reply in place of the call. */
export type ChatSlicesToolContent = ChatSlicesCard

export type ChatSlices = ChatSlicesText | ChatSlicesToolCall | ChatSlicesToolCallResult | ChatSlicesSticker | ChatSlicesBreak | ChatSlicesCard

/** One ACT cue of a wordless reply, reduced to the fields that history shows. An ACT with neither field stays an empty entry. */
export interface ChatWordlessCue {
  emotion?: StreamingControlEmotion
  gesture?: StreamingControlGesture
  /** Action label as normalized by the ACT parser; never resolved here. */
  action?: string
}

export interface ChatAssistantMessage extends AssistantMessage {
  /** True when transport failure ended this locally preserved response before completion. */
  interrupted?: true
  /**
   * Set on a reply to a stored notice. Like the notice, it never syncs to the cloud.
   * `turnId` identifies the send. `source` names what sent the notice.
   */
  proactive?: { turnId: string, source: string }
  /** Sources returned by the provider, separate from text consumed by speech. */
  citations?: import('../messages/types').Citation[]
  search?: { id: string, status: 'in_progress' | 'searching' | 'completed' | 'failed' }
  /**
   * The kind of content that a tool call is about to add, from the moment the model starts the call until the content
   * arrives or the model writes on. Only a reply that is still written uses it.
   */
  pendingContent?: ChatSlicesToolContent['type']
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
  /**
   * Set when a user turn was answered without words: the reply had no visible text and carried the decline marker
   * before any speech. `cues` holds one entry per ACT of the reply and is empty for a silent reply. Such a message has
   * empty content and no generation transcript, and providers receive it as its cue text.
   */
  wordless?: {
    cues: ChatWordlessCue[]
  }
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
  /** Skills that the owner invoked with this message. Their steps stay with it, so later requests keep following them. */
  skills?: ChatInvokedSkill[]
  /**
   * Set on a stored notice: text for the conversation that the owner did not write, for example a finished background task.
   * Requests mark it as a notice, so the model never reads it as owner speech.
   */
  notice?: UserTurn['notice']
}

/**
 * One skill that the owner invoked with a message. The model reads `instructions`. The chat shows the skill on the message.
 * - `steps`: the skill gave its steps to the conversation.
 * - `background`: the skill runs the message as a task in its own session.
 * - `decision`: the skill asks the model a question, and the answer picks what follows.
 */
export type ChatInvokedSkill
  = | { kind: 'steps' | 'background', name: string, instructions: string }
    | { kind: 'decision', name: string, instructions: string, question: DecisionQuestion }

export interface ChatStreamEventContext {
  /** Session ownership travels with the event across concurrent turns and renderer transports. */
  sessionId: string
  /** Stable correlation id shared by every hook emitted for one user turn. */
  turnId: string
  /**
   * ID of the assistant message that stores the turn's reply. The runtime sets it on every turn, so a window that
   * shows another renderer's reply keys it like the stored one. A context built outside the runtime may omit it.
   */
  assistantMessageId?: string
  message: ChatHistoryItem
  contexts: Record<string, ContextMessage[]>
  composedMessage: Array<Message>
  input?: WebSocketEventInputs
  /** Set for a turn the host started without user input. User turns omit it. */
  origin?: 'unprompted'
  /** Cue counts of the reply. The runtime sets it before the stream-end hooks run, and only then. */
  cueStats?: ChatTurnCueStats
  /** Whether the reply speaks on the host. Scene replies and background tasks stay silent. */
  speaks?: boolean
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
  /** The user turn was answered with the decline marker and no ACT and no visible text. */
  silent: boolean
  /** The user turn was answered with the decline marker, at least one ACT, and no visible text. */
  wordless: boolean
  /** Break slices in the stored reply. */
  breaks: number
  /** Well-formed BREAK markers in visible speech that split nothing: before the first text, over the limit, or trailing. */
  breaksIgnored: number
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
    /** The whole reply so far, after each change. A view in another window shows it as it is, tool calls included. */
    | { type: 'assistant-progress', message: StreamingAssistantMessage, sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-message', message: ChatAssistantMessage, sessionId: string, messageText: string, context: ChatStreamEventContext }

export type StreamingAssistantMessage = ChatAssistantMessage & { context?: ContextMessage } & { createdAt?: number, completedAt?: number, id?: string }
