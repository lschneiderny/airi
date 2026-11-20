# Motion Driver Natural

Renderer-neutral Natural motion controller and pure motion layers.

## Usage

```ts
import { NaturalMotion } from '@proj-airi/motion-driver-natural'

const motion = new NaturalMotion({ seed: 41 })
const frame = motion.advance(0)
```

The root exports the controller, frame contracts, rig traits, touch regions,
emotion episodes, and speech onset detector. `./frame-types` also holds
`NaturalTouchGesture`, the touch event every renderer's classifier emits, and
`./emotion-strengths` holds the per-model emotion strength record and its
storage parser, which every Natural renderer's settings use. `./touch-gestures`
holds `NaturalTouchGestures`, the poke and pet classifier both renderers feed
with pointer samples; each renderer keeps its own hit-testing. Individual layers are available
through source subpaths, such as `@proj-airi/motion-driver-natural/gaze`.
Times are monotonic seconds; seeded inputs preserve deterministic output.

The layers are blink, breath, gaze, posture, body, face and face hints,
impulses, hold, gestures, cue gestures, mood and mood modulation, energy,
cursor attention, placement, speech emphasis, pending actions, touch and idle
activities. Each layer that draws does so from
its own seeded stream, so a change in one layer does not reshuffle another.
Cursor attention draws nothing: it plays the episodes the character mind draws.
The controller advances every layer on a fixed 120 Hz grid and interpolates
between grid states, so the frame rate does not change the motion.

Desktop events reach the controller as requests that start on the next grid
step, like pokes. `motion.react('wake' | 'screen-change', nowSeconds)` starts a
desktop reaction: `wake` lifts the head, glances at the camera, and rouses her
from sleep with a start; `screen-change` glances at the screen.
`motion.wake(nowSeconds)` ends a sleep with the gentle wake (the eyes reach the
camera as the lids open), even while the user is still away; awake, she ignores
it, so a caller may send it on every return. `setPerformance` starts no
reaction, and `away` turning false does not end a sleep: only `wake`, or a
`react('wake')` or a touch with a start, does.

After `advance()`, `motion.bodyIntent()` returns the cached `NaturalBodyIntent`
for the frame it most recently produced. Call `advance()` before the first read;
reading earlier throws. Repeated reads return the same snapshot without stepping
or consuming events. `NaturalMotionFrame` keeps its original shape; intent is
not a frame property. `NaturalBodyIntent` is exported from the root and
`./frame-types`. It is a detached, read-only snapshot of state already
computed by Natural: head posture and its slow component, the six additive head
terms (emphasis, impulse, pet, held, emotion gesture, cue), posture shift sequence
and final amplitude/rate scales and activity gain, gaze ownership and saccades,
breath phase/effective period/amplitude scale, host voice and its slow envelope
and onsets, mood, energy, held affect, touch, and cursor attention.

Intent is assembled after the grid loop and describes its next endpoint; the
legacy pose, face, blink, breath and fixation remain interpolated. `intent.time`
is the frame's active seconds, so the grid endpoint may be up to one tick ahead.
At grid endpoints after the origin, the posture plus six head terms, clamped to
[-1, 1], equals the reported head before breath pitch is added and clamped again.
`head.slow` is an alternative to `head.posture`, not an additional term.
Gaze ownership chooses pet override, cursor, chat, aside, then free. Pet coordinates
are the eased hand. Held affect reports the raw target and eased level, including
its retained side after release; `head.held` reports the term actually applied.
The energy reaction deadline starts at negative infinity before any reaction.

Emphasis, impulse, emotion gesture, cue, poke and desktop reaction records are
`null` before their first start. Each has its own `seq`, starting at 1 and advancing
once per accepted start, independently of observers and reads. Multiple starts
between frames advance the sequence for each start and retain the latest payload.
Records remain after their motion ends. Impulses include accepted escalations and
poke surprise episodes; every poke advances its own record even when surprise is
deduplicated. Refused gestures/cues do not advance a sequence; queued cues advance
only when they start. A cue reports its actual start and end; other records use
`at`, the grid-step start, except emphasis uses the speech detector's active time
at acceptance. Emphasis carries magnitude, tau, kind and side (1 for an unsided
nod); an emotion gesture carries its resolved kind, side, sampled lifetime and
the exact strength times band scale passed to its clip. Pokes preserve their
region-relative input coordinates. Desktop reactions carry `wake` or
`screen-change`. Reading intent draws no randomness and changes no frame output.

Two adapters consume the controller. `Live2DNaturalMotionAdapter` in
`@proj-airi/stage-ui-live2d` writes Live2D parameters, and `MMDNaturalAdapter`
in `@proj-airi/stage-ui-mmd` writes MMD bones and morph-runtime layers. Live2D
keeps the trace recorder, rig profile, scorers and QA gates, because they
read Live2D parameters. The architecture is recorded in
[the 3D character motion ADR](../../docs/ai/adr/2026-10-30-3d-character-motion.md),
and what each renderer performs is in
[the interaction portability ADR](../../docs/ai/adr/2026-11-04-interaction-portability.md).

## Idle activities

`./idle-activities` holds `NaturalIdleActivities`, the layer of self-directed
idle behaviour: stretch, yawn, look-around, check-in, peer, zone-out, nod-off
and sway, sleep while the user is away, and the two reach-out cues
`about-to-speak` and `let-go`. The layer performs; it does not schedule.
`@proj-airi/character-mind`'s idle policy decides each act and errand from
the view the layer reports, and the host hands its orders to `idle`.

```ts
motion.setIdleDrive({ energy: 0, valence: 0, tension: 0, sleepiness: 0.8, solitude: 0.5, music: false, rate: 1 }, now)
motion.idleCue('about-to-speak', now)
const off = motion.onIdleReports(reports => mind.receive({ kind: 'idle', reports }))
motion.idle({ id: 'i-1', kind: 'act', act: 'yawn', seed: 7, requested: false }, now)
const { seq, behaviour } = motion.idleState
```

- The layer is inert until `setIdleDrive` receives a drive. Without one it
  reports the dormant view (`dormantIdleView`, `drive: null`) and refuses
  every order, so seeded traces and gates that never set a drive are
  unchanged.
- `onIdleReports` hears the reports at the end of each `advance`: the view,
  only when a field changed (the drive compared by value with
  `sameIdleDrive`), and `started`, `ended`, `refused`, `errand-started` and
  `errand-ended`. `idle(order, now)` starts the ordered act or errand at the
  next step, or refuses it: while blocked, while another act runs, while
  suspended, and with no drive. Each act's shape comes from
  `createRandomStream(order.seed)`; the layer's own `stream('idle')` draws
  only the cues' shapes.
- `./idle-schedule` holds the idle schedule as pure rules over plain JSON state,
  in active seconds, with every draw passed in: when an act or an errand
  starts and which one, the rest after each behaviour, the sleep delay while
  the user is away, and the stretch or yawn after a long sleep. The performer
  tells it what it saw: `IdleView` once per step and an `IdleEdge` for each
  start and end. `advanceIdleSchedule` runs a span of time and returns at most
  one `IdleDecision`; `applyIdleEdge` applies an edge; `nextIdleDeadline`
  names the earliest time the schedule could decide, the hazard's crossing
  included. The mind runs the schedule on its own clock and stream; Natural
  only reports what it saw and performs the orders. The lint block
  `airi/idle-schedule-pure` keeps the module and `./idle-errands` free of
  clocks, timers and `Math.random`. `IdleReport` and `IdleOrder` are the
  contract with `@proj-airi/character-mind`'s idle policy, which composes the
  schedule: the reports a performer sends and the orders it receives. They
  live here because this package must not import the mind.
- `./cursor-notice` holds the cursor episode draw as a pure rule:
  `drawCursorEpisode(band, random)` decides whether she engages a cursor in a
  `CursorBand` and draws the episode's interest span, notice dwell and
  cooldown, in that order, with the constants it reads. A near cursor always
  engages and draws no engagement. `@proj-airi/character-mind` draws it on
  its own stream; the lint block `airi/idle-schedule-pure` keeps the module
  free of clocks, timers and `Math.random`. `CursorReport` and `CursorOrder`
  are the contract with the mind's attention policy.
- `NaturalCursorAttention` draws nothing. Where a notice is possible it
  reports a `CursorReport` (band and opportunity) through `onCursorReports`
  at the end of the `advance`, and starts nothing until the host hands the
  mind's answer to `cursorEpisode(order, now)`. The order starts the episode
  at the next grid step, or is dropped when the report is no longer awaited,
  the cursor left, or permission closed; the next step may then report
  anew. While it awaits an order it reports no other opportunity.
- `idleActivityWeights` and `idleActivityRate` in `./idle-schedule`, and
  `idleEnergyOffset` in `./idle-activities`, are the pure rules that turn a
  drive into odds, pace and an energy offset.
- An activity yields within 0.4 s to speech, thinking, listening, touch, an
  emotion, a cue gesture and a noticed cursor.
- A requested order (`requested: true`, from a preview or scripted QA)
  replaces the running act when a drawn activity could start too. A requested
  sleep ends after 24 s.
- `motion.idleLidFactor` is the part of the frame's `blinkFactor` that a
  behaviour closes on purpose. A renderer whose blinks are switched off applies
  it alone. It is not a frame field, so recorded frames keep their shape.
- `idleState.seq` increments at every start. `IdleBehaviourReports` turns
  per-frame reads of it into start and end reports; both renderer adapters use
  it. An attached observer also receives `idle` events.
- The layer is the one idle performer for both renderers. A host that performs
  a whole body (MMD) sets `body: true` in the drive. That unlocks the
  whole-body kinds (`sigh`, `shoulder-roll`, `shift-stance`, `clasp-hands`,
  `hair-touch`, `heel-rock`, `arm-swing`) and settling in after 120 s of
  continuous `idle` mode. Without `body` those kinds weigh 0 before the single
  draw, so a Live2D drive draws exactly as before they existed. `shift-stance`
  takes architecture 4e's weight 1.2: the MMD body re-plants a foot.
  `clasp-hands` takes 4e's weight 0.7: the MMD body clasps both hands at the
  front-low anchor and rocks. A host lists the whole-body kinds its body cannot
  perform in the drive's `unreachable` (the MMD scene: the clasp on a rig whose
  arms cannot reach that anchor, the hair tuck on a rig without the tuck), and
  those weigh 0. `heel-rock` takes 4e's weight: 0 unless valence is
  above 0.3, then 0.8; the MMD body rises onto the balls of its feet.
  `hair-touch` takes 4e's weight 0.5 (refractory 300 s): the MMD body tucks
  its hair on a rig with head clearance whose arms reach the tuck (the MMD scene
  lists it in `unreachable` elsewhere). While
  she is settled in, nothing that needs her arms, her shoulders or a standing
  posture is drawn (`stretch`, `peer`, `shoulder-roll`, `arm-swing` and the
  three above), and a stretch that would follow a long sleep becomes a yawn. The
  sigh, the yawn and the foot re-plant (`shift-stance`) still play, as
  architecture 4f allows; so do the head and
  gaze kinds (`look-around`, `check-in`, `zone-out`, `nod-off`, `sway`), a
  recorded deviation from 4f's list.
- With `body`, the draw prefers kinds she has not shown recently: a kind
  started `t` seconds ago weighs `t / 300` of its odds until 300 s have
  passed. 300 s is about five acts of 60 s each, so each of the other kinds
  of her settled pool can come first. A ten-minute idle then shows more of
  what she can do. Without `body` the odds are unchanged.
- `bodyIntent().idle` carries the latest behaviour as an
  `IdleBehaviourRecord` (its timing, side and drawn parameters, kept after it
  ends) and `settled`, so a body host plays its own form of each behaviour. The
  frame Live2D draws does not change.
- The mind's same draw decides the long behaviours a host realises in full, the
  errands of `./idle-errands`: a `pastime` with one of her own props (Live2D),
  an `idle-clip` the user allowed for idle and a `wander` in roam mode (MMD). A
  host lists the errands it can realise now in the drive's `errands`; absent,
  none is drawn and the draw is exactly as before. Each errand adds its rate
  (`IDLE_ERRAND_PACING`, the constants of the timer it replaced) to the one
  hazard while it is eligible, and a crossing shares the start between the acts
  and the errands by rate, so the acts keep their pace and each errand keeps
  its old long-run rate. `idleErrand` and `bodyIntent().idle.errand` hold the
  latest `IdleErrandRecord` (kind, start, a pastime's drawn end, and `pick`, a
  uniform for the realiser's choice of prop or clip). The realiser answers
  with `answerIdleErrand(seq, 'done' | 'refused')`; a refused errand is spent
  and keeps its refractory. Natural ends a pastime when she is spoken to, the
  user leaves or she sleeps. `IdleErrandReports` turns per-frame reads of the
  record into start and end reports, and its `close` ends the errand in
  progress for the reader when the controller stops driving the model.

[The idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) records the
design, the pacing numbers and the rendered Live2D pass.

## Motion review

`./review` holds the seam a reviewer uses to find the idle layer that looks
wrong on a running model.

```ts
motion.setReviewGains({ shifts: 0, shiftRate: 1, drift: 1, wobble: 1, eyes: 1, body: 1 })
const { head, eyes, act, owner } = motion.reviewState()
```

- `setReviewGains` scales what a layer contributes to the frame: the size of
  posture shifts, the drift of the rest pose, the continuous wobble, how far
  the eyes leave the camera, and how far the body follows the head.
  `shiftRate` changes how often posture shifts start.
- Every gain is 1 by default, and a gain of 1 leaves every frame
  bit-identical, so seeded traces and gates are unchanged.
- A gain never stops a layer's random process. The other layers and every later
  draw stay as they were, and the same motion returns when the gain goes back
  to 1. `shiftRate` is the exception: it moves the shift schedule.
- A changed gain eases in over 0.25 s.
- `reviewState` names what drives the head and the eyes at the latest grid
  step: the posture shift in progress with its size, the gaze target
  (`GazeTargetKind` in `./gaze`), the idle behaviour and errand in progress,
  and any owner outside idle life (a pet, the cursor, a gesture, an emotion).
  It draws nothing.
- The idle acts have no gain. A host withholds the idle drive to switch them
  off.

### Follow candidate

`follow` in the review gains is a candidate motion, not a layer. At 0, its default, a posture shift goes in a random direction, as it ships. At 1, each shift lands near where the eyes look (`headAimShare` head units per eye unit, with a fifth of the random offset kept), and a new fixation starts the next shift 50 ms after the eyes leave. It adds no random draws and no shifts. Do not make it the default without an ADR: it moves the liveliness statistics.

## Reference statistics

The idle posture shape was fitted to human head motion from two private VTS desk recordings, 7525 s pooled and resampled to 30 Hz. The recordings are never committed, so these aggregates are the only copy in the repository. They show quiet desk work, so use them as a reference for idle liveliness only, not for emotion or speech.

| Quantity | Human value |
| --- | --- |
| Frames faster than 2 deg/s | 57% |
| Move rate (runs above 2 deg/s, gaps up to 0.1 s merged) | 0.49 per second |
| Hold q10 / q50 / q90 / q99 | 0.13 / 0.37 / 1.9 / 7.3 s |
| Hold lognormal fit (mu, sigma) | -0.82, 1.02 |
| Move amplitude q10 / q50 / q90 / q99 | 0.28 / 0.88 / 6.4 / 31 deg |
| Move duration median / q90 | 0.40 / 2.9 s |
| Speed CV over 60 s windows | 0.775 |
| Dwell above or below median speed, q50 / q90 | 20 s / 70-80 s |
| Quick reversals of at least 0.25 deg, yaw / pitch / roll | 0.44 / 0.88 / 0.35 per second |

`posture.ts` draws its holds from the lognormal fit. Sources: `.omo/ulw-research/20261024-181357/verify-wave3-step-regimes.md` for the step structure and `verify-recording-reversals.md` in the same run for the reversals.

## Checks

```bash
pnpm -F @proj-airi/motion-driver-natural exec vitest run
pnpm -F @proj-airi/motion-driver-natural typecheck
```

Any numeric change to a layer changes the seeded Live2D trace hashes. Make such
a change deliberately, never as part of a move or rename.

## When to use

Use this package for autonomous posture, gaze, face, blink, breath, speech,
emotion, cursor attention, placement, touch, and self-directed idle behavior
across renderers.

## When not to use

Keep model parameter writes, rig discovery, rendering, stores, trace recording,
and QA scoring in their renderer or tooling packages. This package does not
depend on Three.js, Vue, Pinia, three-mmd, or stage UI packages.
