# Unprompted reach-out cadence

Date: 2026-10-30
Status: accepted

## Status

Accepted. This decision supersedes only the opportunity-gate section of the
2026-10-19 situational-presence ADR.

## Context

The previous opportunity gate could speak as soon as a minimum gap elapsed
whenever another desktop event arrived. With frequent app changes, that made
her sound like a metronome and made her subjects feel like surveillance:
remarks followed window titles instead of the relationship.

The intended experience is a few messages a day, like a girlfriend texting
her partner. Her subjects should usually be shared conversation threads,
small daily rituals, or something from her own improvised day. Long sessions,
returns, and notifications remain limited reasons to react to the screen.
Silence should be the normal outcome, and Chattiness should change the average
rate rather than determine a gap or threshold.

## Decision

### Product decisions

Luke chose the product direction on 2026-10-29:

- Reach out a few times a day, with Chattiness controlling the mean rate.
- Improvise her own-day thoughts when a turn is considered; do not store daily
  beats. Defer callbacks across days.
- Limit screen reactions to eligible long sessions, returns, and notifications.
- Extract conversation threads with the active chat provider and model.
- Add no Presence toggles. A forced plugin or widget turn starts the two-minute
  floor for the next unprompted turn.
- Test after implementation. Keep extraction visible in the inspector only,
  never in chat history.
- Use the girlfriend messaging frame for cadence and subjects.

The implementation uses a pure urge gate beside the bounded situation event
ring. The gate integrates a hazard over elapsed time and fires after crossing
an exponentially distributed threshold, `Exp(1)`. Social phases shape which
categories can accrue hazard: an active exchange suppresses new openings.
After one unanswered opening, only a continuation can open during the
continuation window; when that window ends, openings resume at a reduced rate.
Only a second unanswered message quiets the gate for hours, except for urgent
notifications. A user's reply gradually restores the rate. A two-minute floor prevents
closely spaced non-urgent openings, with a bounded double-text exception.
Four non-urgent fires per hour remain as a safety rail.

Reasons live in a separate `ReasonState` beside the event ring. It holds
session-scoped conversation threads and logical-day rituals; the own-day
baseline is improvised when needed. Candidate categories compete by hazard,
then weighted-random selection chooses among eligible reasons. The gate's
checkpointed `rngState` makes this deterministic across evaluations and
reloads. Passing a `random()` function was rejected because it cannot be
checkpointed.

The logical day rolls over at 04:00. Greeting, late sign-off, and welcome-back
rituals are tracked once per logical day. The sign-off can fire while he is
present late at night; it is not triggered by idle or lock state. Gate memory,
threads, and ritual completion persist in local storage, outside synced state.
Expired state is pruned when read.

The inspector exposes urge, hazard, phase, ripe reasons, picks, outcomes, and
the extraction ledger so constants can be tuned against real sessions.
At exchange end, thread extraction uses the active chat provider and model.
It reads at most the last 12 user and assistant text items, skips unprompted
user items, truncates each item to 400 characters, and caps the input at 4000
characters. The request caps output at 2000 tokens
(`EXTRACTION_MAX_TOKENS`); an answer that stops at the cap is recorded as
`failed` and is never parsed. The model returns at most three validated
thread drafts, with a
kind, summary of at most 160 characters, cue of at most 200 characters, and
optional due time. Summary and cue text is sanitized and rejected when it
contains control markers or role-prefixed lines. Extraction uses the
unprompted origin without tools, does not fire chat hooks or change the
session message count. It adds no extraction cue or record to chat history;
the extraction outcome is recorded in the inspector ledger. Failures are
recorded without throwing.
A new thread expires at the end of the logical day after the one it was
extracted on (04:00 two calendar days later), or earlier, two ripening
half-lives of its kind after its minimum age. The later bound lets a
follow-up to a late-night chat still ripen after the rollover.
Unprompted requests use four instructions: `base.prompt.unprompted`,
`base.prompt.unprompted-continuation`, `base.prompt.unprompted-ritual`, and
`base.prompt.unprompted-double-text`. Forced turns retain
`base.prompt.unprompted-forced`.

### Timings

These are the delivered values. Each is a `Tuning:` constant in
`packages/stage-shared/src/situation/urge.ts`,
`packages/stage-shared/src/situation/reasons/types.ts`, or
`packages/stage-shared/src/situation/reasons/rituals.ts`.

- Floor: 2 minutes between non-urgent openings (`FLOOR_MS`).
- Safety rail: four non-urgent fires per hour (`SAFETY_CAP_PER_HOUR`).
- Exchange: no new topic for 2 minutes after his latest turn
  (`EXCHANGE_ZERO_MS`); the exchange factor then recovers on a 15-minute
  scale and is about 98% recovered after 30 minutes (`EXCHANGE_SCALE_MS`).
- One unanswered opening: only a continuation can open for 90 minutes
  (`CONTINUATION_WINDOW_MS`); openings then resume at half rate
  (`UNANSWERED_PHASES`).
- Two unanswered messages: only urgent notifications for 4 hours, then
  openings resume at 0.3 of the rate. Three or more: 8 hours, then 0.2.
- Recovery: after a reply, the remaining damping halves each hour
  (`RECOVERY_HALF_LIFE_MS`).
- Double text: a 15% chance of one extra line 10 to 50 seconds after a spoken
  opening, discarded if unsent after 60 seconds (`DOUBLE_TEXT_*`).
- Logical day: rolls over at 04:00 (`LOGICAL_DAY_ROLLOVER_HOUR`).
- Greeting: opens on his first appearance of the logical day between 05:00
  and 15:00 and stays open for 45 minutes. It expires if he speaks first or
  first appears outside that window (`RITUAL_TUNING`).
- Sign-off: open from 22:30 to 01:30 while he is present.
- Welcome-back: opens for 20 minutes when he returns from an absence of at
  least 3 hours that began within the same logical day
  (`WELCOME_BACK_MIN_AWAY_MS`).

This supersedes the opportunity-gate section of
[Situational presence](2026-10-19-situational-presence.md). Other decisions
in that ADR remain in force.

### Calibration and follow-ups

On 2026-10-30, the recommended calibration changing
`OWN_DAY_WEIGHT_MAX` from `0.6` to `0.2` was adopted when Luke's question
timed out. Ripe event threads then win about 71% of the time and question
threads about 58%. The draft's estimate of about `0.3` own-day weight after
90 minutes is therefore about `0.1`.

The cadence simulation found that doubling the base-rate constant does not
make the default-Chattiness band fail: the opening count saturates as other
constraints and rituals limit it. Luke answered on 2026-10-30 that the failure
proof should be the low-side run and that the simulation run should be
lengthened. The recommended increase of the base-rate calibration was adopted
when his question timed out: `BASE_RATE_AT_HALF_PER_HOUR = 1.3`, the smallest
0.1 step whose 200-day default-Chattiness mean is at least 3.2 on all six
seeds. The lowest mean is 3.265. Luke's request to lengthen the run was
implemented as an orchestrator ruling to use 1000 days for the gap-spread
check at `c = 0.5`; its p90-to-median ratio is 2.23 to 2.34. The target floor
for that ratio is 2.0, and the 200-day committed-seed result is 1.994.

Luke also answered that welcome-back should be skipped after an absence
crosses the 04:00 rollover because the greeting covers it. The ritual day
remains only in gate memory (`memory.day`). Inner state writes local storage
directly rather than using `useLocalStorageManualReset`, which can expose
stale snapshots and drop same-tick writes.

The 2026-10-19 gate description used `minGapMs`, `hourlyFireCap`, and
`gateThreshold`; these no longer describe the design. The 3-minute ease-in
after visibility returns replaces the full gap. Engaged and ignored outcomes
settle after 10 minutes.

## Consequences

- The four-fires-per-hour safety rail bounds non-urgent attempts independently
  of Chattiness.
- The instructions `base.prompt.unprompted`,
  `base.prompt.unprompted-continuation`, `base.prompt.unprompted-ritual`, and
  `base.prompt.unprompted-double-text` distinguish ordinary openings,
  continuations, rituals, and double-texts. Forced turns keep the separate
  `base.prompt.unprompted-forced` instruction.
- Regaining visibility uses a 3-minute ease-in, not a full gap.
- Engagement and ignored outcomes settle after 10 minutes.
- A late sign-off can fire while he is present, whether here or idle. Idle and
  lock no longer trigger it.
- Turning **Share the foreground app** off still silences every unprompted
  turn, preserving the existing hard-suppressor contract.
- A gate fire is a full chat call. The redesigned cadence makes fewer such
  calls than the old event-driven gate.
- At `c = 0`, rituals and the remaining baseline still yield about 1.6
  spoken openings a day (1.62 in the seeded 50-day cadence simulation).
- Tune constants against real sessions by reviewing the inspector. The
  simulation models assumed behavior and is not a substitute for live tuning.
- Cross-day callbacks (D1) and stored daily beats (D2) remain deferred.
- The weighted-random choices and calibrated rate are deterministic for a
  given checkpointed state, but different state histories can produce
  different message counts.

## Alternatives

- **Tune the cooldown.** A longer minimum gap would slow the same
  event-triggered metronome, not give messages a natural long-tailed cadence.
- **Put inner reasons in the event ring.** The ring is short-lived and sized
  for observations. Threads need delayed ripening, persistence, and session
  ownership; keeping them beside the ring gives each state a clear lifecycle.
- **Always pick the highest-weight reason.** Argmax selection would repeatedly
  favor a static high-weight reason and starve lower-weight eligible reasons.
- **Pass `random()` into the gate.** A function cannot be saved with gate
  memory. A checkpointed `rngState` makes decisions reproducible across
  reloads.
- **Sync inner state.** Window titles and transient reason state do not belong
  in synchronized Pinia state. Local persistence serves the leader and the
  inspector reads through the existing invoke boundary.
