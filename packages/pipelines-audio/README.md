# @proj-airi/pipelines-audio

Shared audio-pipeline orchestration for AIRI. The package owns input sharing, capture intervals, detector windows, playback groups, and text chunking. It does not depend on a UI.

## Use it for

- Sharing one audio source between recording, transcription, and detectors.
- Building and scheduling speech playback pipelines.
- Parsing streaming-control events.

## Do not use it for

- Vue or Electron lifecycle state.
- Provider credentials and product-specific error UI.
- Browser sources and file encoding, which belong in `@proj-airi/audio`.

## Input, capture, and observation

`AudioInput` shares one `LiveAudioSource`, for example a microphone. The first subscriber opens the source, and the last one to leave closes it.
A live source cannot wait for its readers. A file is an `AudioSource` but not a live source. Each consumer of a file opens its own stream, and that stream keeps native backpressure.
Each subscription, capture, and observer ends with its own abort signal. There is no lease to release.

```ts
const input = new AudioInput(source, { historyMs: 360 })

// capture() subscribes immediately. Its stream is continuous PCM for one interval.
const recording = capture(input, { signal })
const output = transcriber.transcribe({ audio: recording.stream, signal })

// The release control calls recording.finish(). Provider output continues until it completes.
for await (const event of output)
  showTranscript(event)
```

- `subscribe({ from, signal, maxBufferedMs })` returns blocks from now, or first replays retained history from `from`.
- `capture(input, { from, signal, maxBufferedMs })` adds `started`, `finish()`, `cancel(reason)`, and a gap check.
- `retain(signal)` returns a lease. Its holder calls `hold(position)` to keep history from that position.
- `observe(input, options, detector, onResult)` runs a detector over windows with `ordered` or `latest` scheduling.
- `audioWindows(shape)` is the windowing transform alone, for callers that schedule their own work.
- `createScope(signal)` owns one lifetime: an abort signal, reverse-order cleanups, and child scopes.

Observers support sliding windows and growing windows.
`preRollMs` keeps the history that pending detector windows need, including time spent in inference.
A sample gap restarts window growth. Frame coordinates never cross source connections.
A live source cannot wait for a slow reader. Each subscription, capture, and `ordered` observer has a `maxBufferedMs` limit, 60 seconds by default.
When a reader falls behind that limit, only that reader fails. The source and the other readers continue.
There are no mandatory detector deadlines. Plugins own their models, retained results, and disposal.

Captures and observers settle with `Outcome`: `finished` with a value, `cancelled` with a reason, or `failed` with an error.
A finished capture reports its interval. An observer finishes when the source ends and its last window is processed.

## Playback ownership

`Playback.openGroup()` creates an independent queue. Groups can play concurrently.
`finish()` drains one group. `stop({ fadeMs })` closes admission, discards queued clips, and waits for actual silence.
A cancelled clip does not cancel other clips in its group.

The driver owns the audio clock. `playback.nowMs()` reads it.
A clip can set `startAtMs` on that clock. The group still starts clips in order.
Each receipt entry reports `throughMs` and the rendered `interval` on the same clock.
A caller can start the next output relative to that interval, for example 2 seconds after a clip ends.
A group does not mix clips or schedule lanes against each other.
Playback knows no chat session, turn, or agent notification contract.
`Response` in core-agent supplies those conversation boundaries and producer ordering.

## Speech pipeline markers

`createSpeechPipeline` emits special markers (`onSpecial`) in playback order, not in synthesis order.
A marker that follows text fires after that text's clip ends.
When that text produces no audio (synthesis failed, returned nothing, or speech is muted), the marker fires as soon as its synthesis settles.
Every marker fires before the next clip starts. Markers before any text fire before the first clip, and consecutive markers keep their order.
With no audio at all, markers fire in arrival order. A cancelled or interrupted intent drops its pending markers.

A well-formed BREAK marker and a valid DELAY marker also pause the ordered speech track: after either fires, the next clip or marker waits `seconds` on the pipeline `clock` (default: the wall clock).
A BREAK pauses for its clamped duration. A DELAY pauses for the duration it names, with no upper limit.
The pause belongs to the pipeline, so it holds even when the `onSpecial` listener returns at once. Cancelling the intent ends a pause immediately.
Other markers, a malformed BREAK or DELAY included, do not pause the speech track.

The default segmenter is the TTS chunker with `stripAsciiFaces`, in every conversation register.
A TTS request carries the text without faces. Its playback item carries the segment's `displayText`, so captions keep the faces.

## Streaming-control cues and text chunking

`createStreamingControlParser` loads the ACT, DELAY, BREAK, and CALL parsers by default.

- An ACT JSON payload may carry `gesture`: `"nod"`, `"shake"`, `"shrug"`, `"lean"`, or `"glance"`, or `{ "kind": "nod", "count": 2 }`. `normalizeActPayload` drops unknown kinds. `count` is 1-3 for `nod` and `shake` (default 2) and 1 for the other kinds. A gesture-only ACT is valid. It may also carry `action`, a label the consumer resolves later: `normalizeActPayload` trims and lowercases it and keeps it only when it matches `/^[a-z0-9][a-z0-9-]{0,31}$/`, otherwise it omits the field. The parser never resolves or evaluates it. There is no bare or colon action form. The bare form, such as `<|ACT nod|>`, accepts emotions only.
- `<|BREAK|>` pauses for 1.0 s and `<|BREAK n|>` for `n` seconds, clamped to 0.3-3.0. Any other body is rejected as parse-failed and produces no signal.

The TTS chunker ends a segment at every special. At a BREAK or a valid DELAY, it also ends a segment whose text is held at soft punctuation, so text written before the pause is never spoken after it.
With `stripAsciiFaces`, the chunker removes the faces in `ASCII_FACES` from `@proj-airi/stage-shared/conversation-register` from each assembled segment. It keeps a face with punctuation, such as `:3`, in one segment even when the face arrives split across deltas, and it skips a segment that becomes empty.

## Checks

Run `pnpm -F @proj-airi/pipelines-audio typecheck` and `pnpm -F @proj-airi/pipelines-audio test:run`.
Public tests cover capture independence, delayed history use, source gaps, file finalization, cancellation, and playback receipts.
