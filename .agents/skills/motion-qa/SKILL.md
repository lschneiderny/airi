---
name: motion-qa
description: Run motion, emotion, or idle QA, including deterministic gates, headless rig checks, rendered Electron scenarios, and visual review.
---

# Motion QA

For required checks by change type, see the [testing guide](../../../docs/ai/testing.md).

Run `pnpm qa:doctor` first. Resolve reported failures before starting a check. Doctor reports setup problems and never fixes them. In a fresh worktree, run `pnpm qa:setup cubism` first: it downloads Cubism Core into both apps without launching them.

Check doctor's `pointer-platform` row before rendered pointer QA. Run stage hit-test readback acceptance on Windows. Run real-pointer touch on Windows, or on Linux inside `pnpm qa:display run --`, where the QA tools inject input through the session KWin's EIS (run doctor inside the session to check its prerequisites). Elsewhere, touch scenarios refuse with `pointer-platform-unsupported`. T3 runs without pointer events use cursor attention off instead of a parked cursor (a different condition), except on Windows, and CDP pointer moves do not measure the stage hit-test readback. On Linux Wayland the app uses the classic window with click-through disabled, and the polled cursor can stick stale (#2521). Do not present these degraded conditions as Windows pointer acceptance.

## Commands

```bash
pnpm qa:doctor
pnpm qa:test --all
pnpm qa:motion gate emotion --level t1
pnpm qa:motion gate liveliness --level t1
pnpm qa:motion gate emotion --level t2 --rig forbooth
pnpm qa:motion gate emotion --level t3 --rig forbooth [--t1-report <run dir>]
pnpm qa:motion gate liveliness --level t3 --rig forbooth
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch
pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch-pass
pnpm -F @proj-airi/qa-tools exec vitest run src/motion/touch-scenarios.test.ts
pnpm qa:motion gate emotion --level t3 --rig forbooth --rescore <gate run dir>
pnpm qa:motion validate-scorer --level t1
pnpm qa:report <runDir>
```

For the MMD desktop stage, `pnpm qa:stage measure` records window/desktop frame-budget pairs and `pnpm qa:stage gate <json>...` judges `stage-walk-skate`, `stage-arm-penetration`, `stage-frame-budget`, `stage-gesture-walk`, and `stage-action-preempt`. `pnpm qa:stage capture --port <cdp port> --scenario idle --seconds 30 --out <dir>` records final MMD bones, shots and a contact sheet; `walk` needs stage mode and `attach` records without cues. Capture requires the Natural MMD driver, established by MMD diagnostics, not the Live2D fields of the motion QA bridge. Run measurements and captures inside the isolated QA display on Linux, with a temporary profile; stop the app and display afterward. A measurement moves the real OS cursor and needs a quiet, undisturbed desktop. See the Stage gates section of the qa-tools README. MMD has no headless level yet; `docs/ai/audits/2026-11-07-headless-3d-motion-spike.md` records that the production pipeline, IK, and Ammo physics step deterministically in Node and proposes a T2-3D runner.

The clip gates use two scenarios against an app attached with `--port`, with the clip imported for the mounted model: `pnpm qa:stage measure --mode desktop --port <cdp port> --scenario gesture-walk --clip <upper clip> --out <json>` loops an upper clip over a walk (at least 10 s of walking with the clip, whatever `--seconds` says), and `--scenario action-preempt --clip <full clip>` plays a full-body clip while a goal is pending. The committed records are `packages/qa-tools/fixtures/stage/task-16-gesture-walk-chisa.json` and `task-16-action-preempt-chisa.json`. Model-eval scores clip actions with `pnpm qa:model score <transcripts.jsonl> --exposed-actions <label:kind,...>`.

Clip QA kit for a real-surface MMD run:

- A fresh profile has no stance slots. To test sitting, import a sit clip and assign it to the model's `sit` slot first; otherwise the director reports `no-sit-slot`.
- Clips start unexposed and unlabeled. Label and expose them (settings table, or `setCuration` in the `mmd` store) before testing ACT `action` or `perform_action`.
- A QA override of the desktop activity sensor must read idle without away: use an `idleSeconds` value such as 60. A value under 10 s counts as active input (`watching`), so the director never sits; a value over 300 s reads away, and the director refuses every action as `asleep`.
- CDP input (`Input.dispatchMouseEvent`) does not reset the OS idle timer. On an untouched host, keep the activity sensor fresh with the override, or long runs drift into away.
- Chat-window probes must use the real send path: type into the chat-floating composer or call `useChatStore().send` in that renderer. Never use `chat.ingest` or a tool's `execute` there. Those are renderer-local; the composer's `send` routes the turn to the synced leader (the stage window on the desktop stage), which owns the tool executors and the ACT listener. A probe that skips the leader reports a false failure. Prefer `pnpm qa:app run --model <path> --script <replay json> --say <text> --expect act,tts` over hand-written CDP glue: it launches a temporary profile, seeds onboarding and the `qa:llm` replay provider, sends through the composer or the bridge `chatSend`, waits for named bridge events (`act`, `expression`, `tts`, `turn`; `clip` is not recorded yet), and prints one JSON summary. Use `--dry-run` to inspect the plan without launching.

The `builtin:t3-touch` scenario pets, pokes, and triggers the touch blush with the real OS pointer. `builtin:t3-touch-pass` verifies that a passing cursor does not start a pet. The T1 touch suite covers deterministic touch behavior. T3 touch runs move the real OS cursor and need an undisturbed desktop; the runner refuses paths outside the virtual screen and stops when the reported head is implausible. In the Linux QA display, `bridge.json` `pointerOccluders` names windows stacked above the stage that take the input. Both touch scenarios pass there (see the qa-tools README, Pointer platform preflight).

Set `AIRI_QA_RIG_FORBOOTH` to the local ForBOOTH rig directory for T2 and T3. Keep local `AIRI_QA_*` values in the ignored repo-root `.env.qa`; every qa-tools command loads it, and shell values take precedence. Set `AIRI_QA_CUBISM_CORE` when the core is not at the current checkout's default path. `AIRI_QA_RIG_BEAR` is an optional doctor input; Luke's rule says acceptance on one rig counts for the other. The bridge is enabled only when the build is development and both `APP_REMOTE_DEBUG=true` and `APP_MOTION_QA_BRIDGE=true` are set. T3 uses `APP_USER_DATA_PATH` for a temporary profile and manages its remote-debug port internally. Do not reuse a personal Electron profile.

On Linux, start every T3 run, `qa:motion gate --level t3`, and `qa:stage measure` app through the headless QA display so the user can keep working:

```bash
AIRI_QA_RIG_FORBOOTH="<rig dir>" pnpm qa:display run -- pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke
pnpm qa:display down
```

The session is a GPU-accelerated KWin compositor with its own Xwayland and D-Bus bus, run as a systemd user unit, so nothing reaches the user's desktop. Use `--name <name>` when another agent's session may be running, and stop your own session when you finish. `pnpm qa:display shot <file.png>` captures the whole session display when CDP screenshots are not enough. The display does not change a command's CPU slot class. Real-pointer `t3-touch` scenarios run inside it through KWin EIS; outside it they refuse on Linux. Details: [`scripts/dev-tools/README.md`](../../../scripts/dev-tools/README.md#pnpm-qadisplay).

Gate selection and environment values are recorded in the run manifest. A reduced `--seeds` run is not the full committed gate.

T3 emotion runs use the committed `natural-emotion-t3` version 2 gate across three 300-second sessions. The session-stratified placebo null has 52 windows total in the accepted run. It checks visibility, face transfer ratio [0.7, 1.3] against the same-commit T1 reference, and gross release regression. Posture is pooled and reported, not gated. T3 liveliness uses three 600-second captures with the cursor parked.

For `--rescore`, the runner verifies each archived scoring artifact against its capture-time SHA-256 in `run.json`, then checks layout invariants, session headers, and exact trace-event identity. A named invariant refusal exits 2 before creating a run directory. The manifest is trusted, so rewriting an artifact and its recorded digest together is not detected. T3 also needs an UNDISTURBED desktop: mouse movement fails cursor parking, while focus or occlusion changes can throttle frames. Warn the user before a long capture; Luke accepted the interference-affected T3 runs from 2026-10-20.

Liveliness gates accept `--host <id>` for `windows`, `macos`, `linux-x11`, `linux-xwayland`, `linux-wayland`, or `web`. Host profiles are liveliness-only; the option is rejected for emotion gates. At T3, the detected runner host must match `--host` or the command refuses before launch with exit code 2. Selecting `--host linux-xwayland` launches `dev:xwayland` within a Wayland session. Keep the machine undisturbed during T3 liveliness captures: the gate checks the resolved performance mode every 10 seconds in the scored window and fails with `mode-left-idle` if it is not `idle`. At T1 and T2, the liveliness sink checks the mode during the scored window as well.

Run `pnpm qa:host smoke` to compare a temporary Electron app's capability snapshot with the runner and observe host signals for 180 seconds. On native Wayland, pass `--expect-idle verified` or `--expect-idle unverified`, according to the machine's idle probe. Pass `--xwayland` to launch the XWayland backend; that flag requires a Linux Wayland session. The command tears down its app and temporary profile when it finishes.

## Required limitations wording

Every motion QA report and verdict must state:

> Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

The desk VTS recordings are valid for idle liveliness only. Naturalness remains Luke's visual call. ForBOOTH's watermark covers part of the face in T3 screenshots; under Luke's rule, acceptance on one rig counts for the other.

Gate wall time is recorded, not asserted; no test fails on timing. On a quiet 16-core machine at the integration tip, the full T1 emotion gate took 294.6 s against a 300 s target. The angry/strong smoke subset took 44.7 s and 45.5 s, and an independent run took 65.0 s, against a 60 s target. Luke accepted these measurements on 2026-10-20. Under load, times rise; the full gate took 415.6 s. Record the machine load with any timing.

## Gates and known failures

Gate ids, versions, metrics, and budgets live in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`. If a gate changes, edit that file and bump its version in a commit before running it. Never retune a gate or a Natural recipe to pass a failing run.

`pnpm qa:test` compares results with `packages/qa-tools/known-failures.json`. Report new failures as findings. Do not skip, delete, or weaken tests. Add a known-failure entry only with a concrete cause, date, and removal condition. Remove fixed entries when the runner reports them as fixed.

Scorer validation uses protocol 2, fixed before the first full run. The run passed A/A, zero, mutations, and determinism, but unmutated failed: 37 checks were persistent findings, grouped by failed criterion as visibility 7, significance 6, release 31, and size 3. The remaining 66 noise failures exceeded the budget of 25 over 1,500 check-set pairs, missing the prediction that only persistent findings would fail. No constants, recipes, or gates were retuned. See `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md` for the rules and full findings.

## Evidence and heavy runs

After validation passes, `qa:test`, `qa:motion gate` at T1/T2/T3, direct `qa:motion t3`, and `qa:motion validate-scorer` create unique `.temp/qa` runs with `run.json` manifests. T3 also creates a run per capture session; emotion `--rescore` creates its run only after archive validation succeeds. Doctor prints findings only. `qa:report` writes into its first input run or `--out`, without a new run or manifest. Evidence archive writes under `.omo/evidence/<slug>` with its own `manifest.json`, not a QA run. Preserve manifests and artifacts for commands that create QA runs. Before removing a worktree, archive plan evidence into the main checkout:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

Do not commit evidence or rig/core assets. Gate runs take the `gate` CPU slot class, and T3 captures take the `live` class. The T3 timing gate and `qa:stage measure` take `exclusive`, which waits until no other lease holds slots. Run `pnpm slots status` to inspect current holders and queued work.

Acceptance evidence needs `--fresh` on every T1 gate and `validate-scorer` run, so the result is computed rather than read from the cache. A cached run is a local check. `--t1-report` refuses a cached run with exit 2, so pass a run made with `--fresh`.

For details and current gate behavior, read [`packages/qa-tools/README.md`](../../../packages/qa-tools/README.md) and [`docs/ai/adr/2026-10-20-motion-qa-levels.md`](../../../docs/ai/adr/2026-10-20-motion-qa-levels.md).
