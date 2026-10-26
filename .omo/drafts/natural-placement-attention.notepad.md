# Ultrawork Notepad - ulw-plan natural-placement-attention
Started: 2026-10-26T18:49:50.424Z
Tier: LIGHT (planning/control-plane: deliverable is a plan file; no product code edited this session)
Skills: ulw-plan (explicit request, governs workflow); enforce-rules-for-typescript/vitest/eventa/pinia-synced/motion-qa named for the plan's executor, not read here.
RUN_TMP: H:\llm\ollama\tmp\ulw-plan-PK1qwb

## Plan
1. Discovery wave (explore x3 + architect advisory) 2. ideal state + gaps 3. forks one-by-one 4. approval gate 5. scaffold plan, consultant, todos 6. plan-reviewer rounds 7. handoff

## Now
discovery wave

## Todo
- cleanup RUN_TMP

## Findings

## Learnings

## Findings (wave 1)
- Placement chain: tamagotchi pages/index.vue:420-423 cursorPosition -> :463-469 WidgetStage; Stage.vue:60-64 prop, :898-902 Live2D branch; Live2D.vue:28-31,135-140; Model.vue:610-656 createNaturalAdapter attention callback; adapter:23-54 Live2DNaturalMotionAttention, :307-323 forwards; controller setCursor natural-motion.ts:264, setPerformance :278.
- Bounds: main services/electron/window.ts:36-41 createRendererLoop emits bounds each loop tick; no move-ended event. Displays: useElectronAllDisplays polls getAllDisplays every 5 s (electron-vueuse use-electron-all-displays.ts:7-17); display-* events only used by inlay (main/windows/inlay/index.ts:67-73).
- Head rect in viewport CSS px: Model.vue headViewportRect() :1234-1255 (headAnchor() :1560 is parent-space).
- view-control position doc inconsistent (percent vs px) view-control.ts:12 vs :48-53.
- Pocket passes no cursor; web passes cursorPosition.
- AGENTS: stage-ui-live2d natural-motion modules free of Pixi/Vue/window, monotonic seconds, seeded random streams; electron-vueuse eventa contracts in @proj-airi/electron-eventa; tamagotchi: register window RPC before renderer load.
- Architect (advisory): pure geometry in packages/stage-shared (new stage-placement), renderer computes inward from displays+window bounds+head rect; chat direction owned by main; typing relayed chat renderer->main->main window; controller setPlacement/setChatAttention/chatCue; determinism: one RNG draw with shifted threshold, chat branch after cursor branch only when chat!=null, new streamIndex appended 14+; golden hashes observer.test.ts:43-57,97-103 (600 s/seed); QA: extend MotionQaConfigureInputSchema bridge.ts:41-46 + use-motion-qa-bridge.ts, run-t3.ts:158 defaults placementInward 0 chat null.

- Natural (explore): step grid 120 Hz natural-motion.ts:48-49,199-215; adapter input order setPerformance, voice, emotions/pokes, pet, setCursor, advance (adapter:309-324). Posture bias vector index 0 = yaw (headX/ParamAngleX), index 2 = roll. CORRECTION to explorer: yaw bias belongs in index 0 (added to the cursorX follow target), NOT the Z slot.
- drawTarget gaze.ts:319-342 draw order: cursor compare (only if cursor active) -> branch draw -> peripheral side draw -> 4 gaussian uniforms jitter. aside side draw gaze.ts:161-169. glance() no draw gaze.ts:189-191. Per-layer Mulberry32 streams random.ts:1-25.
- Golden pins: observer.test.ts:11-56,89-103 (600 s idle + 60 s emotion, seeds 1-3); mood.test.ts:20-29,121-145; liveliness-gate.test.ts seeds [1,2,3] warm-up 180 scored 1800.
- Tests: natural-motion/*.test.ts (23 files incl gaze.test.ts, posture.test.ts, energy.test.ts, observer.test.ts); cmd pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts.
- QA: T1 scenario-sink.ts:174-212; T3 run-t3.ts:91-93,157-159,182-190; t3-scenario.ts:50-53,367-385 asserts cursorAttention false; bridge schema stage-shared motion-scenario/bridge.ts:24-46 strictObject; use-motion-qa-bridge.ts in stage-ui composables/performance.
- Lab: stage-ui/src/features/devtools/motion/natural/devtools.vue + components/performance-controls.vue etc; tamagotchi route pages/devtools/live2d-natural-motion.vue.
- Settings: live2d.ts:11-17 natural-cursor-attention, reset :109-137; UI stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:459-465; i18n en/settings.yaml:232-235; browser test live2d.browser.test.ts:621-635,939-945.
- Docs: stage-ui-live2d/README.md Natural section ~L50; ADRs docs/ai/adr/2026-10-24-live2d-cursor-attention.md, 2026-10-17-natural-motion-v2-performance-state.md, 2026-10-25-natural-idle-reshape-and-emotion-ducking.md, 2026-10-19-situational-presence.md.
