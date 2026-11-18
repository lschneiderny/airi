# Character mind core: the package, the interface, and the touch slice

Date: 2026-11-18
Status: accepted. Slice CM1 of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-touch`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md), which stays the direction. The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto.

## Context

The character mind ADR fixed the shape of the mind's core (its decision 9) and left three things to the first slice:

- **Where the mind lives.** The roadmap listed it as an open question, together with revision R5 of the [architecture audit](../audits/2026-10-31-architecture-boundaries.md): rename or split `stage-shared`.
- **The first stimulus.** One touch reached five deciders with five states and three clocks (overlap 4 of [Autonomous behavior](../context/autonomous-behavior.md)).
- **Two arrangements from the upstream sync that no ADR recorded.** Upstream's touch module runs only under Universal and MAGIC, and upstream's Live2D expression context runs beside the fork's expression store. Code comments and an owner ruling of 2026-11-17 were their only record.

## Decision

### The package

1. **The mind is a new fork-only package, `packages/character-mind`.** It depends on `@proj-airi/stage-shared` alone and imports only its `expression-performance` and `situation` entry points. Two lint blocks in `eslint.config.ts` enforce the boundary. `airi/character-mind-pure` forbids Vue, Pinia, VueUse, `stage-ui`, and the stores of `stage-shared`. `airi/character-mind-pure/core` forbids clocks, `Math.random`, and timers outside the shell. `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd`, and `qa-tools` depend on it.
2. **`stage-shared` is neither renamed nor split now.** Its README describes it as the client domain layer, which is the first option of audit R5. Slice CM3 decides again, when the urge gate moves into the mind.
3. **The pure rules stay where they are.** `touchAffect`, `acceptReaction`, and `reactionPolicy` stay in `stage-shared`, and the mind composes them. No file moved.

### The interface as built

4. **The core is `step(state, stimuli, nowMs, rng)`.** It returns the next state and the intents. `MindState` is plain JSON, `nowMs` is epoch milliseconds, and `rng` returns uniform draws. The core reads no clock and mutates nothing.
5. **The shell is the class `CharacterMind`.** It takes a `seed` and an optional `clock`, and has `receive`, which answers stimuli now, and `onStep`, which reports each step to a listener. It never lets time run backwards, because the rules drop a stimulus older than the last one.
6. **Five stimulus kinds and three intent channels exist.** The stimuli are `emotion`, `expression-request`, `expression-clear`, `touch`, and `voice-outcome`. The intents are `touch-reaction` and `mood` on the posture channel; `emotion`, `entry`, `release`, and `moment` on the face channel; and `speak` on the voice channel. Every intent carries an `id` and a `cause`, the sequence number of the stimulus it answers.
7. **One mind per `Stage.vue`.** `useCharacterMind` creates it in the window that hosts the stage. One mind per character waits for slice CM4, which owns per-character state. No build renders two stages.
8. **No transport and no persistence.** The stage calls the mind in-process. Everything in `MindState` is fast state and resets at launch, as decision 10 of the character mind ADR says. The pacing of spoken touch reactions is therefore no longer saved in the gate's inner state.

### The expression split

9. **The mind decides the emotion, and each performer's decider picks the entries.** The mind decides the emotion, its strength, and its hold with `acceptReaction`, `emotionHold`, and `releaseHold`, and it owns the reaction history. The picker and the planner receive the decided episode as a `reaction` signal and return only slot commands. For a named expression, the conductor reads the entry's lease and its primary emotion mapping, so the mind needs no catalog.
10. **Emotion stimuli still reach the mind under Universal, MAGIC, and classic.** The fork's expression slots under those drivers use the decided episode. Slice CM7 makes the cut.
11. **The two Live2D expression systems stay side by side.** The fork's expression store and controller are the asset system of the Natural performer and receive slot commands and holds as before. Upstream's Live2D context stays as upstream ships it, and the mind never addresses it. The context's final plugin (`useMotionUpdatePluginExpression`) is registered after the fork's `applyExpressions`, so a preview through the context wins on a shared parameter for as long as it lasts.

### Touch

12. **Touch is split by Live2D driver.** Upstream's touch module answers a touch under Universal and MAGIC only, unchanged, and no stimulus reaches the mind there. This follows decision 7 of the character mind ADR.
13. **Under Natural, one `step` call decides the whole response.** The scene classifies the touch, reports a `TouchReport`, and shows nothing until the conductor hands it the mind's intents: the body reaction, the mood dose, the moment, and a possible spoken line.
14. **The mind decides the spoken line now, and the situation store runs the turn.** `observeTouch` records the touch and returns what the mind may see of the voice channel. `speakReaction` runs the line, and its outcome returns to the mind as a `voice-outcome` stimulus.
15. **Realisation details stay in the performers.** These are the poke's 2 s startle dedupe, the camera glance after a long pet, the MMD flinch's repeat scale, and the moment's chance and entry rest. Each shapes how one performer replays a reaction. Moving them would change Natural's poke contract for no change in behavior.
16. **The mood dose travels as an intent.** Natural's fast mood stays in the performer until CM4.

### Random draws and naming

17. **Every draw comes from the shell's seeded source.** `acceptReaction` and `reactionPolicy` take a draw function, and their memories hold no random checkpoint. The odds are unchanged; the draw sequences are not. Affect traces move to version 2: they record the decider's signals with the decided episodes, and a version 1 trace no longer parses.
18. **The scene-reported touch is named `TouchReport`.** `stage-shared` already exports `TouchGesture` for `'pet' | 'poke'`.

## Consequences

- The pacing of spoken touch reactions resets at launch, so the first long pet after a launch stays silent. Before, only the first pet of a chat session did.
- A switch between the picker and the planner no longer resets the reaction history, because the history lives in the mind.
- A repeat that neither starts nor escalates an episode sends the decider no signal, so it does not appear in an affect trace.
- A spoken reaction that another pending unprompted turn refuses keeps its draw spent. The retry wait and a protest's burst are still given back.
- The devtools reaction inspector shows the voice memory from the moment the stage mounts.
- Two rendered stages would run two minds. Overlap 5 of Autonomous behavior stays latent until CM4.
- The audit's R5 row and the roadmap's question "Where the mind lives" are closed. The ledger's touch decision is settled.

## Alternatives considered

- **A module in `stage-shared`.** No new package. But `stage-shared` has Vue, Pinia, and VueUse as runtime dependencies, so only a lint block scoped to one directory would keep the core pure, and the package that audit R5 calls misdescribed would grow again. Rejected.
- **Inside upstream's `packages/core-character`.** It would need `stage-shared`, which inverts upstream's layering: no `core-*` package imports a `stage-*` package. It would also conflict at every sync, and decision 14 of the character mind ADR puts the mind beside upstream code. Rejected.
- **Rename or split `stage-shared` now.** A rename edits an upstream package that 17 packages import. A split moves code that CM3 and CM7 rewrite. Deferred to CM3.
- **Move the pure rules into the new package.** The asset decider would lose the types beside it, and files would move for no change in behavior. Rejected.
- **Leave the reaction policy in the situation store until CM3.** A second decider would still answer the touch, and overlap 4 would stay open. Rejected.
- **Keep saving the reaction pacing.** It contradicts decision 10 of the character mind ADR: fast state resets at launch. Rejected.
- **Move the fork's expressions onto upstream's context, or filter the fork's catalog by the card's control policy now.** The split needs neither. The filter is a behavior change that belongs with capabilities in CM7. Rejected for this slice.
- **Run upstream's touch module under Natural too.** One touch would get two responses. Rejected.
- **Keep a random checkpoint inside each rule's memory.** It is not the `step` signature of the character mind ADR, and two rules could draw the same values. Rejected.

## Not decided

- One mind per character, load and save of slow state, and where Natural's fast mood lives: CM4.
- Picks seeded from the intent's id, reports of masked or refused expressions, declared capabilities, and no intents for Universal, MAGIC, and classic: CM7.
- The open questions of the character mind ADR stand.
