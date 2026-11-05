import type { Card } from '@proj-airi/ccc'
import type { CharacterProfile } from '@proj-airi/stage-shared/character-state'
import type { PerformanceProfile } from '@proj-airi/stage-shared/expression-performance'

import type { WakeWord } from '../libs/voice/wake-words'

/**
 * AIRI-specific runtime configuration embedded in a character card.
 *
 * The extension is persisted with the card. Editor surfaces must preserve
 * fields they do not own so independent runtime modules can evolve without
 * losing each other's configuration.
 */
export interface AiriExtension {
  /**
   * Conversation turn limit, including the current input's turn. Each turn contains a user group and its assistant/tool group.
   * Missing or `-1` keeps all history. `0` sends only current input. System messages are exempt.
   */
  contextWindow?: number

  wakeWords?: WakeWord[]
  modules: {
    performance?: PerformanceProfile
    /** Her resting disposition and starting relationship; a card without a valid one uses `DEFAULT_CHARACTER_PROFILE`. */
    character?: CharacterProfile
    consciousness: {
      provider: string
      model: string
    }

    vision: {
      provider: string
      model: string
    }

    speech: {
      provider: string
      model: string
      voice_id: string

      pitch?: number
      rate?: number
      ssml?: boolean
      language?: string
    }

    vrm?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    live2d?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    /** ID from the display-models store. */
    displayModelId?: string
    activeBackgroundId?: string

    artistry?: {
      enabled?: boolean
      provider?: string
      model?: string
      promptPrefix?: string
      workflowId?: string
      widgetInstruction?: string
      spawnMode?: 'bg' | 'widget' | 'inline' | 'bg_widget'
      options?: Record<string, unknown>
      autonomousEnabled?: boolean
      autonomousThreshold?: number
      autonomousTarget?: 'user' | 'assistant'
    }
  }

  agents: Record<string, {
    prompt: string
    enabled?: boolean
  }>
}

/**
 * Normalizes a character card context window.
 *
 * @example
 * normalizeContextWindow(undefined)
 * // => -1
 */
export function normalizeContextWindow(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1
    ? value
    : -1
}

/** Character card normalized with the AIRI extension required by the runtime. */
export interface AiriCard extends Card {
  extensions: {
    airi: AiriExtension
  } & Card['extensions']
}
