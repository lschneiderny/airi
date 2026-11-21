# Character mind gaze, amendment: she stops on a pointer resting on her

Date: 2026-11-21
Status: accepted. It amends the [character mind gaze ADR](2026-11-20-character-mind-gaze.md) (CM6a), whose Done-when left the press clause open on the braking ruling (D16). The branch is `luke/fix/character-mind-gaze-stop-early`. The plan, `.omo/plans/character-mind-gaze.md`, records the runs. Current rules: [Autonomous behavior](../context/autonomous-behavior.md) and [Body ownership](../context/body-ownership.md).

## Context

CM6a made the director end a chase toward the cursor as soon as the cursor came within reach. The rendered press check then missed: the gait braked for about 2 s after the goal ended, and she slid about half a leg past or short of a pointer resting on her, so a press there found no body. The owner ruled on D16 in two steps: first stop early, then cut the cursor's delay, then rerun the press check; and once that check still missed, take a short corrective step. The gait stays unchanged throughout.

## Decision

1. **Stop early.** The gait reports `restX`, where the root comes to rest if the walk brakes now. A chase ends once that point reaches a cursor within `CHASE_STOP_LEGS` in the direction she walks, so the braking slide carries her toward the pointer instead of past it. A cursor at or behind her still ends the chase at once. A visit keeps its rule.
2. **Cut the cursor's delay.** The window service sends the window's bounds only when they change, and again after a renderer restarts its loop. Before, it sent them on every 60 Hz tick, and that traffic kept a standing queue in the window's one IPC channel, which delayed every message to the renderer, the cursor among them.
3. **A short corrective step (D16).** After a chase that ended on the cursor, once she is at rest, if the cursor still rests within `CHASE_STOP_LEGS` of her but farther than `STEP_ONTO_CURSOR_MIN_LEGS`, she takes one short `stroll` step onto it, inside the same attend window. One step at most per chase: the step's own arrival arms nothing.

## Consequences

- On macOS, the cursor's trip from the system to the director takes a median of 16.4 ms (p95 27.8 ms), down from 28.4 ms (p95 39.2 ms) before the bounds fix.
- In the director's closed loop, she ends on a pointer that lands on her 1, 2, or 4 s into a chase, after at most one corrective step.
- In the rendered press check on the desktop stage, presses after a rest of at least 0.6 s poked 8 of 12 times, against 2 of 9 with stop-early alone and 3 of 9 at the base. The misses came while she still slid after a 2 s walk, or while she turned toward the pointer to take the corrective step. The plan's rule that every such press pokes is not met.
- A step without the turn, a sidestep onto the pointer, is the follow-up most likely to close the gap. It is a gait change, so it needs its own ruling.
- `qa:bench` runs only on Linux, so the perf tracker benches the branch once its PR is open.

## Alternatives considered

- **A harder brake near the pointer.** It shortens the slide past the pointer but can stop her shorter of it, and it is gait tuning. Not taken (D16).
- **Land the stop-early rule and the delay cut alone.** Presses would keep missing by about half a placement width. Not taken (D16).
