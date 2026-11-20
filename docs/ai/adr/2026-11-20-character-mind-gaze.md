# Character mind gaze: the mind decides cursor notice and the attend window

Date: 2026-11-20
Status: accepted. Slice CM6a of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-gaze`, stacked on CM4b (#58). It builds on the [character mind ADR](2026-11-17-character-mind-direction.md) (decisions 2 and 5), the [character mind core ADR](2026-11-18-character-mind-core.md) (D15: realisation details stay in the performers), the [character mind idle ADR](2026-11-20-character-mind-idle.md) (the report-and-order pattern), the [Live2D cursor attention ADR](2026-10-24-live2d-cursor-attention.md), and the [fullscreen stage and locomotion ADR](2026-10-31-fullscreen-stage-and-locomotion.md). The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D1 to D22 name the forks in the slice's plan, `.omo/plans/character-mind-gaze.md`. D13 was flipped during implementation, and D16 is open. Current rules: [Autonomous behavior](../context/autonomous-behavior.md) and [Body ownership](../context/body-ownership.md).

## Context

Natural decided cursor notice on its own seeded stream, and the MMD body director decided the chase from the same pointer, separately (overlap 8). Autonomous behavior Target rules 4 and 5 ask for the mind to decide the episode and for renderer deciders to act on its intents. A separate bug made presses aimed at her miss: during a pointer rest she kept walking toward the pointer's earlier rest point for the 3 s goal dwell, then settled one leg from it, and a visit walked her 1.5 legs past a pointer resting on her.

## Decision

### Scope

1. **CM6 is split into CM6a and CM6b (D1).** CM6a moves cursor notice and the chase window into the mind and fixes the press miss. CM6b moves the glances through one gaze arbiter and the director's remaining raw inputs onto intents. The halves share no state, and each leaves one decider for what it moves.
2. **The closing titles stay as fixed (D2).** "Close CM6" closes the CM6a row it creates. This file keeps its name; CM6b writes its own ADR.

### Cursor notice

3. **The episode draw stays in `motion-driver-natural` (D3)**, as the pure rule `drawCursorEpisode` in `cursor-notice.ts`, which `character-mind` imports by subpath. This follows the idle ADR's D2.
4. **The mind draws the whole episode (D4):** engaging, span, dwell, and cooldown, in that order, in one call.
5. **Natural detects each opportunity (D5)**: the band in head widths and the rest and move detection need the head geometry and the 120 Hz grid.
6. **The order is queued to the next frame (D6)**, about 17 ms against a 250 to 500 ms dwell.
7. **Natural holds the awaiting opportunity and drops stale orders (D7).** The mind keeps no cursor state but its stream, so a stale order costs only its draw.
8. **The mind draws on its own Mulberry32 stream (D8)**, seeded by one draw of the step's source at the first `cursor` stimulus, so cursor opportunities do not shift voice or touch draws.
9. **Permission stays in Natural (D9):** the Live2D setting, `aside`, and `screen`.
10. **An order goes to the stage that reported (D10).** Cursor geometry is per stage; one stream keeps the draws once per character.

### The attend window

11. **Today's interactions open the window (D11):** a poke, a pet start, a drag release, and a sent chat message. A noticed cursor episode does not.
12. **The intent carries a span (D12)**, `ATTEND_WINDOW_MS` (60 s), which the MMD scene stamps on the director's clock as `attendUntilMs`.
13. **The conductor dispatches `attend` only under Natural (D13, flipped).** The plan chose every driver, to keep the chase under MMD's classic driver. The rendered check found that under classic the director decided a chase but she never walked: the MMD body's input is enabled only under Natural, at the base too, so the classic chase was never visible. Dispatching only under Natural follows Body ownership Target rule 1 and changes nothing a user sees. The touch dispatch already ran only under Natural. The plan's item 4 was amended before any push.
14. **The director reads the cursor's position from its world (D14)**, only to aim a walk that an attend window or a visit asked for, never to start one.

### The press rule

15. **A walk aimed at the cursor ends at once within its stop distance (D15).** A chase (`approach-cursor`) or visit goal ends over `GOAL_MIN_DWELL_MS` while the cursor is on the stage within `CHASE_STOP_LEGS` (1) or `VISIT_STOP_LEGS` (1.5) legs of her root; a visit ended this way lingers as on arrival.
16. **The braking distance is unchanged (D16).** This is the open owner question; see Consequences.
17. **A visit due with the cursor resting on her arrives in place (D17):** no walk, the wander accepted, and the linger drawn. In idle mode the `VISIT_SHARE` draw still comes first.

### Evidence, order, and what stays

18. **The press fix is proved by a Node closed loop and a rendered check (D18).** No new headless scenario or cue.
19. **The press fix lands before the switch (D19)**, so its headless diffs stay `IDENTICAL`.
20. **`interactionSeq` and `chatSendSeq` stay in the director for clip endings (D20)** until CM6b.
21. **`BodyIntent.attention` stays diagnostics-only (D21).** CM6b decides it with the gaze arbiter.
22. **The QA bridge emits `mind` events for `cursor` and `interaction` steps (D22).**

### What this supersedes

This ADR supersedes the Live2D cursor attention ADR's statement that the cursor-attention layer draws the episode on a separate seeded stream of Natural's: the mind draws it. It also supersedes the fullscreen stage and locomotion ADR's statement that the director owns the chase window (`CHASE_WINDOW_MS` after a poke, pet, drag, or sent message): the mind's `attend` intent opens it, and the director only reads `attendUntilMs`. Neither ADR's body is edited.

## Consequences

- Every cursor episode in the headless `gaze-shift` traces is drawn on the mind's stream and starts one frame later. `qa:motion3d diff` reads `DIFFERENT` for `gaze-shift` and `IDENTICAL` for the other eight scenarios. The `mmd-motion-quality` gate and the `gaze-order` report read the same statuses at both ends, with 27 head-turn episodes at each end.
- The odds are unchanged. In the rendered Live2D check, medium moves engaged 8 of 18 times and far moves 1 of 7.
- Under MMD's classic driver she does not chase, as before: the body never walked there.
- With two stages mounted, a chat send gives one `interaction` step per stage. The same window reopens, so this is harmless.
- **The press clause of the CM6 Done-when is not met.** In the rendered press check at the tip, on the desktop stage under Natural, the press rule ended the goal 172 to 175 ms after the pointer landed on her. She then braked for about 2.2 s and slid 0.53 to 0.60 legs. Both presses at a rest of 1.0 s missed; in one she came to rest 0.47 legs from the pointer. The headless closed loop had predicted 0.33 to 0.41 legs at rest. The check stopped at the first miss, as the plan says, so the base was not run and there is no full table. Without the press rule, the old code settles 6 to 8.5 s after the pointer lands, one leg away, after travelling up to 3.4 legs.

## Alternatives considered

- **One PR for all of CM6.** It would carry CM4b's highest-risk shape twice. Rejected (D1).
- **Move the draw into `character-mind`.** It splits the constants from the tracking constants they sit beside. Rejected (D3).
- **Draw only `engaging` in the mind.** It breaks the draw order, so the extraction could not prove itself `IDENTICAL`. Rejected (D4).
- **Detect opportunities in the mind from the raw cursor.** Rejected (D5).
- **Answer synchronously inside the grid step.** Rejected (D6).
- **Draw on the step's shared source.** Rejected (D8).
- **Open the window on a noticed cursor episode.** She would chase less often, a user-visible change. Rejected for now (D11).
- **Send `attend` under every driver.** The classic director would decide chases the body never walks, against Body ownership Target rule 1. Rejected after the rendered check (D13).
- **A shorter dwell for cursor goals, re-aiming on every move, or rest detection in the director.** They still walk, settle one leg away, or add a raw input. Rejected (D15).
- **A world-anchored pointer scenario in `qa:motion3d`.** Evidence tooling outside this slice. Rejected (D18).

## Not decided

- **Braking (D16).** After the press rule ends the goal, the gait brakes for about 2.2 s and slides about 0.5 to 0.6 legs, so presses after a 1 s rest still miss. The fix is either a shorter braking distance in the gait or a stop that anticipates the slide. Both are owner rulings, not taken here.
- Whether a walk toward the user implies that she notices the cursor (D11).
- Visits under a resting pointer: she now stays and lingers (D17).
- The split and the closing titles (D1, D2).
- An MMD Cursor attention setting, which belongs to CM7's character-behavior settings document.
