# Character mind idle: the mind decides her idle acts and sleep

Date: 2026-11-20
Status: accepted. Slice CM4b of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-idle`, stacked on CM4a (#57). It builds on the [character mind ADR](2026-11-17-character-mind-direction.md), the [character mind core ADR](2026-11-18-character-mind-core.md), the [character mind slow state ADR](2026-11-19-character-mind-slow-state.md), and the [idle agency ADR](2026-11-12-idle-agency.md) with its amendments. The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D1 to D16 name the forks in the slice's plan, `.omo/plans/character-mind-idle.md`. Current rules: [Autonomous behavior](../context/autonomous-behavior.md) and [Body ownership](../context/body-ownership.md).

## Context

Each stage's `NaturalIdleActivities` drew its own idle hazard on Natural's clock from its own random stream, so the voice gate and the idle draw ran on two clocks (overlap 3), and two stages in one window drew two schedules (overlap 5). Natural also decided sleep while `useIdleProps` showed it (overlap 9). Autonomous behavior Target rules 1 and 3 and Body ownership Target rule 1 ask for one decider per character, on the mind's clock and seeded source.

## Decision

### Scope

1. **CM4b is one PR (D1).** Acts and errands share one hazard, so any PR boundary between the scheduler and its realiser leaves two deciders running. The first commit is a behavior-neutral extraction that proves itself with `IDENTICAL` headless diffs.

### Who decides what

2. **The rules stay in `motion-driver-natural` (D2)**, in the pure module `idle-schedule.ts`. `character-mind` imports it by subpath, and a lint block keeps it pure. This follows core ADR decision 3.
3. **The mind decides at exact deadlines (D3).** Natural reports edges, and the host arms one idle wake timer at `nextIdleWakeAt`. A 1 Hz sample would delay every decision by up to a second.
4. **Idle time is the mind's clock counted while the view is active (D4).** A hidden or paused stage does not advance idle time, as before.
5. **The mind's source draws the schedule, and each act carries a seed for its shape (D5).** The odds do not change; the headless traces do.
6. **Natural keeps shapes, interruption, settling, cue acceptance, the pastime hold end, and the errand record (D6).** Each must act within one grid step.
7. **`useIdleProps` follows Natural's `idle` report for sleep (D7)**, so the props show the sleep she performs, not the sleep that was asked for.
8. **`allowSleep` leaves the idle drive (D8).** Nothing narrowed it, and the rule that read it moved into the mind.
9. **Natural's fast mood stays a performer channel (D9).** The mind decides every dose already; the afterglow is a frame-sampled value on active time.
10. **The bridge's slow touch dose stays in the bridge (D10)**, as the slow state ADR's D9 keeps the record's events with the store.

### Hosts and drivers

11. **Under drivers other than Natural the idle policy is dormant (D11).** No stage reports a live view, so the mind decides no act and no sleep.
12. **Idle intents go to every attached stage of the window, and only the newest stage reports (D12).** Each act carries its seed, so two stages would show the same act and shape.
13. **The lab's requested play goes through the mind as `idle-play` (D13)**, so cooldowns, recency, and no-repeat see it.
14. **The headless MMD runner drives idle through a mind (D14)**, so its runs test the product path.
15. **The mind store arms the idle wake (D15).** It owns the mind and outlives stage remounts.
16. **A decided act that Natural cannot start spends the fire (D16).** Natural reports `refused`, as an empty pick was spent before. A retry would raise the effective rate.

### What this supersedes and settles

This ADR supersedes the idle agency ADR's statements that Natural draws the idle schedule and that the idle drive has `allowSleep`. The idle agency ADR's body is not edited.

It settles the core ADR's last "Not decided" item: Natural's fast mood stays a performer channel (D9), which makes the core ADR's decision 16 permanent.

### A correction to the slow state ADR

The slow state ADR's decision 2 calls `useCharacterMindStore` a leader-only store. The code differs: every window that creates the store constructs a mind, only the leader's mind connects to the gate, and no follower renders a stage today. Its decision 3 states this correctly. Autonomous behavior rule 18 now states the code's behavior.

## Consequences

- Every idle draw in the headless traces changes: `qa:motion3d diff` reads `DIFFERENT` for `idle-drive` and `sleepy-no-clip`. The odds are unchanged.
- The long-run rates stay within their pins: acts 59.6 per hour idle against a 58.0 pin, and 42.2 per hour working against a 41.7 pin; pastimes 5.49, clips 12.40, and wanders 4.20 per hour.
- The sleep delay follows the uniform 12 to 30 s draw. A 400-seed test checks it.
- A stage that is hidden does not advance idle time.
- Under Universal she never sleeps, as before.

### Known evidence caveat

At seed 1, the `rest-posture` line of the `rest` report reads FAIL at the tip and PASS at the base. A seed sweep showed that this follows the draws, not the code: the tip passed 5 of 6 seeds and the base 6 of 6, and the only failure is the only run at either end with a zone-out in the baseline window.

## Alternatives considered

- **An extraction PR first, then the switch.** It leaves two deciders running between them. Rejected (D1).
- **Move the rules into `character-mind` or `stage-shared`.** It splits the pins from the constants the reports describe. Rejected (D2).
- **A 1 Hz eligibility sample.** It breaks the `sleep-onset` bound. Rejected (D3).
- **Wall time for idle.** It changes what she does on return. Rejected (D4).
- **Keep `allowSleep` and read it in the mind.** Nothing narrows it. Rejected (D8).
- **Move the fast mood or the slow touch dose into `MindState`.** Rejected (D9, D10).
- **A runner-only scheduler for headless runs.** It is a second decider. Rejected (D14).
- **Retry a refused act.** Rejected (D16).

## Not decided

- Reporting a skipped cue as a refusal (Body ownership Target rule 4).
- Letting the voice gate read what she is doing (`state.idle`). That is tuning.
- Overlap 12: whether a notice turn starts the floor stays the owner's question.
