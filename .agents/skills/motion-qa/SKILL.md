---
name: motion-qa
description: Run motion, emotion, or idle QA, including headless MMD gates, the headless Live2D rig, rendered Electron scenarios, and visual review.
---

# Motion QA

For required checks by change type, see the [testing guide](../../../docs/ai/context/testing.md).

Run `pnpm qa:doctor` first. Resolve reported failures before starting a check. Doctor reports setup problems and never fixes them. In a fresh worktree, run `pnpm qa:setup cubism` first: it downloads Cubism Core into the desktop app without launching it.

Check doctor's `pointer-platform` row before rendered pointer QA. Cursor parking and stage hit-test readback acceptance are Windows-only. On Linux, `pnpm qa:display pointer <x> <y>` moves the pointer inside the QA display through the session KWin's EIS (run doctor inside the session to check its prerequisites). CDP pointer moves do not measure the stage hit-test readback. On Linux Wayland the app uses the classic window with click-through disabled, and the polled cursor can stick stale (#2521). Do not present these degraded conditions as Windows pointer acceptance.

## Commands

```bash
pnpm qa:doctor
pnpm qa:live2d-rig [--emotion angry] [--band strong] [--seed 1] [--out <trace.json>]
pnpm qa:motion3d run --model <pmx> --scenario <id> --seed <n> --out <dir>
pnpm qa:motion3d gate <run dir>...
pnpm qa:motion3d report <topic> <run dir>...
pnpm qa:stage measure | gate | capture ...
pnpm qa:host smoke
```

Live2D has a headless runner but no statistical gate. `pnpm qa:live2d-rig` runs one emotion trial through the Natural driver on the ForBOOTH rig and Cubism Core in Node and prints the samples, moving channels, trace hash, and speed. Use it to check that a Natural or Live2D motion change still drives the rig. For rendered Live2D checks, use `qa:app` or the `airi-qa` MCP server with a Live2D model, then a visual review.

For the MMD desktop stage, `pnpm qa:stage measure` records window/desktop frame-budget pairs and `pnpm qa:stage gate <json>...` judges `stage-walk-skate`, `stage-arm-penetration`, `stage-frame-budget`, `stage-gesture-walk`, and `stage-action-preempt`. `pnpm qa:stage capture --port <cdp port> --scenario idle --seconds 30 --out <dir>` records final MMD bones, shots and a contact sheet; `walk` needs stage mode and `attach` records without cues. Capture requires the Natural MMD driver, established by MMD diagnostics, not the Live2D fields of the motion QA bridge. Run measurements and captures inside the isolated QA display on Linux, with a temporary profile; stop the app and display afterward. A measurement moves the real OS cursor and needs a quiet, undisturbed desktop. See the Stage gates section of the qa-tools README.

For MMD body motion without the app, `pnpm qa:motion3d run --model <pmx> --scenario <id> --seed <n> --seconds <s> --out <dir>` runs the real MMD adapter in Node; a seed gives byte-identical traces. Scenarios: `idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`. `pnpm qa:motion3d gate <run dir>...` judges runs against `mmd-motion-quality`; `pnpm qa:motion3d report <topic> <run dir>...` runs a topic report (`gaze-order`, `gesture-timing`, `emotion-table`, `cue-body`, `ownership`, `turn`, `pops`, `idle-acts`, `walk-form`, `rest`) that judges its criteria; `verdicts` lists every verdict with its failing lines. To show a change left a scenario alone, run it at both commits and `pnpm qa:motion3d diff <run> <run>` must print `IDENTICAL`. `frames` and `clip` render stills and video of the posed mesh for review: scores never prove naturalness, and the grey mesh shows no face, hair or cloth. Model-gated tests run through `pnpm qa:test:model`. Options, scenarios and report versions: `packages/qa-tools/README.md`.

The clip gates use two scenarios against an app attached with `--port`, with the clip imported for the mounted model: `pnpm qa:stage measure --mode desktop --port <cdp port> --scenario gesture-walk --clip <upper clip> --out <json>` loops an upper clip over a walk (at least 10 s of walking with the clip, whatever `--seconds` says), and `--scenario action-preempt --clip <full clip>` plays a full-body clip while a goal is pending. The committed records are `packages/qa-tools/fixtures/stage/task-16-gesture-walk-chisa.json` and `task-16-action-preempt-chisa.json`. Model-eval scores clip actions with `pnpm qa:model score <transcripts.jsonl> --exposed-actions <label:kind,...>`.

Clip QA kit for a real-surface MMD run:

- A fresh profile has no stance slots. To test sitting, import a sit clip and assign it to the model's `sit` slot first; otherwise the director reports `no-sit-slot`.
- Clips start unexposed and unlabeled. Label and expose them (settings table, or `setCuration` in the `mmd` store) before testing ACT `action` or `perform_action`.
- A QA override of the desktop activity sensor must read idle without away: use an `idleSeconds` value such as 60. A value under 10 s counts as active input (`watching`), so the director never sits; a value over 300 s reads away, and the director refuses every action as `asleep`.
- CDP input (`Input.dispatchMouseEvent`) does not reset the OS idle timer. On an untouched host, keep the activity sensor fresh with the override, or long runs drift into away.
- Chat-window probes must use the real send path: type into the chat-floating composer or call `useChatStore().send` in that renderer. Never use `chat.ingest` or a tool's `execute` there. Those are renderer-local; the composer's `send` routes the turn to the synced leader (the stage window on the desktop stage), which owns the tool executors and the ACT listener. A probe that skips the leader reports a false failure. Prefer `pnpm qa:app run --model <path> --script <replay json> --say <text> --expect act,tts` over hand-written CDP glue: it launches a temporary profile, seeds onboarding and the `qa:llm` replay provider, sends through the composer or the bridge `chatSend`, waits for named bridge events (`act`, `expression`, `tts`, `turn`; `clip` is not recorded yet), and prints one JSON summary. Use `--dry-run` to inspect the plan without launching.

Set `AIRI_QA_RIG_FORBOOTH` to the local ForBOOTH rig directory for `qa:live2d-rig`, and `AIRI_QA_MMD_MODEL` to a local PMX or PMD model for `qa:test:model`. Keep local `AIRI_QA_*` values in the ignored repo-root `.env.qa`; every qa-tools command loads it, and shell values take precedence. Set `AIRI_QA_CUBISM_CORE` when the core is not at the current checkout's default path. The bridge is enabled only when the build is development and both `APP_REMOTE_DEBUG=true` and `APP_MOTION_QA_BRIDGE=true` are set. Rendered runs use `APP_USER_DATA_PATH` for a temporary profile. Do not reuse a personal Electron profile.

On Linux, start every command that opens the app, including `qa:stage measure`, `qa:app`, and `qa:host smoke`, through the headless QA display so the user can keep working:

```bash
pnpm qa:display run -- pnpm qa:stage measure --pairs <n> --profile <profile dir> --out <json>
pnpm qa:display down
```

The session is a GPU-accelerated KWin compositor with its own Xwayland and D-Bus bus, run as a systemd user unit, so nothing reaches the user's desktop. Use `--name <name>` when another agent's session may be running, and stop your own session when you finish. `pnpm qa:display shot <file.png>` captures the whole session display when CDP screenshots are not enough. The display does not change a command's CPU slot class. Details: [`scripts/dev-tools/README.md`](../../../scripts/dev-tools/README.md#pnpm-qadisplay).

Run `pnpm qa:host smoke` to compare a temporary Electron app's capability snapshot with the runner and observe host signals for 180 seconds. On native Wayland, pass `--expect-idle verified` or `--expect-idle unverified`, according to the machine's idle probe. Pass `--xwayland` to launch the XWayland backend; that flag requires a Linux Wayland session. The command tears down its app and temporary profile when it finishes.

## Finding the motion that looks wrong

Scores do not say which idle motion a reviewer dislikes. For that, use the Motion review section of the Natural motion lab ([stage-ui-live2d README](../../../packages/stage-ui-live2d/README.md#motion-review)): it mutes or solos each idle layer on the running model, captions what drives the head and the eyes, and records flagged moments with the 10 s that led up to them. Ask the user for the downloaded `natural-review-flags-*.json` before proposing a change to idle motion. Never run a capture or a gate with the review gains changed.

## Required limitations wording

Every motion QA report and verdict must state:

> Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

Naturalness remains Luke's visual call. Never retune a gate, scorer constant, or Natural recipe to make a failing run pass; failures are findings.

## Heavy runs

Do not commit run output or rig, model, or core assets. App sessions take the `live` CPU slot class. `qa:stage measure` and `qa:bench` take `exclusive`, which waits until no other lease holds slots, and a measurement needs an undisturbed desktop. Run `pnpm slots status` to inspect current holders and queued work.

For details, read [`packages/qa-tools/README.md`](../../../packages/qa-tools/README.md).
