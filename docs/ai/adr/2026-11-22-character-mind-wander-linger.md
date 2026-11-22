# Character mind: the wander's stay in the errand

Date: 2026-11-22
Status: accepted; CM9d implemented. Headless and rendered acceptance are pending (see the placeholder below).

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md) (the Locomotion row and Precedence rule 8) and the [glossary](../context/glossary.md) (Idle errand). The [CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the split, the decisions table, and the checks. This slice builds on the [settle ADR](2026-11-22-character-mind-settle.md).

## Context

The mind's idle policy decided a wander errand and its visit pick, but the body director drew how long she stayed where the wander or visit took her (`LINGER_MIN_MS` to `LINGER_MAX_MS`, log-uniform, on the director's seeded stream) and decided the walk home. The MMD scene answered the errand `done` as soon as the director accepted it, at departure. Autonomous behavior Target rule 4 listed the linger and the walk home as open.

## Decisions

### The idle schedule draws the stay with the wander

`advanceIdleSchedule` draws a wander's `holdSeconds` right after its pick, from `IDLE_ERRAND_LINGER_SECONDS` (45 to 150 s) with the director's log-uniform law. A pastime's draw is unchanged; an unasked clip draws none. The idle stream gains one draw per wander decision.

Natural records the hold on the errand (`IdleErrandRecord.holdSeconds`). It ends a pastime at its hold, as before, and keeps a wander open: a wander's hold is the stay its realiser keeps.

### D12: the walk home ends the errand; other walks keep the delay

`BodyDirectorInput.wander` carries `lingerSeconds`. `decideBody` stamps `lingerUntilMs` from it on its own clock at arrival or arrival in place, and its seeded stream draws only the wander position. `BodyDirectorMemory.wanderStay` names the accepted errand from its acceptance until she leaves where it took her: at the walk home, at home once the linger passed (no walk is needed), or when another goal takes her away. `wanderErrandAnswer` turns the diagnostics into the realiser's answer, and `MMD.vue` answers the errand `done` then, or `refused` as before. `RETURN_HOME_DELAY_MS` stays the director's rule for the walks the mind did not order as an errand: a chase, a chat approach, a tool, and entering the stage. Option (b), the mind ordering every walk home, was rejected because chase, chat, and tool aftermaths realise the user's or the model's requests.

### D13: a visit that arrives in place uses the same stay

A visit due with the cursor already within `VISIT_STOP_LEGS` arrives in place and stamps the errand's stay, with no director draw.

## Deviations

- **Field name.** The plan names the new memory field `lingerSeq`. It is `wanderStay: { seq, lingerSeconds }`, because the director also needs the accepted errand's stay between acceptance and arrival.
- **Packages beyond the plan's table.** The errand record gained `holdSeconds`, so the first commit also updates the Live2D pastime preview record in `stage-ui` (`use-idle-props.ts`) and its test fixture; the second commit updates the MMD devtools diagnostics fixture in `stage-ui`. No `lab-tools` report reads the removed constants.
- **Natural keeps a wander open.** The plan does not say how Natural treats a wander's hold. Natural ends only a pastime at its hold; otherwise a wander would end at its stay counted from its start instead of from her arrival.
- **Policy doc in the code commit.** Autonomous behavior cited `LINGER_MIN_MS` outside Target, and the policy-docs test requires cited identifiers to exist, so its Locomotion row and Precedence rule 8 change in the director commit.

## Consequences

- While a wander runs, through the walk and the stay, the schedule starts no other errand: an unasked clip or a second wander waits until the walk home. Before, the errand ended at departure, so an unasked clip could be drawn during the stay. The wander's own refractory counts from its start, so its pacing is unchanged.
- No new persisted state, setting, or cross-process event.

## Headless and rendered acceptance

Placeholder for the orchestrator: the base and tip `qa:motion3d` runs for all eleven scenarios at seed 1 (expected `IDENTICAL`, since no scenario lists errands; confirm from the runs' events), the `diff` lines, the Live2D rig hashes, and rendered check 5 of plan section 8 (the wander intent's `holdSeconds`, the body readout's linger, the errand's `done` at `return-home`, or "not exercised").
