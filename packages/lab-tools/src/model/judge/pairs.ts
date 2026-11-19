import type { ReplyTranscriptRecord } from '@proj-airi/qa-tools/model/transcript/schema'
import type { Random } from '@proj-airi/stage-shared/perf/usage'

import { createHash } from 'node:crypto'

import * as v from 'valibot'

import { contenderOf, SEED_TOKEN } from '../contender'

/** Reason tags a judge can attach to one reply. Ids are stable: judgments store them, and reports count them. */
export const PERSONA_TAGS = [
  { id: 'in-character', label: 'In character', tone: 'good' },
  { id: 'natural', label: 'Natural', tone: 'good' },
  { id: 'warm', label: 'Warm', tone: 'good' },
  { id: 'playful', label: 'Playful', tone: 'good' },
  { id: 'fits-moment', label: 'Fits the moment', tone: 'good' },
  { id: 'generic-assistant', label: 'Generic assistant', tone: 'bad' },
  { id: 'out-of-character', label: 'Out of character', tone: 'bad' },
  { id: 'rambling', label: 'Rambling', tone: 'bad' },
  { id: 'flat', label: 'Flat', tone: 'bad' },
  { id: 'awkward', label: 'Awkward wording', tone: 'bad' },
  { id: 'wrong-mood', label: 'Wrong mood', tone: 'bad' },
  { id: 'repetitive', label: 'Repetitive', tone: 'bad' },
] as const

export const PERSONA_TAG_IDS = PERSONA_TAGS.map(tag => tag.id)

/** Verdicts from the left reply's point of view. `-much` marks a clear preference, not just a slight one. */
export const VERDICTS = ['left-much', 'left', 'tie', 'right', 'right-much'] as const
export type Verdict = typeof VERDICTS[number]

const SideSchema = v.strictObject({
  replyId: v.string(),
  runKey: v.string(),
  contender: v.string(),
  tags: v.array(v.picklist(PERSONA_TAG_IDS)),
})

export const PersonaJudgmentSchema = v.strictObject({
  schema: v.literal('airi.persona-judgment/v1'),
  judgmentId: v.string(),
  sessionId: v.string(),
  judge: v.string(),
  at: v.pipe(v.string(), v.isoTimestamp()),
  /** Time from showing the pair to the verdict, measured by the page. Null when the page did not report it. */
  elapsedMs: v.nullable(v.pipe(v.number(), v.minValue(0))),
  slot: v.strictObject({
    key: v.string(),
    turn: v.pipe(v.number(), v.integer()),
    user: v.string(),
    seed: v.nullable(v.string()),
    stage: v.nullable(v.string()),
  }),
  left: SideSchema,
  right: SideSchema,
  verdict: v.picklist(VERDICTS),
  note: v.string(),
})
export type PersonaJudgment = v.InferOutput<typeof PersonaJudgmentSchema>

/** One reply as the judge sees it: the spoken text from the runtime replay, never the raw model output. */
export interface JudgeReply {
  replyId: string
  runKey: string
  contender: string
  slot: PersonaJudgment['slot']
  spoken: string
  cues: string[]
  /** The same conversation's previous exchange, so a reply can be read in context. Null on the first turn. */
  previous: { user: string, spoken: string } | null
}

export interface JudgePair {
  id: string
  left: JudgeReply
  right: JudgeReply
}

/** The replay result a reply needs for judging. The command computes it with core-agent's `replayReply`. */
export interface SpokenReply {
  record: ReplyTranscriptRecord
  spoken: string
  cues: string[]
}

/**
 * The comparison slot of a reply: replies in one slot answered the same scripted user turn after the same scripted user
 * turns before it. The seed is part of the slot, so two contenders are compared on conversations seeded alike.
 */
export function slotOf(record: ReplyTranscriptRecord): PersonaJudgment['slot'] | null {
  if (record.conversation.kind !== 'turn' || record.conversation.turn === null)
    return null
  const seed = SEED_TOKEN.exec(record.generation.config)?.[1] ?? null
  const stage = record.schema === 'airi.reply-transcript/v2' ? record.live.scenario.stage : null
  const turn = record.conversation.turn
  const user = record.conversation.user
  return { key: JSON.stringify([turn, seed, stage, user]), turn, user, seed, stage }
}

/**
 * Turns replayed records into judgeable replies with their previous exchange.
 *
 * Returns:
 * - One reply per record that has a slot and no error. Probe records and failed requests are left out.
 */
export function buildJudgeReplies(replies: readonly SpokenReply[]): JudgeReply[] {
  // Index each conversation's replies by turn to find the previous exchange. A run key names one conversation.
  const byConversation = new Map<string, Map<number, SpokenReply>>()
  for (const reply of replies) {
    const turn = reply.record.conversation.turn
    if (turn === null)
      continue
    const conversation = byConversation.get(reply.record.runKey) ?? new Map<number, SpokenReply>()
    conversation.set(turn, reply)
    byConversation.set(reply.record.runKey, conversation)
  }
  const out: JudgeReply[] = []
  for (const { record, spoken, cues } of replies) {
    const slot = slotOf(record)
    if (!slot || record.reply.error)
      continue
    const before = byConversation.get(record.runKey)?.get(slot.turn - 1)
    out.push({
      replyId: record.replyId,
      runKey: record.runKey,
      contender: contenderOf(record),
      slot,
      spoken,
      cues,
      previous: before ? { user: before.record.conversation.user, spoken: before.spoken } : null,
    })
  }
  return out
}

/** The key of a judged comparison, independent of which side each reply was shown on. */
export function pairKey(slotKey: string, a: string, b: string): string {
  return JSON.stringify([slotKey, ...[a, b].sort()])
}

export interface PlanOptions {
  random: Random
  /** Pair keys already judged, from an earlier session's judgments. They are not offered again. */
  judged?: ReadonlySet<string>
  /** Keep only contenders whose name contains one of these strings. Empty or missing keeps all. */
  contenders?: readonly string[]
}

/**
 * Plans the pairs of one session.
 *
 * Every two contenders that answered the same slot form a candidate. Candidates are interleaved across contender pairs,
 * so the first verdicts already cover every matchup instead of exhausting one. Each pair's sides are shuffled, so a
 * contender is not always shown on the same side.
 */
export function planPairs(replies: readonly JudgeReply[], options: PlanOptions): JudgePair[] {
  const keep = options.contenders?.length
    ? (name: string) => options.contenders!.some(part => name.includes(part))
    : () => true
  const slots = new Map<string, Map<string, JudgeReply>>()
  for (const reply of replies) {
    if (!keep(reply.contender))
      continue
    const slot = slots.get(reply.slot.key) ?? new Map<string, JudgeReply>()
    // The first reply of a contender in a slot stands for it; a second copy of the same setup adds no comparison.
    if (!slot.has(reply.contender))
      slot.set(reply.contender, reply)
    slots.set(reply.slot.key, slot)
  }

  const groups = new Map<string, JudgePair[]>()
  for (const [slotKey, slot] of slots) {
    const entries = [...slot.values()].sort((a, b) => a.contender.localeCompare(b.contender))
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const key = pairKey(slotKey, entries[i]!.replyId, entries[j]!.replyId)
        if (options.judged?.has(key))
          continue
        // Reply ids often name the model, so the page gets an opaque digest of the key instead.
        const id = createHash('sha256').update(key).digest('hex').slice(0, 16)
        const [left, right] = options.random() < 0.5 ? [entries[i]!, entries[j]!] : [entries[j]!, entries[i]!]
        const matchup = JSON.stringify([entries[i]!.contender, entries[j]!.contender])
        const group = groups.get(matchup) ?? []
        group.push({ id, left, right })
        groups.set(matchup, group)
      }
    }
  }

  for (const group of groups.values())
    shuffle(group, options.random)
  const order = shuffle([...groups.values()], options.random)
  const plan: JudgePair[] = []
  for (let round = 0; order.some(group => group.length > round); round++) {
    for (const group of order) {
      if (group.length > round)
        plan.push(group[round]!)
    }
  }
  return plan
}

function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}
