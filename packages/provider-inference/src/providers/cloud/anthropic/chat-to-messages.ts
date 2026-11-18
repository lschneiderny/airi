import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageCreateParamsBase,
  OutputConfig,
  TextBlockParam,
  ThinkingConfigParam,
  Tool,
  ToolChoice,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages'

import * as v from 'valibot'

/**
 * Output cap of a request that sets none. The Messages API requires `max_tokens`; Chat Completions does not.
 * Callers that care about length set their own cap; this one leaves room for reasoning and a long answer.
 */
export const DEFAULT_MAX_TOKENS = 8192

const TextPartSchema = v.object({ type: v.literal('text'), text: v.string() })
const RefusalPartSchema = v.object({ type: v.literal('refusal'), refusal: v.string() })
const ImagePartSchema = v.object({ type: v.literal('image_url'), image_url: v.object({ url: v.string() }) })
const AudioPartSchema = v.object({ type: v.literal('input_audio') })
const FilePartSchema = v.object({
  type: v.literal('file'),
  file: v.object({ file_data: v.optional(v.string()), file_id: v.optional(v.string()), filename: v.optional(v.string()) }),
})
const ContentPartSchema = v.variant('type', [TextPartSchema, RefusalPartSchema, ImagePartSchema, AudioPartSchema, FilePartSchema])
const ContentSchema = v.nullish(v.union([v.string(), v.array(ContentPartSchema)]))

const ToolCallSchema = v.object({
  id: v.string(),
  function: v.object({ name: v.string(), arguments: v.string() }),
})

const ChatMessageSchema = v.variant('role', [
  v.object({ role: v.picklist(['system', 'developer']), content: ContentSchema }),
  v.object({ role: v.literal('user'), content: ContentSchema }),
  v.object({ role: v.literal('assistant'), content: ContentSchema, refusal: v.nullish(v.string()), tool_calls: v.nullish(v.array(ToolCallSchema)) }),
  v.object({ role: v.literal('tool'), tool_call_id: v.string(), content: ContentSchema }),
])

const ToolDefinitionSchema = v.object({
  type: v.literal('function'),
  function: v.object({
    name: v.string(),
    description: v.optional(v.string()),
    parameters: v.optional(v.record(v.string(), v.unknown())),
  }),
})

const ToolChoiceSchema = v.union([
  v.picklist(['auto', 'none', 'required']),
  v.object({ type: v.literal('function'), function: v.object({ name: v.string() }) }),
])

/** The fields of a Chat Completions request body that the translator reads. Other fields are ignored. */
export const ChatRequestSchema = v.object({
  model: v.string(),
  messages: v.array(ChatMessageSchema),
  stream: v.optional(v.boolean()),
  max_tokens: v.nullish(v.number()),
  max_completion_tokens: v.nullish(v.number()),
  temperature: v.nullish(v.number()),
  top_p: v.nullish(v.number()),
  stop: v.nullish(v.union([v.string(), v.array(v.string())])),
  tools: v.nullish(v.array(ToolDefinitionSchema)),
  tool_choice: v.nullish(ToolChoiceSchema),
  parallel_tool_calls: v.nullish(v.boolean()),
  reasoning_effort: v.nullish(v.picklist(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])),
  thinking: v.nullish(v.looseObject({ type: v.picklist(['adaptive', 'disabled', 'enabled', 'between_tools']) })),
})

export type ChatRequest = v.InferOutput<typeof ChatRequestSchema>
type ChatContent = v.InferOutput<typeof ContentSchema>
type ContentPart = v.InferOutput<typeof ContentPartSchema>

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

/** Splits a `data:<type>;base64,<data>` URL. Returns undefined for any other URL. */
function parseDataURL(url: string): { mediaType: string, data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return match ? { mediaType: match[1], data: match[2] } : undefined
}

function imageBlock(url: string): ImageBlockParam {
  const inline = parseDataURL(url)
  if (!inline)
    return { type: 'image', source: { type: 'url', url } }
  const mediaType = IMAGE_MEDIA_TYPES.find(type => type === inline.mediaType)
  if (!mediaType)
    throw new Error(`Anthropic Messages does not accept images of type ${inline.mediaType}`)
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: inline.data } }
}

function fileBlock(file: Extract<ContentPart, { type: 'file' }>['file']): ContentBlockParam {
  const inline = file.file_data === undefined ? undefined : parseDataURL(file.file_data)
  if (!inline)
    throw new Error('Anthropic Messages accepts files only as base64 data URLs')
  if (inline.mediaType === 'application/pdf')
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: inline.data }, title: file.filename }
  if (inline.mediaType.startsWith('text/')) {
    const text = new TextDecoder().decode(Uint8Array.from(atob(inline.data), char => char.charCodeAt(0)))
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text }, title: file.filename }
  }
  throw new Error(`Anthropic Messages does not accept files of type ${inline.mediaType}`)
}

/** The Messages API rejects text blocks without visible text. */
function hasText(text: string) {
  return text.trim() !== ''
}

function contentBlocks(content: ChatContent): ContentBlockParam[] {
  if (content == null)
    return []
  if (typeof content === 'string')
    return hasText(content) ? [{ type: 'text', text: content }] : []
  return content.flatMap((part): ContentBlockParam[] => {
    switch (part.type) {
      case 'text': return hasText(part.text) ? [{ type: 'text', text: part.text }] : []
      case 'refusal': return hasText(part.refusal) ? [{ type: 'text', text: part.refusal }] : []
      case 'image_url': return [imageBlock(part.image_url.url)]
      case 'file': return [fileBlock(part.file)]
      // The app sends audio only to models whose catalog entry lists audio input; Anthropic's listing does not.
      case 'input_audio': throw new Error('Anthropic Messages does not accept audio input')
    }
    return []
  })
}

function contentText(content: ChatContent): string {
  if (content == null)
    return ''
  if (typeof content === 'string')
    return content
  return content.map(part => part.type === 'text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('')
}

function toolResultContent(content: ChatContent): ToolResultBlockParam['content'] {
  const blocks = contentBlocks(content).filter((block): block is TextBlockParam | ImageBlockParam => block.type === 'text' || block.type === 'image')
  return blocks.length > 0 ? blocks : undefined
}

/**
 * Reads stored tool arguments. A call that a model cut off or wrote malformed keeps its place in the history with an
 * empty input, because its error result follows it and a thrown error would block every later turn of the session.
 */
function toolInput(argumentsText: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(argumentsText || '{}')
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/** A user or assistant message. The translator writes no mid-conversation system messages. */
interface Turn {
  role: 'user' | 'assistant'
  content: ContentBlockParam[]
}

/**
 * Appends one message, merging it into the previous one of the same role. In a user message, tool results come first,
 * as the Messages API requires.
 */
function appendMessage(messages: Turn[], role: Turn['role'], blocks: ContentBlockParam[]) {
  if (blocks.length === 0)
    return
  const previous = messages.at(-1)
  if (previous?.role === role) {
    previous.content.push(...blocks)
    if (role === 'user')
      previous.content.sort((a, b) => Number(b.type === 'tool_result') - Number(a.type === 'tool_result'))
    return
  }
  messages.push({ role, content: blocks })
}

function toolChoice(choice: ChatRequest['tool_choice'], parallel: ChatRequest['parallel_tool_calls']): ToolChoice | undefined {
  const disable = parallel === false ? { disable_parallel_tool_use: true } : {}
  if (choice == null)
    return parallel === false ? { type: 'auto', ...disable } : undefined
  if (choice === 'none')
    return { type: 'none' }
  if (choice === 'auto')
    return { type: 'auto', ...disable }
  if (choice === 'required')
    return { type: 'any', ...disable }
  return { type: 'tool', name: choice.function.name, ...disable }
}

function reasoning(effort: ChatRequest['reasoning_effort']): { thinking?: ThinkingConfigParam, output_config?: OutputConfig } {
  switch (effort) {
    case 'none': return { thinking: { type: 'disabled' } }
    case 'minimal':
    case 'low': return { output_config: { effort: 'low' } }
    case 'medium':
    case 'high':
    case 'xhigh': return { output_config: { effort } }
    default: return {}
  }
}

/**
 * Translates a Chat Completions request body into Messages API parameters, without `stream`.
 *
 * Use when:
 * - The Anthropic provider sends an OpenAI-shaped request from xsAI to the native Messages API.
 *
 * Expects:
 * - A body that matches {@link ChatRequestSchema}. Unknown fields, such as `seed` or `response_format`, are dropped,
 *   as Anthropic's OpenAI compatibility endpoint drops them.
 *
 * Returns:
 * - Parameters with every system and developer message joined into the top-level system prompt in order, like the
 *   compatibility endpoint, and with prompt cache breakpoints from {@link placeCacheBreakpoints}.
 */
export function toMessagesParams(body: ChatRequest): MessageCreateParamsBase {
  const system: TextBlockParam[] = []
  const messages: Turn[] = []
  for (const message of body.messages) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = contentText(message.content)
        if (hasText(text))
          system.push({ type: 'text', text })
        break
      }
      case 'user':
        appendMessage(messages, 'user', contentBlocks(message.content))
        break
      case 'assistant':
        appendMessage(messages, 'assistant', [
          ...contentBlocks(message.content),
          ...(message.refusal && hasText(message.refusal) ? [{ type: 'text' as const, text: message.refusal }] : []),
          ...(message.tool_calls ?? []).map(call => ({ type: 'tool_use' as const, id: call.id, name: call.function.name, input: toolInput(call.function.arguments) })),
        ])
        break
      case 'tool':
        appendMessage(messages, 'user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: toolResultContent(message.content) }])
        break
    }
  }

  const tools = body.tools?.map((tool): Tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: { ...tool.function.parameters, type: 'object' },
  }))
  const choice = tools?.length ? toolChoice(body.tool_choice, body.parallel_tool_calls) : undefined
  const stop = typeof body.stop === 'string' ? [body.stop] : body.stop ?? undefined

  placeCacheBreakpoints(system, tools ?? [], messages)
  return {
    model: body.model,
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? DEFAULT_MAX_TOKENS,
    messages,
    ...(system.length ? { system } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(choice ? { tool_choice: choice } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    ...(stop?.length ? { stop_sequences: stop } : {}),
    ...reasoning(body.reasoning_effort),
    ...(body.thinking ? { thinking: body.thinking as ThinkingConfigParam } : {}),
  } satisfies MessageCreateParamsBase
}

function markLastBlock(message: Turn | undefined) {
  const block = message?.content.at(-1)
  if (block && block.type !== 'thinking' && block.type !== 'redacted_thinking')
    block.cache_control = { type: 'ephemeral' }
}

/**
 * Marks up to three prompt cache breakpoints, in place.
 *
 * - The end of the system prompt, or of the tools when there is no system prompt. It caches both, because the API
 *   renders tools before the system prompt.
 * - The end of the history before the newest message that carries new input. That message holds what changes on
 *   every request, such as AIRI's situation block, so a later request finds the history before it unchanged.
 * - The end of the request when it ends with tool results, so the next model step of the same tool loop reads it.
 *
 * The API ignores a breakpoint on a prefix shorter than the model's minimum, so short prompts cost nothing extra.
 */
export function placeCacheBreakpoints(system: TextBlockParam[], tools: Tool[], messages: Turn[]) {
  const lastSystem = system.at(-1)
  const lastTool = tools.at(-1)
  if (lastSystem)
    lastSystem.cache_control = { type: 'ephemeral' }
  else if (lastTool)
    lastTool.cache_control = { type: 'ephemeral' }

  const isNewInput = (message: Turn) => message.role === 'user' && message.content.some(block => block.type !== 'tool_result')
  const newest = messages.findLastIndex(isNewInput)
  if (newest > 0)
    markLastBlock(messages[newest - 1])

  const last = messages.at(-1)
  if (last?.role === 'user' && !isNewInput(last))
    markLastBlock(last)
}
