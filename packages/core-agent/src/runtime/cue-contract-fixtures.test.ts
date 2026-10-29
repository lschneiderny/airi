import { createStreamingControlParser } from '@proj-airi/pipelines-audio'
import { describe, expect, it } from 'vitest'

import { cueComplianceOutcome } from './cue-compliance'
import { cueContractFixtures } from './cue-contract-fixtures'
import { ChunkInvariantError, replayReply, replayReplyAtEveryChunking } from './reply-replay'

describe('cue contract fixtures', () => {
  it.each(cueContractFixtures)('$id: $text', async (fixture) => {
    if (fixture.expect.chunkInvariant === false)
      await expect(replayReplyAtEveryChunking(fixture.text)).rejects.toBeInstanceOf(ChunkInvariantError)
    const replay = fixture.expect.chunkInvariant === false
      ? await replayReply({ text: fixture.text, thinkingText: fixture.thinkingText, chunks: 'whole' })
      : await replayReplyAtEveryChunking(fixture.text)
    const controller = createStreamingControlParser()
    let stageRejected = 0
    const unknownMarkers: string[] = []
    const parsedActs = new Set<string>()
    for (const special of replay.specials) {
      await controller.dispatchWith(special.value, {
        observer: (event) => {
          if (event.type === 'rejected') {
            stageRejected++
            if (event.reason === 'no-matching-parser')
              unknownMarkers.push(special.value)
          }
          if (event.type === 'parsed' && event.parserName === 'ACT')
            parsedActs.add(special.value)
        },
      })
    }
    const first = replay.events.find(event => event.kind === 'special' || event.value.trim() !== '')
    expect({
      act: replay.cueStats.act,
      recovered: replay.cueStats.recovered,
      stripped: replay.cueStats.rejected,
      stageRejected,
      outcome: cueComplianceOutcome({
        act: replay.cueStats.act,
        recovered: replay.cueStats.recovered,
        stripped: replay.cueStats.rejected,
        rejected: stageRejected,
      }),
      leadCue: first?.kind === 'special' && parsedActs.has(first.value),
    }).toEqual({
      act: fixture.expect.act,
      recovered: fixture.expect.recovered,
      stripped: fixture.expect.stripped,
      stageRejected: fixture.expect.stageRejected,
      outcome: fixture.expect.outcome,
      leadCue: fixture.expect.leadCue,
    })
    expect(unknownMarkers).toEqual(fixture.expect.unknownMarkers ?? [])
    expect(replay.literals).toEqual(replay.events.filter(event => event.kind === 'literal').map(event => event.value))
    expect(replay.specials).toEqual(replay.events.filter(event => event.kind === 'special').map(({ value, raw }) => ({ value, ...(raw === undefined ? {} : { raw }) })))
    if (fixture.expect.spoken !== undefined)
      expect(replay.literals.join('')).toBe(fixture.expect.spoken)
    if (fixture.expect.residualChars !== undefined) {
      expect(replay.fullText.length - replay.literals.join('').length - replay.specials.reduce((sum, special) => sum + special.value.length, 0))
        .toBe(fixture.expect.residualChars)
    }
    if (fixture.id === 7)
      expect(replay.specials.some(special => special.value.includes('STICKER'))).toBe(false)
  })
})
