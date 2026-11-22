# @proj-airi/qa-tools

## Character behavior inputs

The motion QA bridge reads shared behavior from `settings/character-behavior`.
`configure` accepts `cursorAttention`, `chatAttention`, `touchReactions`,
`idleActivities`, and `heldEmotions`; these affect the shared document. The
Live2D-only `screenLean` input replaces `screenAwareness` and changes placement
without changing chat attention. State replies expose all four behavior
switches and screen lean separately. `configure.driver` accepts `natural`,
`universal`, and `magic` for Live2D, or `natural` and `classic` for MMD. MMD
changes go through its realisation settings document command. A driver the loaded
renderer does not support is rejected; state replies report that renderer's driver.
Default headless scenarios keep their
existing settings and motion inputs.

## Purpose

This private, Node-only package runs repository QA checks: headless body motion for MMD (`qa:motion3d`) and Live2D (`qa:live2d-rig`), rendered Electron app sessions, desktop stage gates, and perf reports. Motion quality scoring, LLM evaluation, and the character-state simulator are in [`@proj-airi/lab-tools`](../lab-tools/README.md). Product packages must not depend on it.

Body-motion contracts live under `src/t2-3d/`: `scenarios.ts` exports the nine
deterministic `motion3dScenarios`, and `read-trace.ts` exports `readTrace(path)`
and `parseTrace(input)`. Both return `{ trace, rot, root, channels }` with the
validated header and decoded float32 blocks. `MotionTraceRefusal.name` identifies
structural refusals; these inputs are never scored.

Every scenario but `sleepy-no-clip` (100 s) warms up for 10 s. At their default 60 s scored duration,
`idle` has one observation marker, `gaze-shift` repeats shuffled targets at
15, 40 and 80 degrees to both sides, held for a seeded 3 to 5 s, returning
forward for a seeded 2 to 4 s between targets (18 cues at seed 1), and `touch`
has ten pokes.

`speak` is timeline version 2 (recorded as `scenarioVersion` in the trace
source detail); version-1 speak traces, with twelve peaks at fixed 20/40/60/80 %
positions, are no longer its reference. Version 2 has three 8 s utterances with
five labelled peaks each (fifteen per run), spaced by seeded gaps of 0.9 to
1.5 s, with strengths of 0.35 to 0.95 (the peak's voice level). Each utterance
runs at one of the energies 0.45, 0.65 and 0.85 in seeded order, returning to
0.5 after it. During one seeded utterance a chat panel 25 degrees to a seeded
side and 10 degrees down shows half a second earlier and unfolds a reply, so
Natural reads it for the quarter second before she answers, until talking
ends the read. No emotion pulse is sent.

`gesture-under-clip` (talk, 30 s, version 3) exercises clip ownership with a
programmatic clip, never an asset. Every time follows from the timeline by one
rule for every seed: utterance A at 0.5 s (energy 0.85, five peaks); a clip
that claims the right arm and fingers 50 ms after the A peak nearest 3 s with a
0.25 s fade-in; a body poke 50 ms after the A peak nearest 5 s, inside A's
gesture unit; utterance B at 8.5 s (10 s, six peaks) while the clip holds; the
release 1.5 s after B ends (20 s) with a 0.3 s fade-out, when no gesture unit
can run; utterance C at 22 s (7 s, four peaks); and a second claim 50 ms after
C's first peak, released 50 ms after its third while C's unit runs. Which
arm a gesture unit takes is the gesture layer's seeded choice, so the ownership
criterion pools seeds 1 to 6. The clip keys
the rig's right shoulder, upper arm, elbow, wrist and finger bones with a raised
pose and a 0.2 Hz, 3 degree sway, is registered with the body and the frame
pipeline like an app clip, and plays on the runner's mixer.

Cue kinds beyond voice, gaze, emotion, gesture, touch, goal and activity:
`energy` sets the user energy handed to Natural and the body (0.5 until set),
`chat` shows or hides the chat panel (a head-width point, as the gaze cursor)
and may unfold a reply, which the runner hands the adapter as a chat read
(`chatRead`), as the app's character mind does, and `clip-claim` and `clip-release` start and end the
runner's clip as the app's upper clip layer, with that layer's smoothstep fade
(0.25 s in, 0.3 s out, `@proj-airi/stage-ui-mmd/composables/mmd/layer-fade`). Each is labelled in the trace as a `marker`.
Gaze cursors are three head widths away: x is `3*sin(yaw)`, y is `3*sin(pitch)`;
the cue type documents how to recover angles for the world target.
While a cue holds a cursor, the runner circles it around the target by one
degree of visual angle at 1 Hz, as a hand resting on the mouse does. Natural keeps its
cursor attention only while the cursor moves, so a cursor held perfectly
still would lose her gaze after about a second and a half, as it does in the app.
`walk` (version 3, goal 4) defaults to 60 s, every goal at walk pace: a leg to
+19.5 leg lengths at 0.5 s (about 22 s of walking, enough for three 10 s gate
windows), back to the left toward +8 at 28 s, a goal behind her at +19 at
33 s while she walks left (she brakes and turns around through 180 degrees),
then short legs to +16 at 45 s and +19 at 54.5 s; a last goal to +16 at 64 s
fires only in longer runs. Each cue but the turn-around comes at least 2 s after
the previous leg's arrival turn ends (measured on version 2), so slower starts
and stops keep every turn: 8 turns in 60 s (the gate's `gait.headLeadMs` needs
8 turn episodes), which `walk-form` checks at report time. Only a seeded
`observe-walk` marker depends on the seed. Versions 1 and 2 are no longer
selectable; `qa:stage capture --scenario walk` replays the same version 3 goals.
Touch is reported only and has no human reference.

`sleepy-no-clip` (C004 of goal 4, idle class) assigns no stance clip. Its
100 s warm-up puts the director's idle-to-sit time, 120 s after load, at 20 s
of scenario time; the user goes away at 40 s (an `activity` cue with `away`,
recorded as `mode: away`) and input returns as `listening` at 80 s. It
defaults to 120 s and is the only scenario that records `stance:<reason>`
markers, one whenever the stance director's reason changes, from the first
frame (`recordStance`); the other scenarios do not, so their traces are
unchanged. Version 2 sets the QA idle drive `qa-neutral-day-away`, so the idle
scheduler falls asleep 12 to 30 s after the away cue and reports it.

`idle-drive` (C001 of goal 4, idle class, version 1) is the `idle` timeline with
the QA idle drive `qa-neutral-day` (neutral mood, daytime, the user present and
inactive), so the character mind decides her idle acts over the run; it defaults to
60 s and accepts up to 600 s. `idle` itself sets no drive and stays the base idle
that `gesture-timing`, `ownership` and the gate's idle class score.

`music` (CM5 of the character mind roadmap, idle class, version 1) is the `idle`
timeline with the QA idle drive `qa-neutral-day`. The scenario also sets `music`, so the runner sends its
character mind `{ kind: 'music', playing: true }` before the first frame and
records `music: true` in the trace source detail; the mind may then draw her
groove (the `sway` act). The stimulus draws nothing, so the idle stream's seed
does not move. It defaults to 60 s and accepts up to 600 s; a sway is rare, so run it at 600 s
and check for an `idle:sway:start` marker.

`music-beat` (CM5b, idle class, version 1) is `music` with a detector's beats
at 120 BPM (`beats: { bpm: 120, jitterSeconds: 0.02 }`). `scriptBeats` computes
them from the run's seed on a seed layer of their own: one beat in ten missed,
one extra off-beat in ten, each arrival jittered by up to 20 ms, and each
interval the exact spacing of the detected beats, as the detector measures it
on the audio clock. From the first warm-up frame the runner hands each beat to
`MMDNaturalAdapter.beat` at the frame it arrives, records the scripted tempo as
`beats` in the trace source detail, and records each `groove-lock` observer
event as a `groove:lock:<beats per cycle>` marker. The beats draw nothing, so a
seed draws its sways at the same times as in `music`.

`emotions` defaults to 120 s: six clear pulses and two placebos, spaced 12 s
apart in the first 100 s, then all five cue gestures in seeded order in the last
20 s. With `E = PERFORMANCE_EMOTIONS`, `k = (seed - 1) mod 6` and
`p = floor(k / 2)`, rotate E by `3p` and take its first half for even k or
second half for odd k. Run seeds 1 to 6 and score them together with `pnpm lab:motion3d gate`: each emotion
then has exactly three trials, with twelve placebo trials. Higher seeds repeat
the sets with different seeded orders; every trial id includes its seed.
Shorter runs truncate trials and do not carry this pooling guarantee.

### Run tools

Commands that read stored run directories and judge nothing. Scoring, rendering, and batch tools for runs are in [lab-tools](../lab-tools/README.md#run-tools). Each replaces a
check that reviewers wrote by hand during motion tuning and that went wrong at
least once.

| Command | Purpose | When to use | When not to use |
| --- | --- | --- | --- |
| `pnpm qa:motion3d diff <base run> <tip run> [<base run> <tip run>...] [--allow-mismatch scenario,seed,model,length]`, or `diff <base folder> <tip folder>` | Is the motion identical? Compares the traces block by block (`header`, `rig`, `detail`, `rot`, `root`, `channels`, `events`) and prints IDENTICAL or DIFFERENT per block. Where a frame block differs, it prints the first differing frame and its time, and the largest difference: for `rot`, the largest turn between the two rotations of one bone in degrees, with the bone and time. Only `source.gitSha` and `source.dirty` are ignored, because they name the commit. Two folders are matched by run directory name. A pair that differs in scenario (id, class or `scenarioVersion`), seed, model (`rig.assetSha256`, or `rig.id` without a hash) or scored length is REFUSED unless `--allow-mismatch` names the field. Exit 0 when every pair is identical, 1 when one differs, 2 on a refusal, a run present in one folder only, an unreadable trace or a usage error. | Proving that a change left a run's motion byte-identical, or finding where and how much it changed. | Judging whether a change is good: a difference is not a fault, and identity says nothing about quality. |
| `pnpm qa:motion3d affected <base commit> <tip commit>` | Does a change touch motion? Answers whether any file the headless runner loads changed between two commits, from the runner's real import graph at each commit (read from git objects, no checkout): roots `src/t2-3d/runner/run.ts` and `src/t2-3d/runner/arguments.ts`, followed through static imports and re-exports, side-effect imports, literal `import()` and `new URL(..., import.meta.url)`, relative files and `@proj-airi/*` workspace exports (every condition of an `exports` entry counts). Type-only imports are left out because they are erased. Exit 1 AFFECTED: a changed file is in either commit's closure, or a `package.json` that owns a closure file changed in anything but `scripts`, or a `tsconfig*.json` beside one (or at the root) changed; the changed closure files are listed. Exit 0 NOT AFFECTED: none of that, both closures complete. Exit 2 CANNOT TELL: a computed `import()`, an import that does not resolve to a file of the commit, a missing root, or a changed `pnpm-lock.yaml`/`pnpm-workspace.yaml` (dependency versions may differ), without an affected file; also a usage error. Limits: files read through `fs` at runtime are not followed (the runner reads only dependency `package.json` versions that way), and a change in a closure file is AFFECTED even when it cannot change motion (the `frames` observer commit 7920da8b2 is AFFECTED: the command does not prove a runner change neutral; `diff` of stored runs does). Use it in landing checks to skip motion identity runs for changes that touch no runner file; run them when it exits 1 or 2. |

## Usage

Run `pnpm qa:doctor` first. It checks whether the current worktree can produce meaningful results and does not repair the environment.

Every root `qa:*` script runs its entry directly with `node --import tsx`, from the repository root. Run a script as `pnpm --silent qa:<tool>` when its output must contain nothing but the tool's own lines.

| Command | Use |
| --- | --- |
| `pnpm qa:setup cubism [--force]` | Download Cubism Core for the desktop app without opening a window. Skip present copies; `--force` downloads again. |
| `pnpm qa:doctor [--json] [--warm]` | Check Node, pinned pnpm, temporary directory and compile cache space (`temp-space`), installation, built packages, Cubism Core, Chromium, the Live2D rig directory (`AIRI_QA_RIG_FORBOOTH`) and MMD model file (`AIRI_QA_MMD_MODEL`), and conflicting Electron processes. `--warm` runs the stage-ui browser warm-up. |
| `pnpm qa:live2d-rig [--emotion angry] [--band strong] [--seed 1] [--out <trace.json>]` | Run one 10 s emotion trial through the Natural driver on the headless ForBOOTH rig and Cubism Core, and print the samples, moving channels, trace hash, and speed. Set `AIRI_QA_RIG_FORBOOTH`; set `AIRI_QA_CUBISM_CORE` when the core is not at the checkout's default path. See [T2 status](#t2-status). |
| `pnpm qa:host smoke [--xwayland] [--expect-idle verified\|unverified] [--expect-backend <backend>] [--expect-verified <proofs>]` | Launch a temporary Electron profile and compare host signals with the runner's capabilities, then observe idle delivery every 5 seconds for 180 seconds. On Linux, also check the desktop backend and the signals it verifies. |
| `pnpm qa:smoke [--model <path>] [--stage-host window\|desktop] [--expect-host window\|desktop] [--xwayland] [--electron-arg=<switch>...] [--settle <seconds>] [--allow <json>] [--out <dir>]` | Start the app from a fresh profile and fail on any renderer exception, `console.error`, browser error, or main-process error in any window. See [Clean-start smoke](#clean-start-smoke). |
| `pnpm qa:app run --model <path> --say <text> [options]` | Run a disposable experience session: replayed chat and speech, real model import, events, and a screenshot. See [App experience sessions](#app-experience-sessions). |
| `pnpm qa:mcp` | Serve the `airi-qa` MCP server over stdio, so an agent can start the app, chat, screenshot, and read errors through tools. See [Agent MCP server](#agent-mcp-server). |
| `pnpm qa:stage measure --mode <window\|desktop> --port <cdp port> [--seconds 60] [--attempts 3] --out <json>` | Measure the MMD frame budget of a running app in one host mode. See [Stage gates](#stage-gates). |
| `pnpm qa:stage measure --pairs <n> --profile <dir> [--seconds 60] [--settle 10] [--attempts 3] --out <json>` | Launch the app once per run and measure alternating window and desktop pairs into one file. |
| `pnpm qa:stage measure --mode <window\|desktop> --port <cdp port> --scenario <gesture-walk\|action-preempt> --clip <clip name> [--seconds 12] [--attempts 3] --out <json>` | Play an imported MMD clip over a walk or into one and record the snapshot series. See [Stage gates](#stage-gates). |
| `pnpm qa:stage handoff --model <MMD model> [--seconds 120] --out <json>` | Launch the desktop stage on a fresh profile and walk her to another display and back. It needs a session with more than one display. See [Stage gates](#stage-gates). |
| `pnpm qa:stage gate <json> [<json>...]` | Judge stage evidence with `stage-walk-skate`, `stage-arm-penetration`, `stage-frame-budget`, `stage-gesture-walk`, `stage-action-preempt`, and `stage-handoff`. |

Exit code 0 means the requested check passed, 1 means a check failed or a run broke, and 2 means invalid arguments or setup; app sessions also use 130 for interruption.

## Linux host session guard

`qa:bench` launches and launched `qa:stage measure` pairs need a calm host. Before each launch they wait up to 30 minutes for one, as `decideHostContended` in `@proj-airi/stage-shared/perf/usage` judges it from load per core, machine CPU use, and CPU pressure (`src/host-quiet/`).

On Linux, `pnpm qa:smoke`, `pnpm qa:app run` (except `--dry-run`), `pnpm qa:host smoke`, and `pnpm qa:kwin-probe` (unless it gets an explicit `--bus`) start only inside a live `pnpm qa:display` session, so their windows and desktop sensors never reach the user's own desktop. Outside one they exit 2 before launching Electron, and the message names `pnpm qa:display run --`. The guard accepts a session only when `AIRI_QA_DISPLAY_SESSION` names it, its systemd unit is active, its env file exists, and the display, bus, and runtime variables match that env file, so a stale export from a stopped session or a hand-set marker is refused. `--allow-host-session` skips the guard for a person who deliberately tests on their own desktop; agents never pass it. Windows and macOS have no QA display and are not guarded. The shared check is `requireQaDisplaySession` in `scripts/dev-tools/qa-display-guard.ts`.

Process discovery is scoped the same way. On Linux, the process listing that the launch check, `trackTree`, and teardown read (`listLiveProcesses` in `src/env/processes.ts`) contains only the processes of the current session: everything in the cgroup of the `airi-qa-display-<name>.service` unit and of its `airi-qa-display-<name>.run-<pid>.scope` units, child cgroups included, plus the caller's own descendants found through `/proc/<pid>/task/<tid>/children`. `pnpm qa:display run` starts its command in such a run scope, so a process the run leaves behind stays visible to the next teardown or launch check of the same session. The listing never runs `ps` or `pgrep` and never walks `/proc` for the whole host. Without `AIRI_QA_DISPLAY_SESSION`, or when that session's unit is not active, it refuses with an error instead of reading the host. macOS and Windows still list every process. `pnpm dev:top` and `pnpm wt` list every host process through their own module, `scripts/dev-tools/lib/processes.ts`, to attribute CPU and memory to worktrees. The two listings stay separate because agent QA must not read the user's processes on Linux, and a merged module would put a host-wide listing one import away from it.

A QA display also keeps the run off the user's audio graph. By default the session has no audio server, so the app, KWin, and the portals are not clients of the user's PipeWire. A run that plays, captures, or screen-shares audio (system-audio lip sync, speech playback checks) starts its session with `pnpm qa:display up --name <name> --private-audio`. That session has its own PipeWire, WirePlumber, and pipewire-pulse, and inside it the null sink `airi_qa` is the default sink: `pw-play --target airi_qa` feeds it, and its monitor source records what the app played. `--host-audio` links the user's own audio sockets for a person who wants to hear the session; agents never use it. See [`pnpm qa:display`](../../scripts/dev-tools/README.md#pnpm-qadisplay).

## Host signal smoke

Run `pnpm qa:host smoke` on Windows, macOS, or Linux X11. On Linux, run it as `pnpm qa:display run -- pnpm qa:host smoke ...` (see the host session guard above). On native Wayland, `--expect-idle verified|unverified` is required: choose the result established by the machine's idle probe. Run `--xwayland` for XWayland.

On Linux, `--expect-backend kwin|x11-ewmh|sway|hyprland|gnome|none` is required, and `--expect-verified` lists the runtime proofs the app must reach, from `foreground`, `cursor`, `geometry`, `keepAbove`, `lock`, `portal` and `audio`. The expected profile is `capabilitiesForHost(host, linuxDesktop)` with those proofs set, so the comparison is exact. A bridge-owned signal may move forward once, from `linux-bridge-starting` through its unverified status to the expected one; a signal that moves back, takes any other status, or ends elsewhere fails. A proof that changes no signal on that host and backend is refused with exit 2, for example `cursor` on `x11-ewmh` or `sway`. Name `lock` only when the session owns a lock source: `qa:display` sessions have no logind seat or ScreenSaver service unless a test starts one.

During the observation on Linux, the smoke gives the verifiers their evidence once each. When `cursor` is expected, it moves the session pointer with `pnpm qa:display pointer` after the second and third samples (to 200,200 and 1000,600). When `foreground` is expected, after the fourth sample it opens a Konsole helper window inside the session and waits up to 20 seconds for the app's foreground sample to leave AIRI, closes the helper, and waits for focus to return to an AIRI window, which fires the window focus event the foreground verifier needs. Pointer moves are desktop input and reset a live idle reading, so runs that do not expect `cursor` get none: on X11 the idle reading is live from the start and must advance across the whole observation. `report.json` `drive` holds a receipt for each step, and a required step that failed or never ran fails the run with `drive-failed`. Every sample records the app's foreground sample as `exeName`, `busy` and `ownProcess`, never the title.

In a headless `qa:display --compositor sway` session, run `pnpm qa:host smoke --expect-idle unverified --expect-backend sway --expect-verified geometry`. The sway backend reports its outputs, so window geometry verifies there. Two limits of that session remain:

- Foreground: the seat has no input devices, so Electron never activates and foreground is never verified. Expecting `foreground` ends with `verification-missing` and `drive-failed`.
- Idle: on 2026-11-09 idle stayed unverified for the whole observation, so the run expects `--expect-idle unverified`.

For native KWin Wayland, include all four proofs established by the regression
run, including keep-above:

```sh
pnpm qa:display run -- pnpm qa:host smoke --expect-idle verified --expect-backend kwin --expect-verified foreground,cursor,geometry,keepAbove
```

The smoke passed with 37 samples in `.temp/qa/20261109-184734-host-smoke`
under `<worktrees>/lsp-t19`. Lock and audio are not listed
because that session did not provide a lock source or run capture.

The command prints a JSON report and saves `report.json` and `app.log` under the reported `.temp/qa/` run directory. Every sample includes its elapsed time, raw host snapshot, idle reading, and resolved performance mode. A live idle sensor must advance; native Wayland may stay unverified with null idle readings or promote once to live and then advance. Runtime hook or foreground binding failures fail the signal comparison and name their reason.

A bridge read that times out under host load (a slow CDP evaluate) is not a broken run. It is listed in `report.json` `missedSamples` with its elapsed time and message, and the next read follows at once. The evaluation sees only the samples that arrived, with its checks unchanged, so the observation must still span 180 seconds. Three timed-out reads in a row, or any other bridge error, end the run as `run-failed`.

Exit codes are 0 for pass, 1 for a failed check or interrupted run, and 2 for refused setup or invalid arguments. SIGINT and SIGTERM stop observation and finish teardown; repeated interrupts leave teardown running. Only Windows parks the cursor before observation. macOS receives no harness input; Linux receives only the evidence steps described above. The smoke refuses a second Electron session in its worktree and always removes its temporary profile after stopping its app tree.

Each entry of `report.json` `failures` is an object with a `code` and a `message`; evaluator failures also name the `signal` and the `expected` and `received` statuses. Codes: `host-mismatch`, `backend-mismatch` (the app reports another desktop backend), `signal-mismatch`, `verification-missing` (a named proof never turned its signal to the expected status, or `foreground` is live but no foreground sample arrived), `drive-failed`, the idle codes, `snapshot-missing`, `observation-too-short`, `refused` (exit 2, nothing launched), `run-failed` and `teardown-failed`.

For failure QA only, `pnpm qa:host smoke --xwayland --expect linux-wayland --expect-backend kwin` changes the expected host without changing the launched backend. It must exit 1 and name `systemIdleTime`. A KWin session run with `--expect-backend sway` must exit 1 with `backend-mismatch`.

Windows live acceptance is [~] for Luke: `pnpm qa:host smoke`. macOS live acceptance is [~] for Luke: `pnpm qa:host smoke`. Use the smoke to verify host delivery; use the motion gates to score character motion.

## Temporary directory space

The `temp-space` doctor row reads `statfs` for the system temporary directory (`os.tmpdir()`) and for the Node compile cache directory: `NODE_COMPILE_CACHE` when set, otherwise the checkout's `node_modules/.cache/node-compile-cache`, which the repository's entry points use by default (see the [dev-tools README](../../scripts/dev-tools/README.md#node-compile-cache)). It warns above 80 % and fails above 95 % of inodes or space, whichever is worse. A filesystem without a fixed inode table, such as btrfs or NTFS, is judged on space only. The row names the temporary directory's subdirectory that holds the most entries, and it warns when `NODE_COMPILE_CACHE` points into the temporary directory: every Node process with that variable writes cache files there, which filled the inodes of a 1,048,576-inode tmpfs on 2026-11-12. Doctor deletes nothing.

## Fresh worktree Cubism setup

Cubism Core is an ignored local asset, not an installed workspace dependency. A new worktree can therefore fail the `cubism-core` doctor check even when the main checkout passes. Run `pnpm qa:setup cubism` from the worktree being checked, then rerun `pnpm qa:doctor`. Setup skips existing copies; `--force` downloads and replaces them.

The desktop app's Vite config (`apps/stage-tamagotchi/electron.vite.config.ts`) registers `DownloadLive2DSDK()` from `@proj-airi/unplugin-live2d-sdk`. Setup calls that package's existing download hook directly without starting the app. The downloader extracts `CubismSdkForWeb-5-r.3` into the app's `.cache/` and copies `Core/live2dcubismcore.min.js` into its `public/assets/js/` tree. The Vite hook keeps its existing behavior; `pnpm install` alone does not invoke it. Doctor remains read-only.

Cubism Core has its own Live2D license; see the root [license note](../../README.md#license-and-credits) and the [local QA license decision](../../docs/ai/adr/2026-10-20-motion-qa-levels.md#t2-license-decision). Do not commit the SDK or rig assets.

## Local QA environment

Put local defaults in the repository root's ignored `.env.qa`, for example:

```dotenv
AIRI_QA_RIG_FORBOOTH="/path/to/rig"
AIRI_QA_MMD_MODEL="/path/to/model.pmx"
```

Every `bin/` command that reads QA settings loads this file first or recording their environment. Only `AIRI_QA_*` keys apply, and existing shell variables (including empty values) take precedence. A missing file is silent. Malformed input produces a warning and applies no values; unrelated keys produce warnings and are ignored. Doctor names the source file and loaded keys in its rigs row.

## Pointer platform preflight

Doctor's `pointer-platform` row is OK on Windows. On macOS it is OK when the CoreGraphics pointer backend may post mouse events. The backend is `src/t3/pointer-macos.ts` over `scripts/macos/mac-pointer.py`, run with `python3 -I`. It plays step tables built by `warpSteps`, `moveSteps`, `pressSteps`, `releaseSteps`, and `dragSteps` in global display points, the space of Electron's `screen` and CDP's `screenX`/`screenY`. A warp needs no permission. Posted moves, presses, releases, and drags need Accessibility access for the app that started the QA command, such as the terminal. macOS drops posted events silently without it, so the helper refuses such a table with exit code 3. Doctor's row is then WARN and names that app. Rendered runs without the access warp the cursor through the backend and send button input over CDP.

On Linux inside `pnpm qa:display run --`, it is OK when the KWin pointer backend is available: `python3` with PyGObject (`gi`), `libei.so.1`, and the nested KWin's `org.kde.KWin.EIS.RemoteDesktop` D-Bus interface. Otherwise the row is WARN and names what is missing.

The KWin backend needs the default `kwin` QA display (with or without `--portals`). The `x11` and `sway` QA display sessions (`pnpm qa:display up --compositor x11|sway`) have no KWin, so the row is WARN there. To place the pointer in any of the three sessions, use `pnpm qa:display pointer <x> <y>`. It plays one EIS move on `kwin` through `scripts/linux/kwin-pointer.py` (run with `python3 -I`), runs `xdotool mousemove` on `x11`, and runs `swaymsg seat - cursor set` on `sway`. `qa:host smoke` evidence steps and `qa:stage handoff` move the pointer this way.

- Cursor parking is Windows-only.
- `qa:stage measure` falls back to CDP pointer moves outside Windows, which never trigger hit-test readback. The `stage-frame-budget` readback is therefore unmeasured. This also holds inside the QA display.
- On Linux, the desktop stage runs only where the desktop bridge can emulate click-through: KWin or an EWMH X11 session with a supported Electron (`isLinuxStageEligible` in `apps/stage-tamagotchi/src/main/windows/stage/mode.ts`; see the [Linux desktop bridge ADR](../../docs/ai/adr/2026-11-09-linux-desktop-bridge.md)). Other Linux sessions get the classic window, and their polled cursor can stick stale (#2521). See `apps/stage-tamagotchi/src/renderer/pages/index.vue` and the [fullscreen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

## Chat and speech replay server

`qa:llm` is a development-only OpenAI-compatible HTTP server for testing chat, ACT cues, tool calls, and speech playback without provider tokens. It uses `node:http`, makes no provider calls, and never launches Electron.

```bash
pnpm qa:llm serve --script packages/qa-tools/fixtures/llm/example.json --port 0 --log .temp/qa/replay-requests.jsonl
pnpm qa:llm serve --set legacy-2026-10-27-mac-m2 --run-key dolphin3:8b/bench
```

The server prints one JSON ready line to stdout with `ready`, `baseURL`, `model`, `speechModel`, `script`, `entries`, and `log`. The default host is `127.0.0.1`, the default port is `0` (choose a free port), and the default script is the committed example. Relative script and log paths resolve from the calling directory. SIGINT and SIGTERM close listening and active connections and exit 0. Invalid arguments or setup exit 2. Do not expose this unauthenticated server or send it real conversation data: its request log contains complete prompts and tool definitions.

A `.json` script contains an array; `.jsonl` contains one entry per nonblank line:

```json
[
  {
    "content": "<|ACT {\"emotion\":\"happy\"}|>Hello!",
    "usage": { "prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20 }
  },
  {
    "match": { "regex": "stop|action", "flags": "i" },
    "content": "I'll stop the current action.",
    "toolCalls": [
      { "name": "perform_action", "arguments": { "action": "stop" } }
    ]
  },
  { "content": "The action is finished." }
]
```

Each entry is consumed once. The first unused entry whose `match` matches the last user message takes precedence; otherwise the first unused entry is consumed, even if it has a match. A string `match` is a case-sensitive substring; an object uses `regex` and optional JavaScript regex `flags`. Text content parts in the last user message are concatenated for matching. A preferred later entry does not discard earlier entries. `content` defaults to an empty string and `toolCalls` defaults to an empty array. Tool `arguments` can be a JSON object or a string encoding a JSON object. ACT cues are replayed verbatim, including across chunk boundaries. Invalid scripts and regexes fail before listening.

Tool replies end with `finish_reason: "tool_calls"`. AIRI can then send another request containing the tool result, so include a final text entry after a tool entry. The example's `perform_action` uses `{"action":"stop"}`, which does not require importing a particular animation. To play a clip instead, use an action label exposed for the active model. Provider validation may itself issue a completion and consume an entry; inspect the log and restart the server before a deterministic scenario.

`--set` and `--script` are mutually exclusive. Set mode reads validated `airi.reply-transcript/v1` rows from `packages/lab-tools/model-eval/sets/<id>/transcripts.jsonl`, optionally filters by exact `--run-key`, and replays `reply.text` in file order. It does not replay recorded tools, thinking, errors, or usage. An empty selection fails at startup.

`--chunk-chars N` (default 16, range 1-1048576) splits content and tool arguments by Unicode code point. `--delay-ms N` (default 0, range 0-60000) delays each SSE chunk. Streaming requests receive OpenAI chunks followed by `data: [DONE]`; nonstreaming requests receive a completion JSON object. Exhaustion returns HTTP 409 with the source filename and zero-based next index; malformed JSON or invalid request shapes return 400. Unknown routes return 404 JSON. Browser CORS preflight is supported.

Point AIRI at the `baseURL` printed by this run, including `/v1/` and the trailing slash:

| Setting | Value |
| --- | --- |
| Chat provider | OpenAI Compatible (`openai-compatible`) |
| API protocol | Chat Completions (`chat-completions`) |
| Base URL, both providers | `http://127.0.0.1:<printed port>/v1/` |
| API key, both providers | `replay` (nonempty placeholder; ignored by the server) |
| Chat model | `airi-replay` |
| Speech provider | OpenAI Compatible (`openai-compatible-audio-speech`) |
| Speech model | `airi-replay-tts` |
| Speech voice | Custom voice `alloy` |
| Speech options | SSML off; speed 1; response format `wav` if exposed |

`GET /v1/models` advertises both model IDs. The speech ID includes `tts` because AIRI's compatible speech model discovery filters for that substring. Its provider has no voice catalog, so enter a custom voice ID. `POST /v1/audio/speech` accepts AIRI's `model`, `input`, and `voice` fields plus optional speech options; it always returns `audio/wav` regardless of the requested format or speed. The response is valid 24 kHz mono 16-bit PCM silence: 50 ms per input code point, with a minimum of 0.25 s and maximum of 30 s. It exercises decoding, playback timing, and completion; silence does not exercise amplitude-driven lip sync or voice quality.

Every HTTP request appends one JSON line to `--log` (default `.temp/qa/llm-requests.jsonl`) with `method`, `path`, the original parsed `body`, `selectedEntryIndex` (null outside a selected completion), `status`, and an ISO `timestamp`. Malformed JSON has a null body. Authorization headers are not logged. The log appends across restarts; choose a fresh path per scenario.

Run the pure replay and real xsai transport tests with:

```bash
pnpm -F @proj-airi/qa-tools exec vitest run --project node src/llm
```

## Clean-start smoke

`qa:smoke` proves that the app starts without errors. It launches the development app with a fresh `APP_USER_DATA_PATH` profile, completes onboarding, waits for the motion QA bridge, optionally imports `--model` (the same formats and `--kind` rules as `qa:app`), waits `--settle` seconds (default 20), screenshots the stage, and tears down.

```bash
pnpm qa:smoke                                              # Linux: pnpm qa:display run -- pnpm --silent qa:smoke (required; see Linux host session guard)
pnpm qa:smoke --model /models/character.zip --settle 10
pnpm qa:smoke --model /models/miku/miku.pmx --stage-host desktop   # the full-screen desktop stage instead of the classic window
pnpm qa:smoke --model /models/miku/miku.pmx --stage-host desktop --expect-host window   # a platform whose gate keeps the classic window (sway)
pnpm qa:smoke --xwayland                                   # launch through dev:xwayland inside a Wayland session
```

By default the smoke forces the classic window (`AIRI_STAGE_HOST=window`). `--stage-host desktop` instead saves the Experimental 3D stage setting and an MMD renderer in the temporary profile's `stage-config.json`, so the launch goes through `selectHostMode` and its platform gate, and attaches to the `#/stage` page. It needs an MMD `--model`.

`--expect-host` names the host the run must end in; it defaults to `--stage-host`. On a platform where the gate keeps the classic window, such as a `qa:display --compositor sway` session, pass `--stage-host desktop --expect-host window`: the run then attaches to the classic `#/` window, imports the model there, and passes only when the main process logged `Building the classic window host`, the collector attached to a `#/` window, and no `#/stage` window existed at any time during the run. Every run checks the same three facts for its expected host (`#/stage` instead of `#/` for the desktop stage), so a run that silently ended in the other host fails. `--expect-host desktop` needs `--stage-host desktop`. The summary reports `expectHost`.

`--xwayland` launches `dev:xwayland` (`--ozone-platform=x11`) instead of `dev`, and its run directory ends in `-clean-start-xwayland`. `--electron-arg=<switch>` (repeatable; write it with `=` because the value starts with `--`) appends one Chromium or Electron switch to the Electron command line through electron-vite's `--` passthrough. The X11 QA display (`qa:display --compositor x11`, Xvfb with Openbox) has no GPU, and WebGL fails there with `WebGL unsupported` or `WebGL context creation failed`, so run the smoke there with software GL:

```bash
pnpm qa:display run --name x11 -- pnpm --silent qa:smoke \
  --electron-arg=--use-gl=angle --electron-arg=--use-angle=swiftshader \
  --electron-arg=--enable-unsafe-swiftshader --electron-arg=--ignore-gpu-blocklist
```

The session itself does not add these switches; the smoke passes them only when asked, so a run on a GPU session keeps the real GL path.

While the app runs, a CDP collector attaches to every window, including windows opened later, and records uncaught exceptions, unhandled rejections, `console.error` and failed `console.assert` calls, and browser error log entries such as failed resource loads. Enabling the domains replays what V8 buffered before the attach, so errors from the first paint count. After teardown, the main-process log is scanned for app logger `[error]` lines, uncaught exceptions, and unhandled rejections. Chromium's own `:ERROR:` lines and the renderer errors that Vite echoes as `[vite] (client)` are excluded.

Any error that does not match an entry in `fixtures/smoke/allowed-errors.json` (or `--allow <json>`) fails the run, and so does a window the collector could not attach to. Each allowlist entry names its `kind` (`exception`, `console`, `log`, or `main`), a regular-expression `pattern`, a `reason`, the date it was `added`, and when to remove it (`removeWhen`). Add an entry only for a concrete, understood cause; an unexplained error is a finding.

Stdout is one JSON line: `ok`, `runDir`, `failure`, `expectHost`, the watched `windows`, counts of unexpected `errors` and `mainErrors`, `allowed`, `unwatchedWindows`, the `firstErrors`, and the `screenshot`. The run directory keeps `errors.json` (every error with its window, kind, text, and source), `diagnostics.json`, `stage.png`, and `app.log`. Exit 0 means a clean start, 1 means an unexpected error or a broken run, 2 means invalid arguments or setup, and 130 means interruption.

On 2026-11-09 a run on Linux in `qa:display` watched the stage, `#/inlay`, and beat-sync windows and found no errors. With a probe that threw an early exception, logged `console.error`, and rejected a promise in the renderer entry, it failed and reported all three in both app windows.

## App experience sessions

`qa:app` runs a disposable Electron experience session with the same replay script format as `qa:llm`. It starts `ReplayServer` in process on loopback port 0, and reuses the shared launch, CDP, model import, screenshot and ownership-checked teardown helpers in `src/t3/`.

```bash
# Inspect the entire plan without opening Electron or requiring this path to exist.
pnpm qa:app run --dry-run --model /models/character.zip --say hello --expect act,tts

# Use the qa:llm example script in an app session. qa:app owns its replay server.
pnpm qa:app run --model /models/character.zip \
  --script packages/qa-tools/fixtures/llm/example.json \
  --say hello --expect act,tts --timeout 60

# The same fixture can also be inspected separately with qa:llm.
pnpm qa:llm serve --script packages/qa-tools/fixtures/llm/example.json --port 0
```

`--say` repeats in order. `--script <json|jsonl>` and `--set <model-eval set id>` are mutually exclusive; neither flag selects the committed example. Set mode uses all transcript rows, as in `qa:llm` without `--run-key`. `--expect` is a comma-separated list of `act`, `expression`, `clip`, `tts`, `turn`, `mind`, or `idle` (default `turn`). `tts` is met only when the reply's speech has finished playing, so the run records the speech end. Every message also waits for a completed assistant turn before sending the next. Each message gets a fresh event sequence cursor and one `--timeout` budget in seconds (default 60, maximum 3600) covering send and event collection. Startup, bridge readiness, and model import have separate T3 bounds.

`--model` accepts a Live2D ZIP or directory, MMD ZIP or PMX/PMD, and VRM. `.vrm` infers VRM and `.pmx`/`.pmd` infer MMD; ZIPs and directories default to Live2D, so pass `--kind mmd` for an MMD ZIP or directory. Directories are zipped in the run directory. A PMX/PMD input packages its parent directory with its resources; use a directory containing one model. Model bytes remain local and the temporary archive is removed at teardown. Import uses the real display-model store and waits for the shared scene's mounted lifecycle.

The fresh `APP_USER_DATA_PATH` profile receives provider records and active chat/speech selections through their stores' exported persistence keys, followed by onboarding completion and a leader reload. VueUse strings stay raw; objects and booleans use JSON. This makes the stores read the seed during initialization instead of mutating an already synchronized snapshot. The selected display model is an IndexedDB file record created by `importModelFromInput`, selected through `useSettingsStageModel().updateStageModel()`. The seed selects OpenAI Compatible Chat Completions, `airi-replay`, speech provider `openai-compatible-audio-speech`, `airi-replay-tts`, custom voice `alloy`, enabled speech, and SSML off. The replay speech endpoint returns WAV silence. Saved API keys are the placeholder `replay`; plan output redacts them.

When an open `#/chat-floating` target has a visible, editable textarea, the driver focuses it and uses CDP `Input.insertText` and Enter. Otherwise `chatSend` calls `useChatStore().send` in the stage window. Both paths reach the synced leader that owns tool execution and ACT handling. The driver never uses `chat.ingest` or a tool's `execute`, and never resends through another path after typing has started.

The dev-only event ring records parsed ACT cues, applied performer expression slot changes, the reply's speech start and end, and assistant turn start/completion with at most 500 reply characters. ACT means parsed, not successfully performed. Speech starts with the reply's first played clip and ends when its playback has drained or was interrupted, not between sentences. The turn usually completes before the speech does. Expressions require a mapping that actually occupies a performer slot; an unmapped emotion can produce ACT without expression. Clip/action start/end is currently **not wired**: the shared stage has no renderer-neutral clip lifecycle subscription, so `--expect clip` times out. VRM has no performer expression slot events. There is no synthetic success event for these gaps.

The headless MMD runner declares `MMD_NATURAL_CAPABILITIES` before the first
frame, without consuming a random draw. Mind events include a `refusals` JSON
array of cause, intent kind, and reason; they contain no stimulus content.
A refused request remains observable even when it yields no intent.

The ring also records one `mind` event for every step of the character mind (`CharacterMind.receive`). Its payload holds scalars only: `stimulus`, the kinds of the step's stimuli (`touch`, `emotion`, `expression-request`, `expression-clear`, `voice-outcome`, `presence`, `screen-change`, `idle`, `idle-wake`, `idle-play`, `cursor`; comma-separated when one step has several, as a desktop wake with a screen change does); `gesture`, the touch gesture (`poke`, `pet-start`, `pet-end`) or null; `outcome`, the result a `voice-outcome` reports (`spoken`, `declined`, `cancelled`, `failed`, `refused`) or null; `intents`, a JSON array of `{ channel, kind, id, cause }`, one object per intent, to which an `idle-act` adds `act` and `requested`, an `idle-errand` adds `errand`, and a `cursor-episode` adds `band` and `engaging`; and the voice decision of a touch that reached the voice policy: `voice` (`speak`, `hold`, or null when no decision was made), `voiceLine` (`pet-soft`, `poke-protest`, or null), and `voiceReason` (the hold reason, or null). It records no point, mood dose, situation id, or text. A touch reaches the mind only under the Natural driver; an ACT emotion reaches it under every driver, so `--expect mind` is met by a reply that carries one. Presence and screen-change stimuli reach it under every driver. A spoken touch reaction adds a second step, the `voice-outcome`, after the step of the touch. A step whose stimulus is `presence` also carries `away` (whether the user is away after the step) and `wake` (`unlock`, `resume`, or null when the user came back without a wake); other steps carry neither. A step whose stimulus is `cursor` also carries `band` (`near`, `medium`, or `far`) and `opportunity` (`appeared`, `restarted`, `moved`, `nearer`, or `reopened`); a cursor report reaches the mind only under the Natural driver. A step whose stimulus is `voice-tick` also carries `gate`, the fire or hold reason of the gate evaluation (for example `forced`, `urge`, or `floor`), or null when the gate skipped because a line or another unprompted turn was open; and `category`, the reason category of a fire (for example `open`), or null. The gate ticks every 2 s, so the ring leaves out an unforced tick that yields no intent, and likewise a step of only idle reports or idle wakes that yields none; a forced tick and a tick that fires are always recorded. A fire's `voice/speak` intent is followed by the unprompted turn's `turn` and `tts` events and by a `voice-outcome` step (`spoken` or `declined`). Every `mind` step also carries `lines`, the kinds of its `voice/speak` lines (`reaction`, `reach-out`, or `widget`), and `cues`, its body cues (`about-to-speak` before a reach-out or widget line, `let-go` when she declines one); each is comma-separated, or null when the step has none. A widget request that she speaks shows as a step with `lines` `widget` and `cues` `about-to-speak`, and its decline as a `voice-outcome` step with `cues` `let-go`.

The ring also records one `idle` event for each idle report of the Natural driver in the Live2D or MMD scene, with `phase` (`start` or `end`) and `behaviour` (for example `sleep`). Under the Universal driver no `idle` events appear.

### Fake ScreenSaver

On Linux, lock QA runs `scripts/linux/fake-screensaver.py` inside the QA display of the app session. It exports `/org/freedesktop/ScreenSaver`, owns `org.freedesktop.ScreenSaver` on the session's private bus, answers `GetActive`, emits `ActiveChanged(true)` `--lock-after` seconds after it starts and `ActiveChanged(false)` `--unlock-after` seconds after it starts, and exits 5 s later: the app drops a signal whose sender name has no owner when it arrives. It prints one JSON line per step. The app's lock source reads it because the private system bus of a QA display has no logind. It exits 2 outside a QA display or when the name already has an owner.

```sh
pnpm qa:display run --name mcp -- python3 -I packages/qa-tools/scripts/linux/fake-screensaver.py --lock-after 5 --unlock-after 50
```

The app takes its first `GetActive` answer as the baseline, so leave a few seconds before the lock.

`--perf-dir <dir>` turns on perf recording in the launched app (`AIRI_PERF_RECORD=1`, `AIRI_PERF_DIR=<absolute dir>`). Without it every QA launch sets `AIRI_PERF_RECORD=0`, so QA sessions stay out of perf recording. `--out <dir>` must name a new directory; otherwise the existing run helper creates `.temp/qa/<timestamp>-app-experience`. `--keep-open` retains Electron and the replay server until interruption, then tears down. SIGINT/SIGTERM exit 130, including during keep-open. An interrupt during keep-open comes after every expectation was checked, so it does not turn the summary's `ok` false; an interrupt before that does. The driver forces the development window stage host unless `--stage-host desktop` asks for the full-screen desktop stage, which needs an MMD `--model`: the session then saves the Experimental 3D stage setting in the temporary profile and attaches to the `#/stage` page, as `qa:smoke --stage-host desktop` does, and fails on a platform whose gate keeps the classic window. It keeps its temporary profile separate from personal settings, and refuses another Electron session in the same worktree.

Stdout contains one compact JSON summary line (`ok`, `runDir`, `model`, `sendPath`, event counts, `missing`, `screenshot`, `diagnostics`, `durationMs`). `sendPath` is `composer`, `chatSend`, `mixed`, or null before sending. Diagnostics include bridge state, per-message cursors, missing kinds, event timestamps, replay request log, timings, and teardown receipts. A broken run exits 1 and still attempts screenshot/diagnostics and teardown. Invalid arguments or refused setup exit 2; success exits 0. Dry run prints the full JSON plan, creates no run, takes no lease, starts no server or app, and does not read model/script files.

The summary also reports `pageErrors`, the number of renderer errors the clean-start collector recorded in any window, and `diagnostics.json` lists them. They do not change `ok`; use `qa:smoke` to gate on errors.

Every `qa:app` session samples host memory every 2 seconds and appends one JSON line per sample to `memory.jsonl` in the run directory, which `run.json` lists as an artifact. Each line holds the time, the used bytes, the compressed bytes, the swap used, the pressure level, and the Linux PSI `some avg10` value; fields the platform does not report are null. On macOS, used memory is active, wired, and compressor-occupied pages, and pressure comes from `kern.memorystatus_vm_pressure_level`. On Linux, used memory is `MemTotal - MemAvailable`, pressure is null, and PSI comes from `/proc/pressure/memory` when the kernel has it. The stdout summary has a `memory` object with `peakUsedGiB`, `peakCompressedGiB`, `maxPressure`, `peakPsiSome10`, and `swapDeltaMiB` (swap at the last sample minus swap at the first). Sampling stops before teardown, so the swap figure describes the app while it is still loaded. `memory` is null when the platform is unsupported or no read succeeded. A failed read skips only its tick. Memory is reported only and never changes `ok`; `diagnostics.json` keeps the full figures, including total memory and the first read error. Host memory includes the model server, so a local model's footprint shows here too.

Live acceptance so far covers one configuration: on 2026-11-09, on Linux in `qa:display`, a ForBOOTH Live2D directory with the example script and `--say hello --expect act,tts` passed in 47 seconds through the `chatSend` path, with ACT, expression, TTS, and turn events, a rendered character in the screenshot, and a clean teardown. The owner must still verify the composer path, MMD and VRM, interruption, and Windows and macOS. Unit tests and dry run do not prove those behaviors.

```bash
pnpm -F @proj-airi/qa-tools exec vitest run --project node src/app
```

## Perf reports

`pnpm perf` reads the desktop app's perf recording directories and never writes into them. Without `--dir` it reads the defaults for `pnpm dev` and packaged builds: `<config>/@proj-airi/stage-tamagotchi/perf` and `<config>/ai.moeru.airi/perf` (Electron names userData after the package name, which electron-builder sets to `ai.moeru.airi` for packaged builds), where `<config>` is `$XDG_CONFIG_HOME` (default `~/.config`) on Linux, `~/Library/Application Support` on macOS, and `%APPDATA%` on Windows. `--dir <path>` repeats and replaces the defaults; use it for `qa:app --perf-dir` runs and for apps started with `APP_USER_DATA_PATH` or `AIRI_PERF_DIR`.

```bash
pnpm perf sessions [--since 7d] [--json] [--dir <path>]...
pnpm perf incident --list [--json] [--dir <path>]...
pnpm perf incident <id> [--json] [--dir <path>]...
pnpm perf features [--feature <key>] [--metric p50FrameMs|share21|share36|share100|cpuPct|workingSetKb] [--seed 1] [--json] [--dir <path>]...
pnpm perf compare <shaA> <shaB> [--include-dirty] [--json] [--dir <path>]...
pnpm perf bench [--scenario <id>] [--since 7d] [--json]
pnpm perf compare --bench <refA> <refB> [--scenario <id>] [--metric <metric>] [--json]
pnpm perf status [--json]
pnpm perf --help
```

`sessions` prints one row per session with its segments merged: start (UTC), duration, short sha (`*` when any identity epoch was dirty, `~n` when the session saw n epochs), host, renderer and model, fps, the share of frames at or above 36 ms and 100 ms, the window-weighted median stage-window CPU (percent of one core), the largest stage-window working set, incidents, and the `live`, `recovered`, and `failed:n` flags. `--since` takes `<n>m`, `<n>h`, or `<n>d` and keeps sessions that started within that window. `--json` prints an array of the same rows with `null` where no segment holds a value. `fps` is exact over the counted windows: their frames divided by the number of counted windows times 5 s. Counted windows are the stage-window rollups that the reducer includes, after settling and visibility exclusions. `medianFpsLowerBound` is 1000 divided by the median frame interval's bin upper edge, so it snaps to a few values and is a lower bound; a steady 60 fps session reads about 55.6.

A segment's row in `sessions.jsonl` wins; a raw segment without a row (a live session, or one that retention has not rolled up yet) is reduced in memory with the same `SegmentRollupReducer` that retention uses. A session is `live` while its `raw/<sessionId>.live` names a running process, and an un-rolled session counts as `recovered` when it has no `recording-stop`, no later segment, and no running recorder. Liveness checks the `.live` pid on the local machine only: for a directory copied from another host, an unrelated local process with the same pid makes a dead session read as `live` and not `recovered`. The same raw segment in several `--dir` copies counts once. Rolled-up rows carry no model name or maximum working set, so `modelName` and `maxWorkingSetKb` are `null` for sessions whose segments are all rolled up; the text table falls back to the model id. Malformed and unknown-version lines are skipped and reported per file on stderr.

`incident --list` lists `incidents/*.json` files across the directories; `incident <id>` prints one, and `--json` prints the file with its path.

`features` runs `compareFeature` from `@proj-airi/stage-shared/perf/usage` on the rolled-up segment cells, each taken over all of its buckets, for one feature (`speechMuted`, `mmdPhysics`, `naturalMotion`, `mmdRoam`, `wakeWord`, `hearing`) or for all of them without `--feature`. Strata (host, renderer, model, activity, window, stage host, devtools, refresh rate, and every other feature) are never pooled. Per stratum it prints each side's blocks, sessions and windows, the median and IQR of the block values, the unpaired difference with its 90% interval, Cliff's delta, the noise floor, and the verdict. When at least 3 sessions hold both values, it also prints the paired estimate and states whether it was decisive: it decides only from 8 sessions, and paired comparisons have low power below about 8 sessions. A side short of 5 blocks, 3 sessions or 120 windows gives `insufficient data` with the counts; a feature with no stratum holding two values prints the count of each value it holds. The 90% intervals are percentile bootstraps, which under-cover at small sample sizes. `--seed` fixes the resampling, so the same data and seed give the same output.

`compare` prints, per stratum, the median of the cell medians of every metric for two commits' usage sessions. A sha argument is a prefix of 4 to 40 hex characters and must match at most one recorded commit. Cells recorded with a dirty tree are excluded unless `--include-dirty`; cells whose identity came from build info have an unknown dirty state and are kept and counted. Usage sessions of two commits differ in more than the commit, so use the bench (`pnpm perf compare --bench`) for a controlled comparison.

Both commands are observational and label their output so. They drop host-contended cells, which the app marks from its own host samples.

Exit codes: 0 for success, including when there is no perf data or the data is insufficient; 2 for invalid arguments, an unknown incident id, or a sha prefix matching several commits; 1 when reading fails.

`bench` and `compare --bench` read the `qa:bench` history, `bench.jsonl` in the per-machine state directory (`AIRI_PERF_BENCH_DIR` names another directory that holds it). They reject `--dir` with a usage error and exit 2. `bench` lists runs grouped by scenario and code state (sha, plus `*<diff hash>` for a dirty tree) with valid/total runs and the medians of the valid runs. `compare --bench` compares two refs with the shared `compareBench` statistics: a ref is a sha of at least 4 hex digits (a clean commit in the history; an ambiguous prefix is refused), `HEAD` (the checked-out commit, clean), or `worktree` (the checked-out commit and the current diff hash, hashed like the recorder's identity, untracked file contents included). Without `--scenario` it compares every scenario either ref has; without `--metric`, every judged metric (`p95FrameMsApprox`, `fps`, `stageWindowCpuPct`, `stageWindowCpuMsPerFrame`, `stageWindowWorkingSetKb`). Each side holds the valid runs of its code state; invalid runs are listed with their reasons and left out. It prints every run value, both medians, the difference, sigma and its noise source, the practical floor, the agreement count, the verdict (`regression`, `improvement`, or `within-noise`), `lowConfidence` (fewer than 10 comparable clean history commits), and `stale` (newest runs more than 7 days apart), or the refusals with their reasons. Under a `regression` or `improvement` verdict, the text output adds a `stage attribution (informational)` block for that direction, described under [Stage attribution](#stage-attribution). `--json` prints the same as an array of scenarios, each compared scenario with an `attribution` object holding `regression` and `improvement`. Exit codes: 0 when every scenario was compared, whatever the verdict; 2 for invalid arguments, a ref without runs (`no bench runs for <ref>`), or a refused comparison; 1 when reading the history or git fails.

```bash
pnpm -F @proj-airi/qa-tools exec vitest run --project node src/perf
```

`pnpm qa:bench` runs the bench-v1 matrix on the Electron app and appends one `bench-run` record per launch to `bench.jsonl`. Run it through the display guard:

```bash
pnpm qa:display run -- pnpm qa:bench [--scenario <id>] [--runs <n>] [--out <dir>] [--repo-root <checkout>] [--not-after <ISO time>]
```

`--runs` defaults to 5 and must be at least 3. Each launch waits for a calm host, starts the window stage on a fresh profile with perf recording on, and imports the model named in `.env.qa` (`AIRI_QA_MMD_MODEL`, `AIRI_QA_RIG_FORBOOTH`). `--repo-root` measures another checkout with this checkout's harness and summarizer: the bench reads that checkout's `.env.qa`, launches its app, runs its scripts, and defaults `--out` to its `.temp/qa/`. The path must hold `apps/stage-tamagotchi/package.json`. `--not-after` takes an ISO time with an offset, such as `2026-11-21T06:00:00Z`; no launch starts after it, and the records already appended stay. Exit codes: 0 every run is valid, 1 a run broke or is invalid, 2 invalid arguments or refused setup, 3 no calm host or no mounted model in time, 4 `--not-after` was reached before a launch, 130 interrupted. Bench one commit, bench the other, then compare the two with `pnpm perf compare --bench`. Start a bench only when no other CPU-sensitive check is running: a launch waits for the host to calm down, and a run sampled on a contended host is invalid.

The perf recorder's overhead was measured once with an independent instrument; the [usage performance recording ADR](../../docs/ai/adr/2026-11-14-usage-performance-recording.md) records the result. Frame-time comparisons between commits use `pnpm qa:bench`. `measure` has no `--help` flag: an unknown option prints its usage and exits 2.

A manual `qa:bench` run still puts its per-run scratch directory in the system temporary directory (`os.tmpdir()`). The perf tracker sets `TMPDIR` to its state directory for the benches it starts. The [perf regression loop ADR](../../docs/ai/adr/2026-11-21-perf-regression-loop.md) records the design of the stage attribution, `pnpm perf status`, and the tracker below.

### Stage attribution

A `bench-run` record carries `stages` when the renderer timed its frame stages. The field maps each stage id to `msPerFrame`, `p95MsApprox`, and `n`. `msPerFrame` is the stage's total time divided by the run's frame count, so the stages of a run add up to `metrics.stageSumMeanMs`. `p95MsApprox` is the approximate 95th-percentile duration of one call, and `n` is the call count. A record without `stages` did not record them. This includes records written before per-stage recording, and readers treat them as "not recorded" by permanent policy.

Stage attribution is information, not a verdict. No stage passes or fails. `compare --bench` prints attribution only under a metric's `regression` or `improvement` verdict, and only for that direction:

- `stage <id>  +0.42 ms/frame  (z 3.1)` lists up to 5 stages that moved in the verdict's direction. Under a regression, a stage qualifies when its shift is above +0.02 ms per frame and its z is above 1. Under an improvement, its shift must be below -0.02 ms per frame and its z below -1. The shift and the z are signed, B minus A. The z is the shift over the stage's MAD sigma, which is pooled with the same trailing clean history commits as the metric once at least 3 history runs carry the stage. A stage whose sigma is 0 qualifies on its shift alone, which must still exceed 0.02 ms per frame in the verdict's direction. It prints `(no measured noise)` in place of the z and ranks ahead of every stage with a z, largest absolute shift first. In `--json` such a stage has `z: null` and `zeroNoise: true`.
- `no timed stage moved` means that the cost lies outside the timed stages, such as GPU, compositor, or untimed work.
- `stage timings not recorded for this scenario` means that A or B has no run with `stages`.

### Perf status

`pnpm perf status` reads the bench history, the tracker log `track.jsonl` beside it, the accepted costs of the checkout it runs in, and `origin/main`. Like the rest of `pnpm perf`, it never writes. Qualifier lines come first:

- `stale` when no tracker tick started in the last 48 h;
- `lowConfidence` when the bench history holds fewer than 10 distinct clean commits;
- `main tip not benched` when `origin/main` has no clean run;
- a `gh` failure streak, because open PRs are not benched while `gh` fails.

After the qualifiers come these sections:

- the open findings, each with its scenario, metric, difference, practical floor, PR, and top stage;
- the last tick, with its age and exit code (`running` before its `tick-end`);
- the main tip;
- the outcome mix (`fixed`, `accepted`, `noise`, and the noise share);
- findings closed in the last 14 days;
- the accepted costs, each with the commit that introduced it, or `uncommitted`;
- baseline resets in the last 14 days;
- per scenario, the median `msPerFrame` of each stage at the latest benched main tip.

`--json` prints the same fields: `lastTick`, `trackerStale`, `mainTip`, `lowConfidence`, `open`, `recentlyClosed`, `outcomes` with `noiseShare`, `accepted`, `baselineResets`, `ghFailureStreak`, and `stages`. Status reads accepted costs from its own checkout. To see an entry on a branch, run status in that branch's worktree. Exit codes follow `pnpm perf`: 0, including an empty history; 2 for invalid arguments; 1 when reading fails.

### Perf tracker

`pnpm perf:track` is the only perf command that writes. It records the tracker's work in `track.jsonl`, the file beside `bench.jsonl` in the per-machine state directory (`AIRI_PERF_BENCH_DIR` moves both). A new file is readable by its owner only.

```bash
pnpm perf:track tick [--subject <ref> --baseline <ref>] [--scenario <id>] [--runs <n>] [--deadline HH:MM] [--plan-only] [--trigger timer|manual]
pnpm perf:track close <id> --resolution fixed|accepted|noise [--at <sha>] [--note <text>]
pnpm perf:track install-timer [--ref <ref>]
pnpm perf:track uninstall-timer
pnpm perf:track --help
```

Exit codes:

- 0 success, including a tick whose subjects were skipped, deferred, or broken;
- 1 an unexpected step broke, the app worktree could not be prepared, or reading failed;
- 2 a usage error or an id that is not an open finding;
- 130 interrupted.

#### Events

Each line of `track.jsonl` is one event with `v` (1), `t` (epoch milliseconds), and `event`. Readers skip malformed lines and lines of another `v`, and count them on stderr. The events are:

- `tick-start`, with `tickId` and `trigger`.
- `discovery`, with `mainTip` and the open PRs (number, head, merge-base baseline, base ref). `prs` is `null` and `ghError` holds the message when `gh` failed.
- `subject`, with one subject (`main`, `pr` with its number, or `manual`), its baseline, its scenarios, and an outcome: `benched`, `already-benched`, `deferred`, `skipped`, or `broken`. A `reason` says why a subject was not benched, for example `deadline`, `capacity`, `plan-only`, `host-busy`, `outside-window`, `subject-dirty`, `subject-unsupported`, `sha-mismatch`, `no-records`, or `bench-exit-<code>`.
- `baseline-reset`, of kind `environment` or `not-comparable` (see [Comparisons](#comparisons)).
- `finding-open`, `observed-again`, and `finding-close` (see [Findings](#findings)).
- `tick-end`, with the exit code and the duration.

#### Subjects and baselines

A tick plans its subjects and their baselines:

- The `origin/main` tip is benched with 5 runs per side. It is compared with the previous benched main tip and with an anchor, a main tip benched 3 to 6 days earlier, when one exists.
- An open PR head is a subject only when its diff touches a render-loop path. The paths and the scenarios each one maps to are `renderLoopPaths` in `src/track/paths.ts`, and test files count for none. The head is benched with 3 runs, only in the mapped scenarios. It is compared with `git merge-base <head> origin/<base branch>`, so a stacked or unrebased PR is measured against its own starting point, not against `main`.
- PRs that were benched least recently come first.
- A side that already has enough clean runs in the current environment is not benched again. A subject with no missing side is `already-benched`.

`--subject` and `--baseline` together bench one manual pair, in every scenario unless `--scenario` names one. `--runs` sets that pair's runs, at least 3 (default 5). The finding's `reproduce` command uses this mode. `--plan-only`, or `AIRI_PERF_TRACK_PLAN_ONLY=1`, records the plan without benching.

Each subject's cost is estimated from its missing bench sides. The estimate also reserves time for a four-pass confirmation of every baseline and scenario pair. When the cost does not fit the time left before the deadline, the subject is `deferred` with reason `capacity` and waits for a later night.

#### Comparisons

Runs are compared only within one environment: the host and the model fingerprint of the newest run of each scenario.

- A side benched only under an older environment gets a `baseline-reset` of kind `environment` and is benched again.
- Sides whose Electron version, build mode, or scenario version differ get one `baseline-reset` of kind `not-comparable` per subject, baseline, and scenario. The comparison is never retried.
- A side with too few runs is benched once more.
- A `stale` comparison, whose sides are more than 7 days apart, opens nothing.

A `regression` verdict is only a candidate. The confirm step benches it again in reverse order: baseline, subject, subject, baseline, with 3 runs each. It judges only the runs of that window, so cached runs cannot confirm a candidate. A candidate that is no longer a regression opens nothing.

#### Findings

A confirmed regression appends `finding-open`. The finding holds:

- the id `<scenario>:<metric>:<baseline sha7>..<subject sha7>`;
- the subject and baseline, with the PR number for a PR subject;
- both medians, the difference, the practical floor, sigma, and `lowConfidence`;
- up to 5 `topStages`, or `noStageMoved`;
- the number of commits in the range, and the range commits that touch render-loop paths;
- `reproduce`, a `pnpm perf:track tick --baseline <sha> --subject <sha> --scenario <id>` command;
- `closeCheck`, the `pnpm perf compare --bench <baseline> <fix sha> --scenario <id> --metric <metric>` command that must show `within-noise` or `improvement`.

When a confirmed regression matches an open finding with the same scenario and metric, and their commit ranges overlap by sha or by patch identity, the tracker appends `observed-again` instead of a second finding. This covers the anchor flagging a known regression again, and a PR finding seen on `main` after a rebase merge.

Every finding ends as `fixed`, `accepted`, or `noise`:

- `pnpm perf:track close <id> --resolution <resolution> [--at <sha>] [--note <text>]` closes it by hand. It refuses an id that is not open, lists the open ids, and exits 2.
- The tracker closes a finding as `fixed` when a later subject of the same line (`main`, or the same PR), compared with the finding's baseline, is `within-noise` or an `improvement`.
- The tracker closes a finding as `accepted` when an accepted cost covers it.

The outcome mix in `pnpm perf status`, the noise share above all, shows whether the floors and the sigma factor can be trusted.

#### Accepted costs

An intended cost is an entry in the committed `packages/qa-tools/perf/accepted-costs.json`:

```json
{ "entries": [{ "id": "mmd-hair-physics", "scenario": "mmd-idle", "metric": "stageWindowCpuMsPerFrame", "reason": "Hair physics is a feature.", "accepted": "2026-11-21" }] }
```

An `id` is kebab-case and unique. `scenario` is a bench-v1 scenario, `metric` a judged bench metric, `reason` must not be empty, and `accepted` is a `YYYY-MM-DD` date. An entry holds no sha, no measured value, and no host value. Commit the entry with the change that pays the cost, or later.

For each subject, the tracker reads the entries from the subject's own tree and resolves each entry in the subject's own history. Neither the tool checkout nor `origin/main` decides which entries apply. To resolve an entry, the tracker parses each committed version of the file reachable from the subject and takes the first commit, in history order, whose version holds the id. This survives reformatting the file, an entry in the same commit as the change, and a rebase merge that gives that commit a new sha. An entry accepts a finding with the same scenario and metric in these cases:

- its commit lies in the finding's range;
- its commit comes after the subject (late acceptance: the tracker flagged first, and the entry was committed later);
- every commit of the range has a patch-equivalent in the history of the entry's commit, as after a rebase merge.

The tracker then appends `finding-close` with `resolution: 'accepted'`, `by: 'tracker'`, and `at` set to the entry's commit, and benches that commit as the new baseline. When an entry's commit lies in the subject's history but not in the regular baseline's history, the entry's metric is compared with that commit, a baseline of kind `accepted`, and the scenario's other metrics keep the regular baseline. A cost accepted in the same commit as the change therefore opens no finding on that metric.

#### Ticks

A tick runs from the tool checkout: the `perf-track-runner` worktree under the timer, or the current worktree when run by hand. It never runs in the main checkout, and it never runs inside `qa:display`.

1. The tick takes the lock `track.lock` in the state directory, which holds its pid. When a live process holds the lock, the tick prints `already running`, appends nothing, and exits 0. A lock whose pid is dead is stale and is removed.
2. The tick appends `tick-start`. Its `tickId` is the local start time, `yyyyMMdd-HHmmss`. Times of day are read with `date-fns` in the system time zone.
3. With `--trigger timer`, a tick that starts outside 01:00 to 06:30 local time records a `skipped` subject with reason `outside-window` and exits 0. This stops a missed run that `Persistent=true` starts at a daytime wake.
4. Unless `--plan-only` is set, the tick samples the host. On a contended host it records a `skipped` subject with reason `host-busy: <load>` and exits 0. The host check sees CPU load only, not GPU load.
5. The tick fetches `origin` in the main checkout, which it only fetches and reads. Unless it benches a manual pair, it lists the open PRs with `gh`, fetches each PR head, and computes its merge base and changed paths. When `gh` fails, `discovery` records `ghError`, and the tick plans the main tip only.
6. The tick plans the subjects. With `--plan-only`, it records each planned subject as `skipped` with reason `plan-only`, or as `deferred` with reason `capacity`, and benches nothing.
7. The tick benches each subject's missing sides in the app worktree `perf-track`, which it creates and locks on first use. To prepare a side, it does the following:
   1. It checks out the sha.
   2. It runs `git clean -fdxq`, which keeps `.env.qa`, `node_modules`, and the downloaded Cubism SDK directory.
   3. It runs `pnpm install --frozen-lockfile`.
   4. It runs `pnpm run build:packages`, because the clean removed the package builds and an install that finds `node_modules` current skips the postinstall that builds them.
   5. It checks that tracked files are unchanged.
   6. It writes the model paths from the main checkout's `.env.qa` into the worktree's `.env.qa`, unchanged, so the model fingerprint matches the history.
   7. It runs `pnpm qa:setup cubism` when Cubism Core is missing.

   A prepared sha is reused within the tick, except by the confirmation passes. A failed install, build, or setup fails the tick with exit 1.
8. The tick runs each bench as `pnpm qa:display run --name perf-track -- pnpm qa:bench --repo-root <app worktree> --scenario <id> --runs <n> --out <dir>`, from the tool checkout. Each invocation gets a fresh `--out` directory, `runs/<tickId>/<seq>-<sha7>-<scenario>` in the state directory, and the confirmation passes and rebenches are included. After every bench, a failed one included, the tick runs `pnpm qa:display down --name perf-track`.
9. The tick judges each subject against each baseline. When a side has too few runs, it benches both sides once more. It confirms candidates, then appends the subject's outcome, its baseline resets, and each `observed-again` or `finding-open`. After all subjects, it appends the `accepted` and `fixed` closes and benches the new accepted baselines that still fit.
10. When at least one finding opened, the tick sends one desktop notification with `notify-send --app-name=AIRI`. `AIRI_PERF_TRACK_NOTIFY=0` turns it off, and every QA run sets it. A failed notification is logged and does not change the exit code.
11. The tick appends `tick-end` with its exit code. It then removes the lock, empties its scratch directory, and keeps the run directories of the last 7 ticks.

Stdout holds only the tick's own lines: one line per subject with its outcome, a line for each finding that opened, was observed again, or closed, and `tick <tickId> exited <code>`. The output of the benches and the other children goes to stderr.

A tick that is not a manual pair has a deadline: the next `--deadline` time after the tick started, 06:30 local time by default. A manual pair has no deadline unless `--deadline` is given. Before each bench, the confirmation passes included, the tick checks the clock. Once the deadline has passed, it starts no further bench, and the remaining subjects are `deferred` with reason `deadline`. The bench gets the deadline as `--not-after`. Its exit codes map to subject outcomes:

- 0 records nothing yet: the tick checks the new records first. No new record gives `broken` with reason `no-records`. A record of another sha gives `sha-mismatch`, and a dirty record gives `subject-dirty`.
- 1 is how `qa:bench` reports an invalid run (`host-contended` or `excluded-window`), so the tick checks the new records first. When the bench recorded at least one invalid run, every new record is of the sha and clean, and every invalid one carries an `invalidReason`, the valid runs count. When they are fewer than the step asked for, the tick benches that side once more with the same arguments; past the deadline it starts no retry, and the subject is `deferred` with reason `deadline`. In the initial comparison, the tick then judges on the eligible runs, and a side still short, including one with no valid run at all, gets the rebench of both sides that any side with too few runs gets, once per subject. Exit 1 with no new record, a record of another sha, a dirty record, or an invalid run without an `invalidReason` records `broken` with reason `bench-exit-1`. The retry, its deadline check, and these `broken` cases apply to the confirmation passes too, but a confirmation gets no rebench of both sides: when its fresh valid runs are too few to compare, the candidate is not confirmed, so it opens no finding and appends no `observed-again`, and the subject keeps its `benched` or `already-benched` outcome.
- 4 records `deferred` with reason `deadline`, and the tick starts no further bench.
- 3 records `deferred` with reason `host-busy`, and the tick starts no further bench.
- 2 records `skipped` with reason `subject-unsupported`, and the tick continues.
- 130 stops the tick, which exits 130.
- Any other code records `broken` with reason `bench-exit-<code>`, and the tick continues.

Tracked files that still differ after the clean give `broken` with reason `subject-dirty`. The tick's `pnpm` children run with `TMPDIR` set to the state directory's `tmp/`, so bench scratch stays out of the system temporary directory. These children are the install, `build:packages`, `qa:setup cubism`, `qa:display`, and `qa:bench`. `git`, `gh`, and `notify-send` run with the caller's environment, including its `TMPDIR`.

The tick exits 0 when it finished, even when subjects were skipped, deferred, or broken. A bench that exits 1 without only invalid runs makes its subject `broken`, and the tick goes on. The tick exits 1 only when an unexpected step broke, for example when the app worktree could not be prepared. It exits 130 when interrupted, and 2 for an unknown `--scenario`, before anything is written.

#### Nightly timer

The tracker uses two persistent detached worktrees beside the checkout, under the directory that `pnpm wt new` uses:

- `perf-track-runner` holds the tracker code at the timer's ref, so the current harness benches every subject, including subjects older than the tracker.
- `perf-track` holds the subject being benched.

Both are locked with reason `perf tracker`, so `pnpm wt gc` leaves them in place.

After the tracker lands, the owner of the machine installs the timer once, by hand:

```bash
pnpm perf:track install-timer [--ref origin/main]
```

`install-timer` does the following:

1. It creates and locks the runner worktree at `--ref` (default `origin/main`) when the worktree is missing.
2. It resolves `git` and `pnpm` on `PATH` without a shell.
3. It renders `airi-perf-track.service` and `airi-perf-track.timer` from the templates in `packages/qa-tools/perf/systemd/` into `$XDG_CONFIG_HOME/systemd/user` (default `~/.config/systemd/user`), with mode 0644.
4. It reloads systemd, enables the timer, and prints the next run.

The timer fires daily at 01:00 with up to 10 minutes of random delay, and `Persistent=true` catches up a missed night. The service has these parts:

- Before each tick, it fetches and checks out the ref in the runner and runs `pnpm install --frozen-lockfile` there.
- It runs `pnpm perf:track tick --trigger timer` under `systemd-inhibit --what=sleep:idle`, so the machine stays awake while the tick runs.
- It stops after 6 hours.
- It always runs `pnpm qa:display down --name perf-track` when it stops.

The rendered units hold local paths and stay on the machine.

`pnpm perf:track uninstall-timer` disables the timer, removes both units, and reloads systemd. It leaves both worktrees in place and prints the `git worktree unlock` and `git worktree remove` commands that remove them.

```bash
pnpm -F @proj-airi/qa-tools exec vitest run --project node src/track
```

## Agent MCP server

`pnpm qa:mcp` serves the `airi-qa` MCP server over stdio. It drives one disposable app session with the same launch, seed, onboarding, import, send, screenshot, and teardown helpers as `qa:app`, and the error collector of `qa:smoke`. The repository's `.mcp.json` registers it for Claude Code. For another client, register the command `pnpm --silent qa:mcp` with the repository as its working directory; for example, `codex mcp add airi-qa -- pnpm --silent --dir <repo> qa:mcp`.

| Tool | Does |
| --- | --- |
| `airi_start` | Launches the development app with a fresh temporary profile, the in-process replay LLM and speech server, and onboarding complete, then waits for the bridge. Optional `model` (and `kind`) imports and selects a model; optional `script` loads a `qa:llm` replay script. Optional `stageHost` is `window` (default, the classic window) or `desktop`, the full-screen desktop stage: it needs an MMD `model`, saves the Experimental 3D stage setting in the temporary profile as `qa:smoke --stage-host desktop` does, and attaches every later tool to the `#/stage` window. |
| `airi_send` | Sends a chat message through the real chat path and waits for a completed turn plus the `expect` kinds. `reply` queues the assistant reply for this turn; without a script, every send needs one. |
| `airi_state`, `airi_events` | Read the bridge state and the event log, including the `mind` events described under [App experience sessions](#app-experience-sessions). |
| `airi_evaluate_voice` | Runs devtools "Evaluate now" in the leader window through the bridge verb `voiceEvaluate`: one gate tick that skips the timing guards only. It takes no input and returns `{ status: 'evaluated', decision, memory }` (the gate decision and memory as plain JSON; `decision.fire` and `decision.reason` say whether she reaches out and why) or `{ status: 'skipped', reason }` with `unprompted-pending`, `gate-not-running`, or `no-mind`. A fire starts a real unprompted turn. A hard hold, such as `dont-disturb`, still holds. |
| `airi_widget_reaction` | Posts a widget reaction request on the `airi-spark-notify-bridge` BroadcastChannel from a fresh channel object in the stage window, as a widget window does, and waits for the `response` addressed to it. Input: `headline`, optional `note`, and optional `timeoutSeconds` (default 45). The request is `{ type: 'request', requestId, fromInstanceId, payload: { headline, note?, fallbackResponseText: '' } }`; only the leader serves it, and the mind holds it until she and the user are quiet. Returns `{ text, fallback, elapsedMs }`: `text` is the spoken reaction, or null with `fallback: true` when she declined, no mind was connected, or the turn missed its deadline. Returns `{ timedOut: true, elapsedMs }` when no response came. |
| `airi_import_model` | Imports and selects another model. |
| `airi_screenshot` | Returns the stage window as an image and saves it in the run directory. |
| `airi_errors` | Lists renderer errors from every window and main-process error lines since `airi_start`. |
| `airi_eval` | Evaluates an expression in the stage window, for example to dispatch pointer events on the character and then read the `mind` events they caused. |
| `airi_stop` | Tears the session down and returns the teardown report. |

`fixtures/llm/voice.json` is the replay script for unprompted turns. Its third and fourth entries match the unprompted trigger message (`(A quiet moment. ...`, `base.prompt.unprompted-trigger`): the first speaks one short line, the second answers `<|SILENT|>`. The remaining entries match any request and answer `<|SILENT|>`, so a late unprompted turn or another request does not end in `replay_exhausted` and never takes the quiet-moment or widget entries. To get a spoken turn and then a declined one, start with `script` set to this file, call `airi_evaluate_voice` until `decision.fire` is true, and wait for the `voice-outcome` `spoken` step; then call `airi_evaluate_voice` again. Forcing skips the floor that the first line started, so the second fire takes the `<|SILENT|>` entry and ends in `voice-outcome` `declined` with no `tts`. A gate fire on its own between the two calls takes an entry too; read the `mind` events to see which turn took which.

The same file also answers widget turns. Its first two entries match the QA headline `QA widget ping`, which a widget turn's trigger message carries as its topic: the first speaks, the second answers `<|SILENT|>`. The quiet-moment entries exclude that headline, so a widget turn never takes them. To get a spoken widget line and then a declined one, call `airi_widget_reaction` with headline `QA widget ping` and read a non-null `text`, then call it again and read `fallback: true`; the `mind` events show `lines` `widget` for both requests and a `voice-outcome` `declined` with `cues` `let-go` for the second.

On Linux outside a QA display, `airi_start` starts `qa:display` session `mcp` and launches the app there; `airi_stop` stops it again. A server that itself runs inside a QA display uses that one. Starting the server costs nothing; the app and the display exist only between `airi_start` and `airi_stop`. Closing the client, SIGINT, and SIGTERM tear a running session down. Each session writes `.temp/qa/<timestamp>-mcp-session/` with `app.log`, `requests.jsonl`, and the screenshots.

On 2026-11-09 a stdio client on Linux started a session outside a QA display with the ForBOOTH Live2D directory, sent a message with a scripted ACT reply and received `act`, `turn`, and `tts` events, took a screenshot, evaluated an expression, listed errors, and stopped with a clean teardown that also stopped the `mcp` display.

## Levels

| Level | What it proves | What it cannot prove |
| --- | --- | --- |
| T0 | Unit tests cover local contracts and deterministic behavior. | Integration with a rig or a rendered application. |
| T2 | The real model runs headlessly at a fixed timestep: MMD through `qa:motion3d` (production pipeline, IK, and Ammo physics), Live2D through `qa:live2d-rig` (the ForBOOTH rig, Cubism Core, physics, and pose). | Renderer pixels, complete application behavior, or naturalness. |
| T3 | The Electron app runs from a fresh profile: `qa:smoke`, `qa:app`, the `airi-qa` MCP server, `qa:host smoke`, `qa:bench`, and `qa:stage`. | Statistical confidence from a single rendered run, or visual naturalness. |
| T4 | A person reviews rendered images and clips for appearance and naturalness, later, from the [review backlog](../../docs/ai/context/testing.md#motion-feel); it never gates landing. | An automated, reproducible naturalness score. |

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which remains Luke's visual call.

## Stage gates

The desktop stage gates live in `src/stage/gates.ts`; `src/stage/measure.ts` produces the frame-budget and scenario input. Relative paths resolve against pnpm's `INIT_CWD`: the directory where you typed the command, or the `--dir` directory when pnpm is called with `--dir`.

`pnpm qa:stage capture --port <cdp port> --scenario idle --seconds 30 --out <dir>`
attaches to a running Electron MMD scene and records final humanoid bones after
IK, grants and physics. On Linux, launch the app inside
`pnpm qa:display run --name <name> -- <command>` with a temporary
`APP_USER_DATA_PATH`. `--mode window|desktop` defaults to `window`, `--shots`
defaults to 12 and `--seed` to 1. Seconds must be greater than 0 and at most
120; seed selects the cue timeline and does not reseed the mounted model.

Before it attaches, capture samples the host: load per core, machine CPU use,
and CPU pressure, judged by `decideHostContended`. Load from other work stalls
frames until the [`lab:motion3d gate`](../lab-tools/README.md#gate) refuses the trace with `frame-gap`, so a
contended host makes capture exit 2 with the reading. The captured app is the
target, not outside load: capture reads its CPU seconds through the CDP port
(`SystemInfo.getProcessInfo`, which lists only the app's own processes) and
leaves its share out of the machine CPU use. The load average and CPU pressure
still include the app.
`--wait-quiet <seconds>` (at most 3600) samples every 2 s until the host
calms down, and exits 2 if it stays busy. `--allow-busy` skips the refusal,
for a capture you will not gate, and records the reading. `capture.json`
records the result as `preflight` (`quiet`, `waitedSeconds`, `sample`).

`--collect-before` is an optional measurement protocol, off by default. Before
each recording it requests a full V8 collection of the stage renderer through
CDP (`HeapProfiler.collectGarbage`), waits for it, and lets the frames settle
for one second. This keeps a known product stall out of the motion
measurement: an old-generation collection whose finalization pause lands
inside a frame and produces a 50 ms interval. The stall itself is measured
and reported separately, with idle frame intervals in the running app.
`capture.json` records the choice as `collectBefore`. The flag does not change
what the gate refuses.

Capture waits for a mounted MMD model, checks animation, then warms up for
10 s and waits for a second of standing before starting the recorder.
`idle` observes the existing motion. `walk` posts the shared scenario's
`requestGoal` cues in stage mode, converting leg lengths from the starting
root and clamping to reachable ground. `attach` records without driving cues,
so another command can drive the character, and records gate class `idle`
unless `--class talk` says, before the capture, that it records a speaking turn
(goal 3's rendered turn, judged in the talk class). `--class` applies only to
`attach`. `fixtures/llm/turn-happy.json` is the replay script for that turn: an
ACT `happy` cue and a 411-character reply, about 20 s of replay speech at the
replay server's 0.05 s per character. Other scenario ids refuse with
`scenario-not-drivable`. A walk outside stage mode has the same refusal.
Capture checks `MMDMotionSnapshot.driver`, refusing Classic with
`driver-not-natural`; the motion QA bridge's `driver` and `naturalActive`
fields describe Live2D and cannot establish the active MMD driver.
An absent MMD model refuses with `no-mmd-model`.

Output is `trace.json` (shared v1 contract, `source.level: 'rendered'`),
`shots/NN-<time>s.png`, `capture.json` and `strip.png`. The recorder drains in
600-frame chunks. `capture.json` includes the source URL, scenario, host mode,
frame count, median FPS, median/worst wall-frame intervals, frame-gap fraction,
`frameGap` (the worst motion-time interval, the share of intervals over 1/24 s
and the wall drift, with the gate's limits and the list of limits exceeded;
the stdout summary line repeats them, stderr names a coming `frame-gap`
refusal, and the exit code does not change),
`noticeDismissed` (`true`, `false` or `'absent'` for the optional close action
on the host-capability notice before screenshots),
requested and actual shot times, and `parity.stageOrder` with the recorded
stage lists. The scene must report exactly the pose and surface stages of
`composeMMDStages` (`@proj-airi/stage-ui-mmd/composables/mmd/stage-composition`),
which the headless runner composes from as well. Any other list, an extra,
missing or reordered stage, refuses the capture with
`stage-composition-mismatch` (exit 2) after the first recording, so
`stageOrder` is always `match` in a written manifest.
The strip has six columns, 320 pixels per shot and no text labels.

Shots are evenly spaced at the midpoint of each interval. If more than 0.5%
of recorded wall-frame intervals exceed 1/24 s, capture discards that probe
and records again without screenshots, then replays the cue timeline for
shots. `probeGapFraction`, `shotsPass: 3` and `shotsNote` disclose this;
`attach` remains undriven and does not claim to replay external inputs.
The new trace retains any gaps the renderer produces without screenshots.
Trace and shots are written before
the manifest and strip, so strip encoding failure preserves the measurement.
Median FPS below 20 writes `failure: 'frame-rate-under-20'` and exits 1.
Successful captures exit 0; usage errors, named scene refusals and unsupported
scenarios exit 2. Recorder refusals include `measurement-running`,
`trace-recording`, `invalid-trace-request`, `invalid-trace-event`,
`trace-not-stopped` and `invalid-trace-range`. Broken runs exit 1.
Capture is measurement evidence; scoring and visual review are separate.

| Gate id | Input | Passes when |
| --- | --- | --- |
| `stage-walk-skate` | A walk timeline: `perFrameSeries` (top level or under `walk`) with the columns `mode`, `skate`, and `feetMaxError`, and optionally `skateContact`, one row per frame. | The non-idle frames include `walking`, max `locomotion.skateContact` < 0.05 when the timeline has that column (else max `locomotion.skate` < 0.05), and max `feet.maxError` < 0.05. The contact-point skate is judged because a foot that rolls heel to toe moves its ankle on purpose (owner decision O6, goal 4); with flat feet it equals `skate`. `qa:stage measure --scenario` records it in its rows (appended column), and `stage-gesture-walk` judges it there by the same rule, so a rendered scenario walk is judged on the contact point too. `qa:stage measure --mode` (goal 4 criterion C003's command) records beside its frame timing a `perFrameSeries` with the columns `t`, `mode`, `skate`, `feetMaxError` and `skateContact`, one row per diagnostics snapshot (10 Hz; the `skateContact` column carries the snapshot's `skateContactPeak`, the largest per-frame contact skate since the previous snapshot, so no frame between snapshots is lost), and the hand-off record appends `skateContact` to its columns, so both rendered walks are judged on the contact point; a measure record whose series never leaves `idle` (a frame-budget measurement of a standing character) or has no series gives this gate no input (NO INPUT, not a pass), and records measured before the column existed are read and judged on the ankle as before. `measure --mode` itself issues no goal, so she walks during the measurement only when something else drives her: goal 4 criterion C003 runs it "over a walking timeline with `pnpm qa:stage capture` recording the same app", and the piece that walks her is `qa:stage capture --scenario walk` (it posts walk version 3's goals as `requestGoal`, `src/stage/capture.ts`), started on the same app for the same span. Without it she stands, the series never leaves `idle`, and `stage-walk-skate` reads NO INPUT, which does not pass. No new driver is needed; proving that the two commands overlap needs an app window. The contact points come from the rig (the toe bone for the ball, the point under the ankle at the toe's height for the heel); the performer reports only which one carries the foot. A spin about the ball reads 0 under the ball kind while the heel sweeps: that limit is stated in the goal 4 rules. |
| `stage-arm-penetration` | A standing run per model: `model` plus `perFrame` with `t_ms`, `penL`, and `penR`, or a `models.<name>.penetration.left/right.max` summary. | Kinematic `arms.penetration` max is 0 over at least 30 s on every model. `clothContact` is printed for information only. |
| `stage-frame-budget` | `measure` records (`result` with `mode`, `fps`, `p95StageMs`, `readbackMs`, `frames`), single files or one pairs file. | At least 3 window/desktop pairs; every desktop p95 AIRI stage sum <= 4 ms; median desktop/window FPS ratio >= 0.9; every desktop readback mean <= 1 ms; median per-pair (desktop readback max - window readback max) <= 1 ms. |
| `stage-gesture-walk` | A `measure --scenario gesture-walk` record (`kind: 'stage-scenario'`) with the snapshot `series`. | Over the samples from the playClip post to the stopClip post: the clip plays on the upper layer during `walking` for at least the larger of the record's `seconds` (12 by default) and 10 s, so a record with a short `seconds` field cannot pass on a short walk; max `locomotion.skateContact` (or `locomotion.skate` in a record without that column) < 0.05 and max `feet.maxError` < 0.05 over the non-idle samples; `locomotion.enabled` is true on every sample; the clip is on the upper layer in at least 80 % of the samples; the run is valid. |
| `stage-handoff` | A `handoff` record (`kind: 'stage-handoff'`) with its `perFrameSeries` (the appended `skateContact` column optional). The same series is a walk timeline, so `stage-walk-skate` judges the foot contact of the crossing. | The scenario ran; the camera origin (`world.originX`) went to another display's and back, so the stage window followed her once each way; she reached both goals within 0.2 model units, stands idle at the last one, and no goal timed out; her placement rectangle lies inside the window; no root step between two samples is larger than 10 % of the first leg or goes against the walk by more than 0.05 model units, so nothing teleported her. |
| `stage-action-preempt` | A `measure --scenario action-preempt` record with the snapshot `series`. | The clip performs on the full layer with at least one `playing` sample; `locomotion.enabled` is false and `director.pendingGoal` is set on every `playing` sample; the held goal is issued (pending cleared, `director.goalX` set) within 3 s after `action.performing` clears; the p95 AIRI stage sum over the run is <= 4 ms; the run is valid. Samples in phase `settling` are counted but not gated, because the director keeps the gait on while she stops walking. |

- `gate` prints `<gate id>: PASS`, `FAIL`, or `NO INPUT`, each followed by its checks with the measured values. Exit codes: 0 every gate with input passed, 1 a gate failed, 2 usage error, unreadable or unrecognised evidence, or no input for any gate.
- Runs pair by their `n` field; when a run lacks one, runs pair in the order given. The todo 1 evidence names the window `classic` and the desktop stage `spike`; both vocabularies are accepted.
- `measure` reads the frame measurement through the motion diagnostics BroadcastChannel of the stage target (`#/` for window, `#/stage` for desktop) while the real OS cursor circles over the character, so the hit-test readback cost is part of the readback numbers. Both host pages take the cursor from the main process, so a CDP pointer would never trigger a readback. One long-lived process moves the cursor: JXA `CGWarpMouseCursorPosition` on macOS (no Accessibility trust needed) and PowerShell `SetCursorPos` on Windows; elsewhere CDP moves are used and the record notes the method (`load.pointer.method`). AIRI stages are every timed stage except the three-mmd internals and `render`.
- Before each attempt `measure` waits up to 5 minutes for a quiet machine: no `vitest`, `tsc --noEmit`, or `vue-tsc` process, and a 1-minute load average below 3. During the run, a 1 Hz sidecar records the load average and `pgrep` hits, and one `ps` top-8 CPU listing is taken halfway. An attempt with a hit is `INVALID-CONCURRENT-LOAD` and is repeated up to `--attempts`; discarded attempts stay in the record, and the record has `valid: false` when every attempt was invalid. Only macOS reads the host process table here. On Linux and Windows the sidecar records no `pgrep` or `ps` data, `psBackground` stays `null`, and no attempt is marked `INVALID-CONCURRENT-LOAD`; the 1-minute load average before each attempt is the only quiet check, so on Linux agent QA never reads the names or command lines of the user's processes.
- `AIRI_STAGE_HOST` works only in a development build (`stage-tamagotchi dev`); a packaged build ignores it and obeys the Experimental 3D stage setting.
- `measure --port` attaches to an app started with `APP_REMOTE_DEBUG=true`, `APP_REMOTE_DEBUG_PORT`, and `AIRI_STAGE_HOST=<mode>`, with an MMD model mounted. `measure --pairs` copies `--profile` (onboarding done, MMD model selected) for every run, launches `stage-tamagotchi dev` with `AIRI_STAGE_HOST` set to window, then desktop, for each pair, waits for the model, settles for `--settle` seconds, measures, and tears the run down like T3. It rewrites `--out` after every run; a broken run is listed under `failures` and exits 1.
- `measure --scenario` attaches like `measure --port` and needs the clip imported for the mounted model. It waits for her to stand still, starts the frame measurement, requests a walk goal 600 DIP away toward the side with more ground, and posts `playClip` one second into the walk. `gesture-walk` loops the clip (a looping `debug` request skips the 4 s gesture repeat cooldown, not the ownership rules) and walks her back and forth between the start and the goal until the clip has played on the upper layer while walking for `--seconds`, or for six times that plus 10 s, then posts `stopClip`. A 600 DIP leg spends only about 1.4 s of its starting, walking, stopping, and turning in mode `walking`, so the default 12 s span takes about nine legs. `action-preempt` plays the clip with its own loop setting, requests the goal again at the first performing sample, posts `stopClip` after `--seconds` of playing, and records until the held goal is issued. Every snapshot is one series row (`t` in ms since the playClip post, `mode`, `enabled`, `skate`, `feetMaxError`, the performing name, layer and phase, `pendingGoal`, `goalX`); a gate failure names the offending rows as `#<row> (t <s> s)`. A refused request is recorded in `refusal`; a `refractory` refusal with a retry time, which an earlier attempt that played the clip causes, is waited out and the attempt repeated, at most `--attempts` times. The quiet-machine wait and the concurrent-load sidecar are the same as for the frame measurement.
- `handoff` runs its own app session, like `qa:smoke`: a fresh profile with the desktop stage enabled, the model imported, and a teardown. On Linux it starts only inside a QA display session. Start one with two outputs: `pnpm qa:display run --outputs 2 -- pnpm qa:stage handoff --model <model> --out <json>`. It moves the session pointer to two positions first, because a KWin session reports the cursor as live only after the pointer has moved, and hand-off is off until then. It then waits for `world.reach` to list more than one ground line, requests a walk goal in the middle of the nearest ground line she is not on, then a goal back to where she started, and records every snapshot. A goal she does not reach within `--seconds` ends the walk. The run directory keeps `handoff.json`, `stage.png` (the stage window after the walk), `display.png` (every output of a KWin QA display, which shows the display she is on), and `app.log`. A run that could not walk records its reason as `refusal` and exits 1. Pass a model folder with one `.pmx`: the importer takes the first model file of a folder.
- The director refuses every action as `asleep` while the desktop activity sensor reports a long idle time. On a host where nobody touches the input devices during the run, keep the activity sensor fresh, or the scenario only records the refusal.
- Keep the desktop undisturbed during a measurement: the frame rate is the measured value.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/stage`. The fixtures in `fixtures/stage/` are minimal copies of the plan's real evidence, and each names its `source`.
- `measure --pairs` launches the app through the same pnpm resolver as the app sessions and doctor. The resolver finds pnpm's own `.tools` layout under `PNPM_HOME`, a JS `npm_execpath`, or a standalone pnpm binary of the pinned version, such as the one mise installs, through the `dist/pnpm.mjs` beside it. It finds that binary from `npm_execpath`, from `npm_config_node_gyp`, or in a `PATH` directory, so a script started with `pnpm exec`, which sets neither variable, resolves it too.
- `stage-frame-budget` passes its readback-max criterion with little margin, because the asynchronous read's buffer copy still stalls occasionally. If it fails again, the next fix is a CPU silhouette mask, not a threshold change. The gates and the stage architecture are recorded in [the full-screen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

## T2-3D body motion

### Run

```bash
pnpm qa:motion3d run --model "/path/to/model.pmx" --scenario idle --seed 1 --seconds 60 --out .temp/qa/idle-1
pnpm qa:motion3d run --model "/path/to/model.pmx" --scenario walk --seed 1 --seconds 30 --warmup 10 --out .temp/qa/walk-1 --verify-determinism
```

The Node runner loads an external PMX, initializes the shipped Ammo backend,
and composes the production Natural adapter, stance director, body stages,
IK, grants, physics and shared motion-trace sampler. Its stages come from
`composeMMDStages`, the same composition the scene registers; the stages this
level does not run (Classic gaze and face, lip-sync, bone and surface morphs)
keep their ids and slots and do nothing, and `omitted` names that work. Body
blinks and planned gaze shifts are recorded as `marker` events labelled
`blink` and `gaze-shift:<amplitude>:<signed yaw>:<goal kind>` (degrees; the
yaw is signed explicitly, positive toward the character's left), because the trace v1 reader accepts no
other new event kind. The performer's act feedback and rest directive are
recorded the same way, as `act:<id>:<playing|finished|cancelled>` and
`rest:<none|rest|doze>` on each change; neither appears without a producer. A
scenario with an idle drive also records the idle scheduler's own reports (Natural's
`NaturalIdleActivities`, read from the adapter after each frame's advance) as
`idle:<kind>:<start|end>`, one start and one end per behaviour; a run without a
drive has none. It opens no window and
needs no GPU. Models and textures remain outside the repository. The optional
load and gaze integration tests use `AIRI_QA_MMD_MODEL` when set.

`--model`, `--scenario` and `--out` are required. Scenarios are `idle`,
`idle-drive`, `music`, `music-beat`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`,
`touch` and `sleepy-no-clip`. Seed defaults to 1;
duration and warm-up default to the scenario's values (10 s warm-up).
Scored duration is capped at 120 s, except for the idle-class `idle`, `idle-drive`, `music`, `music-beat` and
`sleepy-no-clip` scenarios, which accept up to 600 s (owner decision O1, goal 4: a ten-minute idle). A
600 s run is about five times a 120 s run in wall time and output size.
Relative paths resolve against `INIT_CWD`.
A scenario may set an idle drive (`idleDrive`, `src/t2-3d/idle-drive.ts`): the
runner hands it to the Natural adapter before the first frame, as the app's scene
does, and records its name and values in the trace source detail as `idleDrive` and
`idleDriveValues` (and so in `summary.json` provenance). Like the scene, it adds
the whole-body kinds the loaded rig cannot perform as `unreachable`
(`idleKindsOutOfReach`); the recorded values stay the scenario's. The runner
drives idle through a `CharacterMind`, as the app does: its clock is the run's
time, its seed derives from the run's seed, the adapter's idle reports go to
the mind, its idle intents return to the adapter as orders, and before each
Natural advance it sends `idle-wake` when `nextIdleWakeAt` is due. Without a
drive the view stays dormant and the mind decides no idle act. The same mind
draws every cursor episode: the adapter's cursor reports go to it, and its
`cursor-episode` intents return to the adapter as orders for the next frame.
Scripted away edges also reach this mind; the director reads its body `away`
answer, preserving away-sensitive stance markers such as `sleepy-no-clip`.
The runner supplies no attend intents. Four scenarios set one,
each with the product's documented neutral drive (all mood fields 0, sleepiness 0,
solitude 0, no music except in `music` and `music-beat`, sleep allowed, rate 1) and the whole-body capability the MMD
scene declares (`body: true`, rules amendment 9; without it she never settles,
rests, dozes or draws a whole-body kind): `idle-drive` (`qa-neutral-day`, the
user present; C001), `music` and `music-beat` (`qa-neutral-day`, the user present with music
playing) and `sleepy-no-clip` version 2 (`qa-neutral-day-away`, the user
away at its 40 s cue; C004). Every other scenario sets none and its trace is
byte-identical to before. `--acts off` (default `on`) sets no idle drive, so the
idle scheduler stays inert, as the companion that `lab:motion3d report idle-acts --pair`
compares against; it is recorded as `acts: 'off'` in the trace source detail, and
`on` records nothing. On a scenario without a drive the switch changes nothing but
that record.
An existing output directory is refused with exit 2.
Measured on 2026-11-12 on both rigs and every scenario (two timings each), a run uses one core ((user + sys) / wall 1.01 to 1.10) and peaks at about 0.95 GB (first rig, 0.5 to 0.6 GB on the second) plus about 0.3 GB for its pnpm and tsx launchers. Each run creates:

- `trace.json`: shared trace v1, including warm-up, scenario events, source
  revision, asset hash, stages, clock policy and omitted work.
- `summary.json`: `motion3d-run-summary` v1 with provenance, scored per-stage
  mean/p50/p95/p99/max timings, pose and AIRI p95 sums, per-frame arm
  penetration, cloth contact, foot skate, foot error and contact-point skate
  (`perFrameSeries` columns `t_ms`, `mode`, `skate`, `feetMaxError` and the
  appended `skateContact`), and `collisions`: the
  performer ticks, warm-up included, on which an arm had no clear pose and kept
  its previous one. A run with any such tick writes its outputs and exits 1.
  It also carries `corrector` (`capHits`, `guardScans` and `holds`: the arm
  ticks, warm-up included, on which the corrector's 6 degree cap bound, its
  guard scan began, or it held the arm), `owned` (clip ownership per mask group,
  one row per scored frame), `ownership` (per scored frame: the largest angle
  between a written local rotation and the clean pose per written group, in
  radians, the gesture-layer weight per arm, and the nine displayed arm angles
  per side with their rest values, in degrees) and `clip` (only with the
  synthetic claim clip: per scored frame, its analytic rotation of the right
  upper arm, lower arm and hand relative to their trace parents, in the trace
  basis, or null while it has no weight).
- `run.json`: the standard QA manifest with command, environment, source
  revision, artifact hashes and result.

Stdout is one JSON line with `ok`, `runDir`, `frames`, `wallMs` and `realtime`.
Wall time measures the simulation loop, including warm-up, and excludes model
initialization and serialization. Stage percentiles and diagnostic series
cover scored frames only. Summary times start at zero and advance by
1000/60 ms; a 30 s run's last sample is at 29,983.33 ms, so the arm gate's
30 s span requirement needs a longer run. Only a walk summary with actual
walking frames belongs in the walk gate. Headless timings never qualify as
rendered frame-budget evidence.

Every frame advances exactly 1/60 s. Director and Natural clocks derive from
the frame index; the trace's wall channel equals its accumulated motion time.
The seed selects the scenario timeline and model key `qa-<seed>`. Fresh
instances are built for each run. For the same model, scenario, seed, options,
revision and dirty state on the same host/runtime, `trace.json` is byte-identical.
It contains no measured wall-clock values. `--verify-determinism` builds and
steps a second fresh runtime, compares the rotation/root/channel block hashes,
and fails with exit 1 on a mismatch. This does not claim determinism across
CPUs, Node versions or Ammo builds.

The image boundary returns inert textures and omits image callbacks, toon
rotation and alpha inspection. This level also omits Classic gaze/face,
Natural face surfaces, lip-sync, expression bone morphs, surface morphs,
touch hit-testing, overlays, animation clip layers and rendering. It drives
touch and speech cues through the existing inputs; it adds no arm gesture
behavior. It cannot judge skinning, silhouettes, materials, camera framing,
window integration or perceived naturalness. Exit codes are 0 completed,
1 run or determinism failure, 2 invalid arguments or setup refusal, and
130 interrupted.

### Trace format

The shared type and codec are exported from
`@proj-airi/motion-driver-humanoid/motion-trace`. A capture is one `trace.json`,
written as `JSON.stringify(trace)` with a final newline. Its `kind` is
`motion-trace` and its integer `version` is 1. A capture is one file whatever
its length; the headless runner writes up to 600 s of scored time for its
idle-class scenarios, and nothing in the reader limits the length.

`source` identifies the producer (`t2-3d`, `rendered` or `reference`), scenario
id, class and seed, source revision and dirty state, ordered pose/surface stage
ids, omitted production work, and provenance in `detail`. Classes are `idle`,
`talk`, `gaze`, `emotion`, `walk` and `react`. `rig` contains a free-text model
key (never a personal asset path), optional SHA-256, leg length in model units,
ordered humanoid bone columns, parent indices, bind offsets, physics-owned
slots excluded from the columns, eye source and finger availability.
Parent indices precede their children; -1 identifies a root. Missing canonical
bones attach to the next present ancestor. Bind offsets are parent-relative
displacements expressed in trace axes, not bone-local axes. Secondary bones
(hair and skirts) never become columns. A both-eyes control is copied into both
eye columns; without an eye source there are no eye columns.

Trace axes are +Y up, +Z forward at rest and +X = Y cross Z. Quaternions use
Hamilton multiplication and `(x,y,z,w)` order; `a*b` applies b first.
For bone world orientation W and bind orientation W0 with the model root at
identity, N = W*conj(W0). Heading yaw is the unwrapped `atan2(f.x,f.z)` for
`f = N_hips*(0,0,1)`. The hips column stores `Ry(-yaw)*N_hips`; every other
column stores `conj(N_parent)*N_bone`. Bind rotations therefore become identity,
and helper joints, IK, grants and physics fold into the recorded humanoid
world orientations. Every stored quaternion is normalised, with w >= 0 on
frame zero and its sign chosen for a nonnegative dot with the previous frame.

`frames` is the total frame count. `hz` is the nominal sample rate (60 headless;
median observed rate for rendered captures), while per-frame time is
authoritative. `scoredFrom` is the first scored motion time; earlier samples
are warm-up. Three base64 strings hold little-endian float32 blocks:

| Block | Float count | Order |
| --- | --- | --- |
| `rot` | frames * bones * 4 | Frame, bone column, x/y/z/w |
| `root` | frames * 4 | Hips world x/y/z in model units, then unwrapped yaw in radians |
| `channels` | frames * 9 | Frame, channel in the fixed order below |

Channels are `time`, `wall`, `voiceLevel`, `speaking`, `targetX`, `targetY`,
`targetZ`, `locomotionMode`, `gaitWeight`. Time and wall are seconds since
frame zero; headless wall equals motion time, and motion time sums pipeline dt.
Voice level and gait weight are 0..1; speaking is 0 or 1. The target is a world
point in trace axes and model units. Locomotion modes are 0 idle, 1 turning,
2 starting, 3 walking, 4 stopping. Missing scalar channels use NaN.
Rotations, root values, motion time and wall samples must be finite; time
strictly increases. All other scalar channels permit NaN for absent data but
never infinity. Leg length must be finite and greater than zero, rest offsets
must be finite, and parents must match the canonical nearest present ancestor.
The codec preserves every float32 bit, including missing-value NaN payloads.

`events` are sorted by motion time `t` and use the shared discriminated union:
gaze jumps (yaw/pitch in radians), emphasis, emotion pulse/hold/placebo,
gesture, gait lift-off/heel-strike, goal, touch, mode, or marker. Gaze and
emphasis events distinguish scenario labels from derived observations.
Emotion trials carry optional trial ids for pooling, as documented above.

The recorder grows in 600-frame chunks and drains after stopping. Header and
events accompany only a drain beginning at frame zero. Full 600-frame chunks
can concatenate as base64 without re-encoding; a final partial chunk ends the
stream. Raw blocks for a typical 54-bone, 60 s, 60 Hz trace occupy about 3.3 MB,
or 4.4 MB as base64, plus metadata and events.

`readTrace` and `parseTrace` return the validated trace plus decoded blocks.
They throw typed structural refusals named `trace-unreadable`, `trace-kind`,
`trace-shape`, `trace-nonfinite`, `trace-unnormalized`, or `time-nonmonotonic`;
these are never scored. Arithmetic overflow in prepared kinematic signals also
refuses as `trace-nonfinite` before detectors run. Nonfinite metric values or
contributing samples fail applicable gates with `undefined: nonfinite`.
Quaternion norm tolerance is 1e-3. The gate also checks rate, frame gaps,
duration, rig completeness and reference-band policy.

## Evidence

After argument and environment checks pass, `pnpm lab:model run` and `pnpm lab:model score` create unique runs under `.temp/qa/<timestamp>-<tool>-<label>/`, as do the app session commands. Each run's `run.json` records its command, source SHA, dirty state, relevant `APP_*` and `AIRI_QA_*` environment values, gate provenance when applicable, artifact hashes, and result. `pnpm qa:live2d-rig` prints its summary and writes only the `--out` trace.

`pnpm qa:doctor` prints its findings, including with `--warm`, and creates no run directory or manifest.

Run output and evidence are not committed.

## Bridge gates

The motion QA bridge is development-only and uses remote debug; it adds no listening port. Registration requires all three gates: a development build, `APP_REMOTE_DEBUG=true`, and `APP_MOTION_QA_BRIDGE=true`. The bridge uses typed Eventa commands as one dispatcher and validation boundary, not as an isolation or security boundary. Production bundle checks verify that bridge markers are absent.

The `deleteAllData` verb runs "Delete all data" in the stage window through the same function as the Data settings page: the state registry, then the host step that the app provides. It answers `{ ok: true }` or `{ ok: false, error }` with the first failure's message, so a check can assert on it. Call it as `AppSession.deleteAllData()` or, on an `AppSessionCore`, as `core.bridge.call('deleteAllData', undefined, timeoutMs)`. It has no MCP tool.

## T2 status

T2 is GO, path A. The Cubism Core and ForBOOTH rig ran in Node without a GPU using two documented global shims. Across 600 frames and 281 parameters, Node and Chromium differed by 0; the negative control differed by 30. The measured Natural, adapter, and physics loop reached 55.19x real time. The runner skips mesh deformation because it reads but does not write parameters and costs about 90% of a frame. `pnpm qa:live2d-rig` runs it on one emotion trial; `src/t2/runner.test.ts` runs it when `AIRI_QA_RIG_FORBOOTH` is set. The statistical Live2D gates, the T1 simulator, the scorer validation, and the rendered Live2D T3 harness were removed on 2026-11-17; Live2D gates come back on `lab:motion3d`'s gate pattern when needed. The [motion QA levels ADR](../../docs/ai/adr/2026-10-20-motion-qa-levels.md) records the removed design.

## Architecture

`qa:smoke`, `qa:app`, `qa:host smoke`, and the `qa:mcp` session drive the real app through one shared lifecycle, `AppSessionCore` in `src/session/app-session.ts`. One `start` call runs the same ordered steps for every command:

1. Launch `stage-tamagotchi dev` on the run's fresh profile (`launchStageTamagotchi`) and record its root process. The launcher does not pass `ELECTRON_RUN_AS_NODE` on, because a shell started by an Electron app sets it and Electron would then start as plain Node.
2. Connect to the stage window over CDP (`connectStage`) and record the process tree (`trackTree`).
3. Optionally start a `PageErrorCollector` over every window.
4. Run the command's own preparation, such as seeding the replay provider or waiting for the dispatcher.
5. Complete onboarding (`completeOnboarding`), unless the command skips it.
6. Optionally wait for the motion QA bridge (`MotionQaBridgeClient.waitForBridge`). The wait fails as soon as the app exits.

By default every step after the launch is raced against the command's abort signal. `qa:host smoke` uses `abortMode: 'after-connect'` instead: an interrupt during startup lets the stage connection finish, so teardown still closes the browser gracefully. `teardown` stops the collector, closes the browser, kills the owned process tree, removes the profile only when no run process is left (`teardownRun`). A run that relaunches on the same profile, for example to check what survives a restart, passes `keepProfile: true` to every teardown except the last, so the next session on that `profileDir` starts with the previous launch's local storage and settings. It also works after a failed or interrupted start. Each command still owns its CLI flags, run directory, evidence files, report, and exit code. Each command refuses to launch while its worktree already runs an Electron session, before it creates a run directory.

## When to use

Use this package when a change needs proof: a headless motion run or identity diff, a model test, an app session, a stage gate, or a perf comparison.

## When not to use

Do not use this package from product code or for ordinary development commands. It does not replace unit tests. For motion quality scores, LLM evaluation, or character-state simulation, use [`@proj-airi/lab-tools`](../lab-tools/README.md); how motion feels is a person's review from the [review backlog](../../docs/ai/context/testing.md#motion-feel).
