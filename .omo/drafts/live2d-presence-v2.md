---
slug: live2d-presence-v2
status: plan-complete
intent: clear
review_required: false
plan_path: .omo/plans/live2d-presence-v2.md
plan_sha256: null
review_round_id: null
review_round_limit: 5
pending-action: write .omo/plans/live2d-presence-v2.md
review:
  plan_reviewer:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/live2d-presence-v2.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
approach: layered stochastic Natural v2 (home drift + filtered-OU continuous motion + lognormal posture shifts + independent gaze/saccades + face/blink/breath + energy states + additive impulses + physics-ownership rig profile), deterministic liveliness score as hard gate built first, performance-state resolver + desktop activity signals (built-in only), emotion impulses in Natural, Energy slider, devtools Natural lab with post-physics trace capture.
---

# Draft: live2d-presence-v2

## Affected user and ideal state
Users: (U1) Luke as viewer - Live2D companion (ForBOOTH, Bear Pajama) in a screen corner during work/gaming, Electron desktop primary, web secondary. (U2) Luke as tuner - needs to judge and tune motion without guessing. (U3) Universal/MAGIC mode users and web client - must not regress. (U4) Chat/LLM pipeline - emits emotion acts and speech state that Natural consumes.

| Row | Ideal state | Reason |
|---|---|---|
| IS-1 | Natural is never frozen: continuous low-amplitude motion on head/body/eyes; near-still head fraction within band of recording (4.8% <0.5 u/s). | v1 is near-frozen 79.5% of frames; a tracked human never stops. |
| IS-2 | Motion is heavy-tailed and varied: mostly small adjustments, occasional large shifts with natural velocity profile/overshoot; no detectable loop. | Recording: top-10% speed samples carry ~43% of path; v1 moves are uniform critically-damped glides. |
| IS-3 | Lived-in home pose: non-neutral (looking down ~ recording AngleY mean -16.4) and drifting over minutes; amplitude in recording ballpark (AngleX std 7.65, Y 6.42, Z 2.27). | v1 centers at camera with ~half the spread. |
| IS-4 | Imperfect coordination: eyes lead/glance independently (saccades, glance-away, look-down), body lags with lower gain and partial decorrelation; rigs whose physics derives body from head are not double-driven. | v1 body = scaled head copy; eyes lock to camera; Bear physics outputs ParamBodyAngleX/Y/Z from ParamAngleX/Y/Z. |
| IS-5 | Whole face participates: breath always on (excites rig physics), natural blink timing, eyelid/brow/mouth micro-activity coupled to gaze & speech, without fighting blink/expression/lipsync/squint/manual owners. | v1 touches 8 channels; ParamBreath is static (SDK breath deleted, manual breath only on explicit setBreath); both rigs use ParamBreath as physics input. |
| IS-6 | Distinct performance states (idle, watching, listening, thinking, talking, reacting) with smooth cross-fades; talking adds speech-synced emphasis. | v1 has one hard-coded behavior; speech only drives lips. |
| IS-7 | Reactions grow out of motion: LLM emotions become impulses + procedural face hints layered on Natural, visible on both rigs, never a reset to neutral. | Emotions map to motion groups (Happy/Sad...) that neither rig defines (both model3 Motions empty), so today emotions do nothing; clips with priority>1 blend Natural out entirely. |
| IS-8 | Desktop awareness: cursor activity, input idleness, system-audio activity, screen-change level, lock/suspend shift attention/energy; no new native dependency; web degrades gracefully. | User end goal; Electron already has getCursorScreenPoint, powerMonitor events, system-audio capture, screen ambient-light capture. |
| IS-9 | Deterministic offline liveliness score vs recording-derived reference bands runs in the normal test suite; reference numbers committed with provenance, raw recordings not committed. | Avoids judging by eye alone (prior procedural attempt felt robotic); turns the audit into a regression gate. |
| IS-10 | Real-surface tuning: devtools Natural lab to force states, fire impulses, adjust energy, capture the actual rendered parameter trace and score it. | Controller sim can differ from rendered output (physics, ranges, owners). |
| IS-11 | No regressions: Universal/MAGIC unchanged; manual/exclusive owners, explicit clips, pause/hidden, model replacement behave as v1; frame cost negligible during gaming. | Shared renderer, gaming overlay budget. |
| IS-12 | Docs and settings reflect v2 (README, settings copy, ADR if contracts change). | Repo rule: docs ship with code. |

| Gap | Today | Reason | Closed by |
|---|---|---|---|
| GAP-1 | Followers converge then hold; nothing between primaries. | natural-motion.ts schedulePrimary/integrate | todos (layers) |
| GAP-2 | Uniform target, 25-60% step, critically damped, fixed quiet ranges. | natural-motion.ts:118-133 | todos (shifts) |
| GAP-3 | Posture mean-reverts to 0; head gain 0.36/0.24. | natural-motion.ts:139-147 | todos (home pose) |
| GAP-4 | body = 0.30*p; eyes = fixation - head, fixation mostly 0; Natural disables idle saccades; no physics-derived-body detection. | natural-motion.ts, Live2D.vue:171-172, Bear physics3 | todos (coordination, rig profile) |
| GAP-5 | No breath/eyelid/brow/mouth from Natural; blink uniform 3-8 s. | motion-manager.ts blink, Model.vue:487 breath only on control | todos (face, breath, blink) |
| GAP-6 | No state input to Natural. | adapter Attention has only driver/owners/motion/cursor | todos (state model + wiring) |
| GAP-7 | Emotions -> missing motion groups; clip>IDLE fully blends out. | Stage.vue:266-280, emotions.ts, adapter compose eligibility | todos (impulses) |
| GAP-8 | No desktop signal reaches Live2D except cursor (1 s expiry). | Live2D.vue:111-118, electron screen.ts, powerMonitor.ts | todos (desktop signals) |
| GAP-9 | No score, no reference numbers in repo. | audit used throwaway scripts | todos (score) |
| GAP-10 | Devtools Live2DMotionDevtools has no Natural controls/trace capture. | apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue | todos (lab) |
| GAP-11 | v1 tests pin v1 internals (8 cases controller, 12 adapter). | natural-motion.test.ts, natural-motion-adapter.test.ts | todos (test rewrite, regression) |
| GAP-12 | README describes v1 'quiet resting poses'. | packages/stage-ui-live2d/README.md:12-29 | todos (docs) |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- v1 sim (30 min seeded, +/-30 range): headX std 3.7, max 9.5, still(<0.5u/s) 79.5%. Recording 18m: X std 7.65 (p5 -20.1/p95 8.8), Y std 6.42 mean -16.4, Z 2.27, still 4.8%, <2u/s 30.9%, EyeBallX .094 Y .123, EyeLOpen .213 (p5 .59 p95 1.21), BrowLY .043, MouthOpenY .025, MouthForm .05, BodyAngleX 2.55 (VTS head-derived).
- Neither rig defines motion groups: ForBOOTH model3 Motions {} (Groups EyeBlink=[EyeLOpen,EyeROpen], LipSync=[]); Bear Motions {} (EyeBlink=[], LipSync=[]). Motion files exist on disk but unreferenced.
- Bear physics3: ParamAngleX->ParamBodyAngleX(+Param134/136/138), AngleY->BodyAngleY, AngleZ->BodyAngleZ; many hair groups take ParamBreath input. ForBOOTH physics: AngleX/Z/BodyZ->ParamAngleX2, AngleY+Breath->AngleY2, BodyAngle*/Breath/BodyPosition*->Body*2; positionz/BodyPosition inputs.
- Both rigs have ParamBreath, BrowL/R Y/Angle/Form, EyeL/R Open & Smile, MouthForm, MouthOpenY; Bear also ParamCheek, BrowLX/RX.
- Plugin order Model.vue:472-519: beatSync pre, idleDisable pre, idleFocus post, expression final, autoBlink final, lightSquint final, manualControl final, lipSync final, breathControl final, natural.frame final; natural composes inside SDK updateFocus (before physics).
- Blink: useMotionUpdatePluginAutoEyeBlink uniform 3000-8000 ms, close 75 ms, open 150-300 ms (motion-manager.ts).
- Signals: chatSending (Stage.vue:249), nowSpeaking/mouthOpenSize (Stage.vue:137), VAD isSpeech/onSpeechStart (stage-ui/src/stores/ai/models/vad.ts:19-130), emotion acts via streamingControl.onSignal (Stage.vue ~300-330), cursorPosition prop with 1 s expiry (Live2D.vue:111-118), Electron screen.getCursorScreenPoint (apps/stage-tamagotchi/src/main/services/electron/screen.ts:16-36), powerMonitor suspend/resume/lock events (powerMonitor.ts:27-30), system audio capture (apps/stage-tamagotchi/src/renderer/features/live2d/system-audio-lipsync.ts), screen ambient-light environment behindLuminance (Model.vue:480).
- Devtools: apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue renders Live2DMotionDevtools from @proj-airi/stage-ui/features/devtools/motion/live2d.
- Repo has no Python except engines/stage-tamagotchi-godot/tools/*.py; stage-ui-live2d vitest projects node (*.test.ts) + browser (*.browser.test.ts).
- Recording manifest.json (inside each .riggold zip, alongside semantic_channels.parquet + session_state.jsonl) declares per-parameter default/min/max: ForBOOTH ParamAngleX/Y/Z +/-30, ParamBodyAngle*+/-10, EyeBall +/-1, EyeL/ROpen 0..1 default 1, Brow* -1..1. So the audit's +/-30 normalization holds; extraction can normalize from the manifest. Columns are 'raw.<ParamId>' + t_rel_ms + tracking_ok.
- VTS vtube.json maps (both rigs): FaceAngleY in +/-20 -> ParamAngleY +/-30; EyeOpen 0..1.2 (ForBOOTH) -> 0..1.9; BodyAngleX from FaceAngleX -> +/-10.
- pixi-live2d-display 0.4.0 types: Cubism4InternalModel.physics?: CubismPhysics (types/index.d.ts:4649) with _physicsRig (index.d.ts:4343; dist/cubism4.es.js:2422-2562 settings/inputs/outputs) -> runtime body-from-head detection is possible but touches an underscore field (needs NOTICE) - alternatively parse the model's physics3.json via settings.physics.
- Electron cursor -> renderer: apps/stage-tamagotchi/src/renderer/pages/index.vue:391 computes cursorPosition passed to Stage.
- Natural lab host: packages/stage-ui/src/features/devtools/motion/live2d/{devtools.vue,components,composables,index.ts}; system-audio store packages/stage-ui/src/stores/system-audio-lipsync.ts.
- Settings: Live2DMotionDriver 'magic'|'natural'|'universal' default universal; natural-cursor-attention default true (live2d.ts:4-8); UI packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:61-399; i18n en settings.yaml:206-231.

## Decisions (with rationale)
- [2026-10-17 asked, batch] Desktop signals: built-in only - global cursor movement, input idle time (powerMonitor.getSystemIdleTime), system-audio loudness and screen-change level only when those captures are already enabled, lock/suspend. No new native dependency, no app/window names. (Luke chose recommended.)
- Emotions in Natural: procedural impulses (head/body impulse + brow/eye-smile/mouth-form shaping on standard params). No per-model expression mapping. Universal behavior unchanged. (Luke chose recommended.)
- Settings: keep cursor attention toggle + add one Energy slider (calm..lively); everything else in devtools Natural lab. (Luke chose recommended.)
- Tests: liveliness score + reference bands first and a hard gate in the normal suite; tests-after for wiring/UI; agent-run real-app QA always. (Luke chose recommended.)

## Architect lane (st_01a147ce, completed) - adopted after spot checks
- Split pure layers into packages/stage-ui-live2d/src/composables/live2d/natural-motion/ {baseline, gaze, face, breath, energy, impulses, rig-profile, liveliness, reference-stats}.ts; keep Live2DNaturalMotion facade + advance() contract in natural-motion.ts; per-layer seeded RNG streams.
- Performance state: pure resolvePerformanceState in packages/stage-shared/src/performance-state/; Stage.vue sole writer; passed as one prop Stage->Live2D.vue->Model.vue (precedent `presence`). Desktop activity enters through a stage-shared store written by host (pattern useScreenAmbientLightEnvironment). Devtools override via performanceOverride store (pattern stage-ui/src/stores/presence-bubble.ts:25,45).
- Emotions: Stage.vue live2d branch calls live2dSceneRef.setEmotion(name,intensity) (same shape as spine/tachie/mmd Stage.vue:282-289); Live2D.vue exposes; Model.vue branches: universal/magic -> today's currentMotion group behavior; natural -> naturalMotion.impulse(). act.motion unchanged.
- Face channels composed in adapter late composition (inside updateFocus wrap, after eyeBlink, before physics), self-recognizing {base,written} writes (pattern light-squint motion-manager.ts); eyelid floor 0.2 > BLINK_THRESHOLD 0.15; never write ParamMouthOpenY; MouthForm offsets only when !nowSpeaking.
- Desktop: add getSystemIdleTime invoke in packages/electron-eventa/src/electron/powerMonitor.ts; main service apps/stage-tamagotchi/src/main/services/electron/desktop-activity.ts (~2 Hz) emitting electronDesktopActivityChanged in apps/stage-tamagotchi/src/shared/eventa/index.ts; renderer store src/renderer/stores/desktop-activity.ts writes stage-shared useDesktopActivity; cursor velocity from useElectronRelativeMouse; screen change from ambient-light environment deltas; Wayland caveat; web fallback visibility/focus/pointer recency.
- Score tooling: pure liveliness.ts + reference-stats.ts typed const with provenance; extraction script run with root tsx; no new JS dependency; no package.json script changes.
- Lab: packages/stage-ui/src/features/devtools/motion/natural/ exported ./features/devtools/motion/natural; Electron page apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-natural-motion.vue linked from pages/settings/system/developer.vue; trace ring buffer store in stage-ui-live2d; Blob download (pattern keyframe-editor.vue:351-354).
- Rig profile: runtime detection from internalModel.physics._physicsRig (NOTICE) marks bodyFromHeadPhysics -> zero direct body commands; read after setupLive2DModel.
- Risks: physics output weight<1 blending; currentMotion other readers unverified; Emotion enum duplicated in stage-ui and stage-ui-live2d (follow-up).
- My deviation: Parquet extraction = PEP 723 uv Python converter packages/stage-ui-live2d/scripts/export-riggold-trace.py (pyarrow inline dep, dev-only, precedent engines/.../*.py) -> JSON trace; TS script scripts/extract-natural-reference.ts computes stats with liveliness.ts. Avoids work in the private recorder repo. Reversible.

## Ultrabrain lane (st_01a147cd, completed) - adopted as starting values (tune)
- h = softlimit(mu + b + g*n + r + j); softlimit identity below 0.8 then 0.8+0.2tanh((|h|-0.8)/0.2).
- Home drift OU SD (0.08,0.12,0.025) tau 90 s filter 5 s; continuous low-pass-filtered OU SD (0.012,0.010,0.005) tau (0.20,0.24,0.32) filter (0.07,0.08,0.10); gain g=0.3+1.3*sigmoid(2e), e OU 6 s filtered 0.6 s.
- Product home mu=(0,-0.1,0); desk calibration fixture mu=(-0.14,-0.55,0) used only by the score test.
- Shifts: r_new=0.7 r_old + A diag(1,0.8,0.3) d, A truncated lognormal median 0.22 logSD 0.7 bounds 0.025-0.75; min-jerk 10u^3-15u^4+6u^5, D=0.22+0.4 sqrt(|dr|/0.35); hold 0.35+lognormal(median 1.6, logSD 0.65, 0.15-9.65); overshoot 0.
- Blink: single scheduler interval 0.6+lognormal(median 4, logSD 0.5), close 60-90 ms, open 160-260 ms, occasional advance onto large gaze shift.
- Face: brow SD 0.025, mouth form SD 0.04, occasional silent mouth opening <=0.06 when not speaking; lid/brow tiny asymmetry; pupils conjugate.
- Breath: 0.45+0.12 sin(phase), period ~4.8 s wandering ~15% over 20 s; respects manual breath owner.
- Gaze: fixation holds lognormal median 1 s logSD 0.7 (0.18-5 s); targets camera (0,0), desk (0,-0.18), peripheral (+/-0.12,0) + jitter; saccade D=clip(0.030+0.0025*A,0.035,0.090), A~20|d eye|; eye = gaze - K*h_applied, K=(0.31,0.40); ~30% of posture shifts are attention shifts with eyes leading 30-80 ms.
- Body: lag 150-300 ms, gain ~0.33 in recording units (normalized 0.99), residual SD 0.15 body units; never write physics-owned outputs (transitive graph, nonzero weights).
- States: idle 1.0/1.0/0.50, watching 0.8/0.7/0.25, listening 0.75/0.6/0.85, thinking 1.0/1.1/0.30, talking 1.15/1.3/0.65, reacting overlay 1.3/1.5 (amplitude/shift-rate/camera-fixation p). Priority speaking > listening(VAD) > generating > active attention > idle; dwell 0.3 s, VAD release 0.5 s, cross-fade 0.7-1.5 s; never reset processes.
- Speech emphasis: a=mouthOpenSize/100, envelopes 40/250 ms, o=max(0,fast-slow), trigger up-cross 0.10 rearm 0.04, accept ~25%, refractory 1.2 s, impulse 0.02-0.05 mostly pitch.
- Impulse j(t)=0.12 I^0.7 d (t/tau)^2 e^{2(1-t/tau)}, tau 0.25-0.5 s; per-emotion direction/brow/lid biases; dedupe; expression hints decay 1-3 s.
- Clips: parameter masks; ~10% micro-motion residual on clip-owned channels, full Natural on unowned; manual/exclusive zero residual; keep 0.2/0.45 s fades; latent processes keep running.
- Score metrics + bands: channel SD x0.7-1.4; still P(v<0.5) .02-.10 & P(v<2) .22-.43 (vector speed |d(AngleX,Y,Z)|/dt; recompute reference with same definition); top-10% path share .35-.52; velocity ACF 1/e crossing .08-.6 s; corr(eyeX,headX) -.95..-.65; blink 8-20/min CV .35-.8; loop detector <.30 (2-60 s, excl breath); desk pose Y -16.4+/-4, minute-Y range 8-22, X p5/p95 within 4; >5 Hz power <5%, near-limit <1%; talking speed ratio 1.15-1.7 & onset enrichment >1.2. Aggregate S=100 exp(-mean(d^2)/2); hard-fail frozen/clipped/looping regardless of S. 120 Hz sim, 3 min warm-up, 30 min per seed, fixed RNG streams.
- Prototype sanity (lane-executed, head only, 3 seeds): SD 7.30-7.77/6.08-6.91/2.29-2.39, vector still 2.5%/35%, top-decile 41-42%, loop detector 1.0 for 4 s loop vs .079 stochastic.

## Plan-consultant ledger (st_01a147df, completed 2026-10-17)
- Accepted:
  - B1: capture moves to `internalModel.on('beforeModelUpdate')`. Verified against SDK `cubism4.es.js` Cubism4InternalModel.update: saveParameters, then updateFocus, physics, beforeModelUpdate, model.update, loadParameters.
  - M1: the self-recognition map and its mutation QA are removed; Natural is a per-frame overlay.
  - M2: eyelid formula fixed, with tests g/g2.
  - M3: userSpeaking replicated over the speech bus.
  - M4: Stage.vue branches emotion routing by driver, and Universal keeps its store write.
  - M5: `.omo/evidence/` added to .gitignore in todo 1. Verified that .gitignore has no .omo rule and that .omo drafts/plans are tracked.
  - M6: talking bands are provisional.
  - M7: the trace travels over the BroadcastChannel as a Blob download; no IPC or main writes.
  - m1 (ADR dir and date naming), m2 (missing-channel rule), m3 (stage-web typecheck), m4 (Wayland/null degradation), m5 (gaming-budget justification and GPU-tab run), m7 (matrix: todo 8 no longer depends on 11), m9 (no-reset test).
- Declined:
  - m6 (pause the Natural blink under manualActive). v1 in Natural mode kept the blink plugin blinking during manual control. Keeping the Natural blink under manual control preserves that behavior, and manual control's eyeSquint multiplies before compose. Also verified: isIdleMotion is true when no motion plays (`!currentGroup`, motion-manager.ts hookUpdate).
  - m8: cosmetic.
- Final plan sha256: 6ac0b6a78ab5e39756cd70a5167cb17b1f3d93cae3732d9165d484529b1d0388 (89,708 bytes).
- Structural self-check passed: header order, 15 sequential `- [ ] N.` rows with every field, 4 F rows with categories, 12/12 GAP closed, 12/12 IS mapped, no placeholders, no trailing whitespace.
- Review: plan-reviewer explicitly skipped by Luke ("Approve, skip review"). No review round launched.

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (2026-10-17, Luke chose "Approve, skip review" - plan-reviewer explicitly declined; plan-consultant still mandatory)
previous-next: on Approve -> scaffold plan, plan-consultant, append todos, TL;DR, self-check, plan-reviewer rounds (max 5).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
