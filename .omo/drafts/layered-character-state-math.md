# Advisory lane output: math (st_01a1a36c), 2026-11-03
Claims to verify; not decisions.

st_01a1a36c [completed] transcript via event-log:
assistant: I read this as an advisory-only design request: I'll read the ADR, mood.ts and the situation module, then return the formulas with worked numbers. I'll stop when all seven parts are answered in text.
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
assistant: I read this as an advisory-only design request. I read the ADR, `mood.ts` and the reach-out reason types, then checked every formula with a scratch simulation in the eval kernel. No files were edited.

## Bottom line
Use **3 mood axes**: valence and energy in [-1,1], tension in [0,1]. Mood is computed in a squashed space: `m = tanh(atanh(B) + raw)`, and tension uses a logistic with gain 4. Contributions expire exactly at a fixed time, and per-source budgets cap the raw sum, so the model can't push mood up without limit. Temperament advances in whole epoch hours, so replaying it gives identical results. Relationship levels saturate as they grow, have a daily gain cap, and change stage with hysteresis. Stage-ups happen only at the 04:00 rollover. Effort: **Medium**, mostly pure functions and tests.

## 1. Mood

**Why 3 axes:** the face needs a brows channel. Without tension, "hurt and sulky" and "tired and sad" look the same, and the moment layer already has three axes (`valence/arousal/tension`), so the mapping is 1:1.

```ts
export type MoodAxes = Readonly<{ valence: number, energy: number, tension: number }>
export type MoodSource = 'model-cue' | 'touch' | 'reach-out-unanswered' | 'reply' | 'return' | 'significant' | 'ritual'
export interface MoodContribution {
  readonly id: string // idempotency key, e.g. `unanswered:${reachOutId}`
  readonly source: MoodSource
  readonly reason: string // short English phrase, at most 60 characters
  readonly atMs: number
  readonly halfLifeMs: number
  readonly delta: MoodAxes // effective delta, after headroom and budgets
  readonly expiresAtMs: number // atMs + halfLifeMs * log2(maxAbs(delta) / MOOD_EPSILON)
}
```

**Formulas** (with `MOOD_EPSILON = 0.01`):
- `remaining(c,t) = (t < c.atMs || t >= c.expiresAtMs) ? 0 : 2^(-(t - c.atMs)/c.halfLifeMs)`
- `raw_a(t) = Σ c.delta_a · remaining(c,t)`
- `valence = tanh(atanh(T_v) + raw_v)`, and the same for energy.
- `tension = σ(logit(T_t) + 4·raw_t)`.

**Saturation:** `dm/draw = 1 − m²`. A nudge has full effect at m=0 and only 36% of its effect at m=0.8. Tension with gain 4 has slope 0.51 at the 0.15 baseline. With gain 1 tension hardly moved (slope 0.13), which is why it is 4.

**Pruning:** a contribution counts as exactly zero at `expiresAtMs`, so pruning only removes zeros and never changes a value. A cap of 64 entries is an assertion; the budgets keep about 15 entries live at most.

**Headroom at insertion:** before storing a delta, shrink it so the raw sum stays inside the rail: `d_eff = sign(d)·min(|d|, max(0, 2.5 − sign(d)·raw))`. This puts `|raw| ≤ 2.5`, so valence can't exceed 0.99.

**Model cue:**
- The cue sends directions per axis in {-1,0,1} plus a reason. It never sends numbers.
- The step is 0.08 per axis, with a 90-minute half-life. At most one cue per turn.
- Budget: the sum of |model deltas| on each axis over a rolling 60 minutes is at most 0.24. Anything beyond that is truncated.

**Event table** (Δv, Δe, Δt, half-life):

| Event | Δv | Δe | Δt | Half-life |
| --- | --- | --- | --- | --- |
| Pleasant touch (budget 0.3/h) | +0.10 | +0.05 | −0.03 | 1.5 h |
| Unwelcome touch | −0.08 | +0.05 | +0.08 | 1 h |
| First unanswered reach-out (90 min, no reply) | −0.06 | −0.03 | +0.06 | 3 h |
| Second consecutive unanswered | −0.12 | −0.05 | +0.10 | 6 h |
| Late reply (appended; the original stays) | +0.06 | 0 | −0.06 | 2 h |
| Significant, model-marked (at most 2/day) | ±0.25 | ±0.10 | +0.15 if negative | 9 h |
| Ritual reciprocated | +0.05 | +0.03 | 0 | 2 h |
| Return after gap g | +0.15·f | +0.10·f | +0.10·f | 4 h |

For the return event, `f = clamp(log2(g/12h)/3, 0, 1)`: 24 h gives 0.33, 48 h gives 0.67, 96 h gives 1.

**Worked examples:**
- Ten "lift" cues in one hour: the budget keeps three, so raw is 0.24 and valence goes from 0.10 to `tanh(0.100+0.24)` = **0.328**.
- Model spam every minute for 3 days (simulated): raw levels off at 0.35 and valence at **0.53**, with 15 live entries.
- A hurt event plus a second unanswered message at the 0.15 tension baseline: v=−0.26, e=−0.15, t=0.32. After 9 h: v=−0.07, t=0.22. After 30 h: back near baseline (v=0.075, t=0.158).

## 2. Temperament
The continuous model is `dT/dt = k_T·(m − T) + k_A·(R − T)`:
- `k_T = ln2/5d` is the EMA of mood.
- `k_A = ln2/10d` is the pull back to the card's resting value R.

**Discrete update:** process only **completed epoch hours** `[h, h+1h)`:
- `T ← R + (T − R)·e^(−k_A·1h) + k_T·1h·(m(h+30min) − T)`
- Then clamp `|T − R|` to at most v 0.3, e 0.25, t 0.15.

**Why this survives days of closure:** on load, the update loops over each missed hour. Mood during that time is a pure function of the stored contributions, so after they expire only the anchor pull acts. Because the hour grid is fixed, the result doesn't depend on when loads happen. Advancing to 10 days in one call and in four separate calls gave bit-identical values (checked). One +0.25 event raises T.v from 0.100 to 0.115 after a day, and it falls back to 0.109 by day 10.

## 3. Relationship
Three dimensions, all in [0,1]:
- **closeness**: emotional intimacy.
- **trust**: you are safe and keep your word.
- **familiarity**: she knows your life and routines.

Also store `activeDays`, `wound`, and `milestoneIds[]` (long-term memory refs). A fourth dimension isn't needed; "affection" is just closeness.

**Daily diminishing returns:** keep a raw sum S per dimension for each logical day. The day's effective gain is `E(S) = G·(1 − e^(−S))`, and an event of size x adds `ΔE = E(S+x) − E(S)`. The level update is `level += (1 − level)·ΔE`, which saturates near 1. Daily caps G: closeness **0.02**, trust **0.012**, familiarity **0.03**. A typical day (S = 1.7) yields 0.82·G, heavy farming (S = 10) yields 1.00·G, and a light day (S = 0.6) yields 0.45·G.

**Raw event points** (c = closeness, f = familiarity, t = trust):

| Event | Points |
| --- | --- |
| First real exchange of the day (at least 3 user turns) | c 0.4, f 0.4, t 0.2 |
| Each later user turn | c 0.05, f 0.05 |
| Replied to a reach-out within 2 h | c 0.2, t 0.2 |
| Self-disclosure (written to memory) | c 0.3, f 0.4, t 0.1 |
| Kept promise (a thread followed up) | t 0.4 |
| Milestone (at most 1/day) | c 0.5, f 0.2, plus a memory ref |
| Pleasant touch (at most 1 counted per hour) | c 0.1 |
| Ritual reciprocated | c 0.1, f 0.1 |

**Asymmetric trust:**
- Unkind: `trust ×= 0.95`, closeness −0.01.
- Hurtful: `trust ×= 0.85`, closeness −0.03, `wound += 0.15`.
- Persistent unwelcome touch: `trust ×= 0.97`.
- At most 2 negative events count per day.
- Trust gains are multiplied by `(1 − wound)`, and wound has a 5-day half-life. Trust drops fast and recovers slowly.

**Absence:** closeness never changes because of absence. On return after a gap g longer than a 3-day grace period, apply one event `absence:${lastDayKey}`: `f = 0.6·f + 0.4·f·2^(−(g − 3d)/60d)`. A 10-day gap costs about 3%.

**Thresholds** (up / down):

| Dimension | Stages |
| --- | --- |
| Closeness | friendly 0.15/0.10, close 0.35/0.28, intimate 0.60/0.52 |
| Trust | open 0.35/0.30, confiding 0.45/0.39 |
| Familiarity | knows-you 0.25/0.20 |

**Unlocks:**
- Teasing: friendly and open.
- Nicknames: close and knows-you.
- Initiative: close.
- Vulnerability: close and confiding.
- Callbacks: knows-you and at least 3 milestones.

**Hysteresis rules:**
- Stage-ups are applied only at the 04:00 rollover, at most one per dimension per rollover. The reward shows up as "the next morning she calls you X".
- Stage-downs apply immediately.
- Positive input can't lower a level, and each down-gap is at least 0.05, so a stage only drops after a real negative event.

## 4. Rendering to words
**Buckets** (exit hysteresis 0.05, or 0.04 for tension):

| Axis | Labels and boundaries |
| --- | --- |
| Valence | upset < −0.45 ≤ low < −0.15 ≤ even < 0.15 ≤ good < 0.45 ≤ bright |
| Energy | drained / tired / steady / lively / buzzing, same boundaries |
| Tension | relaxed < 0.22 ≤ a little on edge < 0.45 ≤ tense |

A value must pass the boundary by the hysteresis amount before it leaves its current bucket.

**Reasons:**
- Weight `w = remaining·(|Δv| + |Δe| + |Δt|)`, multiplied by 0.5 when the source is `model-cue`, which damps self-confirmation.
- Show the top 2 with `w ≥ 0.04`.
- A reason already shown stays until its w drops below 0.03, or below half the weight of the best excluded candidate.
- List reasons in `atMs` order, not rank, so a change in ranking doesn't reorder the text.

**Prompt stability:**
- Use coarse time words relative to the logical day ("earlier today", "last night", "yesterday").
- Store `{buckets, reasonIds}` and re-render the line only when that tuple changes. That is about 4–8 changes a day.
- Put the mood line after the persona and relationship segments, which change less often.

## 5. Face offset
Use `d_a = m_a − R_a`, the deviation from the card's resting value.

**Damping:** `D(τ) = 0.25 + 0.75·2^(−max(0, τ − 2min)/20min)`, where τ is the time since the last user message, touch, or character speech.

**Channels:**
- `mouthCorner += 0.35·d_v·D`
- `eyeOpen += 0.15·d_e·D`
- `blinkRate ×= clamp(1 − 0.25·d_e·D, 0.6, 1.4)`
- `browInner += 0.4·d_t·D`

Each channel's offset stays within 35% of its range. Pass the result through a first-order filter (τ = 1.5 s) so an inserted contribution or a jump in D doesn't make the face pop. The moment layer plays on top unchanged.

## 6. Reach-out urge
`urgeFactor = exp(clamp(0.35·v + 0.15·e − 0.2·max(0, t − 0.3), −0.4, 0.3))`. The range is [0.67, 1.35], and it multiplies the existing gate's hazard. Worked values: (0.4, 0.2, 0.1) gives **1.185**, and (−0.4, −0.1, 0.5) gives **0.823**.

The unanswered and return contributions from §1 feed this factor through mood. They don't touch the gate. The existing second-unanswered quieting and the 4-per-hour rail still apply.

When `v ≤ −0.2`, `t ≥ 0.35` and an unanswered reason is in the top 2, the reach-out prompt says she sends one pointed message rather than several.

## 7. Invariants and property tests
Use a seeded generator. I haven't checked whether `fast-check` is already a dependency, so ask before adding it.

1. **No runaway:**
   - Adversarial streams (a cue every turn, touch spam, up to 30 days) keep `|raw| ≤ 2.5` and model-only raw ≤ `0.24·1.5h/ln2 = 0.52`.
   - Temperament stays within its clamp.
   - Relationship levels stay in [0,1], and daily gain never exceeds G.
2. **Idempotent replay:** `load(save(S), t)` deep-equals `advance(S, t)`. Applying the same contribution id twice changes nothing. Advancing in any split of [t0, t1] gives bit-identical temperament (verified).
3. **Deterministic:** all functions take `nowMs` explicitly, with no `Date.now()` inside. The same seed and a fake clock give identical snapshots.
4. **Monotone decay:** with no inserts, `|raw_a(t)|` doesn't increase over t, and `|T − R|` doesn't increase once raw is 0.
5. **Threshold stability:**
   - Add ±0.005 noise to levels, or replay positive-only days: at most one stage change per rollover and zero stage-downs.
   - Valence noise of ±0.04 around a boundary never changes the bucket.
6. **Pruning is invisible:** `mood(prune(S,t), t') == mood(S, t')` for all t' ≥ t.

## Simulation (30 days, scratch code)
The simulated use: greeting at 08:00, one unanswered reach-out per day, an evening session with 3 cues (75% positive), 2 touches, a significant positive event every 3rd day, away days 15–17, a hurtful event on day 22.

- **Mood:** valence 0.03–0.65, energy −0.04–0.30. On day 22 the 21:30 valence was 0.27.
- **Temperament:** T.v rose from 0.10 to 0.19, below its 0.40 clamp, and T.e from 0 to 0.04. At most 7 contributions were live.
- **Relationship:**

| Day | Closeness | Familiarity | Trust |
| --- | --- | --- | --- |
| 30 | 0.35 (close) | 0.48 | 0.33 |
| 60 | 0.62 (intimate) | 0.75 | 0.42 |
| 90 | 0.78 | 0.88 | 0.50 (confiding around day 70) |

The hurt on day 23 dropped trust from 0.344 to 0.307.

That month run used gain-1 tension, so it can't show the tension range. The gain-4 tension values come only from the single-event checks in §1.

## Risks
- **The model rewarding itself:** the self-confirming loop is still possible. The 0.5× reason weight and the budget only limit it; a model-eval check should confirm this.
- **Gaming milestones:** the model could mark too many exchanges as milestones. The 1-per-day cap only limits it.
- **Drift under constant spam:** under nonstop maximum model cues, temperament rose 0.14 in 3 days. If that is too fast, halve `k_T` for the `model-cue` source.
