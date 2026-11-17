# Character mind: the target design for autonomy, body, prompt, and state

Date: 2026-11-17
Status: accepted as direction. No code implements it yet. Refactors move the code toward it, one step at a time. Target rules: the Target sections of [Autonomous behavior](../context/autonomous-behavior.md#target), [Body ownership](../context/body-ownership.md#target), [LLM prompt](../context/llm-prompt.md#target), and [State persistence](../context/state-persistence.md#target).

## Context

The four policy docs in `docs/ai/context/` describe the client as it is. Together they list nine autonomous-behavior overlaps, six body-ownership gaps, six prompt gaps, and more than twenty persisting stores outside the persistence rules. The overlaps fall into three kinds:

1. **Two writers on one channel.** Beat sync and Natural both write Live2D head angles. Emotion impulses, pokes, desktop reactions, idle acts, and chat cues each start a glance, and the latest one wins.
2. **One stimulus, several independent deciders.** One touch reaches five deciders with five cooldowns. One return of the user reaches four.
3. **Independent clocks.** The idle draw and the reach-out gate draw separate hazards. Each rendered stage runs its own Natural and its own mood doses.

Earlier refactors fixed overlaps one at a time. The [idle agency ADR](2026-11-12-idle-agency.md) folded three idle timers into Natural's one draw. Without a stated target, each later refactor would decide the shape again. This ADR states the target once. The rules live in the Target section of each policy doc.

## Decision

Luke made these decisions on 2026-11-17.

### One character mind

1. **One mind per character, in the leader window.** A [character mind](../context/glossary.md#character-mind) receives every [stimulus](../context/glossary.md#stimulus): touch, cursor notice, the user's return, music, desktop events, chat, and elapsed idle time. It emits [intents](../context/glossary.md#intent) on [channels](../context/glossary.md#channel). It runs on one clock. Mood, idle draws, refractories, and reach-out pacing exist once per character, not once per stage.
2. **The mind decides episodes; the performer runs frames.** The mind decides discrete episodes at event rate: start an idle act, glance at a target, react to a touch, fall asleep, groove to music, speak or stay silent. The per-stage [performer](../context/glossary.md#performer-target) owns continuous per-frame control: fixation, cursor tracking, springs, breath, lipsync, and blending. Noticing the cursor is a mind decision. Tracking it is the performer's.
3. **Voice is a channel.** The urge gate and the spoken reaction policy become the mind's voice policy, on the same clock as body episodes. The mind knows what the body is doing when it wants to speak. It can answer one touch with a body reaction or a spoken line, chosen together. Widget and plugin turns that make her speak are stimuli too: the voice policy decides their timing and may defer them, for example while the user types, but never drops them silently. Only the user's own turns bypass the mind.
4. **Music is a stimulus.** One music detector feeds the mind. The mind starts a groove episode, and the performer realises it through Natural's head channel (and the MMD body). The separate beat-sync writer and its separate detector go away.

### Performers and renderers

5. **Renderer deciders react to intents and their own world only.** A renderer may keep deciders for choices only it can make, such as the MMD body director's stance, clip, and locomotion choices. They act on the mind's intents and on the renderer's own world (stage geometry, clip library, walking state). They never subscribe to raw stimuli such as touch, cursor, return, or chat.
6. **Capabilities are declared.** Each performer declares the episodes and gestures it can realise. The mind issues only declared ones. The prompt's `actions` segment offers the model only declared ones. A refusal is a reported event, never a silent drop.
   - **Expressions split the same way.** The mind decides the emotion, its strength, its hold, and the reason, and owns emotional habituation. Each performer maps that intent to its own model's assets: the picker, combos, moments, pastimes, and the user's mapping over its catalog. A performer seeds its pick from the intent's id, so two stages showing one model agree. It reports when a clip, a manual switch, or a missing asset masks or refuses the expression. An explicit request from the model for a named expression travels as an intent that names the entry.
7. **Natural is the only motion driver.** Classic (MMD), Universal, and MAGIC (Live2D) retire as character drivers. Motions a model ships with become material the Natural performer may use to realise an intent; they never compete with it.
8. **One owner per channel.** Natural owns posture. Anything else that wants posture, such as an expression's head tilt or a groove, is an input Natural composes as an offset with a declared weight. It is never a second writer.

### Interface of the mind

9. **Pure core, thin shell.** The core is a pure function, `step(state, stimuli, nowMs, rng) -> { state, intents }`, over plain serializable state. A thin class in the leader window owns the clock, the random source, persistence, and the eventa transport to the stages. Tests drive the core with scripted stimuli and a seeded random source, with no Vue and no timers.
10. **Slow state is the per-card character state.** One mind per character means the existing per-card character-state record (IndexedDB, tier 4 of the persistence rules) is the mind's slow state. Only the leader reads and writes it. It holds mood, energy, temperament, relationship, and the voice policy's pacing memory (urge memory, last-spoke times, own-day weight). The core applies decay for the time away on load. Fast state (running episodes, cooldowns under a minute) resets on launch. A card export carries temperament only; mood, relationship, and pacing memory never leave the device. "Delete all data" clears the record.

### Settings, prompt, and state

11. **Behavior settings belong to the character.** Settings about what she decides (idle activities, touch reactions, mood, held emotions, chattiness, quiet rules) live in one character-behavior document that the mind reads. Renderer settings pages hold only realisation settings (clip curation, stance clips, roam mode, cursor sensitivity).
12. **One composer for every character call.** Every LLM call that speaks or acts as the character goes through one composer with the same segments, caps, and memory source: the speaking character's. The paths (chat, unprompted, Spark Notify commands-only) differ only by declared request inputs, never by their own concatenation. A segment with no producer is deleted.
13. **One registry for persisted state.** Every piece of persisted client state is declared at one registration point with its tier, keys, and reset. A focused test fails when storage is written under a key that no registration owns. The existing gaps are migrated.

### Scope and order

14. **The target wins in client stage code.** In the client stage packages (`stage-ui`, `stage-shared`, `stage-pages`, `stage-layouts`, the renderer packages, the motion drivers, and `apps/stage-tamagotchi`), refactors restructure upstream code where the target needs it and absorb the merge cost at sync. The projects that the README's support scope keeps from upstream stay untouched.
15. **Order.** The planned upstream sync comes first. The first refactor after it extracts the mind's pure core and routes touch, return, idle, and voice through it.

## Consequences

- Each rendered stage becomes a view of one character. Touching either stage doses mood once, and both stages show the same idle act.
- Users of Universal, MAGIC, and classic lose those modes. A Live2D model whose parameters Natural cannot drive well needs a realisation path, which is an open question below.
- Upstream changes to the retired drivers, the chat store, and plain-ref settings stores will conflict at sync. That cost is accepted (decision 14).
- Mood, relationship, and pacing memory on disk are personal data the fork owns. The registry (decision 13) and "Delete all data" must cover them from their first commit, and a card export must leave them out.
- Each performer keeps a catalog-aware picker, so per-model knowledge stays out of the mind. The price is a report channel from the performer back to the mind for masked and refused expressions.
- Each policy doc keeps two parts: current sections that describe the code, and a Target section. When a refactor lands, its rule moves from Target into the current sections, and its gap or overlap entry is removed.

## Open questions

- **Models Natural drives poorly.** What the performer does for a Live2D rig with non-standard parameters once Universal retires.
- **Leadership hand-off.** How the mind's state moves when the leader window closes and another window takes the lead.
- **Per-window stimuli.** The cursor and touch are per stage. Which stage's stimulus the mind takes when two stages report at once.
- **The groove episode's shape on MMD.** Whether it is a Natural body offset, a clip, or both.

## Alternatives considered

- **Per-channel arbiters only.** Fixes two writers on one channel, but one touch still reaches five deciders. Rejected.
- **Per-stimulus interpreters only.** Fixes one stimulus with several deciders, but not glance or beat-sync fights on a channel. Rejected.
- **One mind per stage.** Today's behavior. Keeps double mood doses and unsynchronised idle acts across stages. Rejected.
- **Renderer deciders on raw stimuli.** Simpler, but the mind could not coordinate a touch or a return across voice, face, and body. Rejected.
- **Per-path prompt profiles.** Allows a deliberately lean commands-only prompt, but keeps the divergence the prompt gaps record. Rejected.
- **Seam outside upstream code.** Keeps syncs clean, but leaves the design blocked wherever upstream stores sit in the path. Rejected for client stage code; kept for whole kept-from-upstream projects.
- **Nothing persists.** No personal state on disk, but she resets emotionally on every launch and reach-out pacing restarts. Rejected.
- **A separate leader-only store for the mind's slow state.** It would duplicate the per-card character-state record and need syncing with it. Rejected (amended 2026-11-17).
- **The mind picks the expression asset.** One decision for all stages, but the mind would need every model's catalog and would couple to renderer assets. Rejected.
- **Widget and plugin turns keep bypassing the gate.** They would stay a second, unpaced voice. Rejected.
