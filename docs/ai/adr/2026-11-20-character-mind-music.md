# Character mind music: one detector, and the mind decides the groove

Date: 2026-11-20
Status: accepted. Slice CM5a of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-music`, stacked on CM4b (`luke/feat/character-mind-idle`). It builds on the [character mind ADR](2026-11-17-character-mind-direction.md), the [character mind core ADR](2026-11-18-character-mind-core.md), the [character mind idle ADR](2026-11-20-character-mind-idle.md), and the [idle agency ADR](2026-11-12-idle-agency.md) with its amendments. The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D1 to D14 name the forks in the slice's plan, `.omo/plans/character-mind-music.md`. Current rules: [Autonomous behavior](../context/autonomous-behavior.md) and [Body ownership](../context/body-ownership.md).

## Context

Two music detectors answered the same audio with no shared state (overlap 2). The level detector `resolveMusic` counted music from the system-audio level and set the idle drive's `music` field, which only reached the mind through Natural's reported view. Upstream's beat sync detector sent beats to its own head plugins. Its `pre` plugin sprang the Live2D head angles under every driver, and Natural overwrote them afterward (overlap 1). Only a code comment recorded that the fork kept beat sync's layer off under Natural. Autonomous behavior Target rule 6 and Body ownership Target rule 2 ask for one detector, music as a stimulus of the mind, and Natural as the only writer of posture under Natural.

## Decision

### Scope

1. **CM5 splits into CM5a and CM5b (D1).** CM5a meets the roadmap's whole Done-when and changes no shape and no constant. CM5b makes the groove follow the beat, which needs a new shape rule and a visual review.

### The detector

2. **Upstream's beat sync detector is the one music detector (D2).** It is the only source that can give the groove a beat, and it already has the user's switch. The level path ran only from a devtools page, and a media-session sensor would say nothing about the beat.
3. **The detection rule (D3).** A run of beats is music once it has lasted 8 s (`MUSIC_SETTLE_MS`) with no gap over 1.8 s (`MUSIC_RELEASE_MS`, upstream's default `releaseDelayMs`). A longer gap ends it. A game, call, or chat app in front ends the run and blocks beats. Her own speech no longer pauses the answer, because that term changed no decision. The pure module is `packages/stage-shared/src/music/index.ts`. This is the slice's one timing change.
4. **Detection runs in the leader's mind store (D4).** `MindMusic` turns beats into edges and arms one timer at `nextMusicDeadline`. The store owns the mind and outlives stage remounts.

### Music in the mind

5. **Music is a `music` stimulus, kept in `MindState.music` (D5).** `NaturalIdleDrive.music` is gone. Natural never read it.
6. **The groove is the `sway` act, drawn by the mind only while it hears music, at today's odds (D6).** The idle schedule reads the mind's music through `IdleContext`. A new episode would need new length and rate constants, which is tuning.
7. **The act kind keeps the name `sway` (D7).** "Groove" is the glossary term for the episode. A rename would churn QA markers, reports, and the MMD act kinds with no behavior gain.

### Beat sync and hosts

8. **Beat sync is `silent` under Natural (D8).** `beatSyncMode` replaces `isBeatSyncLayered`. Under Natural the `pre` plugin advances the controller and its springs and writes nothing, and the `layer` plugin adds nothing. The springs keep moving, so a switch to Universal mid-song does not kick the head. Universal and MAGIC run beat sync as upstream ships it.
9. **Beat sync's settings page is unchanged (D9).** Its Start is also how the mind hears music under Natural. Nothing starts an audio capture by default.
10. **Only the leader hears music, while it leads (D10).** The store starts `MindMusic` at promotion where `isBeatSyncSupported()` holds, stops it at demotion, and re-sends the music after a mind reset.
11. **The watching mode's system-audio rule stays attention (D11).** It decides where she looks, not whether music plays.

### Evidence and body ownership

12. **The `music` headless scenario came first (D12).** No headless run had drawn a sway before. `IDENTICAL` diffs against its first runs prove the move neutral.
13. **Body ownership Target rule 2 lands for grooves (D13).** The expression head tilt part stays in Target for CM7.
14. **On MMD the groove is a body offset (D14):** the performer's existing `sway` form. Dance clips stay requests that the director realises, and music starts none.

### What this settles and clarifies

This ADR settles the character mind ADR's open question on the groove's MMD shape (decision 14).

It clarifies the character mind ADR's decision 4. Under Natural the beat sync detector does not go away: it becomes the one detector, and only its writer goes.

It records the fork's beat sync departure, which only a code comment recorded, and settles the beat sync entry of the upstream policy ledger's Decisions to revisit. Existing ADR bodies are not edited.

## Consequences

- Music counts from detected beats instead of the system-audio level. Under Natural she hears music only while the user runs beat sync.
- The headless `idle`, `idle-drive`, `sleepy-no-clip`, and `music` motion blocks are `IDENTICAL` across the slice. Only the drive's provenance differs.
- With music on, the groove's long-run rate is 14.2 per hour, measured over 1000 simulated hours. Music changes no rate.
- Natural is the only writer of the Live2D head angles under Natural. Overlaps 1 and 2 are closed.

## Alternatives considered

- **One PR with the beat lock.** It holds the structural move behind a visual review. Rejected (D1).
- **Keep the level detector, or add a media-session sensor.** Neither gives a beat. Rejected (D2).
- **Keep the speaking gate, or add a tempo-regularity rule.** The gate changed no decision, and the rule would add constants. Rejected (D3).
- **Detect in `Stage.vue` or the conductor.** One detector per stage, and lost at remount. Rejected (D4).
- **A new groove episode that lasts while music plays.** It needs new constants. Rejected (D6).
- **Unregister the plugins under Natural, or drop beats in `Model.vue`.** The `pre` plugin writes even without beats, and a switch would kick the head. Rejected (D8).
- **Listen by default.** A privacy decision that opens the portal picker at every launch on Wayland. Rejected (D9).
- **A clip for the MMD groove.** It needs a clip the app may not ship. Rejected (D14).

## Not decided

- The beat lock: the groove's period and phase following the beat. CM5b owns it, and the idle agency ADR's follow-up "A beat estimate for sway" stays open until it lands.
- The groove's length and rate in daily use. That is tuning after CM5b.
- Listening by default, which stays the owner's privacy question.
