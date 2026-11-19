# Character mind return: one detector and one response for the user's return

Date: 2026-11-19
Status: accepted. Slice CM2 of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-return`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md) and the [character mind core ADR](2026-11-18-character-mind-core.md). The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto.

## Context

One return reached four deciders, each with its own detector, state, and clock (overlap 6 of [Autonomous behavior](../context/autonomous-behavior.md)):

- **Two detectors.** The performance resolver in `Stage.vue` and the leader's situation sensor each detected the return and the desktop wake, with different rules for stale samples.
- **Separate responses.** The resolver decided a desktop reaction through `reactSeq`, an away watcher in `Stage.vue` marked the `welcome-back` moment, Natural ended its sleep when `away` turned false, and the urge gate opened the welcome-back window from the situation's presence.
- **A defect in the ritual.** The gate took `presence.sinceMs` as the end of the absence. A flip between `here` and `idle` moves that time, so a short pause at noon after an overnight absence opened the welcome-back window at noon.

The presence ruling of Autonomous behavior also applies: an unknown presence reading counts as idle, and no substitute signal stands in for a missing sensor.

## Decision

### What a return is

1. **A return is the resolver's `away` edge.** It is the end of an away span: `away` turns false after it was true. A `null` snapshot or a `null` idle time never makes `away` true.
2. **A desktop wake is a newer unlock or resume time.** It counts only when it is newer than the last one seen after the baseline sample. When both times are new in one call, the newer one names the cause. A wake and a return in one resolver call are one stimulus and get one response. A wake while the user is still away does not end the span.

### The detector and the mind

3. **The resolver is the one detector, and it decides nothing.** `resolvePerformanceState` in `stage-shared` returns its edges as `PerformanceEvent`s: `presence`, with `away` and an optional `wake`, and `screen-change`. `PerformanceState` lost `reactSeq` and `reactKind`. The situation sensor no longer reports wakes; it keeps presence for holds, greetings, and `went-away`.
4. **The mind answers the events with one `step` call.** `Stage.vue` hands each resolution's events to `conductor.desktop`, which sends them to the mind as one step and dispatches the intents.
5. **The stimuli, intents, and fast state as built.** The new stimuli are `presence` and `screen-change`. The new intents are `wake` and `desktop-reaction` on the posture channel; the `welcome-back` value of `moment` on the face channel; and `observe-wake`, with the field `wakeCause`, and `observe-return` on the voice channel. `MindState` gains `presence` (the open away span) and `desktop.screenReactAtMs`. All intents of one response share one `cause`, in the order posture, face, voice, with `observe-wake` before `observe-return`.
6. **The screen-change refractory and the rule that a wake wins moved into the mind unchanged.** A screen change reacts unless a reaction was stamped less than 10 s ago or a presence stimulus with a wake is in the same step. A desktop wake does not stamp the refractory.
7. **The mind sends an idempotent `wake` instead of learning that she sleeps.** Natural ends a sleep on the `wake` intent and ignores it otherwise, so the mind sends it on every return without a `desktop-reaction` `wake`. Natural keeps the sleep draw until CM4, and no sleep report becomes a stimulus.
8. **Stimuli reach the mind under every driver; posture is performed only under Natural.** The conductor drops posture intents under Universal, MAGIC, and classic. The face moment is inert outside Natural. The voice intents reach the gate under every driver, so the `mind` QA event appears under every driver.

### The voice side

9. **The gate keeps the welcome-back ritual and learns of a return only from the mind.** The renamed port's `observeReturn` records a `ReturnObservation` or a `WakeObservation` in the situation. The ritual is one hazard term inside the gate's one integrated urge, compared against one `Exp(1)` threshold, with one category pick among every eligible reason, and its once-a-day state lives in the ritual day that the gate saves. Moving only the ritual into the mind would split the voice channel into two clocks and two draws (overlap 3, which CM3 closes), would need the mind to save state or read the ritual day (CM4 owns persistence), and would change the timing from a 20 min hazard window to a line at the moment of return.
10. **An idle time that turns unknown during an away span ends the span.** This follows from the presence ruling: unknown counts as idle.
11. **The end of an absence for the ritual is `tracking.lastReturnAtMs`.** The reducer's `return` case sets it with `tracking.lastAwayMs`, and `ritualFacts` reads both. A flip between `here` and `idle` no longer moves the end of the absence, which fixes the noon welcome-back after an overnight absence.
12. **A wake with no open span is reported with `awayMs: null`.** The reducer keeps the event, as it kept a wake whose span it could not measure before.
13. **`TouchVoicePort` is renamed `VoicePort`.** It no longer serves only touch.

### QA

14. **Lock QA runs through a fake ScreenSaver.** `packages/qa-tools/scripts/linux/fake-screensaver.py` owns `org.freedesktop.ScreenSaver` on the private session bus of a QA display, so a rendered check exercises the main process's real lock path. The `mind` QA event gained `away` and `wake`, and a new `idle` event records the performer's idle reports.

## Consequences

- The gate's return depends on a mounted `Stage.vue`. A remount during an absence starts a new mind whose span begins at the remount, which shortens `awayMs` and can miss the 3 h welcome-back rule. This stays until CM4 moves the mind to the leader, one per character.
- A capability dropout of `systemIdleTime` during an absence ends the span, so the gate may see a return that the old situation, which kept the span open across `unknown`, did not (decision 10).
- The welcome-back window no longer opens after a short pause hours after an overnight return (decision 11).
- A requested wake also resets Natural's `awaySince`, so she does not fall straight back asleep when the wake reaches Natural before the performance update that clears `away`.
- `reactSeq`, `reactKind`, `PerformanceReactKind`, the away watcher in `Stage.vue`, and the sensor's wake reports are gone. Overlap 6 of Autonomous behavior is closed.

## Alternatives considered

- **The mind decides a welcome-back line now, as it does for touch.** It splits the voice channel's clock and needs persistence (decision 9). Rejected until CM3.
- **The situation sensor as the one detector.** The body and face responses must start on the stage's own frame clock, and the stage already owns the edge. Rejected.
- **Keep the screen-change refractory and the wake-wins rule in the resolver.** Whether to react is a decision, and the resolver keeps only detection. Rejected.
- **Feed Natural's sleep reports to the mind as stimuli.** Sleep stays in the performer until CM4, and such a stimulus would be deleted then. Rejected.
- **Send no return stimuli under Universal, MAGIC, and classic.** The gate's `returned` reason and welcome-back ritual must keep working under every driver, and they now come from the mind. Rejected.
- **Keep the span open with a third presence value when idle time turns unknown.** It contradicts the presence ruling. Rejected.
- **Keep `presence.sinceMs` as the end of an absence.** It keeps the noon welcome-back defect. Rejected.
- **Drop a desktop wake with no span seen.** It changes today's reducer, which keeps such a wake. Rejected.
- **Keep `TouchVoicePort` and add a method.** The name would be wrong. Rejected.
- **Write a locked snapshot with `airi_eval` for lock QA.** It skips the main-process lock path. Rejected.

## Not decided

- The gate's urge memory and ritual day join the mind's voice state, and the voice intents become inputs of the mind's own voice policy: CM3.
- The idle draw and sleep move into the mind, the slow `return` joins the mind's state, and one mind per character removes the remount risk: CM4.
- The glances of desktop reactions become gaze intents, and the MMD director acts on intents instead of reading `away`: CM6.
- No posture intents for Universal, MAGIC, and classic, through capabilities: CM7.
