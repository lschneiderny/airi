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
- `CharacterMind` is the shell. It owns the clock, the random source, and the state, and it never passes the core an earlier time than the last one. It persists nothing: every mind starts from `initialMindState`.
- `seededRandom(seed)` is the shell's random source: the same seed gives the same draws.

### Stimuli and intents

| Stimulus | Intent on the `face` channel |
| --- | --- |
| `emotion` | `emotion`, with the episode and its hold, when the emotion starts or escalates an episode. `release` with scope `neutral` when a neutral resets the reaction state. Nothing for a repeat that does neither. |
| `expression-request` | `entry`. With an emotion mapping and held emotions on, it carries a hold for the entry's lease, and the episode when the request started one. |
| `expression-clear` | `release` with the named slot as its scope, or scope `all` and a hold release when no slot is named. |

The mind decides the emotion, its strength, its hold, and the reason. It reads no catalog: the caller reads a named entry's lease and primary emotion mapping from the catalog of the rendered model and sends them with the request. Which entries show an emotion stays with each performer.

Every stimulus advances `MindState.seq`. An intent's `cause` is the sequence number of the stimulus it answers, and its `id` is unique within one mind.

The emotion rules still keep their own random checkpoint, so `initialMindState` takes the seed and `step` does not draw from `rng` yet.

## Checks

```bash
pnpm -F @proj-airi/character-mind exec vitest run src/step.test.ts
pnpm -F @proj-airi/character-mind typecheck
```

## When to use

Use this package for a decision about what the character does at event rate: which emotion episode starts, how strong it is, and how long it is held. Drive the core from tests with scripted stimuli and a seeded random source.

## When not to use

- Keep per-frame control (fixation, springs, blending) and the choice of a model's assets in the performers and their packages.
- Do not import Vue, Pinia, a store, or a renderer here, and do not read a clock or a global random source outside `mind.ts`. The `airi/character-mind-pure` lint blocks enforce both.
- Put a pure rule that the asset deciders also use in `@proj-airi/stage-shared`; the mind composes it from there.
