import type { TurnRef } from '@proj-airi/core-agent'

import { defineInvoke } from '@moeru/eventa'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { onScopeDispose, shallowRef } from 'vue'

import { getSpeechBusContext, voiceGetTurns, voiceInterrupt, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged, watchVoiceHostEnd } from '../services/speech/bus'

export type SpeechOutputStopReason = 'manual-chat' | 'manual-all'
export type SpeechOutputStopRequest = { reason: 'manual-chat', sessionId: string } | { reason: 'manual-all' }

/**
 * How long a stop request waits for an output host to connect again after the host disconnected.
 *
 * Tuning: a host window that reloads connects again within a few seconds; past this the request fails, so the caller
 * keeps what it wanted to send instead of waiting for a host that does not return.
 */
const HOST_RETURN_WAIT_MS = 10_000

/** One connection of the output host, as its snapshots report it. */
interface OutputHost {
  readonly id: string | undefined
  /** False once the host reported that it disconnected, or ended without reporting. */
  connected: boolean
  /** Aborts when another connection replaces this one. */
  readonly replaced: AbortController
  /** Aborts when the host ends without reporting, for example when its window crashes. Its requests get no answer. */
  readonly ended: AbortController
  /** The lock whose release ends the host, once the store watches it. */
  watchedLock?: string
}

/** Settings control future speech. External interruption targets identities supplied by the audio host. */
export const useSpeechOutputControlStore = defineStore('speech-output-control', () => {
  const speechMuted = useLocalStorage('settings/speech/output-muted', false)
  const activeTurns = shallowRef<readonly TurnRef[]>([])
  const lifetime = new AbortController()
  /** Aborts when no host has been connected for {@link HOST_RETURN_WAIT_MS}. */
  let connection = new AbortController()
  let hostReturnTimeout: ReturnType<typeof setTimeout> | undefined
  let host: OutputHost = { id: undefined, connected: true, replaced: new AbortController(), ended: new AbortController() }
  const context = getSpeechBusContext()
  const stop = context.on(voiceTurnsChanged, ({ body }) => {
    if (body)
      activeTurns.value = body
  })
  const stopConnection = context.on(voiceSnapshotChanged, ({ body }) => {
    if (!body)
      return
    if (!body.connected) {
      hostDisconnected()
      return
    }
    clearTimeout(hostReturnTimeout)
    hostReturnTimeout = undefined
    if (connection.signal.aborted)
      connection = new AbortController()
    if (body.hostId !== host.id) {
      host.replaced.abort('Speech host replaced')
      host = { id: body.hostId, connected: true, replaced: new AbortController(), ended: new AbortController() }
    }
    else {
      host.connected = true
    }
    const current = host
    if (body.lock && !current.watchedLock) {
      current.watchedLock = body.lock
      watchVoiceHostEnd(body.lock, AbortSignal.any([lifetime.signal, current.replaced.signal]), () => {
        if (host !== current || !current.connected)
          return
        // The host's window crashed or was killed, so it answers nothing it still holds and sends no snapshot.
        current.ended.abort('Speech host ended')
        hostDisconnected()
      })
    }
  })

  /** Waits {@link HOST_RETURN_WAIT_MS} for a host to connect again; past that, requests fail. */
  function hostDisconnected() {
    host.connected = false
    hostReturnTimeout ??= setTimeout(() => connection.abort('Speech host disconnected'), HOST_RETURN_WAIT_MS)
  }
  context.emit(voiceRequestTurns, undefined)
  onScopeDispose(() => {
    stop()
    stopConnection()
    clearTimeout(hostReturnTimeout)
    lifetime.abort('Speech controls disposed')
  })

  /** Resolves once another host replaces `previous`, and rejects with `cause` when none connects in time. */
  function untilReplaced(previous: OutputHost, cause: unknown) {
    return new Promise<void>((resolve, reject) => {
      const giveUp = AbortSignal.any([lifetime.signal, connection.signal])
      if (previous.replaced.signal.aborted)
        return resolve()
      if (giveUp.aborted)
        return reject(cause)
      // Settling either way removes both listeners.
      const settled = new AbortController()
      previous.replaced.signal.addEventListener('abort', () => {
        settled.abort()
        resolve()
      }, { once: true, signal: settled.signal })
      giveUp.addEventListener('abort', () => {
        settled.abort()
        reject(cause)
      }, { once: true, signal: settled.signal })
    })
  }

  /**
   * Asks the output host for its current turns, then interrupts the requested ones and waits for the host's receipt.
   *
   * The host that takes a request can go away before it answers: its window reloads, or its scene unmounts. Its
   * responses stopped with it. A host that detaches rejects the requests it still holds, and one whose page unloads
   * may not answer at all. A host whose window crashed answers nothing, and the release of its lock ends the request.
   * Either way the request starts again with the next host, so a send that waits for the receipt
   * proceeds once that host connects. The request fails when no host connects within {@link HOST_RETURN_WAIT_MS}.
   */
  async function requestStopSpeaking(request: SpeechOutputStopRequest): Promise<{ status: 'recorded' | 'failed' }> {
    for (;;) {
      const current = host
      const signal = AbortSignal.any([lifetime.signal, connection.signal, current.replaced.signal, current.ended.signal])
      try {
        const turns = await defineInvoke(context, voiceGetTurns)(undefined, { signal })
        const targets = request.reason === 'manual-all' ? turns : turns.filter(turn => turn.sessionId === request.sessionId)
        return await defineInvoke(context, voiceInterrupt)({ turns: targets, cause: request.reason }, { signal })
      }
      catch (error) {
        if (lifetime.signal.aborted || connection.signal.aborted)
          throw error
        if (!current.replaced.signal.aborted) {
          // An error from a host that is still connected is its answer.
          if (current.connected)
            throw error
          await untilReplaced(current, error)
        }
      }
    }
  }

  function setSpeechMuted(muted: boolean) {
    speechMuted.value = muted
  }

  function toggleSpeechMuted() {
    setSpeechMuted(!speechMuted.value)
  }

  return { speechMuted, activeTurns, requestStopSpeaking, setSpeechMuted, toggleSpeechMuted }
})
