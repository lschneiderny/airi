# Character mind: refractories once per character

Date: 2026-11-22
Status: accepted; CM10 implemented. Headless and rendered acceptance are pending (see the placeholder below).

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md) (Precedence rule 29, the Body director, Emotion impulse, Touch reaction, and Moment expression rows, and Target rule 1) and the [glossary](../context/glossary.md) (Refractory). The [CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the split, the decisions table, and the checks. This slice builds on every CM9 slice, above all the [settle ADR](2026-11-22-character-mind-settle.md) (the store-dispatched `settle` intent) and the [fast mood ADR](2026-11-22-character-mind-fast-mood.md) (a seed the mind hands a new performer).

## Context

Four refractories still lived in a performer or a stage, so a model reload, a driver switch, or a stage remount reset them, and two stages kept two copies:

- The body director's clip and tool refractories (`ACTION_REFRACTORY_MS`, `DANCE_REFRACTORY_MS`, `GESTURE_REPEAT_MS`, `MOVE_TOOL_REFRACTORY_MS`, `LOOK_TOOL_REFRACTORY_MS`) were fields of `BodyDirectorMemory`, which `MMDStanceDirector` builds anew for each rig.
- Natural's poke surprise dedupe (`pokeSurpriseDedupeSeconds`, `lastPokeSurprise`) lived in each `NaturalMotion` controller.
- The moment entry rest (`momentHistory`) lived in each `useIdleProps`.

Autonomous behavior Target rule 1 listed them as the last open part of "mood and refractories exist once per character". The owner answered "Build now" (D18).

## Decisions

### D18: build now

CM10 is a real slice, the last of the CM9 plan.

### D19: performer reports in, remaining durations out

- `MindState.refractory` (`packages/character-mind/src/refractory.ts`) holds every refractory as fast state on the mind's clock. A mind reset clears it; nothing is saved.
- The director stamps nothing. `decideBody` returns `reports` (`BodyDirectorReport`): each counted clip end (`clip-ended`, with the clip kind and source), each accepted gesture clip (`gesture-clip`), and each accepted tool (`tool-accepted`). The MMD scene emits them (`bodyReports`), and `Stage.vue` hands each to `StagePerformanceConductor` `performerReport`, which sends a `performer-report` stimulus.
- `reportRefractory` keeps the director's old rules: an action end arms the action refractory, a dance end the dance refractory, an accepted gesture clip its per-clip repeat window, and an accepted tool the movement or look refractory. A clip she played unasked arms nothing; that rule moved from the director to the mind. The lengths are unchanged.
- The mind answers each director report with a body `refractory` intent of the durations left (`RefractoryRemaining`). A duration, never an absolute time, crosses the boundary: `MMDRefractoryInbox` stamps it on the director clock at the scene's next frame, as `MMDAttendInbox` stamps the attend window. `decideBody` reads the stamped times from its `refractory` input (`BodyRefractory`) and refuses a request inside them exactly as it refused one by its memory.
- Option (b), the mind accepting or refusing clip and tool requests as stimuli, was rejected: it reverses glances D6, under which a model's request stays a request the director takes.

### D20: the moment entry rest lives in the mind

`useIdleProps` reads the rest from `MindState.refractory.momentRest` (option `momentRest`) and reports each entry it marked as a `moment-marked` report (option `momentMarked`). The ids are opaque to the mind. `chooseMomentEntry` keeps the rest rule (`MOMENT_SETTINGS.entryRestMs`). Option (b), keeping the rest in the mind store's shell, was rejected: it puts fast state outside the state that resets together.

### The poke surprise

`answerTouch` decides each poke's surprise with `POKE_SURPRISE_DEDUPE_MS` (2 s) on the mind's clock (`pokeSurprise`), and the poke `touch-reaction` intent carries `surprise`. `startPending` plays the surprise only when the intent says so and keeps its `pokes` counter for the episode ids.

## Deviations

- **The store dispatches the `refractory` intent.** Like `settle`, every `refractory` intent goes from `useCharacterMindStore` to every attached stage (`MindStage.refractory`), so two stages' directors share one set, and a reset hands every stage the cleared refractories. The conductor's `refractory` passes it to a scene that declares body; its `syncScene` seeds a scene that attaches or gains a body from `CharacterMind.refractories()`, the durations left on the mind's clock, rather than reading the state.
- **Report fields.** `clip-ended` names the clip kind `clip` (the plan's `kind` is the union's discriminant) and carries the source, and `gesture-clip` also carries the source, so the mind, not the director, decides that an unasked clip arms nothing. `tool-accepted` carries the tool request's kind.
- **No intent for a moment report.** A `moment-marked` report changes the state and yields no intent: no performer stamps the moment rest.
- **One frame late, also within a frame.** A request in the very frame whose report armed a refractory now passes, because the stamp reaches the director from the next frame on. The tool port's `refractorySeconds` reads 0 for that one frame. The plan's risk table accepts the one-frame shift.
- **Packages beyond the plan's row.** `stage-ui-live2d` (`Model.vue` and the Live2D Natural adapter's `pendingPokes` carry `surprise`), the Live2D rig's scenario sink in `qa-tools`, the `stage-ui` capabilities test (the new body intent), and both packages' READMEs change too.
- **The director diagnostics keep their fields.** `moveRefractoryUntilMs` and `lookRefractoryUntilMs` of `MMDStanceDiagnostics` stay (a QA contract) and now report the stamped input.
- **The MMD body's flinch repeat stays a performer rule.** The humanoid reaction layer scales a poke within 2 s of the last to 0.6 (`REPEAT` in `packages/motion-driver-humanoid/src/performance/reactions.ts`). It shapes a flinch rather than deciding a surprise and is not in the plan's list, so it stays; only its comment now cites the mind's constant. Driving it from the intent's `surprise` is a follow-up.
- **The headless MMD runner** asks `pokeSurprise` on runner-held state at each poke cue's time (decision D6 of the plan) and passes `NO_BODY_REFRACTORY`, because it requests no clip and no tool.
- **Target rule 1 stays listed.** The plan removes it once nothing is open under Natural; it stays in the "Landed" form that rules 3, 6, and 9 use, so the rule and its scope ("Scope to Natural") remain readable.

## Consequences

- A model reload, a driver switch, a stage remount, and a second stage keep one set of refractories; a card switch (a mind reset) clears them.
- No new persisted state, setting, or cross-process event. The `performer-report` stimulus and the `refractory` intent are in-window mind contracts.
- `decideBody` is still pure: it takes the refractories as input and returns what it stamped.

## Headless and rendered acceptance

Placeholder for the orchestrator: the base and tip `qa:motion3d` runs for all eleven scenarios at seed 1 and the Live2D rig hashes for `angry` and `happy` (all expected `IDENTICAL`; `gesture-under-clip` may shift a refractory end by one frame only), the `diff` lines, and rendered check 8 of plan section 8 (a second poke within 2 s after a model reload flinches without surprise; a labelled dance requested again within 60 s after a reload is refused `refractory`).
