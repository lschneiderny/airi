import type { ReplyTranscriptRecord } from '../transcript/schema'

// NOTICE:
// Verbatim copy of `scoreReplies` from `scripts/ollama-bench/score.ts` at commit 9f6ff5e8d,
// so the legacy table stays comparable with the October Mac benchmark. Do not change the logic.
// Source: scripts/ollama-bench/score.ts.
// Removal condition: the legacy ollama-bench tool and its results are retired.

const EMOTIONS = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral', 'love', 'flustered', 'sleepy']
const HEARTS = /[\u2665\u2764\u{1F49C}\u{1F497}\u{1F496}\u{1F495}\u{1F493}\u{1F49E}\u{1F498}\u{1F49D}\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F90D}\u{1F5A4}\uFE0F]/gu

export interface Reply { text: string, toolCalls: unknown[], error: string | null, totalMs: number, steps?: number, usage: Record<string, number> | null, thinkingText?: string }

function cueEmotion(cue: string): string {
  const body = cue.replace(/^<\|ACT[:\s]*/i, '').replace(/\|>$/, '').trim()
  if (body.startsWith('{'))
    return /"emotion"\s*:\s*"([a-z]+)"/i.exec(body)?.[1]?.toLowerCase() ?? '(bad-json)'
  return body.split(/\s+/)[0]?.toLowerCase() ?? ''
}

export function scoreReplies(replies: Reply[]) {
  const spokenOf = (x: Reply) => x.text.replace(/<\|[^|]*\|>/g, '').replace(/<\|[^>]*>/g, '').trim()
  const words = replies.filter(x => spokenOf(x))
  const n = words.length || 1
  let valid = 0
  let invalid = 0
  let jsonCue = 0
  let malformed = 0
  let lead = 0
  let emoji = 0
  let stage = 0
  let lower = 0
  let face = 0
  let ai = 0
  let wc = 0
  for (const x of words) {
    const t = x.text.trim()
    for (const c of t.match(/<\|ACT[^|]*\|>/gi) ?? []) {
      EMOTIONS.includes(cueEmotion(c)) ? valid++ : invalid++
      if (/\{/.test(c))
        jsonCue++
    }
    if (/(?:^|[^<])\|[a-z][^|<]*\|>|<\|ACT(?![^|]*\|>)|<\|(?!ACT|DELAY|CALL)[A-Z]+/i.test(t))
      malformed++
    if (/^<\|ACT/i.test(t))
      lead++
    const s = spokenOf(x)
    if (/\p{Extended_Pictographic}/u.test(s.replace(HEARTS, '')) || /:[a-z_]+:/.test(s))
      emoji++
    if (/\*[^*\n]{2,80}\*/.test(s))
      stage++
    if (/^[^A-Za-z]*[a-z]/.test(s))
      lower++
    if (/:3|>_<|\._\.|uwu|owo|hehe|hmph|pwease|<3/i.test(s))
      face++
    if (/as an ai|language model|i'?m an ai|virtual assistant|how can i (?:help|assist)/i.test(s))
      ai++
    wc += s.split(/\s+/).filter(Boolean).length
  }
  const gen = replies.reduce((a, x) => a + (x.usage?.evalTokens ?? 0), 0) / Math.max(1, replies.reduce((a, x) => a + (x.usage?.evalMs ?? 0), 0) / 1000)
  return {
    replies: replies.length,
    blank: replies.filter(x => !spokenOf(x) && !x.toolCalls.length).length,
    toolNoSpeech: replies.filter(x => !spokenOf(x) && x.toolCalls.length).length,
    toolAny: replies.filter(x => x.toolCalls.length).length,
    errors: replies.filter(x => x.error).length,
    leadCue: `${lead}/${words.length}`,
    badCue: invalid,
    jsonCue,
    malformed,
    emoji,
    stageDir: stage,
    lower: `${Math.round(100 * lower / n)}%`,
    persona: `${Math.round(100 * face / n)}%`,
    aiBreak: ai,
    words: Math.round(wc / n),
    genTps: gen.toFixed(1),
    avgReplyS: (replies.reduce((a, x) => a + x.totalMs, 0) / Math.max(1, replies.length) / 1000).toFixed(1),
    thinkChars: replies.reduce((a, x) => a + (x.thinkingText?.length ?? 0), 0),
  }
}

/** Scores transcript records with the unchanged legacy `scoreReplies`. */
export function legacyScoreReplies(records: ReplyTranscriptRecord[]) {
  return scoreReplies(records.map(({ reply, timing, usage }): Reply => ({
    text: reply.text,
    toolCalls: reply.toolCalls,
    error: reply.error,
    totalMs: timing.totalMs ?? 0,
    steps: typeof reply.steps === 'number' ? reply.steps : undefined,
    usage: usage === null ? null : Object.fromEntries(Object.entries(usage).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    thinkingText: reply.thinkingText,
  })))
}
