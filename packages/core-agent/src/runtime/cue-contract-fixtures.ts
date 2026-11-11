import type { CueComplianceOutcome } from './cue-compliance'

export const CUE_CONTRACT_FIXTURES = { id: 'cue-contract-fixtures', version: 4 } as const

export const cueContractFixtures: readonly {
  id: number
  text: string
  thinkingText?: string
  expect: {
    act: number
    recovered: number
    stripped: number
    stageRejected: number
    outcome: CueComplianceOutcome
    leadCue: boolean
    chunkInvariant?: false
    spoken?: string
    residualChars?: number
    unknownMarkers?: string[]
    /** Decline markers in visible speech, recovered near-misses included. They are no ACT. Defaults to 0. */
    silentMarkers?: number
    /** Native `<|MOOD ...|>` markers; the character-state layer, not the stage controller, consumes them. Defaults to 0. */
    mood?: number
    notes: string
  }
}[] = [
  { id: 1, text: '<|ACT happy|> Hi there.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Leading bare ACT.' } },
  { id: 2, text: '<|ACT:sad 0.3|> Okay.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Colon form with numeric intensity.' } },
  { id: 3, text: '<|ACT {"emotion":"happy","intensity":"strong","motion":"nod","look":"camera"}|> Yay!', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'JSON ACT payload.' } },
  { id: 4, text: '<|ACT happy|> Hi! <|ACT curious|> What\'s that?', expect: { act: 2, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Two ACT markers.' } },
  { id: 5, text: '<|ACT think|> Hmm. <|DELAY 1|> Got it.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'ACT followed by valid DELAY.' } },
  { id: 6, text: '<|ACT happy|> Let\'s play. <|CALL ["chess.play"]|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'A valid CALL parses without a handler.' } },
  { id: 7, text: '<|ACT happy|> Look! <|STICKER cat-wave|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, spoken: ' Look! ', notes: 'Sticker markers never reach control hooks.' } },
  { id: 8, text: '<ACT happy> Hi.', expect: { act: 1, recovered: 1, stripped: 0, stageRejected: 0, outcome: 'recovered', leadCue: true, notes: 'Recovered angle-bracket ACT.' } },
  { id: 9, text: '[ACT happy] e', expect: { act: 1, recovered: 1, stripped: 0, stageRejected: 0, outcome: 'recovered', leadCue: true, notes: 'Recovered square-bracket ACT.' } },
  { id: 10, text: '<ACT banana> Hi.', expect: { act: 1, recovered: 1, stripped: 0, stageRejected: 1, outcome: 'rejected', leadCue: false, notes: 'Angle-bracket recovery accepted by runtime, rejected by stage.' } },
  { id: 11, text: '[ACT:{"emotion":"happy",}] Hi', expect: { act: 0, recovered: 0, stripped: 1, stageRejected: 0, outcome: 'rejected', leadCue: false, spoken: ' Hi', notes: 'Malformed recovered JSON is stripped before dispatch.' } },
  { id: 12, text: 'Wait [DELAY 1s] go', expect: { act: 0, recovered: 0, stripped: 1, stageRejected: 0, outcome: 'rejected', leadCue: false, spoken: 'Wait  go', notes: 'Malformed recovered duration is stripped before dispatch.' } },
  { id: 13, text: 'In [ACT 2] she leaves', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, notes: 'Screenplay prose remains spoken.' } },
  { id: 14, text: 'Be [ACT calm] now', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, notes: 'Unrecognized bracketed emotion remains prose.' } },
  { id: 15, text: '<|ACT {"emotion":"happy"|> Hi', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 1, outcome: 'rejected', leadCue: false, notes: 'Generated and confirmed: malformed native JSON fails the stage ACT parser.' } },
  { id: 16, text: '<|ACT:{"emotion":"happy"}|> Hi', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 1, outcome: 'rejected', leadCue: false, notes: 'Generated and confirmed: act.ts rejects colon JSON before decoding.' } },
  { id: 17, text: '<|ACT pouty|> Hmph.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 1, outcome: 'rejected', leadCue: false, notes: 'Invented bare emotion is rejected.' } },
  { id: 18, text: '<|ACT {"emotion":"pouting"}|> Hmph.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Unknown JSON emotion parses as an inert action.' } },
  { id: 19, text: '<|ACT happy|> Hi! <|LOOK screen|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 1, outcome: 'rejected', leadCue: true, unknownMarkers: ['<|LOOK screen|>'], notes: 'Unknown marker reaches the controller and is rejected.' } },
  { id: 20, text: 'Hi there <|ACT happy', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, residualChars: 11, notes: 'Generated and confirmed: the marker parser drops the 11-character unterminated tail from hooks.' } },
  { id: 21, text: '<|ACT happy|> Oh, hi! I missed you.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Legacy example echo is valid contract syntax.' } },
  { id: 22, text: '<|ACT {"emotion":"happy","intensity":"strong","expression":"<label>","motion":"<cue>","look":"you"}|>\noh! hi hi! <|DELAY 1|> you\'re here!', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Gemma4 placeholder echo still parses.' } },
  { id: 23, text: 'Hi! <|ACT happy|> nice.', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: false, notes: 'Spoken text precedes ACT; projections cannot establish placement.' } },
  { id: 24, text: '<{\'|\'}ACT happy{\'|\'}> Hi', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, notes: 'Generated and confirmed: escaped pipes normalize to a native marker without recovery.' } },
  { id: 25, text: '<think>[ACT happy]</think> Hi', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, chunkInvariant: false, notes: 'response-categoriser.ts:260-289 misses a closing </think> when < and / arrive in separate chunks, so per-char literals are "k> Hi" versus " Hi" whole; stored speech is "Hi" in both.' } },
  { id: 26, text: '<|ACT happy|> Hi! <|MOOD brighter: you came back|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, mood: 1, spoken: ' Hi! ', notes: 'A MOOD cue after the speech is not spoken and is not a stage rejection.' } },
  { id: 27, text: 'Hi<|MOOD brighter: you came back|>', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, mood: 1, spoken: 'Hi', notes: 'A MOOD cue alone leaves only the words spoken.' } },
  { id: 28, text: '[MOOD brighter: you came back] Hi', expect: { act: 0, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'none', leadCue: false, spoken: '[MOOD brighter: you came back] Hi', notes: 'MOOD is not a recoverable cue name, so a near-miss spelling stays prose.' } },
  { id: 29, text: '<|ACT happy|> Oh! <|MOOD happy|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, mood: 1, spoken: ' Oh! ', notes: 'A malformed MOOD body still counts as a MOOD marker; parseMoodCue decides validity.' } },
  { id: 30, text: '|<ACT happy|> Hi.', expect: { act: 1, recovered: 1, stripped: 0, stageRejected: 0, outcome: 'recovered', leadCue: true, spoken: ' Hi.', notes: 'Swapped pipe and bracket: the leading pipe belongs to the recovered marker and is not spoken.' } },
  { id: 31, text: '|<ACT happy|>\n|<ACT {"emotion":"happy","intensity":"strong"}|>\nHey, good morning!', expect: { act: 2, recovered: 2, stripped: 0, stageRejected: 0, outcome: 'recovered', leadCue: true, spoken: '\n\nHey, good morning!', notes: 'granite4 live run of 2026-11-10, shortened: a bare and a JSON cue, both swapped.' } },
  { id: 32, text: '<|ACT happy|>Hey there! Good morning to you too!|>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, spoken: 'Hey there! Good morning to you too!', residualChars: 2, notes: 'granite4 live run of 2026-11-10: a closer that ends the reply directly after its last word is dropped.' } },
  { id: 33, text: '<|ACT happy|> Write x|> f. The pipe operator is |>', expect: { act: 1, recovered: 0, stripped: 0, stageRejected: 0, outcome: 'parsed', leadCue: true, spoken: ' Write x|> f. The pipe operator is |>', notes: 'A closer before more text or after whitespace is prose and stays spoken.' } },
  { id: 34, text: '|<ACT happy strong|>\n|<SILENT|>\nThat\'s fantastic news!', expect: { act: 1, recovered: 2, stripped: 0, stageRejected: 0, outcome: 'recovered', leadCue: true, spoken: '\n\nThat\'s fantastic news!', silentMarkers: 1, notes: 'granite4 live run of 2026-11-10, shortened: a near-miss decline marker before speech is recovered and consumed, and the speech after it stays.' } },
]
