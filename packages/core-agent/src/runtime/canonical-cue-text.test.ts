import type { AssistantTurn } from '../messages/types'

import { describe, expect, it } from 'vitest'

import { canonicalCueText, canonicalizeTurnCues } from './canonical-cue-text'
import { cueContractFixtures } from './cue-contract-fixtures'
import { replayReply } from './reply-replay'

/** Mirrors the stage rules that AIRI hosts pass; core-agent cannot import them from stage-shared. */
const stage = { declineMarker: '<|SILENT|>', recoverCueNames: ['ACT', 'DELAY'] }

describe('canonicalCueText', () => {
  it.each([
    ['a bracket and an angle near-miss', '[ACT happy] Hi <ACT sad> there', '<|ACT happy|> Hi <|ACT sad|> there'],
    ['a near-miss JSON body', '<ACT {"emotion":"happy","intensity":"strong"}> Yay', '<|ACT {"emotion":"happy","intensity":"strong"}|> Yay'],
    ['a recovered DELAY', 'Wait <DELAY 1> go', 'Wait <|DELAY 1|> go'],
    ['markup the runtime strips', '[ACT:{"emotion":"happy",}] Hi', ' Hi'],
    ['a stripped cue beside a recovered one', '[ACT happy] Wait [DELAY 1s] go', '<|ACT happy|> Wait  go'],
    ['prose beside a recovered cue', '[ACT happy] In [ACT 2] she leaves', '<|ACT happy|> In [ACT 2] she leaves'],
    ['a swapped pipe and bracket', '|<ACT happy|>\n|<ACT {"emotion":"happy"}|>\nGood morning!', '<|ACT happy|>\n<|ACT {"emotion":"happy"}|>\nGood morning!'],
    ['a closer that ends the reply after its last word', '<|ACT happy|>Good morning to you too!|>\n', '<|ACT happy|>Good morning to you too!'],
    ['a recovered cue before an unfinished marker', '[ACT happy] Hi <|ACT sa', '<|ACT happy|> Hi '],
  ])('rewrites %s', async (_case, raw, canonical) => {
    expect(await canonicalCueText(raw, stage.recoverCueNames)).toBe(canonical)
    // A canonical reply is a fixed point, so the history prefix stays stable on every later request.
    expect(await canonicalCueText(canonical, stage.recoverCueNames)).toBe(canonical)
  })

  it.each([
    ['well-formed cues', '<|ACT happy|> Hi! <|DELAY 1|> Bye. <|STICKER cat-wave|>'],
    ['no cue', 'Just words, a <3 and a [note].'],
    ['prose that resembles a cue', 'In [ACT 2] she leaves. Be [ACT calm] now'],
    ['a near-miss cue inside a reasoning tag', '<think>[ACT happy]</think> Hi'],
    ['the escaped marker spelling', '<{\'|\'}ACT happy{\'|\'}> Hi'],
    ['an unfinished marker', 'Hi there <|ACT happy'],
    ['a closer after whitespace or before more text', '<|ACT happy|> Write x|> f, the pipe operator is |>'],
    ['a pipe before a tag that is no cue', 'Run sort |<b>file</b> now'],
    ['a name that is not recoverable', '[MOOD brighter: you came back] Hi'],
  ])('returns a reply with %s unchanged', async (_case, text) => {
    expect(await canonicalCueText(text, stage.recoverCueNames)).toBe(text)
  })

  it('rewrites nothing when the host recovers no cue names', async () => {
    expect(await canonicalCueText('[ACT happy] Hi', [])).toBe('[ACT happy] Hi')
  })

  // The history must say what the runtime did. Replaying the canonical text through the runtime must therefore
  // perform the same cues and speak the same words as the reply the model wrote, with nothing left to recover.
  it.each(cueContractFixtures)('agrees with the runtime on cue contract fixture $id: $text', async ({ id, text, thinkingText }) => {
    const canonical = await canonicalCueText(text, stage.recoverCueNames)
    const written = await replayReply({ text, thinkingText, stage })
    const rewritten = await replayReply({ text: canonical, thinkingText, stage })

    expect(rewritten.specials).toEqual(written.specials)
    expect(rewritten.literals.join('')).toBe(written.literals.join(''))
    expect(rewritten.cueStats).toEqual({ ...written.cueStats, recovered: 0, rejected: 0 })
    // Fixture 32 ends with a closer that the runtime drops without counting a cue.
    if (written.cueStats.recovered === 0 && written.cueStats.rejected === 0 && id !== 32)
      expect(canonical).toBe(text)
  })
})

describe('canonicalizeTurnCues', () => {
  it('rewrites the portable text and the native messages of every round, and leaves cited text as written', async () => {
    const turn: AssistantTurn = {
      type: 'assistant',
      id: 'turn',
      status: 'completed',
      rounds: [
        {
          id: 'turn/0',
          content: [{ type: 'text', text: '[ACT happy] Let me look.' }, { type: 'tool', invocationId: 'turn/0/call-1' }],
          toolInvocations: [{ id: 'turn/0/call-1', callId: 'call-1', name: 'lookup', arguments: '{"q":"[ACT happy]"}', execution: { status: 'succeeded', output: [{ type: 'text', text: '[ACT sad] from a tool' }] } }],
          projectionIssues: [],
          continuation: {
            protocol: 'chat-completions',
            scope: 'scope',
            data: [
              { role: 'assistant', content: '[ACT happy] Let me look.', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"[ACT happy]"}' } }] },
              { role: 'tool', tool_call_id: 'call-1', content: '[ACT sad] from a tool' },
            ],
          },
        },
        {
          id: 'turn/1',
          content: [{ type: 'text', text: '<ACT sad> Found it [ACT happy].', citations: [{ url: 'https://example.com/', title: 'Example', startIndex: 10, endIndex: 18 }] }],
          toolInvocations: [],
          projectionIssues: [],
          continuation: {
            protocol: 'responses',
            scope: 'scope',
            data: [
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<ACT sad> Found it.', annotations: [] }] },
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<ACT sad> Cited.', annotations: [{ type: 'url_citation', url: 'https://example.com/', title: 'Example', start_index: 10, end_index: 15 }] }] },
            ],
          },
        },
      ],
    }

    await canonicalizeTurnCues(turn, stage.recoverCueNames)

    expect(turn.rounds[0]).toMatchObject({
      content: [{ type: 'text', text: '<|ACT happy|> Let me look.' }, { type: 'tool', invocationId: 'turn/0/call-1' }],
      // Tool arguments and results are data, never the model's cue text.
      toolInvocations: [{ arguments: '{"q":"[ACT happy]"}', execution: { output: [{ type: 'text', text: '[ACT sad] from a tool' }] } }],
      continuation: {
        data: [
          { role: 'assistant', content: '<|ACT happy|> Let me look.', tool_calls: [{ function: { arguments: '{"q":"[ACT happy]"}' } }] },
          { role: 'tool', content: '[ACT sad] from a tool' },
        ],
      },
    })
    expect(turn.rounds[1]).toMatchObject({
      content: [{ type: 'text', text: '<ACT sad> Found it [ACT happy].' }],
      continuation: {
        data: [
          { content: [{ text: '<|ACT sad|> Found it.' }] },
          { content: [{ text: '<ACT sad> Cited.' }] },
        ],
      },
    })
  })
})
