const TAG_OPEN = '<|'
const TAG_CLOSE = '|>'
const ESCAPED_TAG_OPEN = '<{\'|\'}'
const ESCAPED_TAG_CLOSE = '{\'|\'}>'

/** A cue body must close within this many characters of its opener, or of the balanced `}` of a JSON body. */
const MAX_RECOVERY_LENGTH = 64
/** A JSON cue body must balance within this many characters of its opener. */
const MAX_JSON_BODY_LENGTH = 1024

interface MarkerToken {
  /** `residual` is dropped unfinished marker text. It is never spoken but still belongs to the full text. */
  type: 'literal' | 'special' | 'residual'
  value: string
  /** Original text of a near-miss cue that was rewritten into its canonical `<|NAME body|>` form. */
  raw?: string
}

interface MarkerParserOptions {
  minLiteralEmitLength?: number
  recoverCueNames?: string[]
}

type CueOpener
  = | { kind: 'partial' }
    | { kind: 'full', open: '<' | '[', piped: boolean, name: string, end: number }

type FullCueOpener = Extract<CueOpener, { kind: 'full' }>

type CueResolution
  = | { kind: 'wait' }
    | { kind: 'close', bodyEnd: number, end: number, piped: boolean }
    | { kind: 'flush' }
    | { kind: 'drop' }

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
 * Finds the end of the JSON object that starts with the `{` at `start`.
 * Braces inside JSON strings do not count. Only characters before `limit` are scanned.
 * Returns the index just past the balancing `}`, or -1 when it has not arrived.
 */
function findJsonEnd(text: string, start: number, limit: number) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < Math.min(text.length, limit); i++) {
    const char = text[i]
    if (inString) {
      if (escaped)
        escaped = false
      else if (char === '\\')
        escaped = true
      else if (char === '"')
        inString = false
    }
    else if (char === '"') {
      inString = true
    }
    else if (char === '{') {
      depth++
    }
    else if (char === '}') {
      depth--
      if (depth === 0)
        return i + 1
    }
  }
  return -1
}

/**
 * Finds the closing bracket of a near-miss cue, searching from `from`.
 * `[` cues close on the first unnested `]`; `<` cues close on the first `>`, with an optional `|` before it.
 * Returns the body end and the index just past the closer, or null when it has not arrived.
 */
function findCueClose(buffer: string, opener: FullCueOpener, from: number) {
  let closeIndex = -1
  if (opener.open === '[') {
    let depth = 0
    for (let i = from; i < buffer.length; i++) {
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
    closeIndex = buffer.indexOf('>', from)
  }
  if (closeIndex < 0)
    return null

  const piped = buffer[closeIndex - 1] === '|' && closeIndex - 1 >= from
  return { bodyEnd: piped ? closeIndex - 1 : closeIndex, end: closeIndex + 1, piped }
}

/**
 * Decides what happens to a buffer that starts with a full cue opener.
 *
 * - A JSON body closes only at its balanced `}`, and the closer must follow within 64 characters of it.
 *   A JSON body that does not balance within 1024 characters is given up.
 * - Any other body must close within 64 characters of the opener.
 * - `flush` speaks the opener as literal so the rest is rescanned and never swallowed.
 * - With `final` set no more text arrives. An unterminated canonical `<|NAME` tail is then dropped,
 *   as unfinished `<|...` markers always were. A near-miss, or a JSON body whose closer is missing, is flushed.
 */
function resolveCue(buffer: string, opener: FullCueOpener, final: boolean): CueResolution {
  let from = opener.end
  let limit = MAX_RECOVERY_LENGTH
  const jsonStart = /^\s*\{/.test(buffer.slice(opener.end)) ? buffer.indexOf('{', opener.end) : -1

  if (jsonStart >= 0) {
    const jsonEnd = findJsonEnd(buffer, jsonStart, MAX_JSON_BODY_LENGTH)
    if (jsonEnd < 0) {
      if (buffer.length >= MAX_JSON_BODY_LENGTH)
        return { kind: 'flush' }
      if (!final)
        return { kind: 'wait' }
      return { kind: opener.piped ? 'drop' : 'flush' }
    }
    from = jsonEnd
    limit = jsonEnd + MAX_RECOVERY_LENGTH
  }

  const close = findCueClose(buffer, opener, from)
  if (close && close.end <= limit)
    return { kind: 'close', ...close }
  if (close || buffer.length > limit)
    return { kind: 'flush' }
  if (!final)
    return { kind: 'wait' }
  return { kind: opener.piped && jsonStart < 0 ? 'drop' : 'flush' }
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

  async function scan(
    onLiteral: (value: string) => Promise<void> | void,
    onSpecial: (value: string, raw?: string) => Promise<void> | void,
    onResidual: (value: string) => void,
    final: boolean,
  ) {
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
        if (opener) {
          if (opener.kind === 'partial')
            break

          const resolution = resolveCue(buffer, opener, final)
          if (resolution.kind === 'wait')
            break

          if (resolution.kind === 'drop') {
            onResidual(buffer)
            buffer = ''
            inTag = false
            break
          }

          if (resolution.kind === 'flush') {
            // The cue never closed in time. Speak only its opener and rescan the rest so later markers survive.
            const opening = buffer.slice(0, opener.end)
            buffer = buffer.slice(opener.end)
            inTag = false
            await onLiteral(opening)
            continue
          }

          const raw = buffer.slice(0, resolution.end)
          buffer = buffer.slice(resolution.end)
          inTag = false
          if (opener.piped && resolution.piped)
            await onSpecial(raw)
          else
            await onSpecial(`<|${opener.name}${raw.slice(opener.end, resolution.bodyEnd).trimEnd()}|>`, raw)
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
  }

  return {
    // Not async: returning the scan promise directly keeps the per-chunk microtask count that callers observe.
    consume(textPart: string, onLiteral: (value: string) => Promise<void> | void, onSpecial: (value: string, raw?: string) => Promise<void> | void) {
      buffer += textPart
      buffer = buffer
        .replaceAll(ESCAPED_TAG_OPEN, TAG_OPEN)
        .replaceAll(ESCAPED_TAG_CLOSE, TAG_CLOSE)

      // Nothing is dropped before the stream ends, so the residual callback is never reached here.
      return scan(onLiteral, onSpecial, () => {}, false)
    },

    async end(
      onLiteral: (value: string) => Promise<void> | void,
      onSpecial: (value: string, raw?: string) => Promise<void> | void,
      onResidual: (value: string) => void,
    ) {
      if (cues) {
        // Settle every cue that is still waiting for text, then drop what is left of an unfinished `<|...` marker.
        await scan(onLiteral, onSpecial, onResidual, true)
        const residualStart = inTag ? 0 : buffer.indexOf(TAG_OPEN)
        if (residualStart >= 0 && buffer.length > 0) {
          if (residualStart > 0)
            await onLiteral(buffer.slice(0, residualStart))
          onResidual(buffer.slice(residualStart))
          buffer = ''
          inTag = false
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

  const writeLiteral = async (literal: string) => {
    if (!literal)
      return
    write({ type: 'literal', value: literal })
  }
  const writeSpecial = async (special: string, raw?: string) => {
    write({ type: 'special', value: special, raw })
  }

  void readStream(input, async (chunk) => {
    await parser.consume(chunk, writeLiteral, writeSpecial)
  })
    .then(async () => {
      await parser.end(writeLiteral, writeSpecial, (residual) => {
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
  /**
   * Called for each special marker.
   * `recovery` is set when a near-miss cue was rewritten; `recovery.raw` is the text the model wrote.
   * Returning `false` for a recovered cue rejects it: `recovery.raw` is then passed to `onLiteral` and kept in the text
   * handed to `onEnd`, exactly as if recovery had not happened.
   */
  onSpecial?: (special: string, recovery?: { raw: string }) => boolean | void | Promise<boolean | void>
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
   * A body must close within 64 characters of its opener. A JSON body closes at its balanced `}`, which must arrive
   * within 1024 characters, and the closer must follow within 64 characters of that brace.
   * Otherwise the opener is emitted as literal and the rest is parsed again.
   * An unterminated canonical `<|...` tail is still dropped at the end of the stream.
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
  })

  const processing = readStream(markerStream, async (token) => {
    if (token.raw !== undefined) {
      if (await options.onSpecial?.(token.value, { raw: token.raw }) === false) {
        unrecoveredText += token.raw
        await options.onLiteral?.(token.raw)
      }
      else {
        stats.recovered++
      }
      return
    }

    unrecoveredText += token.value
    if (token.type === 'literal')
      await options.onLiteral?.(token.value)
    if (token.type === 'special')
      await options.onSpecial?.(token.value)
  })

  return {
    /** Number of near-miss cues rewritten and accepted so far. Always 0 when `recoverCueNames` is unset. */
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
