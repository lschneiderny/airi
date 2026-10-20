import type { ContextSnapshot } from './context-prompt'

import { ContextUpdateStrategy } from '@proj-airi/server-shared/types'
import { describe, expect, it } from 'vitest'

import { buildContextPromptMessage, formatContextPromptText } from './context-prompt'

function makeContext(overrides: Record<string, unknown> = {}): ContextSnapshot {
  return {
    'system:minecraft-integration': [
      {
        id: 'volatile-random-id',
        contextId: 'system:minecraft-integration',
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: 'Bot is online in forest biome',
        createdAt: 1743940440000,
        metadata: {
          source: {
            id: 'system:minecraft-integration',
            kind: 'plugin' as const,
            plugin: { id: 'airi:minecraft' },
          },
        },
        ...overrides,
      },
    ],
  }
}

/**
 * @example
 * formatContextPromptText(contextRegistry.snapshot())
 */
describe('formatContextPromptText', () => {
  /**
   * @example
   * Empty context snapshots produce no prompt text.
   */
  it('returns empty string for empty snapshot', () => {
    expect(formatContextPromptText({})).toBe('')
  })

  /**
   * @example
   * Issue #1539: volatile context fields stay out of the rendered prompt.
   */
  it('issue #1539: excludes id, createdAt, and metadata from serialized output', () => {
    const text = formatContextPromptText(makeContext())

    expect(text).not.toContain('volatile-random-id')
    expect(text).not.toContain('1743940440000')
    expect(text).not.toContain('airi:minecraft')
  })

  /**
   * @example
   * Each context source owns its heading, so the text renders without a shared header or source prefix.
   */
  it('renders the context text verbatim without XML wrappers, header, or source prefix', () => {
    const text = formatContextPromptText(makeContext())

    expect(text).toBe('Bot is online in forest biome')
    expect(text).not.toContain('<context>')
    expect(text).not.toContain('[Context]')
    expect(text).not.toContain('system:minecraft-integration')
  })

  /**
   * @example
   * Multiple buckets render as one block, separated by a blank line.
   */
  it('separates multiple modules with a blank line', () => {
    const snapshot: ContextSnapshot = {
      'system:minecraft-integration': [
        {
          id: 'a',
          contextId: 'system:minecraft-integration',
          strategy: ContextUpdateStrategy.ReplaceSelf,
          text: 'Bot is online',
          createdAt: 0,
        },
      ],
      'system:weather': [
        {
          id: 'b',
          contextId: 'system:weather',
          strategy: ContextUpdateStrategy.ReplaceSelf,
          text: 'Sunny, 22C',
          createdAt: 0,
        },
      ],
    }

    expect(formatContextPromptText(snapshot)).toBe('Bot is online\n\nSunny, 22C')
  })

  /**
   * @example
   * A source with only whitespace text adds no blank paragraph.
   */
  it('skips whitespace-only context texts', () => {
    expect(formatContextPromptText(makeContext({ text: '  \n ' }))).toBe('')
  })
})

/**
 * @example
 * buildContextPromptMessage(contextRegistry.snapshot())
 */
describe('buildContextPromptMessage', () => {
  /**
   * @example
   * Empty context snapshots return null instead of an empty user message.
   */
  it('returns null for empty snapshot', () => {
    expect(buildContextPromptMessage({})).toBeNull()
  })

  /**
   * @example
   * Non-empty context snapshots become user-role context prompt messages.
   */
  it('returns a user message with context text', () => {
    const msg = buildContextPromptMessage(makeContext())

    expect(msg).not.toBeNull()
    expect(msg?.role).toBe('user')
    expect(msg?.content).toBeInstanceOf(Array)
  })
})
