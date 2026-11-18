import type { Element, Root } from 'hast'
import type { Position } from 'unist'

import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'

import { unified } from 'unified'
import { visit } from 'unist-util-visit'

export type ResponseCategory = 'speech' | 'reasoning' | 'unknown'

export interface CategorizedSegment {
  category: ResponseCategory
  content: string
  startIndex: number
  endIndex: number
  raw: string // Original tagged content including tags
  tagName: string // The actual tag name found (e.g., "think", "thought", "reasoning")
}

export interface CategorizedResponse {
  segments: CategorizedSegment[]
  speech: string // Combined speech content (everything outside tags)
  reasoning: string // Combined reasoning/thought content
  raw: string // Original full response
}

/**
 * Maps tag names to categories
 * All tags are treated as reasoning (filtered from TTS)
 */
function mapTagNameToCategory(_tagName: string): ResponseCategory {
  // All tags are reasoning - no need to distinguish tag names
  return 'reasoning'
}

interface ExtractedTag {
  tagName: string
  content: string
  fullMatch: string
  startIndex: number
  endIndex: number
}

/**
 * Extracts all XML-like tags from a response using rehype pipeline
 * Works with any tag format: <tag>content</tag>
 * Only extracts tags that are actually complete (have closing tags in source)
 */
function extractAllTags(response: string): ExtractedTag[] {
  const tags: ExtractedTag[] = []

  try {
    const tree = unified().use(rehypeParse, { fragment: true }).parse(response) as Root

    visit(tree, 'element', (node: Element) => {
      const position = node.position
      if (!position?.start || !position?.end)
        return

      const startIndex = getOffsetFromPosition(response, position.start)
      const endIndex = getOffsetFromPosition(response, position.end)

      if (startIndex === -1 || endIndex === -1)
        return

      // Extract the actual tag content from source
      const fullMatch = response.slice(startIndex, endIndex)

      // Only include tags that have a closing tag in the source (not auto-closed by rehype)
      // Check if the source actually contains the closing tag
      const expectedClosingTag = `</${node.tagName}>`
      if (!fullMatch.includes(expectedClosingTag)) {
        // This tag was auto-closed by rehype, so it's incomplete - skip it
        return
      }

      tags.push({
        tagName: node.tagName,
        content: extractTextContent(node),
        fullMatch,
        startIndex,
        endIndex,
      })
    })
  }
  catch (error) {
    console.error('Failed to parse response for tag extraction:', error)
    // If parsing fails, return empty array (no tags found)
  }

  return tags
}

/**
 * Converts a position (line/column) to a character offset in the string
 */
function getOffsetFromPosition(text: string, position: Position['start']): number {
  if (!position || typeof position.line !== 'number' || typeof position.column !== 'number')
    return -1

  const lines = text.split('\n')
  let offset = 0

  // Sum up lengths of all lines before the target line
  for (let i = 0; i < position.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1 // +1 for the newline character
  }

  // Add the column offset (subtract 1 because columns are 1-indexed)
  offset += position.column - 1

  return offset
}

/**
 * Extracts text content from an element node
 */
function extractTextContent(node: Element): string {
  const textParts: string[] = []

  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'text') {
        textParts.push(child.value)
      }
      else if (child.type === 'element') {
        textParts.push(extractTextContent(child))
      }
    }
  }

  return textParts.join('')
}

/**
 * Categorizes a model response by dynamically extracting any XML-like tags
 * Works with any tag format the model uses
 */
export function categorizeResponse(
  response: string,
  _providerId?: string,
): CategorizedResponse {
  // Extract all tags dynamically
  const extractedTags = extractAllTags(response)

  if (extractedTags.length === 0) {
    // No tags found, treat everything as speech
    return {
      segments: [],
      speech: response,
      reasoning: '',
      raw: response,
    }
  }

  // Convert extracted tags to categorized segments
  const segments: CategorizedSegment[] = extractedTags.map(tag => ({
    category: mapTagNameToCategory(tag.tagName),
    content: tag.content.trim(),
    startIndex: tag.startIndex,
    endIndex: tag.endIndex,
    raw: tag.fullMatch,
    tagName: tag.tagName,
  }))

  // Sort segments by position
  segments.sort((a, b) => a.startIndex - b.startIndex)

  // Extract speech content (everything outside tags)
  const speechParts: string[] = []
  let lastEnd = 0

  for (const segment of segments) {
    // Add text before this segment
    if (segment.startIndex > lastEnd) {
      const text = response.slice(lastEnd, segment.startIndex).trim()
      if (text) {
        speechParts.push(text)
      }
    }
    lastEnd = Math.max(lastEnd, segment.endIndex)
  }

  // Add remaining text after last segment
  if (lastEnd < response.length) {
    const text = response.slice(lastEnd).trim()
    if (text) {
      speechParts.push(text)
    }
  }

  // Combine segments by category
  const reasoning = segments
    .filter(s => s.category === 'reasoning')
    .map(s => s.content)
    .join('\n\n')

  // Speech is everything outside tags
  const speech = speechParts.join(' ').trim()

  return {
    segments,
    speech: speech || '',
    reasoning,
    raw: response,
  }
}

/** Text outside closed tags, which are reasoning. Unlike `categorizeResponse`, it keeps the text as written. */
function speechOutsideClosedTags(text: string): string {
  if (!text.includes('<'))
    return text
  let speech = ''
  let position = 0
  for (const tag of extractAllTags(text)) {
    // Tags arrive in document order, nested ones after their parent, which already hid them.
    if (tag.startIndex < position)
      continue
    speech += text.slice(position, tag.startIndex)
    position = tag.endIndex
  }
  return speech + text.slice(position)
}

/**
 * A tag token that `flush` drops from text after a tag that never closed: an opening, closing, or comment tag, or one
 * cut off by the end of the stream.
 */
const TAG_TOKEN = /<[a-z/!][^<>]*>?/gi

/**
 * Reasoning tags that a model can leave open when its reply is cut off. Their text stays hidden at the end of a stream.
 */
const UNCLOSED_REASONING_TAG = /^<(?:think|thinking|thought|reasoning)\b/i

/**
 * Note: This receives literal text from useLlmmarkerParser (special tokens <|...|> are already extracted).
 * Only XML/HTML tags like <think>, <reasoning> need to be parsed here.
 */
export function createStreamingCategorizer(
  providerId?: string,
  onSegment?: (segment: CategorizedSegment) => void,
) {
  let buffer = ''
  let categorized: CategorizedResponse | null = null
  let lastEmittedSegmentIndex = -1
  let lastParsedLength = 0

  // Lightweight state machine to detect tag closures without parsing entire buffer
  type TagState = 'outside' | 'in-opening-tag' | 'in-content' | 'in-closing-tag'
  let tagState: TagState = 'outside'
  let tagStackDepth = 0
  // Speech is decided up to this buffer index: the text before it was released or hidden. The text after it waits,
  // because it follows a tag that has not closed yet or a `<` that ends the buffer.
  let decidedUntil = 0

  // Whether `source` holds a tag that has not closed, judged by a rehype round trip
  function checkIncompleteTag(source: string, holdTrailingLessThan = true): boolean {
    try {
      // rehype writes a text `<` (as in `a < b`) and `&` as references, so write them so here too. A `<` that ends the
      // source stays raw, since the next chunk can make it a tag such as `<think>`, unless `holdTrailingLessThan` is false.
      const escaped = source.replaceAll('&', '&#x26;').replace(holdTrailingLessThan ? /<(?![a-z/!]|$)/gi : /<(?![a-z/!])/gi, '&#x3C;')
      const tree = unified().use(rehypeParse, { fragment: true }).parse(escaped) as Root
      const stringified = unified().use(rehypeStringify).stringify(tree).toString()

      if (stringified !== escaped) {
        const bufferEnd = escaped.trim().slice(-30)
        const stringifiedEnd = stringified.trim().slice(-30)
        return bufferEnd !== stringifiedEnd
      }

      return false
    }
    catch {
      // If parsing fails, assume incomplete
      return true
    }
  }

  /**
   * Returns the end of the longest buffer prefix that holds no unclosed tag, at least `decidedUntil`. Speech up to it
   * cannot change with later chunks. Every chunking of a stream reaches the same index, which keeps speech independent
   * of chunk boundaries.
   */
  function completePrefixEnd(): number {
    if (!checkIncompleteTag(buffer))
      return buffer.length
    // An unclosed tag starts at a `<`, so the complete prefix ends at one. A `<` that ends the prefix is followed by
    // this `<`, so it opens no tag.
    for (let index = buffer.lastIndexOf('<'); index > decidedUntil; index = buffer.lastIndexOf('<', index - 1)) {
      if (!checkIncompleteTag(buffer.slice(0, index), false))
        return index
    }
    return decidedUntil
  }

  // Tracks tag state incrementally (O(chunk.length)) to detect when tags close
  // Returns true when the outermost tag just closed
  function processChunkIncrementally(chunk: string): boolean {
    let tagJustClosed = false

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]

      switch (tagState) {
        case 'outside': {
          if (char === '<') {
            if (i + 1 < chunk.length && chunk[i + 1] === '/') {
              tagState = 'in-closing-tag'
              i++
            }
            else {
              tagState = 'in-opening-tag'
            }
          }
          break
        }

        case 'in-opening-tag': {
          if (char === '>') {
            tagState = 'in-content'
            tagStackDepth++
          }
          break
        }

        case 'in-content': {
          if (char === '<') {
            if (i + 1 < chunk.length && chunk[i + 1] === '/') {
              tagState = 'in-closing-tag'
              i++
            }
            else {
              tagState = 'in-opening-tag'
            }
          }
          break
        }

        case 'in-closing-tag': {
          if (char === '>') {
            tagStackDepth--
            if (tagStackDepth === 0) {
              tagState = 'outside'
              tagJustClosed = true
            }
            else {
              tagState = 'in-content'
            }
          }
          break
        }
      }
    }

    return tagJustClosed
  }

  return {
    consume(chunk: string) {
      // Process before adding to buffer to detect tag closure in this chunk
      const tagJustClosed = processChunkIncrementally(chunk)
      buffer += chunk

      // Re-categorize on first chunk, tag closure, or every 1KB (periodic fallback)
      const shouldRecategorize = !categorized
        || tagJustClosed
        || buffer.length - lastParsedLength > 1000

      if (shouldRecategorize) {
        categorized = categorizeResponse(buffer, providerId)
        lastParsedLength = buffer.length
      }

      // Type guard for TypeScript (shouldRecategorize handles !categorized, but TS doesn't know)
      if (!categorized) {
        categorized = categorizeResponse(buffer, providerId)
        lastParsedLength = buffer.length
      }

      if (onSegment && categorized.segments.length > 0) {
        for (let i = lastEmittedSegmentIndex + 1; i < categorized.segments.length; i++) {
          const segment = categorized.segments[i]
          if (buffer.length >= segment.endIndex) {
            onSegment(segment)
            lastEmittedSegmentIndex = i
          }
        }
      }
    },
    /**
     * Checks if the current position in the stream is part of speech content
     * Returns true if the text should be sent to TTS
     */
    isSpeechAt(position: number): boolean {
      if (!categorized || categorized.segments.length === 0) {
        // No categorization yet, assume it's speech
        return true
      }

      // Check if position falls within any non-speech segment
      for (const segment of categorized.segments) {
        if (position >= segment.startIndex && position < segment.endIndex) {
          // Position is within a tagged segment (thought/reasoning)
          return false
        }
      }

      // Position is not in any tagged segment, so it's speech
      return true
    },
    /**
     * Filters text to only include speech parts
     * Removes content that falls within thought/reasoning segments
     */
    filterToSpeech(text: string, startPosition: number): string {
      // A literal is consumed before it is filtered. A marker is filtered without being consumed, only to test visibility.
      const consumed = startPosition + text.length === buffer.length
      if (!consumed) {
        // A marker after an unclosed tag may be reasoning. A `<` held alone at the end of the buffer opens no tag before
        // a marker, so the marker is visible and `flush` releases that `<`. A caller can consume literals without
        // filtering them, so the complete prefix is measured here instead of read from `decidedUntil`.
        const end = completePrefixEnd()
        return end === buffer.length || (end === buffer.length - 1 && buffer.endsWith('<')) ? text : ''
      }

      // Speech before an unclosed tag is released at once. The rest waits until the tag closes, when a closed tag is
      // reasoning, or until `flush`. Filtering out the whole literal lost the speech before a tag that never closed.
      const end = completePrefixEnd()
      const speech = speechOutsideClosedTags(buffer.slice(decidedUntil, end))
      decidedUntil = end
      return speech
    },
    /**
     * Releases the text that still waits after the last chunk, or before a visible marker, as speech. Call it once
     * after the last chunk, and treat the result as speech.
     *
     * A `<` that ended the stream is text. Text after a tag that never closed is speech, since small models write
     * tag-like noise such as `<smile>` or `|<MOOD brighter|>`, but the tag tokens themselves are not spoken. A reasoning
     * tag that never closed, as in a reply cut off while thinking, stays hidden.
     */
    flush(): string {
      const waiting = buffer.slice(decidedUntil)
      decidedUntil = buffer.length
      if (waiting === '<')
        return waiting
      if (UNCLOSED_REASONING_TAG.test(waiting))
        return ''
      return speechOutsideClosedTags(waiting).replace(TAG_TOKEN, '')
    },
    getCurrentPosition(): number {
      return buffer.length
    },
    end(): CategorizedResponse {
      return categorizeResponse(buffer, providerId)
    },
    getCurrent(): CategorizedResponse | null {
      return categorized
    },
  }
}
