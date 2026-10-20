const TAG_OPEN = '<|'
const TAG_CLOSE = '|>'
const ESCAPED_TAG_OPEN = '<{\'|\'}'
const ESCAPED_TAG_CLOSE = '{\'|\'}>'

/** A near-miss cue must fit in this many characters, opener included. */
const MAX_RECOVERY_LENGTH = 64

interface MarkerToken {
  /** `residual` is dropped unfinished marker text. It is never spoken but still belongs to the full text. */
  type: 'literal' | 'special' | 'residual'
  value: string
  /** True when a near-miss cue was rewritten into its canonical `<|NAME body|>` form. */
  recovered?: boolean
}

interface MarkerParserOptions {
  minLiteralEmitLength?: number
  recoverCueNames?: string[]
  stats?: { recovered: number }
}

type CueOpener
  = | { kind: 'partial' }
    | { kind: 'full', open: '<' | '[', piped: boolean, name: string, end: number }

function createCueMatcher(names: string[]) {
  const upper = names.map(name => name.toUpperCase()).filter(Boolean)
  const alternatives = upper.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const openerPattern = new RegExp(`^([<\\[])(\\|?)(${alternatives})(?![A-Za-z0-9_])`, 'i')
  const partialPattern = /^[<[]\|?([A-Z]*)$/i

  /**
   * Classifies the text at the start of `text` as a cue opener (`<ACT`, `[ACT`, `<|ACT`).
   * A name that ends exactly at the end of `text` is partial: the next chunk may extend it (`[ACTION`).
   */
  function matchAt(text: string): CueOpener | null {
    if (alternatives) {
      const full = openerPattern.exec(text)
      if (full && full[0].length < text.length)
        return { kind: 'full', open: full[1] as '<' | '[', piped: full[2] === '|', name: full[3]!.toUpperCase(), end: full[0].length }
    }
    const partial = partialPattern.exec(text)
    if (partial && upper.some(name => name.startsWith(partial[1]!.toUpperCase())))
      return { kind: 'partial' }
    return null
  }

  function find(text: string): { index: number, opener: CueOpener } | null {
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '<' && text[index] !== '[')
        continue
      const opener = matchAt(text.slice(index))
      if (opener)
        return { index, opener }
    }
    return null
  }

  return { matchAt, find }
}

/**
 * Finds the closing bracket of a near-miss cue.
 * `[` cues close on the first unnested `]`; `<` cues close on the first `>`, with an optional `|` before it.
 * Returns the body end and the index just past the closer, or null when it has not arrived.
 */
function findCueClose(buffer: string, opener: Extract<CueOpener, { kind: 'full' }>) {
  let closeIndex = -1
  if (opener.open === '[') {
    let depth = 0
    for (let i = opener.end; i < buffer.length; i++) {
      if (buffer[i] === '[') {
        depth++
      }
      else if (buffer[i] === ']') {
        if (depth === 0) {
          closeIndex = i
          break
        }
        depth--
      }
    }
  }
  else {
    closeIndex = buffer.indexOf('>', opener.end)
  }
  if (closeIndex < 0)
    return null

  const piped = buffer[closeIndex - 1] === '|' && closeIndex - 1 >= opener.end
  return { bodyEnd: piped ? closeIndex - 1 : closeIndex, end: closeIndex + 1, piped }
}

interface StreamController<T> {
  stream: ReadableStream<T>
  write: (value: T) => void
  close: () => void
  error: (err: unknown) => void
}

function createPushStream<T>(): StreamController<T> {
  let closed = false
  let controller: ReadableStreamDefaultController<T> | null = null

  const stream = new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      closed = true
    },
  })

  return {
    stream,
    write(value) {
      if (!controller || closed)
        return
      controller.enqueue(value)
    },
    close() {
      if (!controller || closed)
        return
      closed = true
      controller.close()
    },
    error(err) {
      if (!controller || closed)
        return
      closed = true
      controller.error(err)
    },
  }
}

async function readStream<T>(stream: ReadableStream<T>, handler: (value: T) => Promise<void> | void) {
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break
      await handler(value as T)
    }
  }
  finally {
    reader.releaseLock()
  }
}

function createLlmMarkerParser(options?: MarkerParserOptions) {
  const minLiteralEmitLength = Math.max(1, options?.minLiteralEmitLength ?? 1)
  const tailLength = Math.max(TAG_OPEN.length - 1, ESCAPED_TAG_OPEN.length - 1)
  const cues = options?.recoverCueNames?.length ? createCueMatcher(options.recoverCueNames) : null
  let buffer = ''
  let inTag = false

  return {
    async consume(textPart: string, onLiteral: (value: string) => Promise<void> | void, onSpecial: (value: string, recovered?: boolean) => Promise<void> | void) {
      buffer += textPart
      buffer = buffer
        .replaceAll(ESCAPED_TAG_OPEN, TAG_OPEN)
        .replaceAll(ESCAPED_TAG_CLOSE, TAG_CLOSE)

      while (buffer.length > 0) {
        if (!inTag) {
          let openTagIndex = buffer.indexOf(TAG_OPEN)
          // A cue opener that starts before (or at) the first `<|` takes over. A partial one is held back.
          const cue = cues?.find(buffer)
          let holdStart = buffer.length - tailLength
          if (cue && (openTagIndex < 0 || cue.index <= openTagIndex)) {
            if (cue.opener.kind === 'full') {
              openTagIndex = cue.index
            }
            else {
              openTagIndex = -1
              holdStart = Math.min(holdStart, cue.index)
            }
          }
          if (openTagIndex < 0) {
            if (holdStart >= minLiteralEmitLength) {
              const emit = buffer.slice(0, holdStart)
              buffer = buffer.slice(holdStart)
              await onLiteral(emit)
            }
            break
          }

          if (openTagIndex > 0) {
            const emit = buffer.slice(0, openTagIndex)
            buffer = buffer.slice(openTagIndex)
            await onLiteral(emit)
          }
          inTag = true
        }
        else {
          const opener = cues?.matchAt(buffer)
          if (cues && opener) {
            if (opener.kind === 'partial')
              break

            // Long `<|NAME {json}|>` bodies are legitimate; every other form must close within the cap.
            const unbounded = opener.piped && /^\s*\{/.test(buffer.slice(opener.end))
            const limit = unbounded ? Number.POSITIVE_INFINITY : MAX_RECOVERY_LENGTH
            const close = findCueClose(buffer, opener)

            if (close && close.end <= limit) {
              const raw = buffer.slice(0, close.end)
              buffer = buffer.slice(close.end)
              inTag = false
              if (opener.piped && close.piped) {
                await onSpecial(raw)
              }
              else {
                const body = raw.slice(opener.end, close.bodyEnd).trimEnd()
                if (options?.stats)
                  options.stats.recovered++
                await onSpecial(`<|${opener.name}${body}|>`, true)
              }
              continue
            }

            if (!close && buffer.length <= limit)
              break

            // The cue never closed in time. Speak only its opener and rescan the rest so later markers survive.
            const opening = buffer.slice(0, opener.end)
            buffer = buffer.slice(opener.end)
            inTag = false
            await onLiteral(opening)
            continue
          }

          const closeTagIndex = buffer.indexOf(TAG_CLOSE)
          if (closeTagIndex < 0)
            break

          const emit = buffer.slice(0, closeTagIndex + TAG_CLOSE.length)
          buffer = buffer.slice(closeTagIndex + TAG_CLOSE.length)
          await onSpecial(emit)
          inTag = false
        }
      }
    },

    async end(onLiteral: (value: string) => Promise<void> | void, onResidual?: (value: string) => void) {
      if (cues && inTag && buffer.length > 0) {
        const opener = cues.matchAt(buffer)
        const unbounded = opener?.kind === 'full' && opener.piped && /^\s*\{/.test(buffer.slice(opener.end))
        if (opener && !unbounded) {
          inTag = false
        }
        else {
          onResidual?.(buffer)
          buffer = ''
        }
      }
      if (!inTag && buffer.length > 0) {
        await onLiteral(buffer)
        buffer = ''
      }
    },
  }
}

function createLlmMarkerStream(input: ReadableStream<string>, options?: MarkerParserOptions) {
  const { stream, write, close, error } = createPushStream<MarkerToken>()
  const parser = createLlmMarkerParser(options)

  void readStream(input, async (chunk) => {
    await parser.consume(
      chunk,
      async (literal) => {
        if (!literal)
          return
        write({ type: 'literal', value: literal })
      },
      async (special, recovered) => {
        write({ type: 'special', value: special, recovered })
      },
    )
  })
    .then(async () => {
      await parser.end(async (literal) => {
        if (!literal)
          return
        write({ type: 'literal', value: literal })
      }, (residual) => {
        write({ type: 'residual', value: residual })
      })
      close()
    })
    .catch((err) => {
      error(err)
    })

  return stream
}

/**
 * Creates a streaming parser for LLM responses with AIRI special markers.
 *
 * Use when:
 * - Handling streamed model output that may contain `<|...|>` markers.
 * - Literal text and special marker tokens need to be emitted separately.
 *
 * Expects:
 * - Callers feed chunks in order and call `end()` once the model stream ends.
 *
 * Returns:
 * - A parser with `consume()` and `end()` methods.
 */
export function useLlmmarkerParser(options: {
  onLiteral?: (literal: string) => void | Promise<void>
  onSpecial?: (special: string) => void | Promise<void>
  /**
   * Called when parsing ends with the full accumulated text.
   * Useful for final processing like categorization or filtering.
   */
  onEnd?: (fullText: string) => void | Promise<void>
  /**
   * The minimum length of text required to emit a literal part.
   * Useful for avoiding emitting literal parts too fast.
   */
  minLiteralEmitLength?: number
  /**
   * Cue names (case-insensitive) whose near-miss spellings are rewritten into a canonical `<|NAME body|>`
   * special instead of being spoken: `<ACT x>`, `[ACT x]`, `<|ACT x>`, `<ACT x|>`.
   * A near-miss must close within 64 characters of its opener, otherwise the opener is emitted as literal.
   * Unset keeps the original parsing byte for byte.
   */
  recoverCueNames?: string[]
}) {
  let fullText = ''
  const recovering = !!options.recoverCueNames?.length
  // Rebuilt from tokens so recovered markers can be left out of the text handed to `onEnd`.
  let unrecoveredText = ''
  const stats = { recovered: 0 }
  const { stream, write, close } = createPushStream<string>()

  const markerStream = createLlmMarkerStream(stream, {
    minLiteralEmitLength: options.minLiteralEmitLength,
    recoverCueNames: options.recoverCueNames,
    stats,
  })

  const processing = readStream(markerStream, async (token) => {
    if (!token.recovered)
      unrecoveredText += token.value
    if (token.type === 'literal')
      await options.onLiteral?.(token.value)
    if (token.type === 'special')
      await options.onSpecial?.(token.value)
  })

  return {
    /** Number of near-miss cues rewritten so far. Always 0 when `recoverCueNames` is unset. */
    stats,

    /**
     * Consumes a chunk of text from the stream.
     *
     * @param textPart The chunk of text to consume.
     */
    async consume(textPart: string) {
      fullText += textPart
      write(textPart)
    },

    /**
     * Finalizes the parsing process.
     * Any remaining content in the buffer is flushed as a final literal part.
     */
    async end() {
      close()
      await processing
      await options.onEnd?.(recovering ? unrecoveredText : fullText)
    },
  }
}
