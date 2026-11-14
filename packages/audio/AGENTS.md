# Audio Adapters

## CONVENTIONS
- Pipelines-audio owns capture intervals, observation windows, and playback groups.
- Share live sources through `AudioInput`. File consumers open independent decode streams.
- Start microphone acquisition in the click handler before the first await.
- Microphone sources own their tracks and context.
- Borrowed streams keep track and context ownership with the caller.
- Playback receipts follow the audio clock and source completion.
- Caller-owned audio contexts close only after their consumers finish.
- Worklet loading uses Vite `?worker&url` and one registration per AudioContext.

## ANTI-PATTERNS
- Do not add character routing, chat persistence, agent notifications, or Vue state.
- Keep VAD policy, wake-word matching, memory search, and transcript rewriting outside this package.
- Borrowed-stream cleanup must not stop caller tracks.
- A late microphone permission result must release tracks when no subscriber remains.
- Do not replace playback completion with UI timers.
- Preserve cancellation cleanup for readers, converters, graph nodes, and worklet ports.

## CHECKS
- `pnpm -F @proj-airi/audio test:run`
- Node tests cover encoding. Chromium tests cover browser resource ownership.
