import type { Tool } from '@xsai/shared-chat'

import type { ExecutableTool, useLlmToolsStore } from '../stores/ai/chat-llm/tools'

import { tool } from '@xsai/tool'
import { z } from 'zod'

/** The reserved `perform_action` value that ends the running performance; a clip labeled `stop` cannot be named. */
const STOP = 'stop'

/** A full-body clip the user exposed to the model. Gestures are not tool actions; they ride on ACT cues. */
export interface ExposedToolAction {
  label: string
  kind: 'action' | 'dance'
}

/** What `perform_action` reports about the body after a request. */
export interface ActionToolState {
  /** The running performance; `label` is null when the clip is not one the model may name. */
  performing: { label: string | null, phase: 'settling' | 'playing', endsInSeconds: number | null } | null
}

/** The JSON object `perform_action` returns to the model; it mirrors the body tool result. */
export interface ActionToolResult {
  success: boolean
  state?: ActionToolState
  error?: string
  /** Whole seconds to wait before the same kind of request can succeed. */
  retryAfterSeconds?: number
  /** Exposed labels, returned when the requested label is not one of them. */
  available?: string[]
}

/**
 * The stage-side operations `perform_action` calls. The body director decides every request, so `perform` resolves
 * once the director has accepted or refused it; `null` stops the running performance.
 */
export interface ActionToolPort {
  exposed: () => ExposedToolAction[]
  perform: (label: string | null) => Promise<ActionToolResult>
  state: () => ActionToolState
}

/**
 * Builds the model-facing action tool over the stage port.
 *
 * The tool store keeps no validator, so every call is checked against the enum built from the exposed labels and a
 * bad call answers with the exposed labels.
 *
 * Expects:
 * - `port.exposed()` returns at least one action; callers remove the tool otherwise
 *
 * Returns:
 * - `perform_action`
 */
export async function createActionTools(port: ActionToolPort): Promise<Tool[]> {
  const labels = port.exposed().map(entry => entry.label).filter(label => label !== STOP)
  if (labels.length === 0)
    throw new Error('The action tool needs at least one exposed action.')

  const parameters = z.object({
    action: z.enum([...labels, STOP]).describe('Label of an exposed action or dance, or "stop" to end the one playing.'),
  }).strict()

  return [await tool({
    name: 'perform_action',
    description: 'Play one of the character\'s exposed full-body actions or dances by label, or "stop" to end the one playing. After an action she refuses another for about 15 seconds, after a dance for about a minute; she also refuses while asleep, while being moved, or while another action plays. A refusal says when to retry.',
    execute: async (input) => {
      const parsed = parameters.safeParse(input)
      if (!parsed.success) {
        const available = port.exposed().map(entry => entry.label)
        return JSON.stringify({ success: false, error: `action must be one of ${available.map(label => `"${label}"`).join(', ')} or "stop".`, available } satisfies ActionToolResult)
      }
      return JSON.stringify(await port.perform(parsed.data.action === STOP ? null : parsed.data.action))
    },
    parameters,
  })]
}

type ActionToolsHost = Pick<ReturnType<typeof useLlmToolsStore>, 'addTools' | 'removeToolsByIds'>

export const actionToolIds = ['action:perform_action'] as const

/**
 * Keeps `perform_action` registered for the active scene's exposed actions.
 *
 * A changed exposed key rebuilds the tool so its enum names the new set, while the same port and key keep the
 * registered tool; an empty set or a missing port removes it, and `dispose` removes it for good. A build that a newer
 * sync overtook is discarded.
 */
export function createActionToolRegistration(host: ActionToolsHost) {
  let generation = 0
  let disposed = false
  let registered: { port: ActionToolPort, exposedKey: string } | null = null

  function remove() {
    registered = null
    host.removeToolsByIds(...actionToolIds)
  }

  async function sync(port: ActionToolPort | undefined, exposedKey: string) {
    const current = ++generation
    if (disposed)
      return
    if (!port || port.exposed().length === 0) {
      remove()
      return
    }
    if (registered?.port === port && registered.exposedKey === exposedKey)
      return
    const tools = await createActionTools(port)
    if (current !== generation || disposed)
      return
    host.addTools(...tools.map(entry => ({ ...entry, id: `action:${entry.function.name}` } satisfies ExecutableTool)))
    registered = { port, exposedKey }
  }

  function dispose() {
    disposed = true
    generation++
    remove()
  }

  return { sync, dispose }
}
