import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

/** Where the character stands relative to her home spot and the chat window. */
export type BodyPosition = 'home' | 'at-chat' | 'elsewhere'

/** What the body tools report about the character after a request. */
export interface BodyToolState {
  position: BodyPosition
  moving: boolean
  /** Whole seconds until the movement tools are accepted again; 0 when they are. */
  refractorySeconds: number
}

/** The JSON object every body tool returns to the model. */
export interface BodyToolResult {
  success: boolean
  state?: BodyToolState
  error?: string
  /** Whole seconds to wait before the same kind of request can succeed. */
  retryAfterSeconds?: number
}

export const bodyLookTargets = ['camera', 'cursor', 'chat', 'away'] as const

export type BodyToolLookTarget = typeof bodyLookTargets[number]

/**
 * The stage-side operations the body tools call. The stage director decides every request, so
 * each call resolves once the director has accepted or refused it.
 */
export interface BodyToolPort {
  state: () => BodyToolState
  comeHere: () => Promise<BodyToolResult>
  goHome: () => Promise<BodyToolResult>
  lookAt: (target: BodyToolLookTarget) => Promise<BodyToolResult>
}

const lookAtParameters = z.object({
  target: z.enum(bodyLookTargets).describe('Where to look: the camera, the cursor, the chat window, or away.'),
}).strict()

/**
 * Builds the model-facing body tools over the stage port.
 *
 * The tool store keeps no validator, so every call is checked against the parameter schema here
 * and a bad call answers with the schema's message. The tools only ask: the director may refuse a
 * request inside its refractory, and the answer says when to retry.
 *
 * Returns:
 * - `come_here`, `go_home`, and `look_at`
 */
export async function createBodyTools(port: BodyToolPort): Promise<Tool[]> {
  return await Promise.all([
    tool({
      name: 'come_here',
      description: 'Walk to the chat window and stand beside it. Refused for about a minute after any come_here or go_home.',
      execute: async () => JSON.stringify(await port.comeHere()),
      parameters: z.object({}).strict(),
    }),
    tool({
      name: 'go_home',
      description: 'Walk back to the resting spot on the stage. Refused for about a minute after any come_here or go_home.',
      execute: async () => JSON.stringify(await port.goHome()),
      parameters: z.object({}).strict(),
    }),
    tool({
      name: 'look_at',
      description: 'Look at the camera, the cursor, the chat window, or away for a few seconds. Refused for a short while after the last look_at.',
      execute: async (input) => {
        const parsed = lookAtParameters.safeParse(input)
        if (!parsed.success)
          return JSON.stringify({ success: false, error: parsed.error.issues.map(issue => issue.message).join('; ') } satisfies BodyToolResult)
        return JSON.stringify(await port.lookAt(parsed.data.target))
      },
      parameters: lookAtParameters,
    }),
  ])
}
