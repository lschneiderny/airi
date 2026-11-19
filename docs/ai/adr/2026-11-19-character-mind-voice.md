# Character mind voice: the urge gate becomes the mind's voice policy

Date: 2026-11-19
Status: accepted. Slice CM3a of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-voice`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md), the [character mind core ADR](2026-11-18-character-mind-core.md), and the [character mind return ADR](2026-11-19-character-mind-return.md). The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D1 to D13 name the forks in the slice's plan, `.omo/plans/character-mind-voice.md`.

## Context

Three deciders made her speak unasked, each with its own clock, random source, and wait:

- **The urge gate.** A loop in the situation store ticked every 2 s on `Date.now`, drew from a Mulberry32 checkpoint (`rngState`) saved with the gate's social memory, and started each reach-out itself (`fire`).
- **The touch-line policy.** Since CM1 the mind decided spoken touch reactions on its own clock and seeded source, and the store sent them (`speakReaction`).
- **The widget path.** A widget or plugin turn waited for a quiet moment on its own timers and forced a turn that bypassed the gate (overlap 10 of [Autonomous behavior](../context/autonomous-behavior.md)).

The reach-out and Natural's idle draw also ran on separate clocks (overlap 3).

## Decision

### The voice policy

1. **The urge gate is the mind's voice policy.** It lives in `packages/character-mind/src/voice.ts` and runs inside `step` on the mind's clock. The gate's pure rules stay in `packages/stage-shared/src/situation`, and the policy composes them, as CM1 composed the touch-line policy.
2. **The gate draws from the mind's source.** `rngState` left the gate memory and the saved slice. An ordinary fire draws five values, a hold draws none, and a `no-topic` hold draws five, because the gate draws before it picks a topic. A fire that chat refuses restores the gate memory before the fire, but its draws stay spent, because the shell's source cannot rewind (D5).
3. **A reach-out and a touch line share one open line.** The mind holds at most one line on its way, as chat runs one unprompted turn at a time. The gate skips its tick while a line is open or while an unprompted turn that the mind did not start is pending.
4. **`turnId` replaces `eventId`** on the `speak` intent and the `voice-outcome` stimulus. The chat message id stays a fresh `nanoid`.
5. **The welcome-back ritual is read from the view's situation** (D4). The gate in the mind reads `tracking.lastReturnAtMs` from the view that the store builds each tick, so one source holds across a remount.

### Who drives it

6. **The store ticks the connected mind** (D2). The 2 s timer and its lifecycle stay in the situation store, because leadership and the host capability live there. The store sends ticks to the mind of the connected stage, and the newest connection wins.
7. **The `VoicePort` methods are `speak`, `publishVoice`, and `connect`.** `speak` starts a line's turn and resolves with its outcome. `publishVoice` mirrors, saves, and publishes the voice state after a step. `connect` hands the port a stage's way to send a voice stimulus and returns a disconnect.
8. **Run ids and the mirror carry a run's urge and hourly cap across a remount.** The store bumps the run id at each promotion and at "Delete all data". A mind that sees a new run id restores the gate memory from the store's mirror, else from the saved slice, else from promotion alone. The mind persists nothing, and the store saves the mirror (D7).
9. **The policy runs under every driver.** The `mind` QA event appears under every driver.

### Persistence

10. **A saved `gate` field that still has `rngState` resets once** (D6). It fails the strict schema, falls back to null on its own, and the threads survive. No compatibility guard keeps the old field.

### Scope

11. **`stage-shared` is neither renamed nor split** (D3, audit R5). Moving the gate's rules would move the whole `situation` folder and its tests without a behavior change, and their only new consumer, the mind, already depends on `stage-shared`.
12. **The CM3 row is split into CM3a and CM3b** (D1). CM3a moves the gate with no intended behavior change. CM3b changes behavior: widget and plugin turns, the cues, and the chat boundary.
13. **Overlap 3 is narrowed, not closed** (D13). The voice decisions share the mind's clock and source, but Natural's idle draw keeps its own clock until CM4 moves it.

### QA

14. **QA sees voice decisions.** The `mind` QA event carries the voice fields `gate` (the fire or hold reason) and `category`. The bridge verb `voiceEvaluate` runs "Evaluate now" from QA, and the replay fixture `packages/qa-tools/fixtures/llm/voice.json` scripts one spoken reply, one `<|SILENT|>` reply, and spare entries.

## Consequences

- The gate runs only while a stage is mounted in the leader. Before desktop-stage calibration, after a failed host state read, or during a remount, no mind is connected and ticks are dropped. This stays until CM4 moves the mind to the leader, one per character.
- A new mind is ticked at once on connect, and a user turn held while no mind was connected follows that tick.
- A declined `<|SILENT|>` turn still plays the `about-to-speak` and `let-go` cues under Natural, as before, because the `Stage.vue` hooks stay until CM3b.
- A refused fire's draws stay spent, so only an exact replay of an old seed changes.
- The saved `gate` field resets once after the upgrade: a ritual may run twice that day, and unanswered damping is forgotten once.

## Alternatives considered

- **Land CM3 as one PR of eleven commits.** Reviews and rendered checks would grow, and a behavior-neutral refactor would share a PR with behavior changes. Rejected.
- **The conductor runs its own timer.** Leadership and the host capability live in the store, and "Evaluate now" reaches the store first. Rejected.
- **Rename or split `stage-shared`.** Decision 11. Rejected.
- **The mind reads its own presence state for the welcome-back ritual.** The state resets with a remount, and the situation still needs the return for the `returned` event and topics. Rejected.
- **Rewind the source after a refused fire.** The shell's source cannot rewind. Rejected.
- **A `NOTICE` fallback that drops `rngState` for one release.** The repository forbids compatibility guards, and the loss is one day's social memory. Rejected.
- **The mind saves its voice state.** The core ADR keeps the mind free of persistence, and CM4 owns slow state. Rejected.
- **Close overlap 3 in CM3 by moving the idle draw.** The idle draw is CM4's row. Rejected.
- **One ADR for both parts.** Each PR carries its own record. Rejected.

## Not decided

- Widget and plugin turns through the voice policy, the `about-to-speak` and `let-go` cues as mind intents, the boundary between the mind and chat (audit R11), and LLM prompt Target rule 6: CM3b.
- The idle draw moves into the mind and one mind per character in the leader removes the connection gaps: CM4.
- Overlap 12: whether a notice turn counts as the owner's own turn or as unasked speech is an open question for the owner. Notices stay outside the mind.
