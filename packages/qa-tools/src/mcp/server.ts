import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { AppSession } from './session'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { errorMessageFrom } from '@moeru/std'
import { z } from 'zod'

const eventKinds = ['act', 'expression', 'clip', 'tts', 'turn'] as const

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** Runs a tool body and turns a thrown error into an MCP tool error, so the agent sees the reason instead of a protocol failure. */
async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body()
  }
  catch (error) {
    return { isError: true, content: [{ type: 'text', text: errorMessageFrom(error) ?? 'unknown error' }] }
  }
}

/**
 * The AIRI QA MCP server: a few verbs over one disposable app session, so an agent can check its own change in
 * the running app. Every tool except `airi_start` needs a running session.
 */
export type QaSession = Pick<AppSession, 'start' | 'state' | 'send' | 'events' | 'importModel' | 'screenshot' | 'errors' | 'evaluate' | 'stop'>

export function createAiriQaServer(session: QaSession, version: string): McpServer {
  const server = new McpServer({ name: 'airi-qa', version })

  server.registerTool('airi_start', {
    description: 'Launch the AIRI desktop app (development build, fresh temporary profile, replay LLM and speech, onboarding done) and wait until it is ready. On Linux it runs in a headless QA display, never on the user\'s desktop. Holds the exclusive CPU lease until airi_stop, and can wait in the CPU slot queue first. Takes about 30 seconds, plus the model import.',
    inputSchema: {
      model: z.string().optional().describe('Absolute path to a Live2D ZIP or directory, an MMD ZIP or PMX/PMD, or a VRM to import and select'),
      kind: z.enum(['live2d', 'mmd', 'vrm']).optional().describe('Model kind; inferred from the extension, ZIPs and directories default to live2d'),
      script: z.string().optional().describe('Absolute path to a qa:llm replay script (JSON or JSONL). Without one, pass `reply` to airi_send'),
    },
  }, args => guarded(async () => json(await session.start(args))))

  server.registerTool('airi_state', {
    description: 'Read the motion QA bridge state of the running app: the selected model, scene, performance mode, and host capability details.',
  }, () => guarded(async () => json(await session.state())))

  server.registerTool('airi_send', {
    description: 'Send one chat message through the real chat path (the chat window composer when open, otherwise the chat store) and wait for the turn to complete. Returns the events of the turn (ACT cues, expressions, speech, turn start and end) and any expected kinds that never arrived.',
    inputSchema: {
      text: z.string().min(1).describe('The user message'),
      reply: z.string().optional().describe('The scripted assistant reply for this turn, for example `<|ACT {"emotion":"happy"}|>Hi!`. Required when airi_start had no script'),
      expect: z.array(z.enum(eventKinds)).optional().describe('Event kinds the turn must produce; a completed turn is always required. `clip` is not wired and always times out'),
      timeoutSeconds: z.number().positive().max(600).optional().describe('Budget for sending and collecting events (default 60)'),
    },
  }, args => guarded(async () => json(await session.send(args.text, { reply: args.reply, expect: args.expect ?? [], timeoutMs: (args.timeoutSeconds ?? 60) * 1000 }))))

  server.registerTool('airi_events', {
    description: 'Read the app\'s event log (ACT, expression, speech, turn) after a sequence number.',
    inputSchema: { sinceSeq: z.number().int().min(0).optional() },
  }, args => guarded(async () => json(await session.events(args.sinceSeq))))

  server.registerTool('airi_import_model', {
    description: 'Import and select another model in the running app.',
    inputSchema: {
      model: z.string().describe('Absolute path to the model file or directory'),
      kind: z.enum(['live2d', 'mmd', 'vrm']).optional(),
    },
  }, args => guarded(async () => json(await session.importModel(args.model, args.kind))))

  server.registerTool('airi_screenshot', {
    description: 'Capture the stage window as a PNG. Returns the image and the saved file path in the session\'s run directory.',
  }, () => guarded(async () => {
    const shot = await session.screenshot()
    return { content: [{ type: 'image', data: shot.png, mimeType: 'image/png' }, { type: 'text', text: shot.path }] }
  }))

  server.registerTool('airi_errors', {
    description: 'List renderer exceptions, console errors, and browser errors from every app window since airi_start, plus error lines from the main-process log. Use it after a change to prove the app ran without errors.',
  }, () => guarded(async () => json(session.errors())))

  server.registerTool('airi_eval', {
    description: 'Evaluate a JavaScript expression in the stage window and return its JSON value. Promises are awaited.',
    inputSchema: { expression: z.string().min(1) },
  }, args => guarded(async () => json(await session.evaluate(args.expression) ?? null)))

  server.registerTool('airi_stop', {
    description: 'Close the app, remove its temporary profile, release the CPU lease, and stop the QA display this server started. Always call it when done.',
  }, () => guarded(async () => json(await session.stop())))

  return server
}
