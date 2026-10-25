---
slug: natural-motion-quality
status: awaiting-approval
intent: clear
review_required: true
plan_path: .omo/plans/natural-motion-quality.md
plan_sha256: e8e45c4ff33be9e36f5ab954d58349b4f6b1d978e2b5f124b74d6b8500de0918
review_round_id: nmq-r1-1792888482820
review_round_limit: 5
pending-action: write and review .omo/plans/natural-motion-quality.md
review:
  plan_reviewer:
    status: approved-round-1
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/natural-motion-quality.md
    round_id: nmq-r1-1792888482820
    plan_sha256: e8e45c4ff33be9e36f5ab954d58349b4f6b1d978e2b5f124b74d6b8500de0918
    launch_id: nmq-r1-1792888482820
    session: st_01a1707b
    result: OKAY (round 1, sha e8e45c4ff33be9e36f5ab954d58349b4f6b1d978e2b5f124b74d6b8500de0918, session st_01a1707b); notes: (1) todo 4 posture test must stay within softLimit identity (|x|<=0.8) or compare pre-limit; (2) todo 13 disabled regime must mean rate=amp=1 exactly via exp(s x - s^2/2) with s=0; (3) todo 14 rebase: per-commit hash pins conflict and are stale until the final re-pin; (4) option (b)/timeout can leave IS-1/IS-2/A-B undelivered by Luke's choice
approach: two parallel tracks - Track E (emotion quick wins: idle ducking during emotion clips, face OU low-pass + lid kink, laugh clip redesign, eye counter-rotation limit) and Track I (idle reshape: slower smoother continuous OU, human-fitted holds, shifts-only activity regime on top of the hold-latched gain); gate band re-derivation is an owner decision deferred by Luke
---

# Draft: natural-motion-quality

## Affected user and ideal state
Users:
- U1 Luke as viewer: watches the corner Live2D companion for hours at widget size; today sees occasional MAGIC-like quick back-and-forth jitter, emotion head moves that barely differ from idle, a laugh that reads as a shiver, repeated identical clips. After: idle moves like a person (slow steps + short holds + calm/restless spells), emotions read at a glance, nothing grates over hours.
- U2 Luke/agents as developers: rely on the motion QA stack (T1/T2/T3 gates, observer golden hashes, liveliness-gate.test.ts) to catch regressions; after: gates still meaningful, versioned, not retuned to pass.
- U3 downstream code: Live2D adapter / rig physics / devtools consume Natural frames; after: same frame contract, deterministic per seed.

- IS-1 | idle has no visible quick back-and-forth; small reversal rate near Luke's recordings (yaw quick reversals target ~0.44/s vs 1.52-1.68/s today) | research C36/C40
- IS-2 | idle varies over tens of seconds (calm/restless spells), minute-to-minute variety rises toward the recordings (CV60 .775; today .10-.17) | C39/C41
- IS-3 | while an emotion clip plays, idle steps back so the clip reads (no idle amplitude boost fighting it) | C11', C19
- IS-4 | every emotion clip reads as its emotion at widget size; the laugh reads as a laugh, not a shiver | investigation 2026-10-24
- IS-5 | face idle noise (mouth/lid) carries no visible flicker or kink | C14
- IS-6 | eyes do not mirror tiny head wobble into darting | C4
- IS-7 | held poses never start shivering mid-hold (already fixed, uncommitted) and the reshape keeps that property | fix 2026-10-25
- IS-8 | QA stays honest: gates versioned, bands changed only by owner decision, never retuned merely to pass; golden hashes re-pinned once per intended motion change with reason | motion-qa skill, IS-3 of motion-gate-redesign
- IS-9 | determinism: same seed -> same frames; new processes use their own streams so retuning one layer never reshuffles another | posture.ts PostureStreams contract
- IS-10 | Luke can judge the result visually at widget size (A/B current vs new) before acceptance | T4 = Luke's visual review

- GAP-1 | continuous OU fast wiggle drives reversals 3.5-3.85x human | C1', C36 | Track I
- GAP-2 | no tens-of-seconds regime; stationary motion | C39 | Track I
- GAP-3 | strong emotions raise idle amplitude x1.27/x1.45 shift rate for 2 s instead of ducking | C19 | Track E
- GAP-4 | laugh = head-only 3.5-5 Hz pitch bob, no face sync | gestures.ts createClip laugh | Track E
- GAP-5 | face OU unfiltered (mouthForm 11.8 reversals/s), lid |q| kink | C14 | Track E
- GAP-6 | eye counter-rotation K mirrors all head motion | C4 | Track E
- GAP-7 | reshape fails jitter + speedPeakLogAsymmetry bands (heuristic) | C40 | owner decision (deferred)
- GAP-8 | frozen-gain fix uncommitted in shared tree with other sessions' work | git status 2026-10-25 | plan base handling

## Components (topology ledger)
- E1 | idle ducks during emotion gesture clips (replaces amplitude boost) | active | C19
- E2 | face OU low-pass + smooth lid multiplier | active | C14
- E3 | laugh clip reads as a laugh at widget size | active | gestures.ts
- E4 | eye counter-rotation only for real head moves | active | C4
- I1 | idle reshape (slow smooth continuous OU, human holds, shifts-only activity regime) | active | C40/C41
- G1 | liveliness gate jitter/SPLA bands | deferred owner decision (Luke: decide later) | C17, C40

## Open assumptions (announced defaults)
- execution shape | Design A: two worktrees, E merges first, I rebases onto E, fast-forward | matches Luke's 'parallel'; minimizes T1/T3 runs | yes
- duck depth/timing | posture amplitude to 0.4 over a per-clip active span + 0.3 s, 0.15 s min-jerk eases, cap ~2 s; postpone shifts inside the window | C19 range .3-.5; avoids freezing on tail-heavy clips | yes
- face low-pass | mouthForm + lid FilteredOu filterTau 0.3 s (variance-compensated); lid uses a smooth even function preserving mean | measured 11.8 -> 0.94 reversals/s | yes
- eye compensation | counter-rotate only the slow head (home + drift + shift + held/emotion/gesture offsets), not the continuous wobble; computed in integrate(); breath coupling kept | C4; grid determinism | yes
- idle reshape params | port R4 exactly (continuous OU sd x1.6, tau x5, filterTau x2; holds clamp(exp(-0.82+1.02N),0.1,15)/1.5; shift amp unchanged x regime amp; regime log-gain OU tau 120 s, rate exp(.8x-.32), amp exp(.6x-.18), new 'activity' stream appended), re-validated on the latched-gain base before porting | simulation evidence C40 | yes
- G1 gate | deferred by Luke: plan includes a stop-and-ask checkpoint todo with per-step metric packet; options (a) versioned generatedHeadBands provisional override for jitter + SPLA (gate v2), (b) keep bands and stop Track I at the best passing step | Luke: decide later | n/a
- acceptance | T1 emotion + liveliness (--fresh), T2 rig spot check, T3 rendered emotion/liveliness, then Luke's T4 visual A/B at widget size (two worktrees side by side) | motion-qa levels | yes
- constraints sweep | budget: none (local); stack: existing TS/Vitest/qa-tools, no new deps; scale: n/a; audience: Luke only | personal fork | -

## Findings (cited - path:lines)
- Process (lane st_01a1706a + lead git status 2026-10-25): main at f5bc5cec7 (cursor-touch merged, its todos landed). Uncommitted in main: frozen-gain fix (posture.ts, observer.test.ts hashes, stage-ui-live2d README line) PLUS other in-flight work (touch-debug overlay/test, gaze.ts + gaze.test.ts, head-anchor, touch-gestures, Model.vue, natural-motion-diagnostics store, devtools.vue + browser test, i18n settings.yaml, stage-ui-live2d package.json, pnpm-lock, README/docs/.github deletions). Conventions: worktree C:/Users/Luke/projects/dtuber-wt/<slug> via `pnpm wt new`, branch luke/feat/<slug>, one Conventional Commit per todo, agent-config in a separate commit, evidence under .omo/evidence/<slug> (never committed), archive evidence before `pnpm wt rm`. Fresh worktree: pnpm install --frozen-lockfile (wt new does it) + build:packages if needed. QA: qa:doctor first; T1 gates with --fresh for acceptance; gates.ts version bump in its own commit before running a changed gate; never retune gate/recipe to pass; limitations wording on every QA report; T3 exclusive slot + undisturbed desktop. Checks: stage-ui-live2d typecheck + vitest; pnpm verify in the worktree. Overlap: motion-gate-redesign (merged) forbade natural-motion edits only within that plan; expression-reactions-and-combos/panel do not touch Natural files.

- Idle/gate surface (lane st_01a17069, lead-verified prototype): R4 (verify-wave3) = steps.ts installSteps with BASE=S7 {oudsd 0.8 => continuous OU sd x1.6 (2*0.8), tau x5, filterTau x2; holds = clamp(exp(-0.82 + 1.02*N(0,1)), 0.1, 15) s / 1.5 drawn from shiftRandom; shift amplitude truncatedLognormal(med .18, logSD 1, 0.005..1) x reg.amp} + regime {log-gain OU tau 120 s, own stream (prototype seed 910000+seed), rate = exp(.8x - .32), amp = exp(.6x - .18); applied to SHIFTS ONLY (R_NOOU=1): during holds nextShiftAt -= (rate-1)*dt; amplitude multiplies shift amplitude}. Results (gate protocol, pre-latch base): yaw q25 1.46x human, still05 .084 / still2 .439 pass at median (seed 2 fails), CV60 .45; fails jitter (2.96e-6 vs floor 1.469e-5) and speedPeakLogAsymmetry (.626 vs floor 1.05). Prototype ran BEFORE the hold-latched gain fix -> must be re-validated on current posture.ts. Gate change rule: edit gates.ts + bump version in a commit before running (motion-qa-levels ADR :28-30); liveliness-gate.test.ts:116/119 pins gate metrics/bands to referenceStats; extract-natural-reference.ts:45-48 provisional x0.6-1.6 / x0.7-1.4. observer.test.ts golden hashes change with any motion change (Node-computed; Bun differs in last bits).

- Emotion surface (lane st_01a17068, lead-checked): ducking hook = natural-motion.ts:434-446 amplitudeScale composition, gestures.activeUntil() (gestures.ts:201-202) already used by postpone at natural-motion.ts:458-463; energy.react (energy.ts:127-134) is the boost to stop for gesture episodes; no test covers ducking. Face: face.ts:95 mouthForm FilteredOu(random, .04, 4) and :96 lid FilteredOu(random, 1, 2) with no filterTau (FilteredOu already supports a 4th filterTau arg with variance compensation, processes.ts); lid kink face.ts:134 `1 - 0.04*abs(q)`; mouthForm output :143. Laugh: gestures.ts:74-81 (cycles 2-4, freq max(3.5,cycles)..5 Hz, amp .04-.06*scale, pitch only); happy -> laugh emotions.ts:78; tests gestures.test.ts 'draws laugh cycles, frequency, and amplitude' + '27 bit-identical clips'. Eye K: gaze.ts:20 compensation {.31,.40}, static eye gaze.ts:226-227, called natural-motion.ts advance(). Other session's uncommitted gaze.ts diff (lead read): cursor-pursuit catch-up lead/carried velocity (motionSeconds, catchingUp) - does NOT touch static eye/compensation; same file though. Docs to update: docs/ai/adr/2026-10-19-natural-emotion-revamp.md (gestures, modulation order, postponed shifts), 2026-10-17-natural-motion-v2-performance-state.md, stage-ui-live2d README gestures/QA sections. Gates: emotionGate v1 (gates.ts:106), naturalEmotionT3Gate v2 (gates.ts:173), liveliness v1 (gates.ts:50); golden hashes (pose, fixation, face, blink, breath) move with every one of E1-E4 and I1.

- Architecture advice (st_01a1706b, claims to verify at write time): Design A = two worktrees; Track E (luke/feat/natural-emotion-clips) merges first, Track I (luke/feat/natural-idle-reshape) rebases onto E, fast-forward; boundary: posture.ts is Track-I-only except one additive getter for E4 (slow pose = home + drift + shift); E edits integrate() scale composition, pending-actions.ts, energy.ts, gestures.ts, face.ts, Snapshot/advance. New activity stream appended at streamIndex 14 (append-only rule in natural-motion.ts). Duck span per clip = explicit activeSpan (not gestureLifetimes tails: tilt-in 7.5 s, nod-off 5.7 s, drop 2.25 s), ~0.15 s eases, duck activeSpan + 0.3 s, cap ~2 s; widen the postpone block to the duck window. E4 compensation must be computed in integrate()/Snapshot (grid-deterministic), not advance(). Face lid: smooth even function keeping mean lid. Holds: avoid variable rejection-draw counts (prototype used one gaussian + clamp). G1 mechanism precedent: generatedBlinkBands/generatedMouthOpenBand provisional overrides (liveliness.ts:91-115) -> a generatedHeadBands override for jitter + speedPeakLogAsymmetry with gate version 2; liveliness-gate.test.ts asserts bands = referenceStats.bands + generated overrides. T1 runs: twice for E (after E2, after E4), once for I after rebase; T3 once total; happy is not a T3 cell (laugh acceptance = visual). I1/I2/I3 as separate commits to keep hash/gate deltas attributable; each records per-seed metric values as G1 decision packet.
- energy boost settings (lead-verified): naturalBands.energyAmplitude/energyRate/energySeconds in packages/stage-shared/src/expression-performance/settings.ts:89-93 (+ settings.test.ts:21-23), used by energy.ts:131-134 (emotion react) and emotion-score.ts:248-269 (scoring windows use energySeconds for strong). No UI references found (git grep packages apps). Desktop/poke reactions use fixed reacting overlay (energy.ts:26).

- Detail advice (st_01a1706c), adopted: E1 duck continuous motion only via new additive posture field `continuousScale` (shift offsets not scaled: scaling a held r near 0.75 would move the pose ~10 deg), envelope owned by NaturalGestures (no draws; min-jerk attack 0.15 s / release 0.3 s; depth 0.45 x min(1,strength) x band amplitude; overlapping windows combine by max), facade sets it before posture.step; QA lifetime adds gestureDuckRelease in emotion-score.ts naturalEmotionLifetime; idle hashes must stay unchanged (proof). E3 face: filterTau 0.3 on mouthForm/lid (one draw per step unchanged); lid soft-abs a*hypot(q,0.3)+b with a=1.0944891587143082, b=-0.1728563303774483 (matches E|q|, SD|q|); sd:ParamMouthForm margin thin (~0.039 vs floor 0.0352) -> check in gate. E2 laugh: lift-and-dip shape (lead 0.15 s, 2-3 cycles at 2.6-3.2 Hz, one-sided dips 0.8, settle 0.35 s, amp .05-.07*scale, sided roll 0.5*amp; same 3 draws), gestureLifetimes.laugh ~1.654 s, body roll follows in strong band; face sync via a gesture `faces` clip list (eyeSmile 0.35*scale*lift, mouthOpen 0.12*scale*bounce, suppressed during speech) -> update contracts gestures.ts:146-147 and emotion-score.ts:260-261 + naturalFaceResidue. Rejected from detail advice: keeping energy.react (Luke removed it); its 2-state still regime (unverified) - plan ports verified R4 instead, with regime on a new appended `regime` stream (index 14) and amplitude latched at shift begin, rate shortening holds.
- Boundary amendment: Track E adds two additive members to posture.ts (continuousScale field for E1; slow-pose getter for E4); Track I rebases over them.

## Decisions (with rationale)
- 2026-10-25 Luke: both tracks in parallel (not emotion-first). Rationale given by Luke via question tool; idle changes will mix into his monitoring of the frozen-gain fix - accepted by choosing parallel.
- 2026-10-25 Luke: gate band re-derivation = decide later.
- 2026-10-25 Luke: write a ulw plan first; high-accuracy review default-on.
- 2026-10-25 Luke: tests = TDD for behavior (ducking, laugh, face smoothing, eye compensation: failing deterministic tests first), gates + per-step metric packets for idle tuning.
- 2026-10-25 Luke: remove the emotion energy boost and its settings: emotions stop calling energy.react (pending-actions.ts), delete naturalBands.energyAmplitude/energyRate/energySeconds (stage-shared settings.ts:89-93, settings.test.ts:21-23) and emotion-score.ts uses (248-269); desktop/poke reactions keep the fixed reacting overlay (energy.ts:26). Ducking replaces it.
- 2026-10-25 Luke: laugh = chuckle with face: slower bob ~2-3 Hz, 2-3 cycles, small backward tilt + roll, body follows, synced eye-smile + mouth-open pulses (route face via existing impulse/hint path, not a gesture face channel - gestures never touch face per gestures.ts:154 contract).
- 2026-10-25 Luke: base = commit the frozen-gain fix on main first. Done: bcdfd23cb fix(stage-ui-live2d): hold the activity gain between posture shifts (posture.ts, observer.test.ts, README hunk only; other session's work left unstaged). Plan worktree branches from bcdfd23cb or later main.
- Out of scope by research: idle acts (track F, unverified), exaggeration ladder as separate track (fold into later emotion craft), clip craft (anticipation/arcs/variants) NOT requested in this plan's direction answer - recommended order put it third; confirm at gate.

## Scope IN
- E1 duck idle during emotion gesture clips + remove emotion energy boost and its 3 settings
- E2 laugh -> chuckle with synced face pulses
- E3 face OU low-pass + smooth lid multiplier
- E4 eye counter-rotation on slow head only
- I1 continuous OU retune, I2 human-fitted holds, I3 shifts-only activity regime (new stream), each its own commit with metric packet
- G1 checkpoint (owner decision) and, if approved, versioned gate band change
- docs: natural-emotion-revamp ADR, natural-motion-v2 ADR, stage-ui-live2d README; golden hash re-pins per todo

## Scope OUT (Must NOT have)
- no idle 'acts' (stretch/look-around), no clip craft beyond the laugh (anticipation/arcs/variants are a later plan), no exaggeration ladder
- no gate/band/threshold change without Luke's explicit G1 answer; never retune a recipe or gate merely to pass
- no new user settings/UI/i18n strings; no change to Universal/MAGIC; no Kirie/Godot/VRM/MMD changes; no new dependencies
- do not touch the other session's uncommitted files (gaze.ts pursuit diff, touch-debug, devtools, head-anchor, Model.vue, i18n, lockfile) in main
- no new random draws on existing streams (new processes get appended streams)

## Open questions

## Approval gate
status: approved 2026-10-25 (Luke: Approve). Plan written to .omo/plans/natural-motion-quality.md.
review: plan-consultant and plan-reviewer spawn refused by the harness plan gate (this session already invoked ulw-execute earlier). Substitutes: lead self-review (structural self-check passed: 16 implementation rows + F1-F4, all with category lines, TL;DR first) + advisory ultrabrain adversarial review (advise-plan-review). Recommend Luke run a plan-reviewer pass in a NEW session before /ulw-execute if he wants the formal review.
self-review changes: G1 checkpoint moved to todo 9 (before any Track I commit) so no step commits red; option (a) changed from fitting bands to our own output to report-only jitter + speedPeakLogAsymmetry for generated motion (precedent: report-only generated mouth SD), still bands stay gated; duck activeSpan computed from clip shapes (10% of peak) instead of invented constants.
next: on Approve -> scaffold plan (no --draft-only), plan-consultant gap analysis, append todos, plan-reviewer high-accuracy review (5-round cap)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
