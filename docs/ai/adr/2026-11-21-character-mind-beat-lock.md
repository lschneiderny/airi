# Character mind beat lock: the groove follows the detected beat

Date: 2026-11-21
Status: accepted. Slice CM5b of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-beat-lock`. It builds on the [character mind music ADR](2026-11-20-character-mind-music.md) (CM5a, which split this slice off) and the [idle agency ADR](2026-11-12-idle-agency.md) with its amendments. The owner approved the recommended option of every fork, D1 to D7, before implementation. The labels name the forks in the slice's plan, `.omo/plans/character-mind-beat-lock.md`. Current rules: [Autonomous behavior](../context/autonomous-behavior.md), [Body ownership](../context/body-ownership.md), and the [Glossary](../context/glossary.md).

## Context

After CM5a the mind draws the groove, the `sway` act, only while it hears music, but the sway kept its own drawn period and phase. Upstream's beat sync detector already reported each beat with its interval on the audio clock, and the idle agency ADR left "A beat estimate for sway" as a follow-up.

## Decision

1. **The mind decides nothing new (D1).** Beats are a realisation input of the groove the mind already decides, as cursor tracking is for a glance. The mind adds no state, no draw, and no intent field, so the idle stream is unchanged.
2. **One path for beats (D2).** The leader's mind store hands each beat from its one beat sync subscription (`MindMusic`) to every attached stage. The conductor forwards it to the scene only under Natural, and the Live2D and MMD adapters queue it for Natural's beat clock on their motion time.
3. **The beat clock.** `packages/motion-driver-natural/src/beat-clock.ts` is pure. The period is the median of the last 8 detector intervals, folded into 60 to 180 BPM. The phase comes from arrivals on Natural's active time through a first-order phase-locked loop. Four hits in a row lock the clock, and four misses or 1.8 s without a beat unlock it.
4. **A sway binds only at its start (D3).** A sway that starts while the clock is locked takes its phase from the clock for its whole length. A sway that starts unbound plays exactly as before, so frames without beats are bit-identical.
5. **Beats per side-to-side cycle (D4).** A bound sway takes `k` from {2, 4, 8}, the multiple nearest its drawn period, and keeps it for the clip. The cycle stays near 2 s, and the detector's octave errors do not double her speed.
6. **The head bob's low point lands on the beat (D5),** every `k/2` beats. The clip's phase eases toward the clock's target, so a correction never moves the head in one step.
7. **No lead constant (D6).** The rendered run on macOS measured the delay from the audio onset to the beat reaching the stage window: a median of about 9 ms (detection 8.5 ms after the onset, arrival 0.5 ms after the detection). That is under the 20 ms at which the plan would lead the clock, so `BEAT_LEAD_SECONDS` stays 0. The delay may differ on other hosts.
8. **Headless evidence (D7).** The `music-beat` scenario, Node tests of the phase, and a one-off measurement of the bob minima against the scripted beats prove the lock on MMD. No report rule is added.
9. **On MMD the act form reads `groovePhase`** from the body intent for a bound sway, and its closed form otherwise. The intent carries a phase, not a clock, because the performer's seconds start at a different tick from Natural's active time.

### What this settles

This ADR closes the idle agency ADR's follow-up "A beat estimate for sway". Existing ADR bodies are not edited.

## Consequences

- With beat sync running under Natural, a groove nods on the beat, half-time on most songs. Without beats she sways as before.
- The headless `idle`, `idle-drive` and its acts-off companion, `sleepy-no-clip`, and `music` runs are `IDENTICAL` between the slice's base and tip, and the Live2D rig hash is unchanged.
- In `music-beat`, both sways bind on their start frame with 4 beats per cycle, and the head's low points fall 2 beats apart. Their error against the true beats has a median of 23 and 27 ms. Outside the sways every root and channel frame equals `music`'s. Some arm and hand rotations differ by at most 0.55 degrees for up to about 10 s after a sway ends: the arm springs settle from a different end phase.
- The detector's first beat comes about 23 s after music starts, while its threshold history fills, so the first groove of a song can come no sooner than about 31 s in.
- Whether the groove feels right stays a visual review.

## Alternatives considered

- **The mind chooses whether to follow the beat.** It adds a draw that moves the idle stream for a feel question nobody has asked. Rejected (D1).
- **Each scene subscribes to beat sync itself.** It duplicates the driver gate and runs in follower windows. Rejected (D2).
- **A free sway locks mid-way.** It needs a phase hand-over on both renderers. Rejected (D3).
- **A turn and a bob on every beat.** It doubles her speed on most songs and inherits every octave error. Rejected (D4).
