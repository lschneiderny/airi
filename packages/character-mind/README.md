# Character Mind

The pure core of the character mind and its thin shell. The mind receives stimuli and answers each with intents on channels; the stage's performers realise the intents. The design is recorded in [the character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md).

## Usage

```ts
import { CharacterMind } from '@proj-airi/character-mind'

const mind = new CharacterMind({ seed: 41 })
const stop = mind.onStep(({ atMs, intents }) => console.info(atMs, intents))
const intents = mind.receive({ kind: 'emotion', source: 'act', emotion: 'happy', nominal: 0.6, turnId, settings })
```

- `step(state, stimuli, nowMs, rng)` is the core. It is a pure function over `MindState`, which is plain JSON. `nowMs` is epoch milliseconds and must not run backwards between calls.
- `CharacterMind` is the shell. It owns the clock, the random source, and the state, and it never passes the core an earlier time than the last one. It persists nothing itself: the host saves `state.slow` (`MindSlowState`, her pacing memory) and hands it back through the `slow` option or `reset(slow)`, which starts the state over from `initialMindState(slow)` and keeps the random stream and the monotonic clock.
- `seededRandom(seed)` is the shell's random source: the same seed gives the same draws.

### Stimuli and intents

| Stimulus | Intents |
| --- | --- |
| `emotion` | `face`: `emotion`, with the episode and its hold, when the emotion starts or escalates an episode. `release` with scope `neutral` when a neutral resets the reaction state. Nothing for a repeat that does neither. |
| `expression-request` | `face`: `entry`. With an emotion mapping and held emotions on, it carries a hold for the entry's lease, and the episode when the request started one. |
| `expression-clear` | `face`: `release` with the named slot as its scope, or scope `all` and a hold release when no slot is named. |
| `touch` | One response, decided together. `posture`: `touch-reaction` for every touch, a poke at its point or a pet `start` or `end`, and `mood` when `touchAffect` returns a dose. `face`: `moment` (`poked` or `petted`) for a poke and a finished pet. `voice`: `speak` when `reactionPolicy` decides a line, with no `cue`: her body already answered the touch. |
| `voice-tick` | In the order posture, voice: `cue` `about-to-speak` and `speak` with a `reach-out` line when the urge gate fires. A new `run.id` first restores the gate memory: a promotion with `run.user` (the user's floor, hourly-cap fires, and ritual day) and `slow.pacing` laid over it and normalized (`restoreGateMemory`). A shown edge eases her in (`visibilityRegainUrgeMemory`). Widget deadlines and requests come first (see below). The gate skips while a line is open, a widget request waits, or `unpromptedPending` is set. |
| `voice-outcome` | `posture`: `cue` `let-go` when she declined a reach-out or a widget line; otherwise none. It settles the line named by `turnId` and closes it. A touch line (`reaction:<eventId>`) settles its pending attempt; a `spoken` one always starts the refractory and the gate's floor. A widget line's `spoken` starts the gate's floor (`recordExternalSpeech`) and never counts as an unanswered opening. A reach-out applies its outcome to the gate (`recordUrgeFireOutcome`); `refused` restores the gate fields of before the fire, with its draws spent. |
| `voice-request` | `posture` `cue` `about-to-speak`, then `voice` `speak` with a `widget` line, at once when nobody is busy; otherwise the request waits. Deadlines are handled first, as at a tick. |
| `user-turn` | None. `recordUrgeUserTurn`: unanswered openings become damping, and an armed double text clears. |
| `presence` | One response, in the order posture, face, voice. A desktop wake: `posture` `desktop-reaction` `wake` and `voice` `observe-wake`. A return: `posture` `wake` (unless the wake reaction already rouses her), `face` `moment` `welcome-back`, and `voice` `observe-return`. Away turning true opens the span and yields nothing. |
| `screen-change` | `posture`: `desktop-reaction` `screen-change`, unless one was stamped less than `SCREEN_CHANGE_REFRACTORY_MS` (10 s) ago or a desktop wake is in the same `step` call. |
| `idle` | `posture`: `idle-act` or `idle-errand` when the idle schedule decides at the current time after the reports are applied (see below). |
| `idle-wake` | Nothing of its own. Like every stimulus, it first brings the idle clock up to `nowMs`, which can yield `posture` `idle-act` or `idle-errand`. |
| `idle-play` | `posture`: `idle-act` with `requested: true`, at once. |
| `music` | None, and no draw. It sets `MindState.music.playing`, fast state that a reset clears. While it is true the idle schedule may draw the groove, the `sway` act (`IdleContext` `music`). Like every stimulus, it first brings the idle clock up to `nowMs` under the old value. A `music` stimulus before the first `idle` report leaves the idle stream's seed unchanged. |
| `cursor` | `gaze`: `cursor-episode` for the report's `requestId`, at once: whether she engages, the interest span, the notice dwell, and the cooldown (see below). |

A scene reports a touch as a `TouchReport`: a poke with its region and a point relative to that region, a pet start, or a pet end with its duration. The `touch` stimulus adds the settings and a `TouchVoiceView`, which is what the voice channel shows of the touch the situation just recorded. Without a view (a pet start, a follower window, no running gate) the mind decides no line and leaves its voice state untouched. The caller runs a `speak` intent and returns what became of it as a `voice-outcome` with the intent's `turnId`.

### The voice policy

`voice.ts` decides when she speaks unasked: spoken touch reactions and reach-outs of the urge gate. The gate's rules stay in `@proj-airi/stage-shared/situation`; the mind composes them on its own clock and source. The store builds a `VoiceView` for every tick and keeps the user's slice of the gate memory: the mind publishes its gate memory, and the store carries that slice in `VoiceRun.user` and saves it. After each answer that changes the gate memory, the core sets `slow.pacing` to `pacingMemoryOf(gate)` when a field differs and keeps the object otherwise, so the host can tell a change by identity; a null pacing stays null while the gate holds none. A touch line and a reach-out share one line slot, `MindVoiceState.line`, because chat runs one unprompted turn at a time. While it holds a line the gate skips; a touch line decided while a reach-out holds the slot leaves the slot alone, and chat refuses it.

Widget and plugin turns arrive as `voice-request` stimuli and wait in `MindVoiceState.requests`, oldest first. A request starts only when nobody is busy: `userSpeaking` is not `false`, `userTyping`, `characterSpeaking`, `generating`, `queued > 0`, `unpromptedPending`, or an open line all hold it. The gate's hard holds and settings do not apply. Then the mind yields `speak` with a `widget` line and opens the line with `speakBy`. At each tick and request the deadlines come first: a request still waiting at `startBy` (`WIDGET_START_WAIT_MS`, 20 s, after the request) yields `drop`, and a widget line still open at `speakBy` (the caller's `timeoutMs` less `WIDGET_DEADLINE_MARGIN_MS`) yields `cancel` and closes. A waiting request goes before a reach-out: the gate skips while one waits, and the waiting topics are the only topics held from the gate (`UrgeGateInput.heldTopics`). `nextVoiceWakeAt(voice)` returns the earliest deadline; `MindVoice` in `stage-ui` publishes it as `wakeAtMs` after each step, and the situation store ticks the mind then.

### The idle policy

`idle.ts` decides when she starts an idle act or an idle errand, which one, when she falls asleep while the user is away, and the stretch or yawn after a long sleep. The rules stay in `@proj-airi/motion-driver-natural/idle-schedule`, the package's one runtime dependency besides `stage-shared`; the mind imports only `/idle-schedule`, `/idle-errands`, and `/cursor-notice`, and types from `/idle-activities`. Natural's performer sends `IdleReport`s in an `idle` stimulus: its `view` (drive, mode, away, blocked, settled, what runs), and the edges `started`, `ended`, `refused`, `errand-started`, and `errand-ended`. `MindState.idle` keeps the view, the schedule, and `activeSeconds`, the mind's clock counted only while the view is `active`.

- Before every stimulus the idle clock catches up to `nowMs` and the schedule runs in pieces that end at its deadlines, so a hazard crossing lands exactly on its deadline and each decision is taken at its own time. `nextIdleWakeAt(idle)` returns the next deadline in epoch milliseconds, or null while no active view reports, while nothing is due, or while an intent waits. The host arms one timer at it and sends `idle-wake`: in the app `useCharacterMindStore`, in the headless MMD runner the frame loop before each advance.
- A decided intent waits in `pending` until the performer reports it `started` (or `errand-started`) or `refused`; no other decision is taken meanwhile. A refusal spends the fire.
- A view with no drive is dormant: it clears the follow-up, the away run, and `pending`, and the policy decides nothing.
- Each act carries a 32-bit `seed`, drawn after the decision's own draws, from which the performer draws its shape.
- `idleOrderOf(intent)` turns an `idle-act` or `idle-errand` intent (`MindIdleIntent`) into the `IdleOrder` that Natural's `idle` performs.
- The policy draws from its own stream, `MindIdleState.random`, seeded by one draw of `rng` at the first `idle` or `idle-play` stimulus. The idle draws therefore do not depend on how often the other channels draw.

### Cursor attention

`attention.ts` decides each cursor episode. The reporting Natural performer sends a `CursorReport` in a `cursor` stimulus when a notice is possible: its `requestId`, the cursor's band (`near`, `medium`, or `far`), and the opportunity. `answerCursor` draws the episode with `drawCursorEpisode` from `@proj-airi/motion-driver-natural/cursor-notice`, on its own stream, `MindState.attention.random`, which one draw of `rng` seeds at the first `cursor` stimulus. The policy keeps no other cursor state: the performer drops an order it no longer awaits, which costs only its draw.

### Return and desktop events

A **return** is the end of an away span: a `presence` stimulus with `away: false` after one with `away: true`. The mind opens the span at the step's `nowMs` and keeps it in `MindState.presence`. A desktop wake (`wake` set, `unlock` or `resume`) while she is still away keeps the span open; the later return still gets its response. `observe-wake` carries the open span at the wake time as `awayMs`, or null when no span was open, and `observe-return` carries the whole span. The voice channel decides whether she says anything about either.

The `wake` intent is idempotent: the performer ends idle sleep with it and ignores it otherwise, so the mind need not know she sleeps. A desktop wake does not stamp the screen-change refractory, and screen changes while she is away still react.

The mind decides the emotion, its strength, its hold, and the reason. It reads no catalog: the caller reads a named entry's lease and primary emotion mapping from the catalog of the rendered model and sends them with the request. Which entries show an emotion stays with each performer.

Every stimulus advances `MindState.seq`. An intent's `cause` is the sequence number of the stimulus it answers, and its `id` is unique within one mind.

Every draw comes from `rng`, in the order of the stimuli: one for the jitter of each new emotion episode, one for each spoken touch reaction that reaches its roll, one for the threshold of a gate run restored by promotion, five for each gate fire (and a `no-topic` hold), one that seeds the idle stream, and one that seeds the attention stream. A refused fire keeps its draws spent. `MindState` holds no random source, so a replay needs the same state and the same draws.

`nowMs` reaches `reactionPolicy` as milliseconds and `touchAffect` and `acceptReaction` as seconds (`nowMs / 1000`). Everything in `MindState` but `slow` is fast state: it is not saved, so the pacing of touch doses and spoken reactions, the urge, and its threshold start over with every mind and every reset.

## Checks

```bash
pnpm -F @proj-airi/character-mind exec vitest run src/step.test.ts
pnpm -F @proj-airi/character-mind typecheck
```

## When to use

Use this package for a decision about what the character does at event rate: which emotion episode starts, how strong it is, and how long it is held, how she answers a pet or a poke with her body, her mood, and her voice, how she answers the user's return and desktop events, when the urge gate lets her reach out, and when she starts an idle act or errand or falls asleep. Drive the core from tests with scripted stimuli and a seeded random source.

## When not to use

- Keep per-frame control (fixation, springs, blending) and the choice of a model's assets in the performers and their packages.
- Keep the shape, interruption, settling, and cue acceptance of idle acts in Natural; the mind only decides which act starts and when. Do not import Natural's performer: only its pure idle subpaths.
- Do not import Vue, Pinia, a store, or a renderer here, and do not read a clock or a global random source outside `mind.ts`. The `airi/character-mind-pure` lint blocks enforce both.
- Put a pure rule that the asset deciders also use in `@proj-airi/stage-shared`; the mind composes it from there.
