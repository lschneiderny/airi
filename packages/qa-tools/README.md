# @proj-airi/qa-tools

## Purpose

This private, Node-only package runs repository QA checks for motion, test failures, rendered Electron scenarios, reports, and evidence. Product packages must not depend on it.

## Usage

Run `pnpm qa:doctor` first. It checks whether the current worktree can produce meaningful results and does not repair the environment.

| Command | Use |
| --- | --- |
| `pnpm qa:setup cubism [--force]` | Download Cubism Core for both apps without opening a window. Skip present copies; `--force` downloads again. |
| `pnpm qa:doctor [--json] [--warm]` | Check Node, pinned pnpm, installation, built packages, Cubism Core, Chromium, rig paths, and conflicting Electron processes. `--warm` runs the stage-ui browser warm-up. |
| `pnpm qa:test --all` | Run the registered Vitest package and project set, then report new, known, fixed, and flaky-passed tests. |
| `pnpm qa:test --package <name> [--package <name>...] [--project node\|browser] [--registry <file>] [--timeout <seconds>]` | Run selected test targets. |
| `pnpm qa:motion gate emotion --level t1 [--emotions a,b] [--bands clear,strong] [--seeds N] [--workers N] [--timeout-minutes N]` | Score the deterministic controller simulation against committed emotion rules. |
| `pnpm qa:motion gate liveliness --level t1 [--workers N] [--timeout-minutes N]` | Check idle motion against the committed generated-liveliness rules. |
| `pnpm qa:motion gate <emotion\|liveliness> --level t2 --rig forbooth [options]` | Run the selected gate against the headless ForBOOTH rig and Cubism Core. Set `AIRI_QA_RIG_FORBOOTH`; set `AIRI_QA_CUBISM_CORE` when the core is not at the checkout's default path. |
| `pnpm qa:motion t3 --rig forbooth --scenario <builtin:name\|file.json> [--keep-open]` | Drive a scenario in the rendered Electron app and collect a Natural trace and screenshots. |
| `pnpm qa:host smoke [--xwayland] [--expect-idle verified\|unverified]` | Launch a temporary Electron profile and compare host signals with the runner's capabilities, then observe idle delivery every 5 seconds for 180 seconds. |
| `pnpm qa:smoke [--model <path>] [--settle <seconds>] [--allow <json>] [--out <dir>]` | Start the app from a fresh profile and fail on any renderer exception, `console.error`, browser error, or main-process error in any window. See [Clean-start smoke](#clean-start-smoke). |
| `pnpm qa:app run --model <path> --say <text> [options]` | Run a disposable experience session: replayed chat and speech, real model import, events, and a screenshot. See [App experience sessions](#app-experience-sessions). |
| `pnpm qa:mcp` | Serve the `airi-qa` MCP server over stdio, so an agent can start the app, chat, screenshot, and read errors through tools. See [Agent MCP server](#agent-mcp-server). |
| `pnpm qa:motion validate-scorer --level t1 [--sections aa,zero,mutations,unmutated,determinism] [--seeds N] [--workers N] [--timeout-minutes N]` | Evaluate scorer false positives, mutation detection, unmutated gate power, and determinism. A missed validation threshold exits 1 by design. |
| `pnpm qa:report <runDir> [<runDir>...] [--out <file>]` | Combine gate, T3, and test-run evidence into a self-contained HTML review page. |
| `pnpm qa:stage measure --mode <window\|desktop> --port <cdp port> [--seconds 60] [--attempts 3] --out <json>` | Measure the MMD frame budget of a running app in one host mode. See [Stage gates](#stage-gates). |
| `pnpm qa:stage measure --pairs <n> --profile <dir> [--seconds 60] [--settle 10] [--attempts 3] --out <json>` | Launch the app once per run and measure alternating window and desktop pairs into one file. |
| `pnpm qa:stage measure --mode <window\|desktop> --port <cdp port> --scenario <gesture-walk\|action-preempt> --clip <clip name> [--seconds 12] [--attempts 3] --out <json>` | Play an imported MMD clip over a walk or into one and record the snapshot series. See [Stage gates](#stage-gates). |
| `pnpm qa:stage gate <json> [<json>...]` | Judge stage evidence with `stage-walk-skate`, `stage-arm-penetration`, `stage-frame-budget`, `stage-gesture-walk`, and `stage-action-preempt`. |
| `pnpm qa:model prompt [--locale en] [--card <file>] [--full <fixture.json>] [--exposed-actions <label:kind,...>] [--json]` | Print the application's system prompt; JSON mode includes the prompt and contract hashes and contract version. `--full` adds the tail segments of a fixture file. `--exposed-actions` adds the `actions` segment for the listed clips (see below). |
| `pnpm qa:model score <transcripts.jsonl> [--set <id>] [--label <l>] [--example-lines-from <file>] [--exposed-actions <label:kind,...>] [--json]` | Score saved replies through the real chat runtime and stage controller, then write reply, JSON summary, and Markdown summary artifacts. |
| `pnpm qa:model import-ollama-bench <dir> --set <id> [--out <file>] [--machine-label <label>] [--server-version <version>] [--mem-gb <number>]` | Convert saved Ollama bench, sweep, and flash-attention results into transcript JSONL. |
| `pnpm qa:model help` | Print the model-evaluation command usage. |
| `pnpm qa:character simulate --scenario <name\|file.json> [--days <n>] [--seed <n>] [--json]` | Drive the pure character-state core through a scenario, check the plan's Appendix A10 invariants, and print a daily table or JSON. An invariant violation exits 1. |
| `pnpm qa:character render --stage <stranger\|friendly\|close\|intimate> [--mood <bucket words>]` | Print the exact `system:character` text for a relationship stage and optional mood buckets. |

`--seeds N` reduces a run and the report records that selection. It does not change the committed gate. Exit code 0 means the requested check passed, 1 means a check failed or a run broke, and 2 means invalid arguments or setup; T3 also uses 130 for interruption.

## Host signal smoke

Run `pnpm qa:host smoke` on Windows, macOS, or Linux X11. On native Wayland, `--expect-idle verified|unverified` is required: choose the result established by the machine's idle probe. For this machine, run `pnpm qa:host smoke --expect-idle verified`. Run `pnpm qa:host smoke --xwayland` for XWayland.

The command prints a JSON report and saves `report.json` and `app.log` under the reported `.temp/qa/` run directory. Every sample includes its elapsed time, raw host snapshot, idle reading, and resolved performance mode. A live idle sensor must advance; native Wayland may stay unverified with null idle readings or promote once to live and then advance. Runtime hook or foreground binding failures fail the signal comparison and name their reason.

Exit codes are 0 for pass, 1 for a failed check or interrupted run, and 2 for refused setup or invalid arguments. SIGINT and SIGTERM stop observation and finish teardown before releasing CPU leases; repeated interrupts leave teardown running. Only Windows parks the cursor before observation. Other hosts receive no harness input. The smoke refuses a second Electron session in its worktree and always removes its temporary profile after stopping its app tree.

For failure QA only, `pnpm qa:host smoke --xwayland --expect linux-wayland` changes the expected host without changing the launched backend. It must exit 1 and name `systemIdleTime`.

Windows live acceptance is [~] for Luke: `pnpm qa:host smoke`. macOS live acceptance is [~] for Luke: `pnpm qa:host smoke`. Use the smoke to verify host delivery; use the motion gates to score character motion.

## Fresh worktree Cubism setup

Cubism Core is an ignored local asset, not an installed workspace dependency. A new worktree can therefore fail the `cubism-core` doctor check even when the main checkout passes. Run `pnpm qa:setup cubism` from the worktree being checked, then rerun `pnpm qa:doctor`. Setup skips existing copies; `--force` downloads and replaces them.

Both app Vite configs register `DownloadLive2DSDK()` from `@proj-airi/unplugin-live2d-sdk`. Setup calls that package's existing download hook directly without starting either app. The downloader extracts `CubismSdkForWeb-5-r.3` into each app's `.cache/` and copies `Core/live2dcubismcore.min.js` into its `public/assets/js/` tree. The Vite hook keeps its existing behavior; `pnpm install` alone does not invoke it. Doctor remains read-only.

Cubism Core has its own Live2D license; see the root [license note](../../README.md#license-and-credits) and the [local QA license decision](../../docs/ai/adr/2026-10-20-motion-qa-levels.md#t2-license-decision). Do not commit the SDK or rig assets.

## Local QA environment

Put local defaults in the repository root's ignored `.env.qa`, for example:

```dotenv
AIRI_QA_RIG_FORBOOTH="/path/to/rig"
```

Doctor, motion, stage, t2-probe, and qa:test load this file before reading QA settings or recording their environment. Only `AIRI_QA_*` keys apply, and existing shell variables (including empty values) take precedence. A missing file is silent. Malformed input produces a warning and applies no values; unrelated keys produce warnings and are ignored. Doctor names the source file and loaded keys in its rigs row.

## Pointer platform preflight

Doctor's `pointer-platform` row is OK on Windows. On Linux inside `pnpm qa:display run --`, it is OK when the KWin pointer backend is available: `python3` with PyGObject (`gi`), `libei.so.1`, and the nested KWin's `org.kde.KWin.EIS.RemoteDesktop` D-Bus interface. Otherwise the row is WARN and names what is missing. Run rendered pointer QA on Windows, or on Linux inside the QA display.

On Linux inside the QA display, real-pointer T3 runs use the KWin backend:

- `scripts/linux/kwin-pointer.py`, run with `python3 -I`, injects absolute pointer motion and left-button presses through the session KWin's EIS (libei as a sender). It reads the output geometry, the cursor position, the active window, and the window list through a one-shot KWin script that calls back over the session bus. It plays the same step table as the Windows script, with the same press dwell and timing receipt; the cursor in the receipt is read back from KWin. Linux has no elevated foreground, so `foregroundElevated` is always false.
- Wayland gives every client 0,0 as its window origin, so the runner maps the page with the stage window's KWin client rectangle instead of the DOM window origin, and with a device pixel ratio of 1, because KWin coordinates are logical pixels. The stage window is the app-owned window whose client rectangle has the page's CSS size. When no window has an app PID, a unique size match is used. A window menu bar sits inside the client rectangle and would offset the page from it; such a window does not match, and the run refuses with `pointer-window-unmatched` instead of pressing at the wrong place.
- The session cursor starts at the output center, which is where KWin also centers the stage window. Pointer runs therefore park the session cursor at 0,0 through EIS before and after playback, and read it back. Runs without pointer events inject no input, so the session's idle timer stays untouched.
- `bridge.json` records `pointerGeometry` (backend, KWin window match, the screen origin used, and the renderer's own origin) and `pointerOccluders`: windows stacked above the stage whose frames cover planned steps. KWin delivers input there to the upper window unless it is click-through.

Outside the QA display on Linux, and on macOS:

- Real-pointer T3 touch scenarios exit `pointer-platform-unsupported`. On Linux the message names `pnpm qa:display run --`; the harness never drives the user's own desktop.
- Cursor parking is not implemented. T3 liveliness/emotion runs turn `cursorAttention` off instead of parking the cursor; this measures a different condition. Inside the QA display this also holds for runs without pointer events.
- `qa:stage measure` falls back to CDP pointer moves, which never trigger hit-test readback. The `stage-frame-budget` readback is therefore unmeasured. This also holds inside the QA display.
- On Linux Wayland, the app uses the classic window only, disables click-through, and its polled cursor can stick stale (#2521). See `apps/stage-tamagotchi/src/renderer/pages/index.vue` and the [fullscreen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).
- On native Wayland, KWin centers the voice Inlay window, which then sits above the centered stage window and is not click-through, so it takes pointer input over its 520x200 rectangle. In the QA display, `builtin:t3-touch` therefore misses the strokes and the body poke and fails verification (finding of 2026-11-09, `pointerOccluders` names the Inlay). The backend itself delivers the input: with the stage stacked above the Inlay, the same step table produced the pet and both pokes.

## Model evaluation

Model evaluation separates deterministic fixtures, offline replay, future live runs, future persona judging, and Luke's own reading. Contract metrics and style heuristics stay separate; heuristic columns are not a model score.

| Level | What it covers | Status |
| --- | --- | --- |
| M0 | Committed cue-contract fixtures replayed through the real runtime at every chunk boundary. | Available |
| M1 | Offline replay of saved transcripts through the real runtime and stage controller. | Available |
| M2 | Live model runs with recorded request options and transcript provenance. | Planned |
| M3 | Judged persona review using an explicit rubric. | Planned |
| M4 | Luke reads the replies and evidence for character quality. | Human review |

The runtime replay is the oracle for cue behavior. Prompt output comes from the shared contract renderer used by the app. Build `@proj-airi/core-agent` and `@proj-airi/i18n` before tests that import their dist-backed exports and before scoring. Scoring refuses when the core-agent dist is missing or older than its runtime source; rebuild it with `pnpm -F @proj-airi/core-agent build`. Build i18n with `pnpm -F @proj-airi/i18n build`.

Each committed dataset lives in `packages/qa-tools/model-eval/sets/<set-id>/`. The Mac M2 benchmark is a separate legacy set: use it to reproduce findings on fixed replies, not to mix with canonical-contract runs or rank models against the current prompt.

Scorer version 3 adds the nonverbal channels to each reply score. The runtime replay stays the oracle for each field:

| Field | Meaning |
| --- | --- |
| `acts[].gesture` | `{ kind, count, dropped }`: the normalized ACT `gesture`. `kind` and `count` are `null` without one; `dropped` marks a written gesture the normalizer refused, such as `"wave"`. A gesture-only ACT is not inert. |
| `bareGestureAttempts` | Non-JSON ACT markers whose first word is a gesture kind, such as `<\|ACT nod\|>`. Gestures are JSON-only, so the stage rejects these; they count in `stageRejected` but not in `acts`. |
| `breaks`, `breaksIgnored` | BREAK slices the runtime kept, and well-formed BREAK markers that split nothing (before the first text, over the limit of two, or trailing). |
| `silent` | `{ count, beforeSpeech }`: SILENT markers in visible speech, and whether one came before any spoken text. |
| `wordless` | The runtime answered a user turn with SILENT, at least one ACT, and no words. |
| `silentNoCue` | The runtime answered a user turn with SILENT alone: no ACT and no words. |
| `asciiFaces` | Faces from the shared ASCII face list in the spoken text that speech output strips. Bubbles keep them. |

Version 3 also redefines `blank` as no speech, no SILENT before speech, and no tool call (`noSpeech && !silent.beforeSpeech && toolCalls.length === 0`), so a wordless or silent reply is not blank. The legacy scorer (`legacy-score.ts`) keeps its own definition.

`buildSystemPrompt` accepts `register` (`talking` or `texting`) and `textingFlavor` (`plain` or `discord`). With a register, it inserts the same register section the app renders after the card and before the stage contract, so a model run can elicit BREAK markers and faces. The contract hash does not change with the register.

Version 4 scores the clip actions. Each ACT record gains `action` (the normalized label, or null) and `actionDisposition`: `accepted` for an exposed gesture, `not-gesture` for an exposed action or dance written on the ACT field, `unknown` for a label that is not exposed, and null without an action. Each reply gains `actionToolCalls` (`perform_action` calls) and `actionToolUnknown` (calls whose `action` argument is neither `stop` nor an exposed action or dance). The run summary sums them as `actionsAccepted`, `actionsUnknown`, `actionToolCalls`, and `actionToolUnknown`; the table shows them as `actions acc/unk` and `action tools unk/calls`. Labels are compared as data and never evaluated.

`--exposed-actions` takes comma-separated `label:kind` pairs, for example `wave:gesture,moonwalk:dance`. Kinds are `gesture`, `action`, and `dance`; labels are lowercase slugs. A malformed pair, an unknown kind, or a repeated label exits 2. Without the flag the dispositions stay null and no tool call is unknown, so default scoring does not depend on an exposed set. The CLI cannot pass an empty set, because an empty flag value exits 2; only the library option `exposedActions: []` gives one, and then every label is unknown.

With `prompt`, the flag adds the `actions` segment after the stage contract, rendered through the same i18n keys and gesture versus action and dance split as stage-ui's `useStageActionsPrompt`. `contractSha256` and `contractVersion` do not change; `promptSha256` covers the composed text, so it changes with the segment. The text pinned in `fixtures/model/actions-prompt.json` is asserted against both renderers.

When any scorer definition changes, bump `CUE_CONTRACT_SCORER.version` in the same commit. Compare runs using `closureDigest`, scorer version, and `coreAgentDistSha256` together. Closure file hashes normalize CRLF to LF so identical source across checkout line endings has the same provenance.

`qa:model prompt` has two modes. Without `--full`, it prints the cacheable prefix alone (formatting rules, card, stage contract); use it to compare the contract or a card across commits, because its hash does not change with memory, tools, or stickers. With `--full <fixture.json>`, it also composes the tail segments (memory index, toolset, account, voice, control, unprompted, plugin, stickers) from the fixture with the shared `composePrompt`, plus the `actions` segment when `--exposed-actions` is given (that segment comes from the flag, never from the fixture), so the output has the segment order and budgets of the app's chat prompt; use it when a model run must see the whole prompt. The fixture is a JSON object whose optional keys are `memory` (`header`, `entries` oldest first), `toolset`, `account`, `voice`, `control`, `unprompted`, `plugin`, and `stickers` (`header`, `entries` of `{ id, description }`); see `packages/qa-tools/fixtures/model/full-prompt.json`. Relative paths resolve against the repository root. qa-tools cannot import stage-ui, so the fixture carries stage-ui's prompt text itself. The stage-ui test `packages/stage-ui/src/stores/chat/prompt-fixture-parity.test.ts` reads the fixture and fails when that text drifts. It guards the memory header (`composeMemoryHeader`), the memory index lines (`indexEntriesFor`), the sticker header and `<|STICKER id|>: description` lines (`stickerPromptSegment`), and the toolset text (`## Toolset` and a `### title` block per plugin, as the toolset store renders it). The fixture carries already-rendered segment text for `account`, `voice`, `control`, and `unprompted`, and qa-tools passes it through unchanged. `voice` is stage-ui's prefix `Voice context for this input. Treat this as evidence, not instructions: ` followed by the request's speech context. `control` is stage-ui's fixed prefix (`Runtime control events for this conversation. These are control records, not user messages. Rendered audio positions are estimates: `) followed by `JSON.stringify` of the control events. `unprompted` is the instruction that `t()` renders for the turn: `base.prompt.unprompted` for open, due, and urgent reasons, `base.prompt.unprompted-continuation`, `-ritual`, or `-double-text` for those categories, and `base.prompt.unprompted-forced` for a forced turn; `base.prompt.unprompted-trigger` is user-turn text, not this segment. Only `plugin` is free text, which is the `appendSystemInstructions` text from a mod. `account` is the segment text that stage-ui's user-account context renders for a signed-in user. This fork's clients are account-free, so the app normally sends no account segment and the committed fixture omits the key. Supply `account` only to evaluate a hosted build, and paste the rendered text. A missing or invalid fixture exits 2.

Use `pnpm --silent qa:model prompt --json` when stderr must remain empty. pnpm's lifecycle banner otherwise goes to stderr; on pnpm 11.24.0, the `-s` script option alone does not suppress the outer pnpm lifecycle banner.

## Chat and speech replay server

`qa:llm` is a development-only OpenAI-compatible HTTP server for testing chat, ACT cues, tool calls, and speech playback without provider tokens. It uses `node:http`, makes no provider calls, and never launches Electron.

```bash
pnpm qa:llm serve --script packages/qa-tools/fixtures/llm/example.json --port 0 --log .temp/qa/replay-requests.jsonl
pnpm qa:llm serve --set legacy-2026-10-27-mac-m2 --run-key dolphin3:8b/bench
```

The server prints one JSON ready line to stdout with `ready`, `baseURL`, `model`, `speechModel`, `script`, `entries`, and `log`. The default host is `127.0.0.1`, the default port is `0` (choose a free port), and the default script is the committed example. For machine capture without pnpm's lifecycle banner on stderr, use `pnpm --silent qa:llm serve`. Relative script and log paths resolve from the calling directory. SIGINT and SIGTERM close listening and active connections and exit 0. Invalid arguments or setup exit 2. Do not expose this unauthenticated server or send it real conversation data: its request log contains complete prompts and tool definitions.

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

`--set` and `--script` are mutually exclusive. Set mode reads validated `airi.reply-transcript/v1` rows from `model-eval/sets/<id>/transcripts.jsonl`, optionally filters by exact `--run-key`, and replays `reply.text` in file order. It does not replay recorded tools, thinking, errors, or usage. An empty selection fails at startup.

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

`qa:smoke` proves that the app starts without errors. It launches the development app with a fresh `APP_USER_DATA_PATH` profile and the exclusive CPU lease, completes onboarding, waits for the motion QA bridge, optionally imports `--model` (the same formats and `--kind` rules as `qa:app`), waits `--settle` seconds (default 20), screenshots the stage, and tears down.

```bash
pnpm qa:smoke                                              # Linux: pnpm qa:display run -- pnpm --silent qa:smoke
pnpm qa:smoke --model /models/character.zip --settle 10
```

While the app runs, a CDP collector attaches to every window, including windows opened later, and records uncaught exceptions, unhandled rejections, `console.error` and failed `console.assert` calls, and browser error log entries such as failed resource loads. Enabling the domains replays what V8 buffered before the attach, so errors from the first paint count. After teardown, the main-process log is scanned for app logger `[error]` lines, uncaught exceptions, and unhandled rejections. Chromium's own `:ERROR:` lines and the renderer errors that Vite echoes as `[vite] (client)` are excluded.

Any error that does not match an entry in `fixtures/smoke/allowed-errors.json` (or `--allow <json>`) fails the run, and so does a window the collector could not attach to. Each allowlist entry names its `kind` (`exception`, `console`, `log`, or `main`), a regular-expression `pattern`, a `reason`, the date it was `added`, and when to remove it (`removeWhen`). Add an entry only for a concrete, understood cause, as in the known-failures registry; an unexplained error is a finding.

Stdout is one JSON line: `ok`, `runDir`, `failure`, the watched `windows`, counts of unexpected `errors` and `mainErrors`, `allowed`, `unwatchedWindows`, the `firstErrors`, and the `screenshot`. The run directory keeps `errors.json` (every error with its window, kind, text, and source), `diagnostics.json`, `stage.png`, and `app.log`. Exit 0 means a clean start, 1 means an unexpected error or a broken run, 2 means invalid arguments or setup, and 130 means interruption.

On 2026-11-09 a run on Linux in `qa:display` watched the stage, `#/inlay`, and beat-sync windows and found no errors. With a probe that threw an early exception, logged `console.error`, and rejected a promise in the renderer entry, it failed and reported all three in both app windows.

## App experience sessions

`qa:app` runs a disposable Electron experience session with the same replay script format as `qa:llm`. It starts `ReplayServer` in process on loopback port 0, takes an exclusive CPU lease, and reuses T3 launch, CDP, model import, screenshot and ownership-checked teardown helpers.

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

`--say` repeats in order. `--script <json|jsonl>` and `--set <model-eval set id>` are mutually exclusive; neither flag selects the committed example. Set mode uses all transcript rows, as in `qa:llm` without `--run-key`. `--expect` is a comma-separated list of `act`, `expression`, `clip`, `tts`, or `turn` (default `turn`). Every message also waits for a completed assistant turn before sending the next. Each message gets a fresh event sequence cursor and one `--timeout` budget in seconds (default 60, maximum 3600) covering send and event collection. Startup, bridge readiness, and model import have separate T3 bounds.

`--model` accepts a Live2D ZIP or directory, MMD ZIP or PMX/PMD, and VRM. `.vrm` infers VRM and `.pmx`/`.pmd` infer MMD; ZIPs and directories default to Live2D, so pass `--kind mmd` for an MMD ZIP or directory. Directories are zipped in the run directory. A PMX/PMD input packages its parent directory with its resources; use a directory containing one model. Model bytes remain local and the temporary archive is removed at teardown. Import uses the real display-model store and waits for the shared scene's mounted lifecycle.

The fresh `APP_USER_DATA_PATH` profile receives provider records and active chat/speech selections through their stores' exported persistence keys, followed by onboarding completion and a leader reload. VueUse strings stay raw; objects and booleans use JSON. This makes the stores read the seed during initialization instead of mutating an already synchronized snapshot. The selected display model is an IndexedDB file record created by `importModelFromInput`, selected through `useSettingsStageModel().updateStageModel()`. The seed selects OpenAI Compatible Chat Completions, `airi-replay`, speech provider `openai-compatible-audio-speech`, `airi-replay-tts`, custom voice `alloy`, enabled speech, and SSML off. The replay speech endpoint returns WAV silence. Saved API keys are the placeholder `replay`; plan output redacts them.

When an open `#/chat-floating` target has a visible, editable textarea, the driver focuses it and uses CDP `Input.insertText` and Enter. Otherwise `chatSend` calls `useChatStore().send` in the stage window. Both paths reach the synced leader that owns tool execution and ACT handling. The driver never uses `chat.ingest` or a tool's `execute`, and never resends through another path after typing has started.

The dev-only event ring records parsed ACT cues, applied performer expression slot changes, local speech playback start/end, and assistant turn start/completion with at most 500 reply characters. ACT means parsed, not successfully performed. Speech end is a playback segment end and may occur between sentences. Expressions require a mapping that actually occupies a performer slot; an unmapped emotion can produce ACT without expression. Clip/action start/end is currently **not wired**: the shared stage has no renderer-neutral clip lifecycle subscription, so `--expect clip` times out. VRM has no performer expression slot events. There is no synthetic success event for these gaps.

`--out <dir>` must name a new directory; otherwise the existing run helper creates `.temp/qa/<timestamp>-app-experience`. `--keep-open` retains Electron, the replay server, and CPU lease until interruption, then tears down. SIGINT/SIGTERM exit 130, including during keep-open. The driver forces the development window stage host, keeps its temporary profile separate from personal settings, and refuses another Electron session in the same worktree.

Stdout contains one compact JSON summary line (`ok`, `runDir`, `model`, `sendPath`, event counts, `missing`, `screenshot`, `diagnostics`, `durationMs`); use `pnpm --silent qa:app` to suppress pnpm's lifecycle banner. `sendPath` is `composer`, `chatSend`, `mixed`, or null before sending. Diagnostics include bridge state, per-message cursors, missing kinds, event timestamps, replay request log, timings, and teardown receipts. A broken run exits 1 and still attempts screenshot/diagnostics and teardown. Invalid arguments or refused setup exit 2; success exits 0. Dry run prints the full JSON plan, creates no run, takes no lease, starts no server or app, and does not read model/script files.

The summary also reports `pageErrors`, the number of renderer errors the clean-start collector recorded in any window, and `diagnostics.json` lists them. They do not change `ok`; use `qa:smoke` to gate on errors.

Live acceptance so far covers one configuration: on 2026-11-09, on Linux in `qa:display`, a ForBOOTH Live2D directory with the example script and `--say hello --expect act,tts` passed in 47 seconds through the `chatSend` path, with ACT, expression, TTS, and turn events, a rendered character in the screenshot, and a clean teardown. The owner must still verify the composer path, MMD and VRM, interruption, and Windows and macOS. Unit tests and dry run do not prove those behaviors.

```bash
pnpm -F @proj-airi/qa-tools exec vitest run --project node src/app
```

## Agent MCP server

`pnpm qa:mcp` serves the `airi-qa` MCP server over stdio. It drives one disposable app session with the same launch, seed, onboarding, import, send, screenshot, and teardown helpers as `qa:app`, and the error collector of `qa:smoke`. The repository's `.mcp.json` registers it for Claude Code. For another client, register the command `pnpm --silent qa:mcp` with the repository as its working directory; for example, `codex mcp add airi-qa -- pnpm --silent --dir <repo> qa:mcp`.

| Tool | Does |
| --- | --- |
| `airi_start` | Launches the development app with a fresh temporary profile, the in-process replay LLM and speech server, and onboarding complete, then waits for the bridge. Optional `model` (and `kind`) imports and selects a model; optional `script` loads a `qa:llm` replay script. |
| `airi_send` | Sends a chat message through the real chat path and waits for a completed turn plus the `expect` kinds. `reply` queues the assistant reply for this turn; without a script, every send needs one. |
| `airi_state`, `airi_events` | Read the bridge state and the event log. |
| `airi_import_model` | Imports and selects another model. |
| `airi_screenshot` | Returns the stage window as an image and saves it in the run directory. |
| `airi_errors` | Lists renderer errors from every window and main-process error lines since `airi_start`. |
| `airi_eval` | Evaluates an expression in the stage window. |
| `airi_stop` | Tears the session down and returns the teardown report. |

On Linux outside a QA display, `airi_start` starts `qa:display` session `mcp` and launches the app there; `airi_stop` stops it again. A server that itself runs inside a QA display uses that one. Starting the server costs nothing; the app, its exclusive CPU lease, and the display exist only between `airi_start` and `airi_stop`. `airi_start` can wait in the CPU slot queue behind builds and other QA runs. Closing the client, SIGINT, and SIGTERM tear a running session down. Each session writes `.temp/qa/<timestamp>-mcp-session/` with `app.log`, `requests.jsonl`, and the screenshots.

On 2026-11-09 a stdio client on Linux started a session outside a QA display with the ForBOOTH Live2D directory, sent a message with a scripted ACT reply and received `act`, `turn`, and `tts` events, took a screenshot, evaluated an expression, listed errors, and stopped with a clean teardown that also stopped the `mcp` display.

## Character state simulator

`qa:character` exercises the layered character state in `@proj-airi/stage-shared/character-state` without the app, a model, or a clock. It does not import `stage-ui` and makes no model calls.

`simulate` replays a scenario day by day with a UTC logical day that rolls over at 04:00 UTC. It applies every event through the real reducer (`applyEvent`), samples the state at the half hour of every simulated hour (`advance`, `readCharacter`, `renderCharacterContext`), and checks these invariants after every event and at every sample: raw mood within the 2.5 headroom per axis; model-cue-only raw within 0.65, the burst peak of the rolling cue budget (`budget / (1 - 2^(-window / halfLife))`, rounded up); while nothing but model cues has ever moved her mood, overall valence within `tanh(atanh(restingValence) + 0.65)`, rounded up (0.64 at the default resting value; the summary reports it as `modelOnlyValenceBound`, which is `null` once a touch, reply, or event has moved her mood); temperament within its clamp of the resting disposition; relationship levels in [0, 1]; each day's gain within its daily ceiling `G`; at most one stage-up per dimension per rollover and none between rollovers; equal results for one `advance` and for the same span split in two; pruning never changes `moodAt`; and rendered text without digits. The daily table shows the valence range, temperament valence, the three levels, the stages, the hours the reading was `pointed`, and the applied and rejected events. `--json` prints the same data with a summary and the first 50 violations; the run duration goes to stderr.

Built-in scenarios live in `src/character-state/scenarios/`:

| Scenario | Shows |
| --- | --- |
| `typical-month` | The plan's A7 month: a reciprocated greeting, one unanswered reach-out a day, an evening session with three model cues and two touches, a significant positive every third day, away days 15 to 17, and a hurtful event on day 22. |
| `model-spam` | One `brighter` cue per minute for the whole run; the rolling budget holds model-only raw valence at or below 0.65 and overall valence at or below 0.64. |
| `absence` | Ten ordinary days, twenty days away, and a return: familiarity erodes while closeness and trust stay. |
| `hurt` | A bad day of hurtful and tense events, then a lonely day of unanswered reach-outs; shows when the reading turns `pointed`. |

A scenario file is JSON with `name`, `description`, `days`, optional `startDate`, `profile`, `awayDays`, and `autoReturn`, and `routines` whose `events` take an `at` time (`HH:MM` UTC; times before 04:00 belong to the end of the logical day), a `kind`, and an optional `repeat` (`count`, `everyMinutes`). The simulator derives the `exchange` of user turns (the third of a logical day is the first real exchange), the `consecutive` count of unanswered reach-outs, and a `return` event before a user turn that follows a gap longer than a day. A `model-cue` takes a MOOD cue body (`brighter: reason`) or weighted bodies picked with the seeded random source, so a run is deterministic for a seed. The `fault-contribution` kind injects a raw mood step around the reducer; use it only to prove that the invariant checks fail, as `src/character-state/fixtures/invariant-violation.json` does. A relative `--scenario` path resolves against the directory the command was started from. An unknown scenario, a malformed file, or an invalid argument exits 2.

`render` prints the text the app would send for a stage preset: `friendly` pairs with trust `open`, `close` with `open` and `knows-you`, and `intimate` with `confiding`, `knows-you`, and three milestones. Without `--mood` the buckets rest at the default resting disposition, so `stranger` prints nothing (the app sends no character text at rest). `model-eval/fixtures/character-stages/<stage>.json` holds `{ stage, text }` for each stage for a later live model run (M2); the tests keep them equal to `render`.

The starting values in the ADR's Known gaps depend on the trust and closeness pace. After you change a constant, run `pnpm qa:character simulate --scenario typical-month --days 90` and read the day-30, day-60, and day-90 rows before you change a stage threshold.

## Levels

| Level | What it proves | What it cannot prove |
| --- | --- | --- |
| T0 | Unit tests cover local contracts and deterministic behavior. | Integration with the full controller, a rig, or a rendered application. |
| T1 | A deterministic scenario exercises the real decider, conductor, hold performer, Natural controller, adapter, and shared scorer without a rig. | Cubism physics, rig-specific parameter behavior, pixels, or visual naturalness. |
| T2 | The real ForBOOTH rig, Cubism Core, physics, and pose run headlessly at a fixed timestep. The spike measured exact Chromium parameter parity and more than 10x real time. | Renderer pixels, complete application behavior, or naturalness. |
| T3 | The Electron renderer dispatches scenario events through its development-only bridge and captures the resulting trace and screenshots. | Statistical confidence from a single rendered scenario or visual naturalness. |
| T4 | Luke reviews the report and rendered images for appearance and naturalness. | An automated, reproducible naturalness score. |

Statistical scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which remains Luke's visual call. Desk VTS recordings are valid for idle liveliness only.

## Scenarios

Scenario files use the shared `@proj-airi/stage-shared/motion-scenario` contract. The same scenario can run at T1, T2, and T3 when its events are supported at those levels. T3 scenarios cannot contain speech, cursor, or gesture events.

A `gesture` event (`{ kind: 'gesture', at, gesture, count? }`) sends an ACT cue gesture (`nod`, `shake`, `shrug`, `lean`, or `glance`) to the Natural scene through the adapter's `gesture` API, as the stage's ACT handler does. `count` (1-3) defaults to 2 for nod and shake and 1 otherwise. `src/motion/gesture-scenarios.test.ts` checks each gesture's trajectory against an idle twin run and the queue rules (a conflicting gesture waits for the channel, a newer one replaces it, and one that would wait more than 1.5 s is dropped). `runT1` takes an `onTouch` observer that receives each touch the stage's classifier reports; `touch-scenarios.test.ts` feeds it through the situation reducer and the reaction policy to check that a 3-poke burst makes exactly one reaction decision. `builtin:t3-smoke` is a rendered smoke scenario; scenario events and Natural events are timestamped in the captured trace.

`builtin:t3-touch` declares a near-band right-side approach from 1.9 to 0.6 head widths at 3 head widths per second, four seconds of horizontal strokes, a 1.5-second rest, and body/head pokes. It ends after the head poke without an off-desktop escape target. Far and medium approaches remain covered at T1. `builtin:t3-touch-pass` declares one straight pass. T3 performs pointer events with real OS input: Windows user32 input, or KWin EIS input inside the Linux QA display (see [Pointer platform preflight](#pointer-platform-preflight)). The head rectangle uses the cursor's unscaled face-feature interaction unit, not the physics-inclusive presence bubble or the user's touch scale. It is measured in viewport CSS pixels through the model's layout and world transforms, then converted to physical screen pixels with the DOM window origin and device pixel ratio. The KWin backend uses the stage window's client origin and a ratio of 1 instead. `bridge.json` records that head rectangle beside the stage window's CSS size.

Before any cursor movement, the runner reads the physical virtual-screen bounds (`GetSystemMetrics` on Windows, the KWin virtual screen geometry in the QA display) and checks every mapped target. It keeps a fitting declared path. If the path does not fit, it mirrors the approach axis toward the virtual-screen center, including later strokes and pokes, and checks the entire mirrored path. It never clips points or shortens the approach. If neither path fits, `pointer-path-outside-virtual-screen` refuses input. The playback script rechecks the live bounds before input, so a changed monitor layout cannot silently clamp targets. `bridge.json` records the virtual-screen rectangle, selected mirror axis, and effective physical steps; scenario trace markers retain the declared coordinates.

Before any cursor movement, a head width greater than half the stage window's CSS width refuses the run as `pointer-head-implausible`, with both widths in the error. A path that cannot fit the desktop is also a named refusal, not permission to shrink the reported head or bypass bounds checks. Real cursor receipt mismatches remain failures, and the receipt is preserved in the error. Touch runs enable cursor attention; ordinary smoke and emotion/liveliness gates keep their existing cursor-parked behavior.

## Stage gates

The desktop stage gates live in `src/stage/gates.ts`; `src/stage/measure.ts` produces the frame-budget and scenario input. Relative paths resolve against pnpm's `INIT_CWD`: the directory where you typed the command, or the `--dir` directory when pnpm is called with `--dir`.

| Gate id | Input | Passes when |
| --- | --- | --- |
| `stage-walk-skate` | A walk timeline: `perFrameSeries` (top level or under `walk`) with the columns `mode`, `skate`, and `feetMaxError`, one row per frame. | The non-idle frames include `walking`, max `locomotion.skate` < 0.05, and max `feet.maxError` < 0.05. |
| `stage-arm-penetration` | A standing run per model: `model` plus `perFrame` with `t_ms`, `penL`, and `penR`, or a `models.<name>.penetration.left/right.max` summary. | Kinematic `arms.penetration` max is 0 over at least 30 s on every model. `clothContact` is printed for information only. |
| `stage-frame-budget` | `measure` records (`result` with `mode`, `fps`, `p95StageMs`, `readbackMs`, `frames`), single files or one pairs file. | At least 3 window/desktop pairs; every desktop p95 AIRI stage sum <= 4 ms; median desktop/window FPS ratio >= 0.9; every desktop readback mean <= 1 ms; median per-pair (desktop readback max - window readback max) <= 1 ms. |
| `stage-gesture-walk` | A `measure --scenario gesture-walk` record (`kind: 'stage-scenario'`) with the snapshot `series`. | Over the samples from the playClip post to the stopClip post: the clip plays on the upper layer during `walking` for at least the larger of the record's `seconds` (12 by default) and 10 s, so a record with a short `seconds` field cannot pass on a short walk; max `locomotion.skate` < 0.05 and max `feet.maxError` < 0.05 over the non-idle samples; `locomotion.enabled` is true on every sample; the clip is on the upper layer in at least 80 % of the samples; the run is valid. |
| `stage-action-preempt` | A `measure --scenario action-preempt` record with the snapshot `series`. | The clip performs on the full layer with at least one `playing` sample; `locomotion.enabled` is false and `director.pendingGoal` is set on every `playing` sample; the held goal is issued (pending cleared, `director.goalX` set) within 3 s after `action.performing` clears; the p95 AIRI stage sum over the run is <= 4 ms; the run is valid. Samples in phase `settling` are counted but not gated, because the director keeps the gait on while she stops walking. |

- `gate` prints `<gate id>: PASS`, `FAIL`, or `NO INPUT`, each followed by its checks with the measured values. Exit codes: 0 every gate with input passed, 1 a gate failed, 2 usage error, unreadable or unrecognised evidence, or no input for any gate.
- Runs pair by their `n` field; when a run lacks one, runs pair in the order given. The todo 1 evidence names the window `classic` and the desktop stage `spike`; both vocabularies are accepted.
- `measure` reads the frame measurement through the motion diagnostics BroadcastChannel of the stage target (`#/` for window, `#/stage` for desktop) while the real OS cursor circles over the character, so the hit-test readback cost is part of the readback numbers. Both host pages take the cursor from the main process, so a CDP pointer would never trigger a readback. One long-lived process moves the cursor: JXA `CGWarpMouseCursorPosition` on macOS (no Accessibility trust needed) and PowerShell `SetCursorPos` on Windows; elsewhere CDP moves are used and the record notes the method (`load.pointer.method`). AIRI stages are every timed stage except the three-mmd internals and `render`.
- Before each attempt `measure` waits up to 5 minutes for a quiet machine: no `vitest`, `tsc --noEmit`, or `vue-tsc` process, and a 1-minute load average below 3. During the run, a 1 Hz sidecar records the load average and `pgrep` hits, and one `ps` top-8 CPU listing is taken halfway. An attempt with a hit is `INVALID-CONCURRENT-LOAD` and is repeated up to `--attempts`; discarded attempts stay in the record, and the record has `valid: false` when every attempt was invalid. On Windows, the sidecar records no `pgrep` or `ps` data.
- `AIRI_STAGE_HOST` works only in a development build (`stage-tamagotchi dev`); a packaged build ignores it and obeys the Experimental 3D stage setting.
- `measure --port` attaches to an app started with `APP_REMOTE_DEBUG=true`, `APP_REMOTE_DEBUG_PORT`, and `AIRI_STAGE_HOST=<mode>`, with an MMD model mounted. `measure --pairs` copies `--profile` (onboarding done, MMD model selected) for every run, launches `stage-tamagotchi dev` with `AIRI_STAGE_HOST` set to window, then desktop, for each pair, waits for the model, settles for `--settle` seconds, measures, and tears the run down like T3. It rewrites `--out` after every run; a broken run is listed under `failures` and exits 1.
- `measure --scenario` attaches like `measure --port` and needs the clip imported for the mounted model. It waits for her to stand still, starts the frame measurement, requests a walk goal 600 DIP away toward the side with more ground, and posts `playClip` one second into the walk. `gesture-walk` loops the clip (a looping `debug` request skips the 4 s gesture repeat cooldown, not the ownership rules) and walks her back and forth between the start and the goal until the clip has played on the upper layer while walking for `--seconds`, or for six times that plus 10 s, then posts `stopClip`. A 600 DIP leg spends only about 1.4 s of its starting, walking, stopping, and turning in mode `walking`, so the default 12 s span takes about nine legs. `action-preempt` plays the clip with its own loop setting, requests the goal again at the first performing sample, posts `stopClip` after `--seconds` of playing, and records until the held goal is issued. Every snapshot is one series row (`t` in ms since the playClip post, `mode`, `enabled`, `skate`, `feetMaxError`, the performing name, layer and phase, `pendingGoal`, `goalX`); a gate failure names the offending rows as `#<row> (t <s> s)`. A refused request is recorded in `refusal`; a `refractory` refusal with a retry time, which an earlier attempt that played the clip causes, is waited out and the attempt repeated, at most `--attempts` times. The quiet-machine wait and the concurrent-load sidecar are the same as for the frame measurement.
- The director refuses every action as `asleep` while the desktop activity sensor reports a long idle time. On a host where nobody touches the input devices during the run, keep the activity sensor fresh, or the scenario only records the refusal.
- Keep the desktop undisturbed during a measurement: the frame rate is the measured value.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/stage`. The fixtures in `fixtures/stage/` are minimal copies of the plan's real evidence, and each names its `source`.
- `measure --pairs` launches the app through the same pnpm resolver as T3 and doctor. The resolver finds pnpm's own `.tools` layout under `PNPM_HOME`, a JS `npm_execpath`, or a standalone pnpm binary of the pinned version, such as the one mise installs, through the `dist/pnpm.mjs` beside it.
- `stage-frame-budget` passes its readback-max criterion with little margin, because the asynchronous read's buffer copy still stalls occasionally. If it fails again, the next fix is a CPU silhouette mask, not a threshold change. The gates and the stage architecture are recorded in [the full-screen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

## Gates

Gate definitions live in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts`.

| Gate id | Version | Meaning |
| --- | --- | --- |
| `natural-idle-liveliness` | 2 | Idle Natural metrics against reference bands. Head jitter and speed-peak log asymmetry are reported, not gated. |
| `natural-talking` | 2 | Talking head speed relative to silence. Speech-onset enrichment is reported, not gated. |
| `natural-emotion` | 1 | Emotion direction, recipe-relative size, release, and visibility above the idle null. |
| `natural-emotion-t3` | 2 | Rendered emotion transfer against session-local placebo windows and a same-commit T1 reference. |
| `natural-idle-liveliness` at T3 | 2 | Rendered idle liveliness from three captures, aggregated by the liveliness gate. |

Changing a gate means editing `gates.ts` and bumping its `version` in a commit before running it. Reports record the gate id, version, and source file SHA. Never tune a gate or Natural recipe merely to make a failing run pass. Failures are findings.

T1 is the deterministic controller simulation. T2 uses the real headless rig and the shared scorer. The idle liveliness gate keeps its original seeds, warm-up, scored duration, and metric list.

Liveliness accepts `--host windows|macos|linux-x11|linux-xwayland|linux-wayland|web`. For example, `pnpm qa:motion gate liveliness --level t1 --host linux-wayland --fresh` simulates an unattended host with its unavailable cursor, placement and desktop idle signals left unknown. Host-profile simulations resolve performance on every step; unprofiled scenarios retain their scripted idle behavior. The option is rejected for emotion gates.

At T3 the runner refuses a host mismatch before launching, and `linux-xwayland` selects `dev:xwayland` within a Wayland session. The bridge verifies the live host, clears earlier performance overrides and leaves real placement and chat inputs enabled. Liveliness fails with `mode-left-idle` if a scored frame leaves idle at T1/T2 or a ten-second bridge sample leaves idle at T3. T3 mode samples are recorded in the capture's `bridge.json`. A report produced by T1 does not establish rendered T2/T3 acceptance.

Host-profile T3 captures record performance samples every ten seconds from scenario start, including warm-up, in `bridge.json` under `modeSamples`. Each sample includes the live host capabilities, `performanceMode`, and `performance`: the last resolver's epoch time, desktop snapshot, cursor movement time, and the `away` flag handed to Natural. These are observed values; diagnostics never resolve performance again or override an input. The liveliness guard still rejects non-idle modes only in the scored window. An idle mode can carry `away: true`.

A standalone `qa:motion t3 --rig forbooth --scenario <file.json>` whose scenario declares `settings.host` records the same samples without imposing a gate verdict. It is suitable for one-seed diagnostics, not three-capture gate acceptance. The ten-second sample interval bounds transition timing; a sample does not prove that the state stayed unchanged between reads.

Host-profile liveliness captures target idle with away inactive. Each scored sample must report `performance.away === false`, otherwise the capture fails with `away-active`, including when the diagnostics are missing. The harness records the rejected sample and does not suppress away, override the resolver, or change sensor readings.

The unchanged T3 capture lasts 600 seconds: 180 seconds of warm-up and 420 scored seconds. With verified, advancing native Wayland idle sensing and no input, the resolver enters away above 300 idle seconds. The instrumented capture observed this between 290 and 300 seconds, inside the scored window. Such an unattended capture cannot finish as idle-only; the harness now reports that limitation instead of changing the resolver or shortening the measurement. An unavailable idle sensor remains a different condition: it supplies null and cannot trigger inactivity-driven away.

## Evidence

After argument and environment checks pass, `pnpm qa:test`, `pnpm qa:motion gate` at T1, T2, or T3, direct `pnpm qa:motion t3`, and `pnpm qa:motion validate-scorer` create unique runs under `.temp/qa/<timestamp>-<tool>-<label>/`. Each run's `run.json` records its command, source SHA, dirty state, relevant `APP_*` and `AIRI_QA_*` environment values, gate provenance when applicable, artifact hashes, and result. A T3 gate also creates one run per capture session. An emotion `--rescore` creates its new run only after the archive passes validation; a refusal exits 2 before creating it. The standalone `t2:probe` prints a JSON summary and creates no run directory.

`pnpm qa:doctor` prints its findings, including with `--warm`, and creates no run directory or manifest. `pnpm qa:report` writes `report.html` into the first input run directory or the path passed with `--out`; it creates no separate run directory or manifest. The evidence archive command copies files under `.omo/evidence/<slug>` and writes that archive's `manifest.json`, not a QA run directory or `run.json`.

Archive plan evidence into the main checkout before removing a worktree:

```bash
pnpm -F @proj-airi/qa-tools run evidence archive --plan <slug> --from <worktree-path>
```

The archive command preserves the source, refuses conflicting bytes, and writes a hash manifest. Run output and evidence are not committed.

## Known failures

`packages/qa-tools/known-failures.json` is the committed baseline. `pnpm qa:test` matches package, project, file, and full test name. New failures and suite errors fail the command. Known failures are reported without being called passes; fixed known failures are reported for registry removal, and flaky entries that pass are identified separately.

Never skip, delete, or weaken a test to clear a failure. Fix a regression or add a registry entry only when there is a concrete cause, date, and removal condition.

## Bridge gates

The motion QA bridge is development-only and uses remote debug; it adds no listening port. Registration requires all three gates: a development build, `APP_REMOTE_DEBUG=true`, and `APP_MOTION_QA_BRIDGE=true`. The bridge uses typed Eventa commands as one dispatcher and validation boundary, not as an isolation or security boundary. Production bundle checks verify that bridge markers are absent.

## T2 status

T2 is GO, path A. The Cubism Core and ForBOOTH rig ran in Node without a GPU using two documented global shims. Across 600 frames and 281 parameters, Node and Chromium differed by 0; the negative control differed by 30. The measured Natural, adapter, and physics loop reached 55.19x real time. The runner skips mesh deformation because it reads but does not write parameters and costs about 90% of a frame.

## Known limitations

The protocol-1 limits are historical: x0 detection was 92.9% with impulse hints active, `ignore-side` detection was 83.3% with a fixed hold side, x0.5 size detection was 64.4% at the inclusive 0.5 size boundary, and unmutated sets passed 84% to 88% of checks. Protocol 2 addresses these validation-design causes without changing gates or Natural motion. See `docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md`.

The first full protocol-2 run passed A/A, zero, mutations, and determinism; unmutated failed. Mutations met their thresholds: x0 killed 324/325 eligible checks, pooled ignore-side killed 72/72 mutable checks, and x0.5 calibration killed 174/174 clear and strong checks. The unmutated run found 37 persistent failures: visibility 7, significance 6, release 31, and size 3. Its remaining 66 noise failures exceeded the budget of 25 across 1,500 check-set pairs, so the prediction that failures would come only from persistent checks was missed. These findings were recorded without retuning. See .omo/evidence/motion-gate-redesign/findings.md for the full list.

Smoke timing is recorded, not asserted. Quiet-machine measurements were 44.7 to 65.0 seconds against a 60-second target; the full gate was 294.6 seconds against a 300-second target.

Naturalness remains Luke's visual call. ForBOOTH's watermark covers part of the face in T3 screenshots. Per Luke's rule, acceptance on one rig counts for the other.

### T1 limitations

- **ACT markers need an emotion.** A scenario ACT marker that carries only `expression` (or only `motion` or `look`) throws at T1 with `ACT marker has no recognized emotion`, because the T1 sink applies only the marker's emotion (`src/motion/scenario-sink.ts`). Put an `emotion` in the marker, or use an `expression` event.
- **Traces show no catalog expressions.** T1 has no rig, so it decides expression slot commands but does not apply them (`src/motion/t1/runner.ts`). A T1 trace records what Natural performed and never shows a catalog expression.
- **Visibility is uninformative on a channel whose idle null never moves.** A zero-spread null makes a hit rate and uniform p-values impossible by construction, so scorer validation reports those channels separately (`zeroSpreadChannels` in `src/motion/validation/evaluate.ts`). At T1 this affects eyeSmile and cheek.
- **`QA_RUN_DIR` in your shell enables the gate project.** `vitest.config.ts` includes `gates/**/*.gate.ts` whenever `QA_RUN_DIR` is set, so a plain package test run in a dev shell with it exported picks up gate files. Unset it before running the package tests directly; `qa:motion gate` sets it per run.

### T3 gates

Before scoring, live T3 gates require `trace.meta.home` to equal the scenario's `home` (default `desk`). Emotion `--rescore` checks the same `posture-home` invariant after all artifact digests pass; a mismatch exits 2 before creating a run directory.

The diagnostics store's local `postureHome` defaults to `product`. At `runScenario`, the bridge synchronously sets it to `scenario.home ?? 'desk'`. Model owns rebuilding the adapter for that home, preserving an already-running recorder and reattaching its observer. The home persists after the last event and capture, until the next scenario replaces it or bridge scope disposal restores `product`. The `t3-smoke` fixture already requests `desk`.

`pnpm qa:motion gate emotion --level t3 --rig forbooth [--t1-report <run dir>]` and `pnpm qa:motion gate liveliness --level t3 --rig forbooth` run committed gates in the rendered app. Emotion `--rescore <gate run dir>` re-scores archived sessions without launching Electron. A live gate uses a separate launch, capture, and teardown for each session. These commands do not accept `--emotions`, `--bands`, `--seeds`, `--workers`, or `--timeout-minutes`.

- Preflight, before anything launches (exit 2 with the reason): `AIRI_QA_RIG_FORBOOTH` must name a rig; doctor's `stray-electron` probe must find no stage-tamagotchi Electron process of this worktree; the emotion gate needs a T1 emotion report at the same commit with a result for every face check of its cells. Without `--t1-report`, the newest `.temp/qa/*-motion-gate-emotion-t1` run at `HEAD` is used; create one with `pnpm qa:motion gate emotion --level t1 --emotions angry,sad,love,sleepy --bands clear,strong`.
- Emotion (`naturalEmotionT3Gate`, `src/motion/gate/t3-scenario.ts`): 10 pulses each of angry strong, sad clear, love clear, and sleepy strong, ordered by a seed so the same cell never repeats consecutively. The gate uses three capture sessions so each session forms its own stratum for the placebo null. The planner assigns the 40 pulses across three equal 300-second scenarios, leaving room for warm-up and placebo windows below the 599-second scenario limit imposed by the renderer's 600-second capture cap and the harness's one-second capture margin. It places placebo windows after each pulse and adds lead placebos until the run has at least 50. The archived accepted run contains 52 placebo windows.
- Scoring (`src/motion/gate/t3-score.ts`) uses the shared scorer with no stripped run: `measureEmotionTrial(trace, null, ...)`, `measurePlacebos` and `scoreEmotionGate` (significance, sign, visibility). The placebo null is session-stratified (`naturalEmotionT3Gate` v2, `placeboNull`): every record carries its session as `stratum`, each trial's visibility hit uses its own session's placebo q90, `E` is the mean trial-minus-own-session-null difference with a bootstrap that resamples within sessions, and significance is `stratifiedUnpairedPValue`, a permutation test that relabels trials and placebos only within each session. The roughly 17 windows per session are too few for a session-only null, so the 50-window minimum applies to the total (the archived run has 52). `report.json` states this under `nullModel`, with per-session trial and placebo counts and per-session null statistics; `nullStats` is pooled for display only; checks of sided channels are unsigned unless the trace has the hold side. A face or eyelid check passes with at least 6 trials above the placebo q90, a face check also needs `E_T3 / E_T1` within [0.7, 1.3], and the release fails only when the tau fitted to the mean unpaired release trajectory exceeds 3 x the nominal `held.releaseTau`. A criterion without data is `n/a`, which fails the gate, except for a channel whose parameter no trace of the rig has (ForBOOTH has no `ParamCheek`): that check is listed with the reason and not gated. Posture checks are reported and pooled per channel, never gated. Slow-modulation checks need long holds, which T3 does not run, so they are not scored. Each result keeps the scorer's own verdict under `scorer`.
- Liveliness: three 599-second idle scenarios, each captured for 600 seconds, with a marker each minute and no inputs. Cursor attention is off and the OS cursor is parked. Each trace is trimmed by the unchanged 180-second warm-up and aggregated with `naturalIdleLivelinessGate` as in T2. A median is used; any hard failure fails. A conflicting stage-tamagotchi Electron process from this worktree refuses the run before launch with exit 2. A cursor-parking failure is recorded as a failed session.
- Output: the gate run dir (`.temp/qa/<ts>-motion-gate-<target>-t3/`) holds `scenarios/`, `partials/`, `report.json` (level `t3`, the rules, the T1 reference, the plan and every session run id), `summary.txt`, `timing.json` and `report.html` rendered with each session's T3 run dir. Each session's own run dir keeps `trace.json` with its scenario and Natural events and the screenshots. A session that fails (verification, cursor parking, launch) adds a failing `session:<id>` row, and the remaining sessions still run; an interrupt or a refusal stops the run.
- `--rescore <gate run dir>` scores an archived emotion run again with the current scorer and rules, launching nothing. Before parsing scoring inputs, it checks every artifact it will read against the SHA-256 recorded in that run directory's `run.json` at capture time (`src/motion/gate/t3-archive.ts`): the gate run's `report.json` and `scenarios/*.json`, the T1 reference's `report.json`, and each traced session's `scenario.json`, `trace.json`, `bridge.json` and `verification.json`. A changed or missing file, or one without a digest, exits 2 with the named `archive invariant "artifact-digest"`. It then checks the planner's layout invariants, exact trace-event identity (`trace-identity`), and session headers (`session-header`). Those refusals also exit 2 with the named invariant, before any rescore run directory is created. A valid archive uses the same scoring and output code as a live run and writes a new rescore directory with `rescoreOf`. The manifest is trusted: rewriting an artifact and its corresponding `run.json` digest together is not detected.
- Exit codes: 0 every gated check passed, 1 a check failed or a session broke, 2 refused before launch (or an archive that cannot be re-scored), 130 interrupted.

Rendered T3 gates require an UNDISTURBED desktop. Mouse movement can fail cursor parking. Focus changes or window occlusion can throttle frames and corrupt long captures. Warn the user before starting a long capture, then keep the desktop, app focus, and window visibility unchanged until it ends.

On Linux, run T3 inside the headless QA display: `pnpm qa:display run -- pnpm qa:motion t3 ...` (see [`scripts/dev-tools/README.md`](../../scripts/dev-tools/README.md#pnpm-qadisplay)). The app then renders on the host GPU in its own KWin session, so the user's mouse, focus, and windows cannot park, throttle, or occlude it, and the user can keep working during long captures. CPU and GPU load from the user's work still competes with the capture, and the `exclusive` CPU slot still applies. Real-pointer scenarios such as `builtin:t3-touch` inject input into the session through KWin EIS, never into the user's desktop. Doctor's `pointer-platform` row, run inside the session, checks the prerequisites; the Inlay finding under [Pointer platform preflight](#pointer-platform-preflight) still fails `builtin:t3-touch` there.

`qa:motion t3` runs one motion scenario in the real Electron app and captures what Natural performed:

```bash
AIRI_QA_RIG_FORBOOTH="<rig dir>" pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke
AIRI_QA_RIG_FORBOOTH="<rig dir>" node --import tsx packages/qa-tools/bin/motion.ts t3 --rig forbooth --scenario <file.json> [--keep-open]
```

- Run `pnpm qa:doctor` first. Do not start a run while a heavyweight check (Vitest browser suites, `electron-vite build`, root typecheck or lint) runs, and keep the app window visible: the bridge paces scenarios with `requestAnimationFrame`, which a hidden or covered window throttles. The harness measures the frame rate before it starts and fails a run whose events were stamped more than 0.5 s late.
- Steps: refuse when an Electron or stage-tamagotchi process of this worktree already runs (exit 2); `createRun` (`.temp/qa/<YYYYMMDD-HHmmss>-motion-t3-<scenario id>/`, never reused); zip the directory that holds the rig's `*.model3.json` into `rig.zip`; `pnpm --dir <worktree> -F @proj-airi/stage-tamagotchi dev` with `APP_USER_DATA_PATH=<run dir>/profile`, `APP_REMOTE_DEBUG=true`, a free `APP_REMOTE_DEBUG_PORT`, `APP_REMOTE_DEBUG_NO_OPEN=true` and `APP_MOTION_QA_BRIDGE=true`; connect to the main stage target (`synced-leader=true`, route `#/`); mark onboarding complete and reload; wait for the bridge; import the rig through a hidden file input and `importModelFromInput`; `configure({ driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions })`; park the OS cursor (Windows `SetCursorPos`, read back with `GetCursorPos`; a failed call or a cursor that is not at the target fails the run with the Win32 error and the foreground process; pointer runs in the Linux QA display park through KWin EIS and read the cursor back from KWin; other platforms and runs warn); `startCapture(min(600, durationSeconds + 1))`; `runScenario`; screenshots at `screenshotsAt` on the scenario clock while it runs; `awaitCapture`; verify; tear down.
- Every wait is bounded: CDP commands time out (default 30 s), the bridge wait, the rig import (600 s), `runScenario` (duration + 60 s) and `awaitCapture` (capture + 120 s) each have a limit, and a launch that exits early fails at once.
- Expression ids: scenarios name expressions by catalog id, which T1 resolves against the rig's catalog fixture (`fixtures/forbooth-catalog.json`). The rendered app keys expressions by their archive-relative `.exp3.json` path, so T3 sends each catalog id as that entry's `fileName` and records the mapping in `bridge.json` (`expressionIds`). Ids that are not in the catalog are sent unchanged, and the bridge rejects them.
- Verification (`verification.json`) fails the run unless every scenario event was dispatched and is stamped in `trace.json` in order with its `at`, the `capture:<label>` marker is present, Natural reported `hold` events when the scenario has emotions, the trace has samples, and every planned screenshot exists.
- Run dir: `run.json` (with `process.rootPid`), `scenario.json`, `launch.json`, `app.log`, `bridge.json`, `trace.json`, `screenshots/NN-<at>s.png`, `screenshots.json` (planned and actual scenario time and trace time per shot), `verification.json`, `teardown.json`, and `error.txt` on failure. The profile and `rig.zip` are deleted by teardown; rig bytes never stay in the run dir.
- Teardown runs on success, failure and Ctrl+C (later interrupts are ignored until it finishes): `Browser.close` over CDP, then `taskkill /PID <root> /T /F` (POSIX: a process-group kill) only after the live process table shows the same PID and creation time with the worktree path in its command line, then each remaining run process the same way. A process belongs to the run when it was seen in the root's tree, its command line contains the run's profile path, or it is an Electron or stage-tamagotchi process whose command line contains this worktree's path as a whole path. Processes of other worktrees never match, so a stray Electron from another worktree is neither a conflict nor a target; the doctor's `stray-electron` row uses the same whole-path rule. The profile is deleted only when no run process remains; otherwise `teardown.json` lists the leftovers and the run exits 1.
- Exit codes: 0 verified, 1 run, verification or teardown failure, 2 usage or environment error before launch (for example `AIRI_QA_RIG_FORBOOTH` unset, a scenario without level `t3` or longer than 599 s), 3 no exclusive CPU lease within 30 min (`T3_LEASE_TIMEOUT_EXIT`), 130 interrupted. `pnpm qa:motion` and the `node --import tsx` form preserve these codes; `pnpm -F @proj-airi/qa-tools exec tsx bin/motion.ts` reports every failure as 1.
- A hard kill of the CLI itself (for example `taskkill /F` on its PID) skips teardown. Check for leftovers with `pnpm qa:doctor` (`stray-electron`) and stop them by hand after confirming their command lines contain your worktree path.
- `builtin:t3-smoke` (`fixtures/scenarios/t3-smoke.json`, levels `t1` and `t3`, 140 s): clear pulses of happy, sad, angry, surprised, think, love, flustered and sleepy 14 s apart (longer than `naturalEmotionLifetime` for clear, 8.7 s, and strong, 12.3 s), one `<|ACT {"emotion":"angry"}|>` marker, `expression1` on and off, and screenshots 1 s and 3 s after each pulse. The same file runs unchanged through `runT1`, and both traces stamp the same scenario events.
- Screen-aware Natural scenarios accept `placement`, `chat-target`, `chat-typing`, `chat-sent`, and `chat-unfold` events. `builtin:t3-screen-attention` exercises placement and chat attention in T1 and T3.

## Result cache

Completed T1 runs are stored in `<git common dir>/airi-qa-cache`, whether they pass or fail. A rerun whose inputs match a stored entry is replayed: it prints `CACHED from <run id>`, copies the stored files, sets `cache: { hit: true, sourceRunId, entryId }` in `run.json`, starts no Vitest process, and takes no CPU lease. A measured hit ran in 0.3 s (2.7 s with pnpm and tsx startup). The matching miss ran Vitest for about 12.9 s.

The key covers the arguments, the environment variables with the prefixes `QA_`, `VITE_`, and `VITEST_` plus `NODE_OPTIONS`, `NODE_ENV`, and `TZ` (`QA_RUN_DIR` is excluded), the gate file hash, the install inputs (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `patches/`), and the runtime identity (Node, platform, architecture, and the Vitest version and hash).

A hit requires every recorded file to exist with identical bytes, including line endings. The recorded closure is the repository files reached through the Vitest config's module graph, plus the `extends` chains of the tsconfig files. A corrupt entry counts as a miss. If the key cannot be built, the run prints `QA cache disabled for this run: <reason>` and runs normally.

Limits:

- `--fresh` skips the lookup, and the run is still stored.
- A cached run is never T3 acceptance evidence. `gate emotion --level t3 --t1-report <cached run>` refuses it before any lease is taken.
- An environment variable outside the filtered prefixes does not enter the key, so changing it can return a stale hit. The same applies to a relative import written with a `.js` suffix for a `.ts` file: that form was measured as a stale hit. The repository config chain does not use either form today.

Worker count: `gate --workers` defaults to the CPU slot grant and is clamped to it. See the cpu-slots README for the classes.

## Review report

`pnpm qa:report <runDir> [<runDir>...] [--out <file>]` writes one self-contained HTML page, `<firstRunDir>/report.html`, from any mix of run directories: gate runs (`report.json`), T3 runs (`scenario.json`, `screenshots.json`, `screenshots/`) and `qa:test` runs (`summary.json`). Rerunning overwrites the file.

The report is a review aid. It does not change a gate verdict or make a naturalness claim.

- Header: run ids, levels, rig, git SHA with the dirty flag, and gate id, version and `fileSha`, from `run.json` and `report.json`.
- The limitations statement from `src/report/limitations.ts` (`reportLimitations`), verbatim, near the top and in the footer.
- Verdicts: one row per emotion x band with its failed checks named; per-channel numbers (`E`, CI, expected, size ratio, `d`, hit rate, Holm p, tau, transfer ratio when a result carries `transferRatio`) in a `<details>` block. Liveliness reports show their metrics against the reference bands.
- Per-cell trajectories: an inline SVG per cell with the gate's windows (`emotionGate.windows`, `release`), the null q90 band, the paired mean trajectory of `report.json` (schema 2: `trajectory`, direction-folded like `E`) with its bootstrap band, the paired mean effect with its CI over the scored window, the late-window mean with its CI and the folded expected effect. Every panel's y axis is in the units of its `E` (named in the gutter), and a mark is drawn only in those units (`src/report/panel-units.ts` holds the audit table): eyelid panels therefore show no late-window mean, late CI or held-only release grid, which the scorer computes from lid ratios minus one. When the run dir still holds `partials/`, the release grids are drawn on face and posture panels, folded the same way. A schema-1 report draws the window statistics only, and the page says so.
- A cell's verdict counts only gated checks. Rows a gate reports without judging (`gated: false`: T3 posture, a channel the rig lacks) show the verdict `not gated` with their reason and never fail the cell.
- T3 runs: a contact sheet of the screenshots grouped by the scenario event that precedes them, with the offset after the pulse. A T3 session that failed before it wrote a trace or a screenshot index is shown as `session not captured` with its own failure summary, not as missing inputs. ForBOOTH runs carry a note that the default watermark expression covers most of the face.
- "For your visual check": every failing cell, every result row the page could not read, and passing cells with a size ratio above 1.3 or a face or eyelid parameter whose mean scored-window peak (`levels`, raw units) lies within 5% of the rig's `min` or `max`. The list points at cells; it never claims the motion looks natural.
- Known failures: the suite counts, new, known, fixed and flaky-passed lists of a `qa:test` run.
- Inputs: every directory with what it was used as and every missing or unreadable file, including result rows of `report.json` that do not have the emotion-check shape (they are named above the verdict table, never dropped). A directory without `report.json` still renders, with the missing inputs named instead of an empty table.
- No `src="http`, `href="http` or `url(http`: images are base64 PNG, plots are inline SVG, fonts are the system stack.
- Exit codes: 0 written, 1 written but an input was missing or unreadable (a file or a result row; the page names it), 2 usage error.
- Tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/report`.

## Scorer validation

`pnpm qa:motion validate-scorer --level t1 [--sections aa,zero,mutations,unmutated,determinism] [--seeds N] [--workers N] [--timeout-minutes N]` checks the emotion scorer itself with the committed emotion gate (`src/motion/validation/`, `gates/validation.gate.ts`).

- `aa`: 20 seed sets of emotion-free runs, scored unpaired as every emotion and band against the committed placebo null. At most 1 set may pass any significance or visibility check, the placebo hit rate must be 0.10 +- 0.03, and the p-values must be uniform (Kolmogorov-Smirnov p > 0.01, `src/motion/ks.ts`). The old checkpoint-12 single-trial rules are scored on the same trials for comparison.
- `zero`: an all-zero emotion table, scored paired, must pass nothing.
- `mutations`: x0, sign flip, `ignore-side`, `ignore-side-neg`, x0.5, x2, `releaseTau` x3 and blink interval 1, each applied through the `emotionTable` seam or scenario `settings.performance`. K1 scores x0 using detection or held-only size, with a 0.99 minimum. K2 proves per-cell equality for both constant-side variants, excludes `notMutable` checks, and applies the 0.95 minimum to their pooled mutable checks. K3 uses paired held-only size calibration for x0.5, with a 0.90 minimum on clear and strong checks; slight checks and the gate-verdict size kill rate are reported only.
- `unmutated`: 5 reseeded full gate runs. A check failing in at least 4 of 5 sets is a persistent finding and fails the section. Other failures are compared with the 0.99 quantile of Binomial(`noiseTrials`, 0.01); `n/a` results are reported separately and do not count.
- `determinism`: two independent runs give identical scores, and shuffled events or records change nothing.
- The CLI runs one Vitest process per shard and phase (simulate, then score) and writes `validation.json` (every number, threshold and verdict, with no run id or time) and `summary.txt`. Exit codes: 0 every threshold met, 1 a threshold missed or the run broke, 2 a usage error. A missed threshold is a finding for Luke; never change a gate constant to meet it.

## When to use

Use this package when motion or the desktop stage needs a gate verdict, an agent needs to run a rendered scenario, a test run must distinguish new failures from the baseline, or QA evidence needs a portable report and durable archive.

## When not to use

Do not use this package from product code or for ordinary development commands. It does not replace unit tests, manual visual review, or Luke's naturalness judgment.
