import type { TurnRef } from '@proj-airi/core-agent'
import type { NotifyObservation } from '@proj-airi/stage-shared/situation'

import type { VoiceMessageSnapshot } from '../../libs/voice/voice-message'
import type { WakeWordPreparation } from '../../libs/voice/wake-word-detector'
import type { ChatToolReference } from '../../types/chat'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

/** Snapshot served by the renderer that owns active speech playback. */
export interface SpeechOutputPlaybackState {
  /** Whether the output host is currently playing assistant speech. It turns false in the pause between two sentences. */
  speaking: boolean
  /**
   * Whether an open voice response already played audio. It stays true in the
   * pauses between sentences, and turns false when no response is open. Muted
   * speech, or a speech provider that returns no audio, keeps it false. The danmaku chat window keeps a spoken reply on screen until it
   * turns false.
   */
  voicing: boolean
}

/** Cross-renderer request for the active speech output host's playback state. */
export const speechOutputGetPlaybackState = defineInvokeEventa<SpeechOutputPlaybackState>('eventa:audio:speech:output:get-playback-state')
/** The output host sends its new playback state after `speaking` or `voicing` changes. */
export const speechOutputPlaybackStateChangedEvent = defineEventa<SpeechOutputPlaybackState>('eventa:audio:speech:output:playback-state-changed')

/**
 * The voice input host sends it when the user starts or stops speaking: `speaking` is true while
 * voice input is capturing. An unsent voice draft does not count. A stage in another window resolves its `listening`
 * performance mode from it. Only changes are sent, so a window that never hosts voice input never
 * emits, and a stage that mounts later starts from `false` until the next change.
 */
export const speechInputUserSpeakingChangedEvent = defineEventa<{ speaking: boolean }>('eventa:audio:speech:input:user-speaking-changed')

/**
 * A chat composer reports that the user is writing. `sourceId` identifies one composer, so the leader can combine
 * every window. `hasDraft` is true while the draft holds text, and `lastInputAtMs` is the time of the last draft
 * change. A composer sends it on draft changes (at most once per second), again every 5 s while a draft exists, and
 * `hasDraft: false` when it closes. The leader's situation gate stays quiet while any composer reports writing.
 */
export const chatComposerActivityChangedEvent = defineEventa<{ sourceId: string, hasDraft: boolean, lastInputAtMs: number }>('eventa:chat:composer-activity-changed')

/**
 * A `spark:notify` observation that a follower window received, for example from the devtools context-flow simulator.
 * Only the leader folds notifies into the situation, so followers forward theirs here. A server notify reaches every
 * window, so the leader also receives forwarded copies of notifies it ingested itself; it drops them by topic key.
 */
export const situationNotifyObservedEvent = defineEventa<NotifyObservation>('eventa:situation:notify-observed')

const BUS_CHANNEL_NAME = 'proj-airi:pipelines:outputs:speech'

let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined
let channel: BroadcastChannel | undefined

function getChannel() {
  if (!channel)
    channel = new BroadcastChannel(BUS_CHANNEL_NAME)
  return channel
}

export function getSpeechBusContext() {
  if (!context)
    context = createBroadcastChannelContext(getChannel()).context
  return context
}

/** The audio host supplies identities for responses that still own output or generation. */
export const voiceGetTurns = defineInvokeEventa<readonly TurnRef[]>('eventa:voice:turns')

/** A newly mounted control requests a snapshot. The host also publishes each turn ownership change. */
export const voiceRequestTurns = defineEventa('eventa:voice:request-turns')
export const voiceTurnsChanged = defineEventa<readonly TurnRef[]>('eventa:voice:turns-changed')
/** Generation completion closes downstream speech even when a provider fails before the normal text-end hooks. */
export const voiceGenerationEnded = defineEventa<TurnRef & { status: 'finished' | 'cancelled' | 'failed' }>('eventa:voice:generation-ended')

/** External interruption stops named responses and waits for durable control receipts. */
export const voiceInterrupt = defineInvokeEventa<{ status: 'recorded' | 'failed' }, {
  turns: readonly TurnRef[]
  cause: string
}>('eventa:voice:interrupt')

/** Commands match one source window, producer, session, and turn. A closed producer cannot reopen. */
export type VoiceSpeechCommand = {
  /** Keeps producer IDs from different windows separate. */
  originId: string
  /** Matches later commands to the producer opened by this source. */
  producerId: string
  /** Prevents commands from affecting another conversation turn. */
  turn: TurnRef
} & (
  { type: 'open', purpose: string }
  | { type: 'text' | 'special', value: string }
  | { type: 'end' | 'finish' | 'flush' }
  | { type: 'cancel', reason: string }
)

export const voiceSpeechCommand = defineInvokeEventa<{ status: 'accepted' | 'closed' | 'finished' | 'cancelled' | 'interrupted' | 'failed' }, VoiceSpeechCommand>('eventa:voice:speech')

/** Editable presentation data crosses windows. Plugin context and audio resources stay in the host. */
export interface VoiceDraft {
  readonly id: string
  readonly sessionId: string
  readonly rawText: string
  text: string
  /** The host is sending the draft. A failed send clears this flag and keeps the draft. */
  readonly sending?: boolean
}

/** A snapshot replaces earlier presentation state. Commands still target the original request or draft identity. */
export interface VoiceHostSnapshot {
  readonly connected: boolean
  /**
   * Identifies one connection of the output host. A new value means that the host window reloaded or another window
   * took over, so a request that the earlier host received gets no answer. A disconnected snapshot has none.
   */
  readonly hostId?: string
  /**
   * The Web Lock that this host connection holds until it detaches; see {@link voiceHostLockName}. The browser releases
   * a lock with the page that holds it, also when its renderer crashes or its window is killed without reporting, so
   * {@link watchVoiceHostEnd} learns that the host is gone. A snapshot sent before the host holds its lock has none.
   */
  readonly lock?: string
  readonly microphone?: { readonly enabled: boolean, readonly ready: boolean, readonly error?: string }
  /** Preparation of the host's wake word detector. Settings in other windows read it from here. */
  readonly wakeWords?: { readonly preparation: WakeWordPreparation, readonly error?: string }
  readonly input?: {
    readonly requestId: string
    readonly sessionId: string
    readonly phase: 'pending' | 'capturing' | 'finalizing' | 'settled'
    readonly text: string
    /** Corrected transcript segments in spoken order. A segment that is not final can still change. */
    readonly segments: readonly { readonly id: string, readonly text: string, readonly final: boolean }[]
  }
  readonly drafts: readonly VoiceDraft[]
  readonly frontDraftId?: string
  readonly error?: string
}

/** A request ID identifies one recording control. Draft commands use a separate draft ID. */
export type VoiceInputCommand
  = {
    type: 'begin'
    requestId: string
    sessionId: string
    /**
     * Where the final transcript goes.
     * `draft` creates a voice draft, or sends it when Auto send is on.
     * `composer` creates no draft. The `end` result returns the text to the control that began the input.
     * @default 'draft'
     */
    target?: 'draft' | 'composer'
  }
  | { type: 'end' | 'cancel', requestId: string }
  /**
   * Cancels the input that the snapshot presents, also one that VAD or a wake word began.
   * A dismiss control, such as Escape in the desktop inlay, sends the `requestId` that it shows.
   * The host ignores the command when another input is presented now, so a stale control cannot cancel newer speech.
   */
  | { type: 'cancel-presented', requestId: string }
  | { type: 'edit-draft', draftId: string, text: string }
  | { type: 'send-draft' | 'discard-draft' | 'select-draft', draftId: string }

/**
 * The input host owns attempts and drafts. A follower cannot end another control's recording.
 * `text` is present only for `end` of a `composer` input that produced a transcript.
 */
export const voiceInputCommand = defineInvokeEventa<{ status: 'accepted' | 'closed', text?: string }, VoiceInputCommand>('eventa:voice:input-command')
export const voiceRequestSnapshot = defineEventa('eventa:voice:request-snapshot')

/** Names the Web Lock that one output host connection holds while it is connected; see {@link VoiceHostSnapshot.lock}. */
export function voiceHostLockName(hostId: string) {
  return `proj-airi:voice-host:${hostId}`
}

/**
 * Calls `onEnded` once the voice host that holds `lock` ends, also when its window crashes or is killed and sends no
 * disconnected snapshot. Aborting `signal` stops watching.
 *
 * `onEnded` runs while this window holds the lock it was granted, so a lock request for the same name that starts
 * after this call runs after `onEnded`.
 */
export function watchVoiceHostEnd(lock: string, signal: AbortSignal, onEnded: () => void) {
  // A shared request waits while the host holds the lock exclusively, and every window that watches is granted at once.
  navigator.locks.request(lock, { mode: 'shared', signal }, () => onEnded()).catch((error: unknown) => {
    if (!signal.aborted)
      console.error('[speech-bus] Watching the voice host failed:', error)
  })
}
export const voiceSnapshotChanged = defineEventa<VoiceHostSnapshot>('eventa:voice:snapshot-changed')

/**
 * Microphone level while a control records or dictates, from 0 (silence) to 1 (full scale).
 * The host publishes it at the observation hop rate and stops when no control captures audio.
 */
export const voiceInputLevel = defineEventa<{ level: number }>('eventa:voice:input-level')

/**
 * A control asks the host to publish `voiceInputLevel` without recording, for example for a level meter in a menu.
 * The request lasts until `until`, a Unix time in milliseconds. The control renews it while the meter is visible,
 * so a closed window cannot keep the microphone open.
 */
export const voiceLevelMonitor = defineEventa<{ until: number }>('eventa:voice:level-monitor')

/** Recording commands address one session-owned voice message draft. */
export type VoiceMessageCommand
  = {
    type: 'record'
    id: string
    sessionId: string
    /** Message that the voice message replies to. The host captures it when recording starts. */
    replyToMessageId?: string
    /** Request tools of the window that started the recording. */
    tools?: ChatToolReference[]
  }
  | {
    type: 'finish'
    id: string
    /**
     * Sends the recording after encoding. A failed send keeps the recording `ready` with an error for retry.
     * @default false
     */
    send?: boolean
  }
  | {
    type: 'send'
    id: string
    /** Composer text that goes into the same user message as the recording. */
    text?: string
  }
  | { type: 'discard', id: string }

/** Completed media uses structured cloning. Live PCM stays on the audio host's source channel. */
export const voiceMessageCommand = defineInvokeEventa<{ status: 'accepted' | 'closed' }, VoiceMessageCommand>('eventa:voice:message-command')
export const voiceMessagesChanged = defineEventa<readonly VoiceMessageSnapshot[]>('eventa:voice:messages-changed')
export const voiceRequestMessages = defineEventa('eventa:voice:request-messages')
/**
 * A voice message left the chat after its submit, because the transcriber recognized no speech in it.
 * The control that recorded it reports `error`.
 */
export const voiceMessageDropped = defineEventa<{ id: string, sessionId: string, error: string }>('eventa:voice:message-dropped')
