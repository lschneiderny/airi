# linux-sensor-parity - Work Plan

> Status 2026-11-17: superseded in part. Only KDE Wayland is checked on Linux; sway, X11, and Hyprland are planned, not checked, and the classic window fallback is scheduled for removal. Current rules: [Linux desktop bridge ADR](../../docs/ai/adr/2026-11-09-linux-desktop-bridge.md), [README Platform support](../../README.md#platform-support), [character mind roadmap](../../docs/ai/context/character-mind-roadmap.md). Its body is frozen history.

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** You and anyone running the desktop app on Linux. On KDE she will know which app you are using and whether you are busy, follow your cursor anywhere on screen, stay on top, treat a locked screen as away, hear your push-to-talk key release, and can run as the full-screen desktop character without ever blocking clicks on your desktop. X11, sway and Hyprland get everything they can prove, and GNOME says plainly what it cannot do.

**What you'll get:** One Linux helper inside the app that talks to the desktop, a newer Electron, push-to-talk through the desktop's own shortcut service, the desktop character on Linux, checks that prove each signal on a test desktop that never touches yours, and an honest per-platform support statement in the README.

**Why this approach:** A small script inside KDE's window manager already proved on your machine that it can report the focused window, cursor and window positions, so one helper built on it closes most gaps at once. Every signal is switched on only after the running desktop proves it, which keeps the app from acting on readings it cannot trust.

**What it will NOT do:** Ship a GNOME extension; use typing or window focus as a stand-in for missing signals; touch your own desktop session during testing, or run the Windows and macOS checks (those are left for you).

**Effort:** XL
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - the Electron update and the new shared coordinate source touch every window, and the desktop character must never trap clicks.
**Decisions to sanity-check:** Click-through on Linux shows as "limited (emulated)" rather than "live"; screen lock counts as live once the subscription works; X11 push-to-talk keeps the current key hook; you install sway, Xvfb, openbox and xdotool before the later tests; Hyprland is checked only against recorded samples; a development build writes one desktop entry file so the shortcut service recognizes the app.

Your next move: read the review result below, then start execution when ready. Full execution detail follows below.

---

> TL;DR (machine): XL, medium risk; 20 todos in 4 waves plus F1-F4: Linux desktop bridge (KWin, X11 EWMH, sway, Hyprland, GNOME/none), runtime-verified host facts, Electron 43.8.7, portal push-to-talk, Linux desktop stage with emulated click-through, system-audio verification, qa:display/qa:host extensions, honest support docs.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected users:**
- **U1, Linux desktop user.** Luke runs Fedora 45 with KDE Plasma 6.8.2 on Wayland; others run Kubuntu, SteamOS or Bazzite KDE, X11 window managers, sway, Hyprland or GNOME. Today on Linux she does not know the foreground app, her gaze ignores the cursor outside her window on Wayland, push-to-talk key-up fails on Wayland, the desktop stage is off, always-on-top does nothing on Wayland, and lock is degraded. Afterwards, every signal the running desktop can prove behaves as it does on Windows.
- **U2, Windows and macOS users.** They run the same app after the shared-contract change and the Electron bump, and must see no regression.
- **U3, agents and developers.** They consume the host capability contract, Settings > System > Presence sensing, `pnpm qa:host smoke`, `pnpm qa:display`, and the host parity ADR.
- **U4, README readers.** They decide from the README whether their platform is supported.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | On KDE Plasma 6 (native Wayland and XWayland), foreground awareness matches Windows: focused app, title, pid, own-process flag and busy state (fullscreen, do-not-disturb, game), under the existing sharing, denylist, freshness and 120-character rules | Chat pillar: she knows what he is doing |
| IS-2 | On KDE native Wayland and XWayland, the global cursor feeds gaze and attention the same as on Windows, including outside her window | Motion pillar |
| IS-3 | On KDE native Wayland, window and display origins are trusted after verification, so placement and caption/widget persistence work, and always-on-top holds | Parity for placement and the stage |
| IS-4 | Screen lock feeds away detection on every Linux session with a live status | Away-behavior parity |
| IS-5 | Push-to-talk delivers key-down and key-up on Wayland and XWayland through the GlobalShortcuts portal, and X11 keeps the proven uiohook path | Voice-chat parity |
| IS-6 | The Experimental 3D desktop stage runs on KDE Wayland and on X11, and its click-through never traps the desktop: an unverified state fails to ignoring and falls back to the classic window | Motion pillar: the desktop stage |
| IS-7 | System-audio capture on Linux is proven live, or stays degraded with a precise reason the user can read | Watching-mode parity |
| IS-8 | Any EWMH X11 session gets foreground window, busy and lock, alongside its existing cursor and origin | Other Linux machines |
| IS-9 | sway and Hyprland report every signal their IPC can prove; GNOME and other compositors report each unprovable signal as unavailable with a stable reason | Other Linux machines, honesty |
| IS-10 | A signal turns live only after the running host proves it. A failure falls back to today's status with a stable reason, nothing stale or fabricated reaches consumers, and Presence sensing names the bridge backend and each pending verification | Contract rule of the 2026-11-08 ADR |
| IS-11 | Windows and macOS behavior is unchanged, including after the Electron bump | No regression for U2 |
| IS-12 | The KWin bridge adds no noticeable compositor load: pushes are coalesced, cursor pushes run only while a cursor loop runs, the script unloads on quit, and a stale script left by a crash is cleared on start | Luke's own desktop health |
| IS-13 | The host parity ADR matrix, the app README and the root README state per-platform support honestly, and every new reason has an English label | The "do not advertise without sensors" thesis |
| IS-14 | Every Linux backend this machine can host is proven by agent-run QA inside `pnpm qa:display` sessions (KWin, Xvfb with openbox, headless sway), with per-backend `qa:host smoke` expectations, without touching the user's desktop | Verification parity |
| GAP-1 | `foregroundWindow` is unavailable on all Linux hosts: `foreground-window.ts:52-58` has no Linux sampler | No binding exists |
| GAP-2 | `cursorScreenPoint` is unavailable on Wayland and XWayland: the resolver's Linux branch hard-codes it, and `screen.ts:23-27` reads only Electron | Wayland hides the global pointer from clients |
| GAP-3 | On native Wayland, `windowOrigin` and `alwaysOnTop` are unavailable and `displayOrigins` is degraded | No client-side origin or z-order on Wayland |
| GAP-4 | `screenLock` is degraded on Linux: `powerMonitor.ts:16-17` listens to Electron `lock-screen`, which Electron emits only on Windows and macOS | No Linux lock source |
| GAP-5 | `globalKeyUp` is unavailable on Wayland and XWayland: `receiveKeyUps` bindings route to uiohook (`global-shortcut.ts:176-178`), which is X11-only | No portal driver |
| GAP-6 | `selectHostMode` forces the classic window on Linux (`mode.ts:33-39`), `clickThroughForward` is unavailable, and Electron 43.4.1 lacks the Wayland ignore toggle and undoes the X11 one on resize (electron#52456) | No toggle, cursor or origin |
| GAP-7 | `systemAudioCapture` is degraded as unverified on Linux, although the `PulseaudioLoopbackForScreenShare` flag and the `loopback` audio request are already wired (`packages/electron-screen-capture/src/main/index.ts:31-33,238-247`) | Never verified live |
| GAP-8 | X11 has cursor, origin and idle but no foreground window, busy state or lock | No EWMH binding |
| GAP-9 | sway, Hyprland and GNOME get the generic Wayland statuses with no backend and no desktop-specific reason | No backends |
| GAP-10 | Facts are static except `waylandIdleVerified`, and Presence sensing cannot show which backend runs or what is still being verified | The contract has one runtime fact |
| GAP-11 | No regression gate covers Windows and macOS after an Electron bump | Not needed until now |
| GAP-12 | No compositor-side code exists yet, so it has no lifecycle rules | New |
| GAP-13 | The ADR matrix, `apps/stage-tamagotchi/README.md:26,59` and the root README do not state Linux tiers | Docs follow code |
| GAP-14 | `qa:host smoke` knows only the static Linux profiles; `qa:display` offers only KWin, with no portals, X11 or sway session | QA follows the contract |

### Must have
- One Linux desktop bridge in the Electron main process at `apps/stage-tamagotchi/src/main/services/linux-desktop/`. It has one backend per desktop: `kwin`, `x11-ewmh`, `sway`, `hyprland`, plus `gnome` and `none`, which only report reasons. It feeds runtime-verified `HostFacts` through the existing `report*` and `updateSnapshot` path in `apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts:73-102` and reuses the existing Eventa channels. The only new Eventa contracts are the `reportPointerSample` and `reportSystemAudioHeard` invokes added in todo 7.
- Every new status turns live only from evidence observed in the running process. No fact is persisted, and every probe has a failure path back to today's status, with a stable reason.
- D-Bus goes through `dbus-native` (decision D4), wrapped in a promise transport that is the only file importing it.
- Electron moves from `^43.4.1` to `^43.8.7` in the `pnpm-workspace.yaml` catalog (decision D3).
- Push-to-talk uses the GlobalShortcuts portal on Wayland and XWayland, and uiohook stays on X11 (default A4).
- The desktop stage on Linux reports `clickThroughForward` as `degraded(linux-click-through-emulated)`, and an unverified stage fails to ignoring (default A2).
- English i18n labels for every new reason, in `packages/i18n/src/locales/en/tamagotchi/settings.yaml` under `presence-sensing.reasons`.
- Docs ship in the commit that changes the code they describe (root `AGENTS.md`, Conventions). The final docs todo updates the ADR matrix and both READMEs.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No GNOME Shell extension, no Plasma 5 live QA (the script feature-detects; default A5), and no Hyprland install from COPR.
- Never report a signal live from a static platform check. Never detect Wayland or Linux in a consumer to answer a capability question; read `useHostCapabilitiesStore` or the main host capability service (`apps/stage-tamagotchi/AGENTS.md`, Anti-patterns).
- No stand-in signals: focus, typing or voice activity never stand in for foreground, cursor or idle (2026-11-08 ADR, Decision).
- The KWin script never enumerates windows beyond the active window and AIRI's own windows, and never writes any property of a window that is not AIRI's own.
- No title persistence or logging. Titles follow the presence rules in `docs/ai/adr/2026-10-19-situational-presence.md:89-118,197-203`.
- Nothing touches Luke's desktop session. Live QA runs only through `pnpm qa:display` sessions with temp profiles (`APP_USER_DATA_PATH`) and a temp `XDG_DATA_HOME` (decision D5). Never lock Luke's real session to test lock events.
- No edits to non-English locale files.
- No tuning of motion constants or gate bands.
- Windows and macOS live smoke is not run by agents. The PR body lists it for Luke (decision D3).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for pure parts (decision D6) with Vitest: desktop detection, resolver facts, the verification state machines, sample mapping, the KWin message parser, preferred-trigger conversion and IPC reply parsers. Tests come after for D-Bus and compositor glue, run against a private `dbus-daemon --session` started by the test. Agent-executed live QA runs in `pnpm qa:display` sessions for every behavioral todo.
- Test commands: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node <path>` for main-process tests (`apps/stage-tamagotchi/vitest.config.ts:50-86`), `pnpm exec vitest run --project stage-shared <path>` for the contract, and `pnpm exec vitest run --project dev-tools <path>` for `scripts/dev-tools`.
- Gate per todo: `pnpm verify` must exit 0 before each commit. Executors block on it until it exits; never end a turn while verify runs (standing agreement). App-executed changes also need `pnpm qa:display run -- pnpm qa:smoke` per the root `AGENTS.md` done-definition, with `--model <path>` when the stage or model loading changes.
- Precondition, Luke's one human step (decision D2): `sudo dnf install sway xorg-x11-server-Xvfb openbox xdotool` before wave 3 QA. An executor that finds a binary missing records `BLOCKED: <binary> not installed` in the evidence, closes that QA row as partial `[~]`, and continues.
- Evidence: `.omo/evidence/linux-sensor-parity/task-<N>-<slug>.<ext>`. Live runs also keep their `.temp/qa/<run>` directory, and the evidence file names it.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- Worktree: `pnpm wt new linux-sensor-parity --base origin/main --branch luke/feat/linux-sensor-parity`. Never branch from local `main`, which may carry unpushed commits. Every todo commits on this branch. Delivery is one PR against `lschneiderny/airi`, rebase-merged, with atomic commits.
- Wave 1 (foundations): 1 is the worktree plus the Electron bump. 2 contract, 3 transport and detection, 4 KWin backend, 5 session signals and 6 QA display extensions run in parallel after 1.
- Wave 2 (KDE parity): 7 bridge bootstrap and facts, then 8 foreground, 9 coordinates and verification, 10 keep-above, 11 portal push-to-talk and 12 system audio in parallel.
- Wave 3 (stage and other desktops): 13 stage click-through, 14 X11 EWMH, 15 sway, 16 Hyprland and 17 GNOME/none reasons, in parallel.
- Wave 4 (proof and docs): 18 host smoke profiles per backend, then 19 cross-session live regression, then 20 docs and the supported-platform statement.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | all | - |
| 2 | 1 | 7-20 | 3, 4, 5, 6 |
| 3 | 1 | 4, 5, 7, 11, 15, 16 | 2, 4 (stub), 5 (stub), 6 |
| 4 | 1, 3 (interface) | 7 | 2, 5, 6 |
| 5 | 1, 3 (interface) | 7 | 2, 4, 6 |
| 6 | 1 | 11, 12, 13, 14, 15, 18, 19 | 2, 3, 4, 5 |
| 7 | 2, 3, 4, 5 | 8, 9, 10, 11, 13, 14, 15, 16, 17 | - |
| 8 | 7 | 18, 19 | 9, 10, 11, 12 |
| 9 | 7 | 10, 13, 18 | 8, 11, 12 |
| 10 | 7, 9 (geometry) | 13 | 8, 11, 12 |
| 11 | 3, 6, 7 | 18, 19 | 8, 9, 10, 12 |
| 12 | 2, 6 | 19 | 8, 9, 10, 11 |
| 13 | 6, 9, 10, 14 (X11 half only) | 19 | 15, 16, 17 |
| 14 | 7, 9 (coordinate ownership) | 13 (X11 half), 18 | 15, 16, 17 |
| 15 | 7 | 18 | 13, 14, 16, 17 |
| 16 | 7 | 18 | 13, 14, 15, 17 |
| 17 | 7 | 18, 20 | 13, 14, 15, 16 |
| 18 | 8, 9, 11, 14, 15, 16, 17 | 19 | - |
| 19 | 12, 13, 18 | 20 | - |
| 20 | 19 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Create the worktree and bump Electron to 43.8.7 with a before/after Linux baseline
  Recommended task executor category: quick - mechanical setup, one catalog line, and scripted runs.
  What to do:
  1. From `/mnt/dev/projects/dtuber`, run `git fetch origin` and then `pnpm wt new linux-sensor-parity --base origin/main --branch luke/feat/linux-sensor-parity`, which runs `pnpm install` (`scripts/dev-tools/README.md:66-67`).
  2. Copy `apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3` and `apps/stage-web/public/assets/js/CubismSdkForWeb-5-r.3` from the main checkout. Without them, `pnpm qa:doctor` fails.
  3. Baseline before the bump. Run `pnpm qa:display run -- pnpm qa:smoke`, then `pnpm qa:display run -- pnpm qa:host smoke --expect-idle verified`. If idle does not verify in the virtual session, rerun the host smoke with `--expect-idle unverified`. Record which flag passed.
  4. Change the catalog line `electron: ^43.4.1` in `pnpm-workspace.yaml:323` to `electron: ^43.8.7`. Run `pnpm install` and confirm that `pnpm -F @proj-airi/stage-tamagotchi exec node -p "require('electron/package.json').version"` prints `43.8.7` or newer, with major version 43.
  5. Rerun both baseline commands with the same flags.
  6. Confirm the fixes this bump exists for. Run `gh pr view 54423 -R electron/electron --json mergedAt,baseRefName,title` and check that `baseRefName` is `43-x-y`, and that the Electron v43.7.6 release notes list it. Read the release notes from v43.4.2 through the installed version, and record every change that touches `setIgnoreMouseEvents`, `powerMonitor`, `globalShortcut`, `desktopCapturer` or `BrowserWindow` bounds. If #54423 is not in the installed version, record `BLOCKED: Wayland ignore toggle missing` and continue: todo 13 then closes its stage rows `[~]`.
  7. Windows and macOS proxy for IS-11 (live smoke there is Luke's, decision D3). Run `pnpm -F @proj-airi/stage-tamagotchi typecheck` against the new Electron types, plus `pnpm exec vitest run --project stage-shared packages/stage-shared/src/host-capabilities` and the node project tests that pin `capabilitiesForHost('windows')` or `capabilitiesForHost('macos')` (find them with `rg -l "capabilitiesForHost\('(windows|macos)'" apps packages`). Record the release-note review from step 6 as the rest of the proxy.
  Must NOT: branch from local `main`; change any other catalog entry; move to Electron 44 or later; touch the main checkout.
  Closes: GAP-6 (Electron part), GAP-11 (Linux half)
  Parallelization: Wave 1 | Blocked by: - | Blocks: all
  References: root `AGENTS.md` Source control workflow; `scripts/dev-tools/README.md` `pnpm qa:display` section; `packages/qa-tools/README.md:40-48` (`qa:host smoke` flags); electron PR #54423 (Wayland `setIgnoreMouseEvents`, released in v43.7.6); electron issue #52456 (X11 input shape undone on resize in 43.x); Electron v43.8.7 release, 2026-11-03.
  Acceptance criteria: `git -C ../dtuber-wt/linux-sensor-parity diff origin/main --stat` lists only `pnpm-workspace.yaml` and `pnpm-lock.yaml`; the version command prints 43.8.7 or newer; the post-bump `qa:smoke` and `qa:host smoke` exit 0 with the same flags as the baseline; `pnpm verify` exits 0.
  QA scenarios: happy - the post-bump `pnpm qa:display run -- pnpm qa:smoke` exits 0 and its run directory has an empty `errors.json`. Failure - if the post-bump host smoke reports a `signal-mismatch` that the baseline did not, stop and report `BLOCKED: Electron bump changed <signal>` with both reports. Evidence: `.omo/evidence/linux-sensor-parity/task-1-baseline.md`, listing both runs' `.temp/qa` directories.
  Commit: Y | `build: bump Electron to 43.8.7 for the Linux click-through fixes`

- [x] 2. Extend the host capability contract with runtime-verified Linux desktop facts (TDD)
  Recommended task executor category: deep-low - a pure resolver change driven by a fixed table, plus schema and label updates.
  What to do: in `packages/stage-shared/src/host-capabilities/index.ts`:
  - Add `LINUX_DESKTOP_BACKENDS = ['kwin', 'x11-ewmh', 'sway', 'hyprland', 'gnome', 'none'] as const` and a derived `LinuxDesktopBackend` type.
  - Add `LinuxDesktopFacts`: `{ backend: LinuxDesktopBackend, bridge: 'starting' | 'ready' | 'failed', foregroundVerified: boolean, cursorVerified: boolean, geometryVerified: boolean, keepAboveVerified: boolean, lockSource: 'logind' | 'screensaver' | null, portalShortcuts: 'absent' | 'session' | 'bound', bridgeFailure: 'api-unsupported' | 'other' | null, clickThroughToggle: boolean, systemAudioVerified: boolean }`.
  - Add a field `linuxDesktop: LinuxDesktopFacts | null` to `HostFacts`, null off Linux.
  - Add a field `linuxDesktopBackend: LinuxDesktopBackend | null` to `HostCapabilities`, for diagnostics. `capabilitiesForHost(host)` without facts returns `null` there, so every existing test that deep-equals a profile (for example `apps/stage-tamagotchi/src/main/tray/index.test.ts:57` and `apps/stage-tamagotchi/src/main/windows/caption/index.test.ts`; enumerate with `rg -l capabilitiesForHost apps packages`) keeps passing unchanged.
  - Required resolver cases besides one per rule above: (a) `linux-xwayland` + `kwin` + `ready` + `cursorVerified` + `clickThroughToggle` gives `clickThroughForward: degraded(linux-click-through-emulated)` (origin is live through Electron there); (b) `portalShortcuts` `session` then `bound` then `session` gives unavailable, live, unavailable for `globalKeyUp`.
  - When `bridge` is `failed` and `bridgeFailure` is `api-unsupported`, use the reason `kwin-api-unsupported` instead of `linux-bridge-failed` (Plasma versions whose script API is neither the Plasma 6 nor the Plasma 5 shape).
  - Add these reasons to `HostReasons`, keeping every existing one: `linux-bridge-starting`, `linux-bridge-failed`, `linux-foreground-verifying`, `linux-cursor-verifying`, `linux-geometry-verifying`, `linux-keep-above-verifying`, `linux-click-through-emulated`, `gnome-needs-extension`, `sway-cursor-unreported`, `linux-desktop-unsupported`, `kwin-api-unsupported`, `linux-portal-shortcut-unbound`.
  Resolution rules. These apply on Linux only, layered over today's static session rules, and the tests pin each row:
  - `screenLock`: `live` when `lockSource !== null`, else today's `degraded(linux-lock-events-undocumented)`.
  - `systemAudioCapture`: `live` when `systemAudioVerified`, else today's degraded reason.
  - `globalKeyUp` on Wayland and XWayland: `live` when `portalShortcuts` is `bound` (todo 11: at least one key-up shortcut is bound right now), `unavailable(linux-portal-shortcut-unbound)` when it is `session` (a portal session exists but no key-up shortcut is bound, for example after the user denied the bind), else today's `unavailable(wayland-no-global-input-hook)`.
  - When `bridge` is `starting`: every signal that this backend can make live is `unavailable(linux-bridge-starting)`.
  - When `bridge` is `failed`: `foregroundWindow` is `unavailable(linux-bridge-failed)`, and the other signals keep today's statuses.
  - When `bridge` is `ready`, per backend:
    - `kwin`: `foregroundWindow` is live when `foregroundVerified`, else `unavailable(linux-foreground-verifying)`. On Wayland and XWayland, `cursorScreenPoint` is live when `cursorVerified`, else `unavailable(linux-cursor-verifying)`. On native Wayland:
      - `windowOrigin` is live when `geometryVerified`, else `unavailable(linux-geometry-verifying)`.
      - `displayOrigins` is live when `geometryVerified`, else today's degraded status.
      - `alwaysOnTop` is live when `keepAboveVerified`, else `unavailable(linux-keep-above-verifying)`.
    - `x11-ewmh` (X11 sessions only): `foregroundWindow` follows the same rule as kwin; everything else keeps today's rules.
    - `sway`: `foregroundWindow` as kwin; `cursorScreenPoint` is `unavailable(sway-cursor-unreported)`; `windowOrigin` and `displayOrigins` follow the kwin geometry rule; `alwaysOnTop` keeps `unavailable(wayland-no-z-order)`.
    - `hyprland`: `foregroundWindow` and `cursorScreenPoint` follow the kwin rules; origins follow the geometry rule; `alwaysOnTop` keeps `wayland-no-z-order`.
    - `gnome`: `foregroundWindow`, `cursorScreenPoint` and, on native Wayland, `windowOrigin` are `unavailable(gnome-needs-extension)`.
    - `none`: `foregroundWindow` is `unavailable(linux-desktop-unsupported)`, and the rest keep today's statuses.
  - `clickThroughForward` on Linux: `degraded(linux-click-through-emulated)` when `clickThroughToggle` is set and `cursorScreenPoint` and `windowOrigin` both resolve live. Otherwise today's `unavailable(linux-no-click-through-forward)`.
  - The `linux-xwayland` idle rule and the native Wayland idle verifier stay unchanged.
  Other changes:
  - Extend `capabilitiesForHost(host, linuxDesktop?: LinuxDesktopFacts)` so that Linux profiles accept the facts. The default stays today's `none`-equivalent.
  - Add every `*-verifying` reason and `linux-bridge-starting` and `linux-portal-shortcut-unbound` (a user without a push-to-talk binding has nothing to be warned about) to the transient set that `presenceLimitations` ignores, next to `wayland-idle-unverified` (`index.ts:206-213`).
  - Update the strict Valibot host schema in `packages/stage-shared/src/motion-scenario/bridge.ts:35-45` and every other schema that validates `HostCapabilities` (find them with `rg -n "hostReason|HostCapabilities" packages apps --type ts`), so that the new field and reasons validate.
  - Add English labels for every new reason in `packages/i18n/src/locales/en/tamagotchi/settings.yaml:94-109`, plus `presence-sensing.backend` and one label per backend.
  - Amend `docs/ai/adr/2026-11-08-host-capability-contract.md` Follow-ups. Compositor-provided sensors that ship inside the compositor or its IPC (KWin scripting, sway IPC, Hyprland IPC) qualify. Shell extensions the user must install (GNOME) do not.
  Must NOT: rename or remove an existing reason or signal; change any Windows or macOS row; add a new `SignalStatus` kind.
  Closes: GAP-10 (contract), contract parts of GAP-1/2/3/4/5/6/7/8/9
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 7-20
  References: `packages/stage-shared/src/host-capabilities/index.ts:1-215` (current resolver, `idleAdvances`, `presenceLimitations`); `index.test.ts:34-92` (host profile table); `packages/stage-shared/AGENTS.md` (pure deciders, no sampling); `packages/i18n/AGENTS.md`; draft decisions D1-D6 and defaults A1-A7 in `.omo/drafts/linux-sensor-parity.md`.
  Acceptance criteria: `pnpm exec vitest run --project stage-shared packages/stage-shared/src/host-capabilities` passes, with one test case per bullet in the resolution rules, written before the implementation. `capabilitiesForHost('windows')` and `capabilitiesForHost('macos')` deep-equal their pre-change values; a test captures those values first. `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm verify` exit 0.
  QA scenarios: happy - the vitest run prints every new case passing. Failure (mutation check) - temporarily make `kwin` + `ready` + `foregroundVerified: false` resolve live, confirm that its test fails, then restore. Record both outputs in `.omo/evidence/linux-sensor-parity/task-2-contract.txt`.
  Commit: Y | `feat(stage-shared): add runtime-verified Linux desktop facts to the host capability contract`

- [x] 3. Add the dbus-native transport and Linux desktop detection
  Recommended task executor category: deep-low - a new boundary module with a fixed interface and real-bus tests.
  What to do:
  - First, fail fast on the dependency claim: `npm view dbus-native version time.modified` must print 0.16.3 or newer, modified in 2026. If it does not, use `@homebridge/dbus-native` behind the same transport (only `transport.ts` changes) and record the swap. If neither can export an interface on a custom bus address, stop with `BLOCKED: no D-Bus library can export` for Luke.
  - Add `dbus-native: ^0.16.3` to the `pnpm-workspace.yaml` catalog, and `"dbus-native": "catalog:"` to `apps/stage-tamagotchi/package.json` `dependencies`, next to `koffi` at line 122. Confirm that the packaged app ships it, using the same check that proves `koffi` ships (electron-builder `files` and electron-vite externals in `apps/stage-tamagotchi/electron.vite.config.ts`).
  - Create `apps/stage-tamagotchi/src/main/services/linux-desktop/dbus/transport.ts`, the only file allowed to import `dbus-native`. It exports `class DbusTransport` with these members:
    - `static session(address?: string)` and `static system()`
    - `call<T>(msg: { destination, path, interface, member, signature?, body? }): Promise<T>`
    - `getProperty<T>(destination, path, iface, name): Promise<T>`
    - `onSignal(match: { sender?, path?, interface, member }, cb): () => void`, which adds and removes the match rule
    - `exportObject(path, iface: { name, methods: Record<string, { signature, handler }> }, opts: { allowedSender: () => string | null }): () => void`. A call from any other sender gets the D-Bus error `org.freedesktop.DBus.Error.AccessDenied`.
    - `requestName(name): Promise<boolean>`, `getNameOwner(name): Promise<string | null>`, `onNameOwnerChanged(name, cb)`, and `close()`
  - Create `linux-desktop/detect.ts` (TDD). Its pure function is `detectLinuxDesktop(env): { session: 'x11' | 'wayland', candidate: LinuxDesktopBackend }`:
    - `HYPRLAND_INSTANCE_SIGNATURE` set gives `hyprland`.
    - `SWAYSOCK` set gives `sway`.
    - `XDG_CURRENT_DESKTOP` containing `KDE` gives `kwin`.
    (Compositor sockets are checked before desktop names because a socket proves which compositor this process talks to, while a desktop name can be inherited from a parent session.)
    - `XDG_CURRENT_DESKTOP` containing `GNOME` gives `gnome`.
    - Otherwise, an X11 session (`XDG_SESSION_TYPE=x11`, or `DISPLAY` set without `WAYLAND_DISPLAY`) gives `x11-ewmh`.
    - Anything else gives `none`.
    The bridge in todo 7 confirms the candidate at run time; for kwin, the `org.kde.KWin` name must have an owner.
  - Tests:
    - `detect.test.ts`: a table test with at least 10 environment rows, including qa:display's env from `scripts/dev-tools/qa-display-plan.test.ts:72-91`.
    - `transport.test.ts`: starts a private bus with `dbus-daemon --session --nofork --print-address=1`, opens two connections, then checks four behaviors: an exported method answers an allowed sender, rejects another sender with AccessDenied, delivers a signal to `onSignal`, and fires `onNameOwnerChanged` when the second connection closes. The test kills the daemon in `afterAll`.
  Must NOT: import `dbus-native` outside `transport.ts`; spawn `busctl` or `qdbus` from product code; import `electron` in `linux-desktop/` outside `index.ts` (backends stay testable under plain Node).
  Closes: GAP-12 (transport), prerequisite for GAP-1/2/3/4/5/8/9
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4, 5, 7, 11, 15, 16
  References: `dbus-native` docs at https://github.com/sidorares/dbus-native/blob/293dc0081bf56851f07c59acba368e6e609dd3c7/docs/api.md (`exportInterface`, `export`) and `index.d.ts`; root `AGENTS.md` Dependencies (decision D4 records the choice and the comparison table in the draft); `apps/stage-tamagotchi/AGENTS.md`; `injeca` boundary rule in root `AGENTS.md` Conventions.
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/detect.test.ts src/main/services/linux-desktop/dbus/transport.test.ts` passes; `rg -l "from 'dbus-native'" apps packages` prints only `transport.ts`; `pnpm verify` exits 0.
  QA scenarios: happy - the vitest command above, whose output shows the AccessDenied case passing. Failure - point `DbusTransport.session('unix:path=/nonexistent')` at a missing socket and assert that it rejects within 2 s with an error that names the address. Evidence: `.omo/evidence/linux-sensor-parity/task-3-transport.txt`.
  Commit: Y | `feat(stage-tamagotchi): add a D-Bus transport and Linux desktop detection`

- [x] 4. Build the KWin script backend with a coalesced push protocol and a probe CLI
  Recommended task executor category: deep-high - new compositor-side code, with lifecycle and backpressure decisions that only live runs can prove.
  What to do:
  - Create `apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/`:
    - `bridge-script.js`, imported with `?raw`. It feature-detects the API level: `workspace.activeWindow` and `windowActivated` mean `plasma6`; `workspace.activeClient` and `clientActivated` mean `plasma5`. It reports through `callDBus('ai.moeru.airi.LinuxDesktop', '/bridge', 'ai.moeru.airi.LinuxDesktop1', <Method>, <json>)`:
      - `Hello` with `{ api }` once at load.
      - `Active` with `{ caption, resourceClass, desktopFileName, pid, fullScreen }`, or `null`, on activation and on the active window's `captionChanged` and `fullScreenChanged`.
      - `OwnWindows`, an array of `{ id: internalId, pid, x, y, width, height, keepAbove, outputScale }`, for windows whose `pid` is in the list the app returns from `OwnPids` (a `callDBus` reply callback, re-requested on `windowAdded`), on `frameGeometryChanged` and `keepAboveChanged`. It uses `clientGeometry` when the property exists, else `frameGeometry`.
    - `cursor-script.js`, a separate script loaded only while any window runs a cursor loop. It sends the current `workspace.cursorPos` once at load, then `Cursor {x, y}` on `cursorPosChanged`, with at most one call in flight. It sends the next position only from the reply callback, and only when the position changed, so no final position is lost.
    - `protocol.ts` (TDD), pure parsers for every method's payload. It rejects malformed or oversized payloads (caption over 4096 characters, or more than 32 own windows).
    - `index.ts`, the `KwinBackend` class. On start, it unloads any stale `airi-desktop-bridge` and `airi-desktop-cursor` scripts (`isScriptLoaded`, then `unloadScript`), writes each script to `<tempDir>/airi-kwin/<name>.js`, then calls `loadScript(path, name)` and `/Scripting/Script<id>` `run`. If `Hello` does not arrive within 2 s, the bridge fails.
    - The backend exports `/bridge` with `allowedSender` set to the current owner of `org.kde.KWin`. It reloads both scripts on `NameOwnerChanged`. `setCursorStreaming(on)` loads or unloads `cursor-script.js`. `runOneShot(source)` runs a write-only actuator script (load, run, unload), used by todo 10. `stop()` unloads everything.
  - Instance naming and crash safety (these names replace the literal names used above). The exported bus name is `ai.moeru.airi.LinuxDesktop.p<pid>` and the plugin names are `airi-desktop-bridge-<pid>` and `airi-desktop-cursor-<pid>`; the backend templates the bus name into each script before writing it. Every script file lives under `<tempDir>/airi-kwin/`, which doubles as the manifest: on start, for each file there whose pid is not a live process, call `unloadScript` with its plugin name and delete the file. Because every push waits for its reply (one call in flight), a script whose AIRI died stops sending after one failed call, so it never loops in the compositor. Two AIRI instances in two QA sessions therefore never share a name. The `Hello` payload is `{ api: 'plasma6' | 'plasma5' | 'unsupported' }`; `unsupported` fails the bridge with `bridgeFailure: 'api-unsupported'`. `cursorPosChanged` is a KWin signal (`workspace_wrapper.cpp`), so no timer runs inside the compositor.
  - Create the probe CLI `scripts/dev-tools/kwin-probe.ts` and the root script `"qa:kwin-probe": "tsx scripts/dev-tools/kwin-probe.ts"`. It connects to the session bus, starts `KwinBackend` with a temp dir, prints one JSON line per message for `--seconds N` (default 10) with captions redacted to their length, then stops and verifies that `isScriptLoaded` is false for both scripts.
  Must NOT:
  - Read or send any window other than the active window and AIRI's own.
  - Write a property from `bridge-script.js` or `cursor-script.js`; only one-shot actuator scripts write.
  - Leave a script loaded after `stop()` or after a crash recovery.
  - Poll KWin on a timer.
  Closes: GAP-12, KWin parts of GAP-1/2/3
  Parallelization: Wave 1 | Blocked by: 1, 3 (interface; code against a fake until 3 lands) | Blocks: 7
  References:
  - KWin scripting API: https://develop.kde.org/docs/plasma/kwin/api/ (`workspace.activeWindow`, `cursorPos`, `cursorPosChanged`, `Window.keepAbove`, `frameGeometry`, `clientGeometry`); `loadScript` and `unloadScript` in https://github.com/KDE/kwin/blob/61e5af0260948a8fa63bc6a1c5933c902bde12ee/src/scripting/scripting.h; rename commit b39ca36 (activeClient to activeWindow).
  - Live probe from 2026-11-09 on Plasma 6.8.2: `loadScript` then `Script<id>.run` delivered `caption`, `resourceClass`, `desktopFileName`, `pid`, `fullScreen`, `keepAbove`, `frameGeometry` and `cursorPos` through `callDBus`; `print()` does not reach the user journal (draft Findings).
  - QA pointer injection through EIS: `packages/qa-tools/src/t3/cursor.ts` and `scripts/dev-tools/README.md` (QA display EIS paragraph).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/backends/kwin` passes, covering the protocol parsers (written first) and the lifecycle against a fake transport: stale unload, the 2 s `Hello` timeout, reload on owner change, and `stop` unloading both scripts.
  - Two probes in two QA sessions at once (`pnpm qa:display up --name lsp-a` and `--name lsp-b`), each with a pointer move injected only in its own session: each probe reports only its own session's cursor, and both end with `scripts-unloaded: true`.
  - A Plasma 5 fixture `Hello` (`api: 'plasma5'`) and an `unsupported` fixture parse; the second fails the backend with `api-unsupported`.
  - Inside `pnpm qa:display run -- pnpm qa:kwin-probe --seconds 15`, the output contains `Hello` with `api: "plasma6"`, at least one `Active` line, and a final `scripts-unloaded: true` line.
  - `pnpm verify` exits 0.
  QA scenarios:
  - Happy: start a KWin QA display; run `konsole` inside it with `pnpm qa:display run -- konsole &`; run the probe with cursor streaming on; move the pointer with the EIS helper from `packages/qa-tools/src/t3/cursor.ts`. Expect `Cursor` lines whose last position equals the final injected point.
  - Failure: run the probe with `DBUS_SESSION_BUS_ADDRESS` pointing at a private bus with no KWin. Expect exit code 1 and `bridge failed: org.kde.KWin has no owner`.
  - Evidence: `.omo/evidence/linux-sensor-parity/task-4-kwin-probe.txt`.
  Commit: Y | `feat(stage-tamagotchi): add a KWin script backend for Linux desktop signals`

- [x] 5. Add session lock and busy sources over D-Bus
  Recommended task executor category: deep-low - small D-Bus consumers with pure mapping and fake-service tests.
  What to do:
  - Create `linux-desktop/session/lock.ts` with class `LockSource` and `start(): Promise<'logind' | 'screensaver' | null>`.
    - logind first: on the system bus, call `org.freedesktop.login1.Manager.GetSessionByPID(process.pid)`, read `org.freedesktop.login1.Session.LockedHint` on that path, and subscribe to its `PropertiesChanged`.
    - Otherwise use `org.freedesktop.ScreenSaver` (`GetActive`, `ActiveChanged`) on the session bus.
    - Emit `onLock(locked: boolean)` only on transitions, deduplicated across both sources.
  - Create `linux-desktop/session/busy.ts` with class `BusySource`. It reads `org.freedesktop.Notifications.Inhibited` (subscribing to `PropertiesChanged` on `/org/freedesktop/Notifications`) and `com.feralinteractive.GameMode.ClientCount` (re-read on the `GameRegistered` and `GameUnregistered` signals). `hint()` returns `'busy'` when ClientCount > 0, else `'quiet'` when Inhibited, else `null`. A missing service counts as absent, never as an error.
  - Tests:
    - Pure mapping cases, written first.
    - Integration on a private `dbus-daemon`, with fake `org.freedesktop.ScreenSaver`, `Notifications` and `GameMode` services exported through `DbusTransport`. They flip the state and assert the emitted transitions.
    - The logind path tests against a fake `org.freedesktop.login1` on a private bus passed in as the system bus.
  Must NOT: call `Lock`, `SetIdleHint` or any other mutating logind method; lock the real session in any test or QA run.
  Closes: GAP-4 (source), the busy part of GAP-1/8
  Parallelization: Wave 1 | Blocked by: 1, 3 (interface) | Blocks: 7
  References: logind D-Bus API, https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html (`GetSessionByPID`, `LockedHint`); live check 2026-11-09: `loginctl show-session $XDG_SESSION_ID -p LockedHint` printed `LockedHint=no`; `org.freedesktop.ScreenSaver` exposes `GetActive` and `ActiveChanged` on Luke's KDE; `Notifications.Inhibited` read `false`; GameMode `ClientCount` read `0` (draft Findings); Win32 busy mapping `apps/stage-tamagotchi/src/main/services/electron/foreground-window-win32.ts:30-40`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/session` passes; `pnpm verify` exits 0.
  QA scenarios: happy - the integration test flips the fake ScreenSaver from false to true to false and asserts exactly two emitted transitions. Failure - with no logind or ScreenSaver service on either bus, `start()` resolves `null` without throwing. Evidence: `.omo/evidence/linux-sensor-parity/task-5-session.txt`.
  Commit: Y | `feat(stage-tamagotchi): read Linux screen lock and busy state over D-Bus`

- [x] 6. Extend `pnpm qa:display` with portals, an X11 session, and a headless sway session
  Recommended task executor category: unspecified-high - tooling across a planner module, its CLI and its docs, with live session checks.
  What to do: in `scripts/dev-tools/qa-display-plan.ts` and `qa-display.ts`:
  - Add `--compositor kwin|x11|sway` (default `kwin`).
  - Complete per-compositor client environment. `clientEnv` (`qa-display-plan.ts:181`) copies the host environment first, so each compositor defines both the keys it sets and the keys it deletes, and `run`/`env` apply both:
    | Compositor | Sets | Deletes |
    | --- | --- | --- |
    | `kwin` | `XDG_CURRENT_DESKTOP=KDE`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` | `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `XAUTHORITY` |
    | `x11` | `XDG_CURRENT_DESKTOP=Openbox`, `XDG_SESSION_TYPE=x11`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` | `WAYLAND_DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY` |
    | `sway` | `XDG_CURRENT_DESKTOP=sway`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `DBUS_SESSION_BUS_ADDRESS`, and `DISPLAY` only when sway started Xwayland | `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY`, and `DISPLAY` when sway has no Xwayland |
    Table tests start from an inherited KDE host environment (`XDG_CURRENT_DESKTOP=KDE`, `KDE_FULL_SESSION=true`, `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`, `XDG_SESSION_TYPE=wayland`) and assert the exact resulting environment per compositor. Todo 3's `detect.test.ts` copies those three resulting environments as rows and asserts `kwin`, `x11-ewmh` and `sway`.
  - Add `--portals` (kwin only). After KWin is ready, it starts `/usr/libexec/xdg-desktop-portal`, `/usr/libexec/xdg-desktop-portal-kde` and the KDE global accelerator daemon on the private bus. Locate the daemon with `rpm -ql kglobalacceld kf6-kglobalaccel 2>/dev/null` and record its path in the evidence.
  - `x11` runs `Xvfb :<n> -screen 0 <W>x<H>x24` and `openbox` with a private `dbus-daemon`. The env file holds `XDG_SESSION_TYPE=x11` and `DISPLAY=:<n>`, with no `WAYLAND_DISPLAY`.
  - `sway` runs `WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 sway -c <generated config>`, where the config sets the output size and nothing else. The env file holds `WAYLAND_DISPLAY`, `SWAYSOCK` and `XDG_SESSION_TYPE=wayland`.
  - A missing binary fails `up` with `qa-display: <binary> not installed (run: sudo dnf install <package>)`.
  - `--portals` also removes `--no-global-shortcuts` from the KWin arguments (`qa-display-plan.ts:135`), sets `XDG_CONFIG_HOME` to `<session dir>/config` for KWin and every service, and writes `<session dir>/config/kglobalshortcutsrc` with a `[ai.moeru.airi]` group holding the QA push-to-talk trigger, so that a bind may skip the KDE confirmation dialog. Record in the evidence whether the dialog still appears. Lock stays off (`--no-lockscreen` remains): lock QA uses a test-owned `org.freedesktop.ScreenSaver` on the private bus (todo 5), never kscreenlocker.
  - Make `parseSessionEnv` and `sessionKeys` (`qa-display-plan.ts:163-177`) compositor-aware: kwin requires `WAYLAND_DISPLAY` and `DISPLAY`; x11 requires `DISPLAY` and sets `XDG_SESSION_TYPE=x11`; sway requires `WAYLAND_DISPLAY` and `SWAYSOCK`. The hard-coded `XDG_SESSION_TYPE: 'wayland'` (`:177`) becomes the session's type. Update the module doc comment (`:4-5`).
  - `shot` stays KWin-only; on x11 and sway it exits 2 with `qa-display: shot needs a kwin session; use a CDP screenshot`. QA in those sessions captures through CDP `Page.captureScreenshot`.
  - Add `pnpm qa:display pointer <x> <y>`. It routes to the EIS helper on kwin, `xdotool mousemove` on x11, and `swaymsg seat - cursor set` on sway.
  - Extend `qa-display-plan.test.ts` with table cases for each compositor's unit arguments and env file, the `--portals` services, and the missing-binary message.
  - Update `scripts/dev-tools/README.md` (the `pnpm qa:display` section) and `packages/qa-tools/README.md` (pointer preflight), so that they name the new modes. The bullet saying the private bus has no portal or global-shortcut service must name `--portals` as the exception.
  Must NOT: change the default session's behavior apart from the added `XDG_CURRENT_DESKTOP`; start any service on Luke's real session bus; require root.
  Closes: GAP-14 (display part), and enables IS-14
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 11, 12, 13, 14, 15, 18, 19
  References: `scripts/dev-tools/qa-display-plan.ts:1-197` (unit arguments at :116-160; `clientEnv` at :162); `scripts/dev-tools/qa-display.ts:1-129`; `scripts/dev-tools/README.md:90-120`; installed binaries on 2026-11-09: `kwin_wayland`, `Xwayland`, `dbus-run-session` and `/usr/libexec/xdg-desktop-portal{,-kde}`. sway, Xvfb, openbox and xdotool are absent until the precondition in Verification strategy is met.
  Acceptance criteria: `pnpm exec vitest run --project dev-tools scripts/dev-tools/qa-display-plan.test.ts` passes. These three commands print the expected values:
  - `pnpm qa:display up --name lsp-portals --portals && pnpm qa:display run --name lsp-portals -- busctl --user get-property org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.GlobalShortcuts version` prints `u 2`.
  - `pnpm qa:display up --name lsp-x11 --compositor x11 && pnpm qa:display run --name lsp-x11 -- xdotool getmouselocation` prints a location.
  - `pnpm qa:display up --name lsp-sway --compositor sway && pnpm qa:display run --name lsp-sway -- swaymsg -t get_version` prints a version.
  - From Luke's KDE shell, `pnpm qa:display run --name <session> -- env` shows, for each of the three sessions, exactly the set and deleted keys of the environment table (no `XDG_CURRENT_DESKTOP=KDE` in the x11 or sway session).
  Each session is then stopped with `pnpm qa:display down --name <name>`, and `pnpm qa:display status` lists none of them. `pnpm verify` exits 0.
  QA scenarios: happy - the three commands above. Failure - with Xvfb missing (or simulated with `PATH` stripped of it), `up --compositor x11` exits non-zero with the install hint. If a package is really missing, record `BLOCKED: <binary> not installed` and close that compositor's checks as `[~]`. Evidence: `.omo/evidence/linux-sensor-parity/task-6-qa-display.txt`, including the `down` and `status` receipts.
  Commit: Y | `feat(dev-tools): add portal, X11 and sway sessions to qa:display`

- [x] 7. Start the Linux desktop bridge in main and feed its facts, lock and backend into host capabilities
  Recommended task executor category: deep-high - cross-module wiring, plus app lifecycle rules and an ADR.
  What to do:
  - Create `linux-desktop/index.ts` exporting `createLinuxDesktopBridge({ env, tempDir, sessionBus, systemBus })`, which resolves to a `LinuxDesktopBridge`. It is the only file in `linux-desktop/` that may import `electron`. Its interface:
    - `backend`
    - `start()` and `stop()`
    - `activeWindow()`, `ownWindows()` and `cursor()`, each returning the last pushed value or `null`
    - `onActive`, `onOwnWindows`, `onCursor` and `onLock`
    - `busyHint()`
    - `setCursorStreaming(on)`
    - `setKeepAbove(windowPid, on)`
  - The bridge picks the backend from `detectLinuxDesktop` and confirms it on the bus. It reports `bridge: 'starting'`, then `'ready'` or `'failed'`. Backends that land in later todos register through a `backends` map; until then, `x11-ewmh`, `sway` and `hyprland` resolve to `none`.
  - In `apps/stage-tamagotchi/src/main/index.ts`, provide the bridge with `injeca.provide('services:linux-desktop', ...)` only when `isLinux` (`index.ts:19,105`). Start it after app ready, before the first window, and stop it in `onAppBeforeQuit`.
  - In `apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts`:
    - Add `linuxDesktop` to `runtimeFacts` (`:19-24`) and initialize it in `getCurrentHostCapabilities` (`:31-53`). Set `clickThroughToggle` from `process.versions.electron`, true when the version is at least 43.7.6 on any Linux session (X11, XWayland or native Wayland; under XWayland the app is an X11 client, so the X11 input-shape fix from PR #54423 applies).
    - Add `reportLinuxDesktop(patch: Partial<LinuxDesktopFacts>)`, which calls `updateSnapshot()` (`:73-84`). `updateSnapshot` also emits when `linuxDesktopBackend` changes, not only when signals change.
  - Add two invokes to `packages/electron-eventa/src/electron/host-capabilities.ts`, exported from `packages/electron-eventa/src/electron/index.ts:10,22`: `reportPointerSample` with payload `{ clientX: number, clientY: number, atMs: number }`, and `reportSystemAudioHeard` with payload `{ level: number }`. Register their handlers in `createHostCapabilitiesService` (`host-capabilities.ts:117-131`) for the sender's window. They forward to `recordPointerSample(window, sample)` (logic lands in todo 9) and `recordSystemAudioHeard(level)` (logic lands in todo 12); until then, and always off Linux, they do nothing.
  - In `powerMonitor.ts`, on Linux with a bridge, subscribe `bridge.onLock` and emit the existing `electronEvents.powerMonitor.lockScreen` and `unlockScreen` events, keeping the Electron listeners for Windows and macOS. Report `lockSource` from `LockSource.start()`.
  - In `apps/stage-tamagotchi/src/renderer/pages/settings/system/presence-sensing.vue`, show `Backend: <label>` under the host line when `snapshot.linuxDesktopBackend` is set.
  - Write `docs/ai/adr/2026-11-09-linux-desktop-bridge.md`, covering:
    - backends and detection
    - the facts table, with the evidence that sets each fact
    - script lifecycle, coalescing, the sender check and KWin restarts
    - privacy: the active window and own windows only, with no title logging
    - the KWin script cost limits
    - why GNOME is excluded
  - Add a nested `apps/stage-tamagotchi/src/main/services/linux-desktop/AGENTS.md`, with an adjacent `CLAUDE.md` containing only `@AGENTS.md`, stating the import boundaries from todo 3 and the no-polling rule.
  - Keep `qa:host smoke` green between this todo and todo 18. In `packages/qa-tools/src/host/smoke.ts`, accept for every Linux host either the static expected status or, for signals the bridge owns, an `unavailable` status whose reason is `linux-bridge-starting` or a `*-verifying` reason, and accept a newly live `screenLock`. Add evaluation cases for both. Todo 18 replaces this with exact per-backend expectations.
  - The new ADR carries a table of backend x signal: the status each backend claims once verified, and the evidence that sets it. Todos 14-17 close against that table, and todo 20 builds the README from it.
  - Put the nested `AGENTS.md`/`CLAUDE.md` and a `WHERE TO LOOK` row for `src/main/services/linux-desktop/` in `apps/stage-tamagotchi/AGENTS.md` in a separate commit from the runtime code (root `AGENTS.md`: agent configuration changes stay separate).
  Must NOT: start the bridge off Linux; block window creation on the bridge for more than its 2 s `Hello` timeout; persist any fact.
  Closes: GAP-4, GAP-10, GAP-12 (lifecycle)
  Parallelization: Wave 2 | Blocked by: 2, 3, 4, 5 | Blocks: 8, 9, 10, 11, 13, 14, 15, 16, 17
  References:
  - `apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts:1-131`; `powerMonitor.ts:1-39`; `apps/stage-tamagotchi/src/main/index.ts:196-300` (the `injeca.provide` pattern) and `:366` (`selectHostMode` runs after app ready).
  - `presence-sensing.vue:1-40`.
  - The `docs/ai/adr/` naming pattern; root `AGENTS.md` (nested `AGENTS.md` and `CLAUDE.md` rule).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/electron/host-capabilities.test.ts src/main/services/linux-desktop` passes, with new cases for `reportLinuxDesktop` emission, the backend change, and Linux lock forwarding.
  - Inside `pnpm qa:display run -- pnpm qa:smoke`, the run passes and its `app.log` contains `linux-desktop: backend kwin ready (api plasma6)`.
  - After the app quits, `busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s airi-desktop-bridge-<app pid>`, run inside the session, prints `b false`, and `<tempDir>/airi-kwin/` holds no file for that pid.
  - `pnpm verify` exits 0.
  QA scenarios: happy - the qa:smoke run above, plus a CDP read of the Presence sensing page in the same session showing `Backend: KWin` (screenshot with `pnpm qa:display shot`). Failure - run `qa:smoke` in a `--compositor sway` session before todo 15 lands; it must pass with no renderer errors, and Presence sensing must show the `none` backend reasons. Evidence: `.omo/evidence/linux-sensor-parity/task-7-bridge.md`, with screenshot paths.
  Commit: Y (two commits) | `feat(stage-tamagotchi): start a Linux desktop bridge and report its facts`, then `docs(agents): route Linux desktop bridge work in stage-tamagotchi`

- [x] 8. Sample the foreground window on Linux from the bridge
  Recommended task executor category: deep-low - one sampler that mirrors the win32 and darwin shape, plus a verification hook.
  What to do:
  - Create `apps/stage-tamagotchi/src/main/services/electron/foreground-window-linux.ts` exporting `createLinuxSampler(bridge, isOwnProcess)`, which returns `() => ForegroundWindowSample | null`. Mapping, written test-first:
    - `title` is the caption; `pid` is the window's pid.
    - `exePath` is `fs.readlinkSync('/proc/<pid>/exe')`, or `null` on any error (like Win32's protected-process case, `foreground-window-win32.ts:91-93`).
    - `exeName` is `path.basename(exePath)` when set, else `resourceClass`, else `null`.
    - `ownProcess` is `isOwnProcess(pid)`.
    - `busy` is `'fullscreen'` when `fullScreen`, else `bridge.busyHint()` (`'busy'` or `'quiet'`), else `'accepts'`.
    - `sampledAtMs` is `Date.now()`. The sampler returns `null` when `activeWindow()` is `null`.
  - Extend `getSampler` in `foreground-window.ts:52-58` with an `isLinux` branch: `createLinuxSampler` when the bridge is ready and its backend is `kwin`, `x11-ewmh`, `sway` or `hyprland`; otherwise `null`.
  - Foreground verification: when an AIRI `BrowserWindow` emits `focus` and, within 1 s, the bridge's active pid satisfies `isOwnProcess`, call `reportLinuxDesktop({ foregroundVerified: true })`. Three consecutive focus events that see a foreign or null pid report `false`.
  - Update `apps/stage-tamagotchi/README.md:59-67`: situational presence runs on Windows, macOS, and the Linux backends whose foreground signal is live.
  Must NOT: log titles; read `/proc/<pid>/cmdline` or `environ`; sample on a timer (the renderer sets the rate, `apps/stage-tamagotchi/src/renderer/stores/foreground-window.ts:15-21`).
  Closes: GAP-1 (KDE now; X11, sway and Hyprland when their backends land), busy for IS-1
  Parallelization: Wave 2 | Blocked by: 7 | Blocks: 18, 19
  References: `foreground-window.ts:1-79`; `packages/electron-eventa/src/electron/foreground-window.ts:9-25`; `foreground-window-win32.ts:30-40,91-93`; `docs/ai/adr/2026-10-19-situational-presence.md:89-118,197-203`; `foreground-window.test.ts` (mock style).
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/electron/foreground-window-linux.test.ts src/main/services/electron/foreground-window.test.ts` passes, with mapping cases written first and a Linux-branch case; `pnpm verify` exits 0.
  QA scenarios: happy - in a KWin QA display, start the app with `APP_REMOTE_DEBUG=true APP_REMOTE_DEBUG_PORT=<free port> APP_REMOTE_DEBUG_NO_OPEN=true APP_USER_DATA_PATH=<tmp> pnpm dev:tamagotchi` and `konsole`; focus konsole with `pnpm qa:display pointer` plus a click; over CDP on the main renderer invoke `electron.foregroundWindow.sample` (the call `renderer/stores/foreground-window.ts` makes) and assert `exeName === 'konsole'`, `ownProcess === false`, `busy === 'accepts'`; focus an AIRI window and assert `ownProcess === true`. Failure - turn Presence sharing off over CDP and assert the store takes no further samples. Evidence: `.omo/evidence/linux-sensor-parity/task-8-foreground.md`, titles redacted to their length.
  Commit: Y | `feat(stage-tamagotchi): sample the Linux foreground window through the desktop bridge`

- [x] 9. Make the bridge the Linux coordinate authority and verify cursor and geometry
  Recommended task executor category: deep-high - coordinate-space correctness across several services, with fail-safe verification.
  What to do:
  - **One coordinate provider.** Create `apps/stage-tamagotchi/src/main/services/electron/coordinates.ts` exporting `readCursor(): Point | null`, `readWindowRect(window): Rectangle | null` and `readDisplays(): Display[]`. Off Linux, or without a ready bridge, they return exactly what Electron returns today, gated by the capability snapshot as today. On Linux with a ready bridge, ownership is per backend and session, and only the owner below is ever read:
    | Backend | Session | Cursor | Window rect | Displays |
    | --- | --- | --- | --- | --- |
    | `x11-ewmh`, `gnome`, `none` | any | Electron, gated as today | Electron, gated as today | Electron |
    | `kwin` | XWayland | bridge | Electron (origin is live there) | Electron |
    | `kwin` | native Wayland | bridge | bridge | bridge outputs |
    | `sway` | XWayland | none (`sway-cursor-unreported`) | Electron | Electron |
    | `sway` | native Wayland | none (`sway-cursor-unreported`) | bridge | bridge outputs |
    | `hyprland` | XWayland | bridge | Electron | Electron |
    | `hyprland` | native Wayland | bridge | bridge | bridge outputs |
    Unit tests cover every row, including that an `x11-ewmh` bridge reaching `ready` leaves all three readings byte-for-byte equal to Electron's. Route every main-process caller through it in this same commit: `readTrustedCursor`, `windowOriginTrusted` and `displayForWindow` (`host-capabilities.ts:56-71`), the `dipToScreenRect`/`screenToDipRect`/`getAllDisplays`/`getPrimaryDisplay` handlers (`screen.ts:52-58`), the `bounds` loop and `getBounds` (`window.ts:36-41,59-70`), `windows/shared/display.ts`, and window-position persistence. Gate: `rg -n "getBounds\(\)|getDisplayMatching|getCursorScreenPoint" apps/stage-tamagotchi/src/main` lists only `coordinates.ts`, and size-only reads, each listed in the evidence with a reason.
  - **Outputs message.** Extend `bridge-script.js` (todo 4) with `Outputs`: `workspace.screens` mapped to `{ name, x, y, width, height, scale }`, sent on `screensChanged`, with a parser case. `readDisplays` returns Electron displays with `bounds.x`/`bounds.y` replaced by the matching output origin, matched by size and scale.
  - **Own-window binding.** For each AIRI `BrowserWindow` on a kwin, sway or hyprland backend, set a unique title `airi-bind-<n>` with `setTitle`, wait up to 2 s for an `OwnWindows` entry with that caption, record the backend window id against the window, then restore the title. `OwnWindows` gains `caption`, for own windows only.
  - **Geometry verification.** `geometryVerified` turns true when a bound window's bridge width and height equal `getBounds()` width and height within 1 px and at least one output is known.
  - **Cursor verification.** `cursorVerified` turns true when `geometryVerified` holds and the cursor stream delivered 2 distinct positions. `recordPointerSample` compares each renderer `pointermove` with `bridge cursor - bound window origin`; two mismatches over 2 px within 10 s revoke both facts and log `linux-desktop: coordinate mismatch revoked verification`. Silence never invalidates the cursor: a resting pointer keeps its last position for as long as it rests. The bridge cursor becomes `null` only on transport failure: `org.kde.KWin` (or the Hyprland socket) loses its owner, the cursor script is found unloaded (`isScriptLoaded` is checked on every `setCursorStreaming(true)` and on each `NameOwnerChanged`), or the bridge fails. Consumers treat `null` as outside.
  - **Renderer reports.** In `packages/electron-vueuse/src/composables/use-electron-relative-mouse.ts`, add a `pointermove` listener that sends `reportPointerSample` at most every 250 ms, only while the snapshot's `cursorScreenPoint` is `unavailable(linux-cursor-verifying)` or live on a Linux backend.
  - **Cursor streaming.** `screen.ts` calls `bridge.setCursorStreaming(true)` when the first window's cursor loop starts (`:44-47`) and `false` when the last stops.
  - **NOTICE removal.** Delete the NOTICE at `screen.ts:29-33`; subscribe the screen service to snapshot changes so that a status change resets `sent` and re-publishes.
  Must NOT: mix Electron display origins with bridge coordinates in one computation; trust geometry from an unbound window; persist a scale ratio; flip a status to live in a commit that does not also route its callers through `coordinates.ts`.
  Closes: GAP-2, GAP-3 (origin and displays), IS-10 (verification)
  Parallelization: Wave 2 | Blocked by: 7 | Blocks: 10, 13, 18
  References: `screen.ts:1-60`; `window.ts:20-82`; `host-capabilities.ts:56-71`; `apps/stage-tamagotchi/src/main/windows/shared/display.ts`; `use-electron-relative-mouse.ts`; `stage.vue:160-173`; consumers `use-chat-floating-click-through.ts:121-125`, `use-screen-ambient-light.ts:104-105`, `controls-island-root.vue:92-103`; commit 0fb36e8ff (hidden-origin gates, which now lift only through a live status); 2026-11-08 ADR Context (Electron reported origin `(1796, 420)` on native Wayland).
  Acceptance criteria: unit tests (written first) pass for the verification state machine (grant, revoke, gap timeout), output-origin mapping, the binding handshake against a fake bridge, and `coordinates.ts` fallbacks off Linux: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop src/main/services/electron`. `pnpm -F @proj-airi/electron-vueuse typecheck` and `pnpm verify` exit 0.
  QA scenarios: happy - in a KWin QA display with the app running, `pnpm qa:display pointer 100 100` then `pnpm qa:display pointer 900 500`; over CDP read `electron.hostCapabilities.get` and assert `cursorScreenPoint`, `windowOrigin` and `displayOrigins` are live and the last `cursorScreenPoint` event is `{ x: 900, y: 500 }`; then inject nothing for 5 s and assert the status is still live and the reading still `{ x: 900, y: 500 }` (a resting pointer is not lost). Failure - inject two offset pointer samples over CDP and assert both statuses return to `*-verifying` and the log has the revocation line. Evidence: `.omo/evidence/linux-sensor-parity/task-9-coordinates.md`, including the `rg` gate output.
  Commit: Y | `feat(stage-tamagotchi): read Linux cursor and window geometry from the desktop bridge`

- [x] 10. Apply keep-above and window placement on native Wayland through KWin actuators
  Recommended task executor category: deep-low - two actuators on the bound-window map, with read-back verification.
  What to do:
  - `setWindowAlwaysOnTop` (`apps/stage-tamagotchi/src/main/windows/shared/window.ts:102`) keeps calling Electron. On the kwin backend in a native Wayland session it also calls `bridge.setKeepAbove(boundWindowId, flag)`, a `runOneShot` script that writes `keepAbove` on that `internalId` only.
  - `keepAboveVerified` turns true when the next `OwnWindows` push shows the requested value within 1 s; a mismatch reports false.
  - Add `placeWindow(window, rect)` to the same file: on kwin + native Wayland with live `windowOrigin`, a one-shot `moveResize` on the bound window; otherwise `window.setBounds(rect)`.
  - Replace every main-process position write under `apps/stage-tamagotchi/src/main/windows` with `placeWindow`; enumerate with `rg -n "set(Content)?Bounds\(|setPosition\(" apps/stage-tamagotchi/src/main` and list each site in the evidence.
  - Restore caption and widget position persistence when `windowOrigin` is live (2026-11-08 ADR: only an untrusted origin skips it).
  Must NOT: write any window not bound to an AIRI `BrowserWindow`; change Windows, macOS or X11 placement (`placeWindow` is a plain `setBounds` there).
  Closes: GAP-3 (always-on-top and placement)
  Parallelization: Wave 2 | Blocked by: 7, 9 | Blocks: 13
  References: `windows/shared/window.ts:102`; `windows/stage/window-contract.ts:27-30,57-66`; 2026-11-08 ADR Decision (persistence paragraph); KWin `Window.keepAbove` and `frameGeometry` writable, https://github.com/KDE/kwin/blob/c8a2cb4611944bc8fce930d37f9f064f74eb91e9/src/window.h (cross-client writes on Wayland are UNVERIFIED in docs; the live QA decides).
  Acceptance criteria: unit tests with a fake bridge cover `placeWindow` routing and keep-above verification; `pnpm verify` exits 0.
  QA scenarios: happy - in a KWin QA display, toggle always-on-top over CDP, run `pnpm qa:kwin-probe --seconds 3`, assert `keepAbove: true` on the AIRI window and `alwaysOnTop` live; move the caption window over CDP to (200, 200), assert the probe reports that origin, restart on the same profile and assert it restores at (200, 200). Failure - if KWin refuses the write, assert the status stays `unavailable(linux-keep-above-verifying)`, record `UNVERIFIED-LIVE: KWin refused cross-client write` and close this row `[~]`. Evidence: `.omo/evidence/linux-sensor-parity/task-10-actuators.md`.
  Commit: Y | `feat(stage-tamagotchi): keep windows above and place them on KDE Wayland through KWin`

- [x] 11. Deliver push-to-talk key-up on Wayland and XWayland through the GlobalShortcuts portal
  Recommended task executor category: deep-high - a new shortcut driver, app identity registration, and a portal flow with a possible user dialog.
  What to do:
  - **Driver.** Create `linux-desktop/session/global-shortcuts-portal.ts`, class `PortalShortcutsDriver`. `start()`: outside a Flatpak (no `/.flatpak-info`), first `org.freedesktop.host.portal.Registry.Register(appId, {})`; then `CreateSession` with `handle_token` and `session_handle_token`, awaiting the `org.freedesktop.portal.Request` `Response` signal; on success report `portalShortcuts: 'session'`. Readiness lifecycle: report `bound` only after a `BindShortcuts` response of 0 that includes at least one shortcut bound for a `receiveKeyUps` binding; report `session` again when a bind is denied or cancelled, when `ShortcutsChanged` or an unbind leaves no key-up shortcut, and report `absent` when the session's `org.freedesktop.portal.Session` `Closed` signal fires or the portal loses its owner. `bind(bindings)` sends `BindShortcuts` with `[(id, { description, preferred_trigger })]`. `Activated`/`Deactivated` for this session call `broadcastTriggered(id, 'down' | 'up')`. `ShortcutsChanged` updates the trigger text `electronShortcutList` returns. A denied response maps to `ShortcutFailureReasons.Denied`, an absent portal to `Unsupported` (`packages/stage-shared/src/global-shortcut/types.ts:86-115`).
  - **Trigger conversion (TDD).** `toXdgTrigger(accelerator)` converts the stage-shared accelerator to the XDG format, for example `CTRL+SHIFT+a` (modifiers `CTRL`, `ALT`, `SHIFT`, `LOGO`); unmappable keys return `null` and `bind` reports `Invalid`.
  - **App id.** The id is `ai.moeru.airi`, matching `appId` (`electron-builder.config.ts:85`). Set electron-builder's Linux desktop file name so the deb and rpm ship `ai.moeru.airi.desktop` (verify with `dpkg-deb -c` on a built deb, or the electron-builder docs for `linux.desktop` if the build is too costly; record which). Call `app.setDesktopName('ai.moeru.airi.desktop')` early in `main/index.ts` on Linux. In development builds only, write `${XDG_DATA_HOME:-~/.local/share}/applications/ai.moeru.airi.desktop` when absent (`Exec` = current Electron binary and app path), log one line, and document it in `apps/stage-tamagotchi/README.md`.
  - **Routing.** In `global-shortcut.ts:44-47,172-181`, add `driver: 'portal'` to `ActiveBinding`. When `getCurrentHostCapabilities().host` is `linux-wayland` or `linux-xwayland`, `receiveKeyUps` bindings route to the portal driver. `linux-x11` keeps uiohook and falls back to the portal on uiohook `load` or `start` failure (`:101-112`). Bindings without `receiveKeyUps` keep Electron `globalShortcut`.
  - **QA input.** Add key press and release to the EIS helper (`packages/qa-tools/src/t3/cursor.ts` or a sibling `keyboard.ts`), QA only.
  Must NOT: change Windows or macOS routing; register on the Flatpak path; detect the host from env (use the capability host id); auto-accept a portal dialog in product code.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 3, 6, 7 | Blocks: 18, 19
  References: portal v2 spec https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html; Host Registry https://github.com/flatpak/xdg-desktop-portal/blob/987607a8e5be0ee8a54462b068985fa99e522abc/data/org.freedesktop.host.portal.Registry.xml (id must match a `.desktop` basename and register before any portal call); KDE release mapping https://github.com/KDE/xdg-desktop-portal-kde/blob/699396c3c421d5769b2dd686d5d35d8d5f3b47ff/src/globalshortcuts.cpp; XDG shortcuts spec https://specifications.freedesktop.org/shortcuts-spec/latest/; `global-shortcut.ts:1-230`; `global-shortcut-uiohook.ts:132-148`; `main/index.ts:105-152` (Chromium `GlobalShortcutsPortal` stays on).
  Acceptance criteria: driver tests against the fake portal cover the lifecycle: session created then bind denied gives `session` and `globalKeyUp` `unavailable(linux-portal-shortcut-unbound)`; bind accepted gives `bound` and live; `ShortcutsChanged` removing the shortcut gives `session`; `Closed` gives `absent`. `toXdgTrigger` table tests (first) and these driver tests pass: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/session src/main/services/electron/global-shortcut.test.ts`; `pnpm verify` exits 0.
  QA scenarios: happy - in `pnpm qa:display up --name lsp-ptt --portals`, start the app with a temp `XDG_DATA_HOME` holding the dev `.desktop` file; enable push-to-talk with its default binding over CDP; within 5 s `BindShortcuts` must answer `response=0`. If the KDE dialog appears (screenshot with `pnpm qa:display shot`), accept it with an EIS Return and record that seeding did not suppress it. Press and release the binding through EIS; over CDP assert `electronShortcutTriggered` `{ phase: 'down' }` then `{ phase: 'up' }`, and `globalKeyUp` live. Failure - dismiss with Escape (or bind an unseeded trigger and dismiss) and assert the registration reports `denied` and `globalKeyUp` is `unavailable(linux-portal-shortcut-unbound)`. If EIS cannot drive the dialog or keys, record `UNVERIFIED-LIVE: <reason>` with screenshots and close the live row `[~]`. Evidence: `.omo/evidence/linux-sensor-parity/task-11-ptt.md`.
  Commit: Y | `feat(stage-tamagotchi): deliver push-to-talk key release on Wayland through the GlobalShortcuts portal`

- [x] 12. Verify Linux system-audio capture live and report it
  Recommended task executor category: unspecified-high - mostly live investigation of existing wiring, plus a small renderer report.
  What to do:
  - In `apps/stage-tamagotchi/src/renderer/features/live2d/system-audio-lipsync.ts`, when the capture's input level (`packages/stage-ui/src/stores/system-audio-lipsync.ts`) first exceeds 0.05 on a Linux host (read from the capabilities store), send `reportSystemAudioHeard({ level })` once per capture. In main, `recordSystemAudioHeard` sets `systemAudioVerified: true`.
  - Investigate and record: whether on native Wayland `getDisplayMedia({ video: true, audio: true })` (`system-audio-lipsync.ts:47-52`) shows the ScreenCast portal picker; whether `PulseaudioLoopbackForScreenShare` (`packages/electron-screen-capture/src/main/index.ts:31-33`) yields an audio track; whether a played tone reaches it.
  - If no session yields audio, keep the degraded status, replace the English reason label in `settings.yaml` with the observed cause, and record the finding in the ADR from todo 7.
  Must NOT: add a capture path or dependency; change macOS or Windows capture; play any sound on, or change the default sink of, Luke's real PipeWire session.
  Closes: GAP-7
  Parallelization: Wave 2 | Blocked by: 2, 6, 7 | Blocks: 19
  References: `system-audio-lipsync.ts:1-60`; `packages/electron-screen-capture/src/main/index.ts:24-148,238-247`; `apps/stage-tamagotchi/src/renderer/stores/desktop-activity.ts:74,112`; PipeWire monitor sources exist on Luke's machine (draft Findings); Electron 43.8.7 desktopCapturer docs.
  Acceptance criteria: a renderer unit test asserts one report per capture; `pnpm verify` exits 0.
  QA scenarios: happy - start a private audio stack for the QA app only: `pipewire`, `wireplumber` and `pipewire-pulse` with `XDG_RUNTIME_DIR=$RUN_TMP/audio-rt` (a fresh directory), plus `pactl load-module module-null-sink sink_name=airi_qa` made the default sink there. Inside `pnpm qa:display up --name lsp-audio --portals`, start the app with that `XDG_RUNTIME_DIR`/`PULSE_SERVER`, enable Live2D system-audio lip sync over CDP, accept the ScreenCast picker through EIS if it appears, and play a generated 440 Hz WAV with `pw-play` against the private stack. Over CDP assert `systemAudioCapture` is live. Failure - with no tone, assert it stays degraded. If the private stack, the picker or the track fails, record the observed cause and close the live row `[~]` with a precise reason. Tear the private stack down and record the `kill -0` receipts. Evidence: `.omo/evidence/linux-sensor-parity/task-12-audio.md`.
  Commit: Y | `feat(stage-tamagotchi): mark Linux system-audio capture live once a capture hears audio`

- [x] 13. Enable the desktop stage on Linux with emulated click-through that fails to ignoring
  Recommended task executor category: deep-high - launch gating and stage input logic where a fail-unsafe path traps the user's desktop.
  What to do:
  - **Launch gate from detection, not verification.** `selectHostMode` (`apps/stage-tamagotchi/src/main/windows/stage/mode.ts`) gains a `linuxStageEligible: boolean` input; Linux returns `'window'` unless it is true, replacing the NOTICE at `:33-39`. `main/index.ts:366` computes it synchronously from `detectLinuxDesktop(process.env)` (todo 3) plus the Electron version: eligible when the candidate is `kwin` or `x11-ewmh` and `process.versions.electron` is at least 43.7.6. This is a launch gate in main beside the host capability service, not a capability claim, so it does not break the "no Linux detection in consumers" rule; say so in the ADR from todo 7. `apps/stage-tamagotchi/src/main/windows/stage/rpc/index.electron.ts:88` (relaunch recomputation) passes the same value. Update `mode.test.ts:35-38` for both values.
  - **Stage starts ignoring and stays ignoring until usable.** In `apps/stage-tamagotchi/src/renderer/pages/stage.vue:389`, replace `clickThroughAvailable` with `clickThroughUsable`: true when `clickThroughForward` is live, or degraded with reason `linux-click-through-emulated`. At `:444`, remove `!clickThroughAvailable.value` from `forceCapture`, add `forceIgnore = !clickThroughUsable.value`, and pass it to `planStageHitRead` and `resolveStageClickThrough` in `apps/stage-tamagotchi/src/renderer/composables/stage-click-through.ts`. The state machine keeps `ignoring: true` and skips readback under `forceIgnore`; press and pause `forceCapture` win only while usable. Add the cases first in `stage-click-through.test.ts`.
  - **One-time fallback.** If, 15 s after the stage window shows, `clickThroughUsable` has never been true, or the snapshot later reports `linux-bridge-failed` or a revocation while the stage shows, call `offerClassicWindowRelaunch` (`apps/stage-tamagotchi/src/main/windows/stage/leave-mmd-notice.ts`, used at `stage/index.ts:133`) once per launch. The stage keeps ignoring while the dialog is up.
  - **Only the stage consumes emulated click-through.** The voice inlay (`apps/stage-tamagotchi/src/renderer/components/inlay/voice-inlay.vue:126-134`), caption and floating chat (`use-chat-floating-click-through.ts:121-125`) keep their non-live behavior; add a browser test pinning the voice inlay's hide-when-empty under `degraded(linux-click-through-emulated)`.
  - Update `apps/stage-tamagotchi/README.md:26`.
  Must NOT: let any Linux path force capture while click-through is unusable; change Windows or macOS stage behavior; remove the `AIRI_STAGE_HOST` development override; persist any verification.
  Closes: GAP-6
  Parallelization: Wave 3 | Blocked by: 6, 9, 10; its X11 QA half also waits for 14 | Blocks: 19
  References: `stage.vue:160-173,389-453`; `stage-click-through.ts:1-142`; `mode.ts:1-50`; `main/index.ts:366-397`; `stage/index.ts:42-49,130-134`; `apps/stage-tamagotchi/src/main/windows/stage/rpc/index.electron.ts:88`; `window-contract.ts:57-66`; `renderer/components/inlay/voice-inlay.vue:126-134`; electron#52456 and PR #54423. QA model: `/opt/truenas/random models/MMD/WuWa_Iuno_Rigged/尤诺/尤诺.pmx` (a directory holding one PMX model, found on this machine 2026-11-09).
  Acceptance criteria: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/windows/stage/mode.test.ts` and `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/composables/stage-click-through.test.ts` pass with the new cases written first; `pnpm verify` exits 0; `pnpm qa:display run -- pnpm qa:smoke --model "/opt/truenas/random models/MMD/WuWa_Iuno_Rigged/尤诺/尤诺.pmx"` passes with the experimental desktop stage enabled in the temp profile.
  QA scenarios: happy (KWin QA display, `konsole` behind the stage, same model) - inject the pointer onto the character's pixels, hold it still for 5 s, then click; over CDP assert the stage received `pointerdown` (the resting pointer kept the stage capturing). Inject onto an empty area and click; assert `pnpm qa:kwin-probe --seconds 2` reports `Active.resourceClass === 'org.kde.konsole'`; capture `pnpm qa:display shot`. Repeat in `--compositor x11` with `xdotool` and a CDP screenshot. Failure - start the app with `XDG_CURRENT_DESKTOP=GNOME` (not eligible) and assert the app log line from `main/index.ts:367` says classic window; then start eligible but with the app's `DBUS_SESSION_BUS_ADDRESS` pointing at a bus without KWin, and assert the stage never captured input and the classic-window relaunch offer appeared. Evidence: `.omo/evidence/linux-sensor-parity/task-13-stage.md`.
  Commit: Y | `feat(stage-tamagotchi): run the desktop stage on Linux with emulated click-through`

- [x] 14. Add an X11 EWMH backend over koffi
  Recommended task executor category: deep-low - a koffi binding following the existing win32 and darwin pattern.
  What to do:
  - `linux-desktop/backends/x11/binding.ts` lazily loads `libX11.so.6` through koffi with `XOpenDisplay`, `XDefaultRootWindow`, `XInternAtom`, `XGetWindowProperty`, `XFree`, `XCloseDisplay`; one display connection per backend, closed on `stop()`.
  - `linux-desktop/backends/x11/index.ts` answers `activeWindow()` on demand (no timer, no event loop): `_NET_ACTIVE_WINDOW` on the root; `_NET_WM_NAME` (`UTF8_STRING`) falling back to `WM_NAME`; `_NET_WM_PID`; `WM_CLASS` (class part); `_NET_WM_STATE` containing `_NET_WM_STATE_FULLSCREEN`. Cursor and origin stay on Electron (already live on X11). Register it in the bridge's `backends` map for X11 sessions.
  - Pure parsers (TDD) for UTF-8 names, `WM_CLASS` NUL-separated pairs, and atom arrays.
  Must NOT: open a display connection per sample; run on Wayland or XWayland sessions.
  Closes: GAP-8
  Parallelization: Wave 3 | Blocked by: 7, 9 | Blocks: 13 (X11 half), 18
  References: todo 9's ownership table (X11 keeps Electron coordinates); `foreground-window-darwin.ts:86-170`, `foreground-window-win32.ts:42-60` (koffi patterns); EWMH spec https://specifications.freedesktop.org/wm-spec/latest/.
  Acceptance criteria: parser tests (first) and a binding test with mocked koffi pass: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/backends/x11`; `pnpm verify` exits 0.
  QA scenarios: happy - in `pnpm qa:display up --name lsp-x11 --compositor x11`, run the app and `QT_QPA_PLATFORM=xcb konsole`; focus konsole with `pnpm qa:display pointer` plus `xdotool click 1`; over CDP assert a sample with `exeName === 'konsole'` and `foregroundWindow` live; `xdotool key F11` on konsole, then assert `busy === 'fullscreen'`. Coordinate regression after the backend is `ready`: move with `xdotool mousemove 300 300`, assert `cursorScreenPoint` is live and its last event is `{ x: 300, y: 300 }`; assert `electron.window.getBounds` over CDP equals `xdotool getwindowgeometry` for the AIRI window; then run todo 13's X11 stage scenario. Failure - kill openbox (no `_NET_ACTIVE_WINDOW`) and assert the sample is `null` with no errors in `app.log`. Evidence: `.omo/evidence/linux-sensor-parity/task-14-x11.md`, or `[~]` with `BLOCKED: Xvfb/openbox not installed`.
  Commit: Y | `feat(stage-tamagotchi): read the X11 foreground window through EWMH`

- [~] 15. Add a sway IPC backend
  Gap [~]: no live exeName sample on headless sway: the session seat has no input devices, so Electron never activates and foreground verification never runs; idle also stays unverified there (harness limit; needs a session-private virtual keyboard). Registration, failure path and focus-change pids are proven (task-14-16-gate-review.md). Window geometry now verifies live after the Outputs fix (b0c5bedb3; task-18 gate review).
  Recommended task executor category: deep-low - a small binary IPC client and a tree walk.
  What to do:
  - `linux-desktop/backends/sway/ipc.ts` (TDD) encodes and decodes i3-ipc frames: magic `i3-ipc`, 32-bit little-endian length and type, JSON payload.
  - `index.ts` connects to `SWAYSOCK`: `GET_TREE` (type 4) for the focused node (`name`, `app_id` or `window_properties.class`, `pid`, `fullscreen_mode`, `rect`); `SUBSCRIBE` (type 2) to `["window"]` pushes `Active` on `focus`, `title` and `fullscreen_mode`; nodes with an own pid feed `OwnWindows`, so todo 9's geometry verification and binding apply. No cursor source exists (`sway-cursor-unreported`).
  Must NOT: send any sway command that changes state.
  Closes: GAP-9 (sway)
  Parallelization: Wave 3 | Blocked by: 7 | Blocks: 18
  References: sway IPC manual https://github.com/swaywm/sway/blob/d6227fe978484e080937b18fbd731fc1456561f7/sway/sway-ipc.7.scd.
  Acceptance criteria: frame and tree-walk tests (first) pass: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/backends/sway`; `pnpm verify` exits 0.
  QA scenarios: happy - in `pnpm qa:display up --name lsp-sway --compositor sway`, run the app and `konsole`, focus each with `swaymsg '[app_id="org.kde.konsole"] focus'`; over CDP assert the sample's `exeName` and that `windowOrigin` turns live. Failure - stop sway mid-run; assert the bridge reports `failed` and `foregroundWindow` becomes `unavailable(linux-bridge-failed)` without renderer errors. Evidence: `.omo/evidence/linux-sensor-parity/task-15-sway.md`, or `[~]` with `BLOCKED: sway not installed`.
  Commit: Y | `feat(stage-tamagotchi): read the sway foreground window over IPC`

- [~] 16. Add a Hyprland IPC backend, proven with fixtures
  Gap [~] UNVERIFIED-LIVE: Hyprland not installed; proven with fixtures only (ready, failure, malformed input, no dispatch). Cursor reads wired to the todo 9 loop in a follow-up (see ledger).
  Recommended task executor category: deep-low - an IPC client plus parsers, checked against Hyprland source.
  What to do:
  - Before code, confirm request and event names against Hyprland source (https://github.com/hyprwm/Hyprland/blob/ff24e1755fd308ee70367d63168a12feb05d1fc2/src/ipc/s2/S2.cpp and https://github.com/hyprwm/Hyprland/blob/15b8b8e825001987f20ec0499ce8fa4236eb8553/src/ipc/s1/Commands.cpp) and quote them in the evidence. Expected: requests `j/activewindow`, `j/clients`, `j/cursorpos`; events `activewindowv2>>`, `windowtitlev2>>`, `fullscreen>>`. If a name differs, use the source's.
  - `linux-desktop/backends/hyprland/`: sockets `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket.sock` and `.socket2.sock`. `Active` from `j/activewindow`, refreshed on events; own windows from `j/clients` filtered by pid; cursor from `j/cursorpos`, requested once per tick of the existing renderer-paced cursor loop and only while streaming is on. Fixtures under `__fixtures__/` follow the quoted formats.
  Must NOT: send any `dispatch` command.
  Closes: GAP-9 (Hyprland)
  Parallelization: Wave 3 | Blocked by: 7 | Blocks: 18
  References: decision D2 (Hyprland is not in the Fedora repos, so live QA is `[~]`); librarian finding that Hyprland IPC details are UNVERIFIED.
  Acceptance criteria: parser and client tests against fixtures and a fake unix-socket server pass: `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node src/main/services/linux-desktop/backends/hyprland`; `pnpm verify` exits 0.
  QA scenarios: happy - the fake-socket test replays an `activewindowv2>>` event and asserts an `Active` push. Failure - a malformed `j/activewindow` reply yields `null` with no throw. Live: if `Hyprland` is installed at execution time, run it headless and repeat todo 15's scenario; otherwise record `[~] UNVERIFIED-LIVE: Hyprland not installed`. Evidence: `.omo/evidence/linux-sensor-parity/task-16-hyprland.md`.
  Commit: Y | `feat(stage-tamagotchi): read the Hyprland foreground window and cursor over IPC`

- [x] 17. Report GNOME and unsupported desktops honestly
  Recommended task executor category: quick - a backend stub, labels and two tests.
  What to do: register `gnome` and `none` backends in the bridge; both report `bridge: 'ready'` at once and carry no samples, and the resolver from todo 2 produces their reasons. English labels: `gnome-needs-extension` = "GNOME needs a Shell extension to share the focused window and cursor; AIRI does not ship one yet."; `linux-desktop-unsupported` = "This desktop does not offer a way for AIRI to read the focused window." Tests: `detectLinuxDesktop({ XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'w' })` gives `gnome`; a resolver case for the GNOME row.
  Must NOT: ship or download any GNOME extension.
  Closes: GAP-9 (GNOME, other)
  Parallelization: Wave 3 | Blocked by: 7 | Blocks: 18, 20
  References: decision D1; `packages/i18n/src/locales/en/tamagotchi/settings.yaml:94-109`.
  Acceptance criteria: the tests pass; `pnpm verify` exits 0.
  QA scenarios: happy - in a KWin QA display, start the app with `XDG_CURRENT_DESKTOP=GNOME` for the app only, open Presence sensing over CDP, screenshot the GNOME reason with `pnpm qa:display shot`. Failure - with `XDG_CURRENT_DESKTOP` unset and no X11, assert the `none` reasons show. Evidence: `.omo/evidence/linux-sensor-parity/task-17-gnome.md`.
  Commit: Y | `feat(stage-tamagotchi): explain GNOME and unsupported desktop limits in Presence sensing`

- [x] 18. Teach `qa:host smoke` the Linux backends and observe foreground, lock and cursor
  Recommended task executor category: unspecified-high - QA tooling across the qa-tools CLI, the motion-QA bridge schema, and live runs in three sessions.
  What to do:
  - In `packages/qa-tools/src/host/smoke.ts:11-31`, extend `expectedHostFacts` with `linuxDesktop`, derived from new flags in `run.ts:31,59`: `--expect-backend kwin|x11-ewmh|sway|hyprland|gnome|none` and `--expect-verified <comma list of foreground,cursor,geometry,keepAbove,lock,portal,audio>`. Expected profiles come from `capabilitiesForHost(host, linuxDesktop)`; replace todo 7's interim tolerance with these exact expectations, still allowing the `starting`/`*-verifying` to live transition once per signal.
  - During the 180 s observation on Linux, drive verification: `pnpm qa:display pointer` moves, and one focus change to an AIRI window and back.
  - Extend `MotionQaState` in `packages/stage-shared/src/motion-scenario/bridge.ts` with `foreground: { exeName: string | null, busy: ForegroundWindowSample['busy'], ownProcess: boolean } | null`, never the title, produced from the renderer foreground store. The smoke asserts a sample arrived when `foreground` is expected verified.
  - Add failure codes `backend-mismatch` and `verification-missing` to `SmokeFailure` (`smoke.ts:52-57`). Update `packages/qa-tools/README.md:40-48`.
  Must NOT: loosen any existing assertion beyond the documented transition; include titles in reports.
  Closes: GAP-14
  Parallelization: Wave 4 | Blocked by: 8, 9, 11, 14, 15, 16, 17 | Blocks: 19
  References: `packages/qa-tools/src/host/run.ts:1-173`; `smoke.ts:1-140`; `packages/stage-shared/src/motion-scenario/bridge.ts:35-150`; `packages/qa-tools/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/qa-tools exec vitest run src/host` passes with new cases (first). Each of these exits 0 and its `report.json` lists the backend and verified facts:
  - `pnpm qa:display run -- pnpm qa:host smoke --expect-idle verified --expect-backend kwin --expect-verified foreground,cursor,geometry`
  - `pnpm qa:display run -- pnpm qa:host smoke --xwayland --expect-backend kwin --expect-verified foreground,cursor`
  - `pnpm qa:display run --name lsp-x11 -- pnpm qa:host smoke --expect-backend x11-ewmh --expect-verified foreground`
  - `pnpm qa:display run --name lsp-sway -- pnpm qa:host smoke --expect-idle verified --expect-backend sway --expect-verified foreground,geometry`
  `lock` is listed only where a lock source exists in that session (the QA sessions have no logind seat or ScreenSaver unless a test owns one), and the evidence states which. `pnpm verify` exits 0.
  QA scenarios: happy - the four runs. Failure - the kwin smoke with `--expect-backend sway` exits 1 with `backend-mismatch` in `report.json`. Evidence: `.omo/evidence/linux-sensor-parity/task-18-host-smoke.md`, listing each `.temp/qa/<run>`.
  Commit: Y | `feat(qa-tools): check Linux desktop backends and their verified signals in qa:host smoke`

- [x] 19. Run the cross-session live regression on Linux
  Recommended task executor category: unspecified-high - long live runs across four sessions, plus triage.
  What to do: from the branch tip, inside each `pnpm qa:display` session with temp profiles:
  - `pnpm qa:smoke` in all four sessions: KWin native Wayland, KWin XWayland (`dev:xwayland`), X11, sway.
  - `pnpm qa:smoke --model "/opt/truenas/random models/MMD/WuWa_Iuno_Rigged/尤诺/尤诺.pmx"` with the experimental desktop stage enabled in the temp profile, with a per-session expected outcome:
    | Session | Expected host mode | Extra check |
    | --- | --- | --- |
    | KWin native Wayland | desktop stage | todo 13 happy scenario (resting pointer, character click, empty-area click reaches konsole) |
    | KWin XWayland | desktop stage | same scenario |
    | X11 | desktop stage | todo 13 X11 scenario |
    | sway | classic window (not eligible, todo 13 launch gate) | the app log line from `main/index.ts:367` says classic window; no stage window exists; the model renders in the classic window |
    A session that shows the other host mode is a failure.
  - One replayed chat turn on KWin native Wayland: `pnpm qa:llm serve`, then `pnpm qa:app run --say "hello"`; the summary must show ACT, expression and speech events.
  - The X11 desktop-stage scenario from todo 13.
  - `pnpm qa:host smoke` per session (todo 18 invocations).
  - `pnpm qa:motion` T1 for `linux-wayland`, compared with the same run on `origin/main` in the same session type, to show no motion regression from the coordinate changes.
  Triage every failure into a new numbered todo appended to this plan, or a recorded pre-existing finding with a repro on `origin/main`.
  Must NOT: tune motion constants or bands; run anything on Luke's desktop session.
  Closes: GAP-11 (Linux), IS-14
  Parallelization: Wave 4 | Blocked by: 12, 13, 18 | Blocks: 20
  References: root `AGENTS.md` COMMANDS and the run-app done-definition; `packages/qa-tools/README.md` (`qa:app`, `qa:llm`, motion T1); `.agents/skills/motion-qa/SKILL.md`.
  Acceptance criteria: every run exits 0, or is triaged as above with its `.temp/qa` directory named; the evidence holds a session x run x result matrix.
  QA scenarios: happy - the matrix is all green. Failure - any red cell yields a new todo or a recorded pre-existing finding, never a silent skip. Evidence: `.omo/evidence/linux-sensor-parity/task-19-regression.md`.
  Commit: N (evidence only), unless a triage fix lands as its own todo.

- [x] 20. State per-platform support honestly in the ADR matrix and READMEs
  Recommended task executor category: writing - documentation driven by the evidence from todos 18 and 19.
  What to do:
  - Update `docs/ai/adr/2026-11-08-host-capability-contract.md:53-80`: keep the six host columns and add a "Linux desktop backend" sub-table (rows = signals; columns = kwin Wayland, kwin XWayland, x11-ewmh, sway, hyprland, gnome, none). Each cell is the status once verified, with `[~]` notes where live proof is missing.
  - Add a "Platform support" section to root `README.md`, worded from the evidence only. Expected shape: Windows and macOS full; KDE Plasma 6 full including the desktop stage; X11 window managers full except push-to-talk key-up needs uiohook; sway without cursor attention, always-on-top or the desktop stage (classic window only); Hyprland implemented but not live-tested; GNOME limited (no foreground or cursor) until an extension exists. Each claim cites its matrix cell.
  - Update `apps/stage-tamagotchi/README.md:26,59`.
  - (From todo 19 triage F2) Correct the KWin native `qa:host smoke` invocation in `packages/qa-tools/README.md` and in the claim table to `--expect-verified foreground,cursor,geometry,keepAbove`, since todo 10 makes keep-above live on KWin native; cite `.temp/qa/20261109-184734-host-smoke` in `/mnt/dev/projects/dtuber-wt/lsp-t19`.
  - Draft `.omo/evidence/linux-sensor-parity/pr-body.md`, listing every `[~]` row and the Windows and macOS smoke for Luke (`pnpm qa:smoke` and `pnpm qa:host smoke` on each, decision D3).
  Must NOT: claim support no evidence shows; edit non-English locales.
  Closes: GAP-13
  Parallelization: Wave 4 | Blocked by: 19 | Blocks: F1-F4
  References: evidence from todos 18 and 19; the backend table in the ADR from todo 7; root `AGENTS.md` (docs with code, prose rules).
  Acceptance criteria: a claim-to-cell table in the evidence maps every README claim to a matrix cell and a `report.json`; `pnpm verify` exits 0.
  QA scenarios: happy - QA by read: both READMEs and the ADR side by side, each Linux claim checked against todo 18's `report.json`. Failure - a claim without a supporting run is removed, not the check. Evidence: `.omo/evidence/linux-sensor-parity/task-20-docs.md`.
  Commit: Y | `docs: state per-platform sensing support for Linux desktops`

- [x] 21. Guard sensor tests and agent QA against the host desktop session (follow-up, Luke 2026-11-09: "be sure to isolate when testing sensors, I don't want my windows to be picked up.")
  Recommended task executor category: unspecified-high - test setup, QA tooling guards and backend defaults across a few files.
  What to do:
  - A Vitest setup file for the stage-tamagotchi `node` project and the root `dev-tools` project that, before any test, removes `DISPLAY`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE` and `XAUTHORITY`, points `DBUS_SESSION_BUS_ADDRESS` and `DBUS_SYSTEM_BUS_ADDRESS` at a nonexistent socket, and sets `XDG_RUNTIME_DIR` to a fresh temp dir, so an accidental default connection fails instead of reaching the host. `DbusTransport.system()` honors `DBUS_SYSTEM_BUS_ADDRESS`.
  - Sensor backends take their display, socket and bus explicitly from the caller (the bridge passes `env`); no backend class reads `process.env` for them.
  - `pnpm qa:kwin-probe`, and on Linux `pnpm qa:smoke`, `pnpm qa:app` and `pnpm qa:host smoke`, refuse to start unless they run inside a `pnpm qa:display` session (an env marker that `qa:display run` sets), with an explicit `--allow-host-session` escape hatch that agents never use. Document it in `scripts/dev-tools/README.md` and `packages/qa-tools/README.md`.
  Must NOT: change product runtime behavior for a user running the app on their own desktop.
  Parallelization: before any app-level live QA of todos 7-19 | Blocked by: - | Blocks: app-level live QA of 7-19
  Acceptance criteria: a test proves a default `DbusTransport.session()` inside the node project fails fast rather than reaching `/run/user/1000/bus`; running `pnpm qa:kwin-probe` and `pnpm qa:smoke` outside a qa:display session exits non-zero with a message naming qa:display; inside one they run; `pnpm verify` exits 0.
  QA scenarios: happy - the probe inside `pnpm qa:display run --name lsp-t21 -- pnpm qa:kwin-probe --seconds 3` runs; failure - the same command from the host shell exits non-zero without connecting (no `airi-desktop-bridge-*` script appears in the host KWin: check with `busctl --user call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s airi-desktop-bridge-<pid>` reading `b false`, a read-only query). Evidence: `.omo/evidence/linux-sensor-parity/task-21-host-guard.md`.
  Commit: Y | `test(stage-tamagotchi): keep sensor tests and agent QA off the host desktop session`

- [x] 22. Keep qa:display sessions off the host audio graph (follow-up from todo 12 part A; Luke's isolation rule)
  Recommended task executor category: unspecified-high - qa:display planner, CLI and docs, with live receipts.
  Finding: a default `pnpm qa:display` session links the host PipeWire and Pulse sockets into its private runtime dir (todo 6), so the session's KWin, its portals and any app inside become clients of Luke's real PipeWire graph; a screen-share or system-audio capture in a QA session would reach his real audio (evidence: `.omo/evidence/linux-sensor-parity/task-12-audio.md`).
  What to do: stop linking host audio sockets by default. Add `--private-audio`, which starts `pipewire`, `wireplumber` and `pipewire-pulse` inside the session's private runtime dir with a null sink `airi_qa` as default and tears them down on `down`; keep host-audio linking only behind an explicit `--host-audio` flag that agents never use. Table tests for the unit plan; README updates in `scripts/dev-tools/README.md` and `packages/qa-tools/README.md`.
  Must NOT: change the user's real PipeWire or default sink; require root.
  Blocks: todo 12 part B live QA, todos 18 and 19 live runs.
  Acceptance criteria: in a default session and in a `--private-audio` session, `pw-dump` on the HOST lists no client whose pid belongs to the session (KWin, portals, app); in the `--private-audio` session `pactl info` (inside) names `airi_qa` as default sink; after `down`, `kill -0` fails for every private audio process; host default sink unchanged; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-22-private-audio.md`.
  Commit: Y | `fix(dev-tools): keep qa:display sessions off the host audio graph`

- [x] 23. Fix Wayland screen-share capture so system audio can start (Luke 2026-11-09: "Full fix in this PR")
  Recommended task executor category: deep-high - a capture-flow design decision across renderer and main, with live proof.
  Finding (todo 12 part A, `.omo/evidence/linux-sensor-parity/task-12-audio.md`): on native Wayland the renderer's `desktopCapturer.getSources` opens the ScreenCast picker, then the main-process `setDisplayMediaRequestHandler` in `packages/electron-screen-capture/src/main/index.ts:238-247` calls `getSources` again, which opens a second picker and returns a new source id; the handler throws `Source with id screen:N:0:s not found.` as an unhandled rejection, never calls back, and `getDisplayMedia` hangs.
  What to do: on Linux, select the source once and reuse it in the request handler (for example, the renderer's chosen source is handed to main, or main performs the only lookup and the renderer does not), so one picker appears and the handler always answers. Every handler path calls the callback, including errors, so `getDisplayMedia` rejects instead of hanging. Keep the `loopback` audio request and `PulseaudioLoopbackForScreenShare`. Tests first for the selection and callback logic.
  Must NOT: change Windows or macOS capture behavior; add a new capture dependency; auto-accept the portal picker in product code.
  Blocked by: 22 for live QA (or the todo 12a private runtime-dir shim) | Blocks: 12 part B
  Acceptance criteria: unit tests for single selection and the always-callback rule pass; live, in an isolated `--portals` session on the private audio stack, enabling Live2D system-audio lip sync shows exactly one picker, the capture yields an audio track, and a 440 Hz tone on the private `airi_qa` sink raises the capture input level above 0.05 (no-tone baseline stays below); host audio, doc mount and portal unchanged; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-23-capture-fix.md`.
  Commit: Y | `fix(electron-screen-capture): pick the Wayland screen-share source once so capture starts`

- [x] 24. Make `use-presence-notice-sync.browser.test.ts` deterministic so `pnpm verify` is reliably green (blocker found during landings)
  Recommended task executor category: deep-low - a test-teardown race in the browser project.
  Finding: `pnpm verify` intermittently, and on the 11a landing twice in a row, fails with an unhandled rejection `Pinia sync runtime was disposed before the RPC completed` from `apps/stage-tamagotchi/src/renderer/composables/use-presence-notice-sync.browser.test.ts:73` (pinia-plugin-synced dispose via `setup-synced.ts:48`), while every test passes. The test file is byte-identical on `origin/main`.
  What to do: reproduce on the integration tip and on `origin/main` (run the browser project several times); find the root cause (an RPC still in flight when the synced runtime is disposed in teardown); fix it at the cause - await the pending sync or dispose in the right order - with no sleeps, retries or swallowed rejections. If the defect is in product code (`setup-synced.ts`), fix the product code; if only the test teardown, fix the test.
  Acceptance criteria: the browser project for stage-tamagotchi passes 10 consecutive runs with no unhandled errors; `pnpm verify` exits 0 twice in a row on the integration tip.
  Evidence: `.omo/evidence/linux-sensor-parity/task-24-browser-flake.md`.
  Commit: Y | `fix(stage-tamagotchi): await pending presence sync before disposing the synced runtime in tests` (adjust the scope and wording to the actual root cause)

- [x] 25. Give every qa:display session a private system bus (follow-up from the todo 7 gate; Luke's isolation rule)
  Recommended task executor category: unspecified-low - qa:display planner, env file and docs.
  Finding: `pnpm qa:display` exports a private session bus but no `DBUS_SYSTEM_BUS_ADDRESS`, so an app in a QA session connects to the host system bus and calls logind `GetSessionByPID`, reading Luke's real session state (todo 7 gate report).
  What to do: start a second private `dbus-daemon` per session as its system bus (a system-bus config pointing at the session dir, no policy beyond what tests need), export `DBUS_SYSTEM_BUS_ADDRESS` through the env file and `run`/`env`, and tear it down on `down`. The app then finds no logind there and reports lock through ScreenSaver or `null`; lock QA owns a fake logind or ScreenSaver on the private buses. Table tests and README updates.
  Must NOT: touch the host system bus; require root.
  Acceptance criteria: inside a session, `busctl --system list` (with the session env) lists only the private daemon's names; a `pnpm qa:display run -- pnpm qa:smoke` passes; `kill -0` fails for the private system daemon after `down`; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-25-private-system-bus.md`.
  Commit: Y | `fix(dev-tools): give qa:display sessions a private system bus`

- [x] 26. Keep the KWin bridge script pumping after an AIRI window is destroyed (defect found by todo 8 live QA)
  Recommended task executor category: deep-low - compositor-side script robustness with a live repro.
  Finding (`.omo/evidence/linux-sensor-parity/task-8-foreground.md`): in `backends/kwin/bridge-script.js` `updateOwn()`, `disconnect` on an already destroyed own window throws inside the `OwnPids` reply callback; KWin swallows the error before `inFlight` resets, so the one-call-in-flight pump stops and every later `Active`/`OwnWindows` push is lost for the app's lifetime (journal: `TypeError: Cannot call method disconnect of undefined` at line 101).
  What to do: guard every disconnect of window signals against destroyed windows; make every reply callback reset the in-flight flag in a `finally`-equivalent path so no exception can stop the pump (KWin's engine rejects `catch {}`; use `catch (error) {}`); same review for `cursor-script.js`. Add `scripts.test.ts` cases that destroy an own window between pushes and assert later pushes still flow, and that a throwing handler does not stop the pump.
  Acceptance criteria: the new tests fail on the current script and pass after; live in an isolated KWin `qa:display` session, open and close an AIRI window, then focus `konsole`: the app's foreground sample shows `exeName: konsole` (todo 8's sampler); `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-26-kwin-pump.md`.
  Commit: Y | `fix(stage-tamagotchi): keep the KWin bridge script pushing after an AIRI window closes`

- [x] 27. Scope qa-tools process discovery to the QA session (follow-up, Luke's isolation rule)
  Recommended task executor category: unspecified-low - qa-tools helper and its callers.
  Finding (todo 9 gate): `packages/qa-tools` `listLiveProcesses` runs a host-wide `ps -eo`, so agent QA reads the command lines of every process on Luke's machine; workers also used host-wide `pgrep` for the same purpose.
  What to do: on Linux inside a `qa:display` session (marker `AIRI_QA_DISPLAY_SESSION`), discover processes only from the session unit's cgroup (`systemctl --user show -p ControlGroup --value airi-qa-display-<name>.service` and its scopes) plus the caller's own descendants; never scan the host. Keep the macOS/Windows behaviour. Tests for the scoping decision; README note.
  Acceptance criteria: inside a session, the helper returns session processes and no process outside the session cgroup (prove with a host process that would have matched the old pattern); `pnpm qa:display run -- pnpm qa:smoke` teardown still finds and reports leftovers; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-27-qa-process-scope.md`.
  Commit: Y | `fix(qa-tools): find QA processes inside the qa:display session only`

- [x] 28. Make `qa:smoke` and `qa:host smoke` run every Linux session without scratch code (triage of todo 19: F1, F4, F5)
  Recommended task executor category: unspecified-high - qa-tools CLI options plus live reruns.
  What to do:
  - `qa:host smoke`: a single slow CDP sample evaluate (timeout under host load) is recorded as a missed sample with a bounded retry, not `run-failed` for the whole 180 s observation; the evaluator and every assertion stay unchanged.
  - `qa:smoke`: add `--xwayland` (launch through the XWayland dev path) and an Electron-args passthrough so the X11 session can supply `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`; or have the `--compositor x11` qa:display session supply them. Document which.
  - `qa:smoke --stage-host desktop` accepts an expected classic outcome (for example `--expect-host window`), so a gated platform (sway) exits 0 when the app correctly keeps the classic window.
  - Tests first for each option; README.
  Acceptance criteria: the todo 19 X11 plain and desktop-stage smokes and the XWayland smokes pass with the new options and no scratch code; the sway `--stage-host desktop --expect-host window` smoke exits 0; a forced slow sample in a unit test is reported as missed, not run-failed; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-28-qa-harness.md`.
  Commit: Y | `feat(qa-tools): run the X11, XWayland and gated-stage smokes without scratch flags`

- [~] 29. Investigate whether the desktop stage character walks away from a resting pointer (triage of todo 19: stage scenario finding)
  Gap [~]: the platform-independent goal-retention mechanism is confirmed (director keeps an issued walk goal; stop-radius moves do not cancel it; 3 s dwell), but this branch's contribution to the observed episodes (cursor ownership, verification withholding/revocation, stage.vue forwarding without the trust latch) is unresolved; the attribution trace recipe is recorded in task-29-stage-locomotion.md and deferred to Luke's motion QA. No motion constants changed.
  Recommended task executor category: deep-low - read-only motion investigation; no tuning (todo 19 Must NOT).
  Finding: in todo 19's stage scenarios, during a 5 s pointer rest she walked 200-250 px toward the pointer's previous rest point, so a press aimed at her hit empty floor. Click-through behaved correctly; the user-visible effect is that a resting pointer can make her walk away.
  What to do: from code and the todo 19 screenshots (`.temp/qa/20261109-lsp-t19-{kwin,xwayland,x11}-stage/a<n>-pre.png`/`-post.png` in `/mnt/dev/projects/dtuber-wt/lsp-t19`), determine whether locomotion follows the pointer with a lag on Linux only (coordinate verification latency, bridge cursor cadence) or on every platform (existing Natural/locomotion design). If Linux-only and caused by this branch, propose a fix as a new row; if it is existing motion design, record it as a motion-QA follow-up for Luke. Also make the stage-scenario QA locate her at press time.
  Acceptance criteria: a written root-cause note with code references and a classification (this branch / pre-existing design); no motion constants changed.
  Evidence: `.omo/evidence/linux-sensor-parity/task-29-stage-locomotion.md`.
  Commit: N (investigation), unless the classification yields a fix row.

- [x] 30. Fix the F2 code-quality findings (follow-up from F2)
  Recommended task executor category: unspecified-low - small test and output changes in existing files.
  Findings (`.omo/evidence/linux-sensor-parity/f2-code-quality.md`): `scripts/dev-tools/kwin-probe-plan.ts:65-71` prints raw OwnWindows captions (window titles) in the probe's formatted output; new tests poll with `vi.waitFor` instead of awaiting the event (`geometry/actuators.test.ts:120,137`, `inlay/voice-inlay.browser.test.ts:159-160`, `live2d/system-audio-lipsync.browser.test.ts:75,87,94`).
  What to do: redact captions in the probe output (length or a fixed placeholder) with a regression test that fails on raw captions; replace each `vi.waitFor` with a bounded promise resolved by the real callback or boundary call; rename the GNOME-wrong test title in `linux-desktop/index.test.ts`; move the controls-island `available` reset into teardown. Each change is a `fixup!` of the commit that introduced the file.
  Acceptance criteria: the redaction test fails on the old formatter; the touched test files pass three consecutive runs; no `vi.waitFor` remains in test cases this branch added or changed (scope per root AGENTS.md "Correct rule violations in touched functions/components/tests, not unrelated code"; untouched pre-existing cases in those files are a recorded follow-up, amended 2026-11-10 after the first todo 30 review); `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-30-f2-fixes.md`.
  Commit: fixups into the owning commits (todos 4, 10, 12, 13, 17/7 as applicable).

- [x] 31. Revoke screen-lock verification when its source goes away (follow-up from F1)
  Recommended task executor category: deep-low - bridge fact lifecycle with tests first.
  Finding (`.omo/evidence/linux-sensor-parity/f1-plan-compliance.md`): `linux-desktop/bridge.ts:271-274` sets the lock source once; `session/lock.ts:84-118` has no path to revoke it, so `screenLock` stays live after the verified source disappears (name owner lost) or a later read fails, against IS-10 (no signal claims live without current proof) and the resolver rule in `packages/stage-shared/src/host-capabilities/linux-desktop.ts:27-28`.
  What to do: give LockSource a revocation path (owner lost, read failure, transport failure) that clears the bridge's lock source so the resolver reports the signal unavailable or degraded with its existing reason, and re-grants only on a fresh verified read. Tests first: owner vanishes after verification -> not live; a failing read after verification -> not live; re-appearance -> live again after a verified read.
  Acceptance criteria: the new tests fail on the current code and pass after; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-31-lock-revocation.md`.
  Commit: Y | `fix(stage-tamagotchi): stop reporting the Linux screen lock as live when its source goes away`

- [x] 32. Keep a press on the desktop-stage character from falling through when a stage-controls tooltip is stuck over her (follow-up from F3 finding F3-A)
  Recommended task executor category: deep-low - renderer hit-testing and tooltip lifecycle with a live repro.
  Finding (`.omo/evidence/linux-sensor-parity/f3-manual-qa.md`, F3-A): after the pointer crosses the stage controls column, the "Connected. Open connection settings" tooltip stays drawn over her torso; a resting press on her where it overlaps gets no stage pointerdown and activates the window behind her. Reproduced on KWin native, XWayland and X11; presses with no tooltip at the aim pass. Candidates: the tooltip never receives pointerleave once the window turns click-through, and/or the stage hit-read treats overlay DOM as non-character.
  What to do: reproduce in a test first (hover the link button, leave while the window turns click-through, rest and press on her under the tooltip); fix tooltip dismissal when the window turns click-through and/or hit-test capture under overlay DOM; keep the Must NOTs of todo 13.
  Acceptance criteria: the new test fails before and passes after; live on KWin native, XWayland and X11 with raw receipts, a press on her after crossing the controls reaches the stage; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-32-stage-tooltip.md`.
  Commit: Y | `fix(stage-tamagotchi): keep stage-controls tooltips from swallowing presses on the character`

- [x] 33. Stop stale XWayland re-entry pointer samples from revoking cursor verification (follow-up from the todo 32 gate)
  Recommended task executor category: deep-low - coordinate verification policy with tests first and a live XWayland repro.
  Finding (`.omo/evidence/linux-sensor-parity/task-32-gate-review.md`, residual xwayland_revocation): on XWayland, real KWin EIS input produced trusted renderer pointermoves that repeat a stale last-known position on window re-entry (564,690 while the cursor was at 716,700; 685,697 while it was at 614,690; a crossing that opened with 960,540). Two such mismatches over 2 px within 10 s revoke verification (`coordinates.ts`), and it is only re-granted on window show or focus rebind (`coordinates.ts:148-151,259-291`), so ordinary pointer travel can disable presses on the character for the rest of the session. KWin native (4/4) and X11 (5/5) did not show it. Evidence runs: `/mnt/dev/projects/dtuber-wt/lsp-t32/.temp/qa/t32-xwayland/receipts/cross-2.json`, `cross-2-back.json`, `app.log`.
  What to do: keep IS-10 (no signal live without current proof; a genuine sustained mismatch still revokes). Either discount renderer samples that are re-entry repeats of a stale position (for example the first sample after pointerenter, or a sample equal to a previously delivered point while the compositor cursor has moved), and/or allow re-grant after a run of agreeing samples without a show/focus rebind. Tests first: replay the recorded XWayland sample sequence and assert no revocation; a genuine offset (the todo 9 failure scenario) still revokes; re-grant rules covered. Live: on XWayland, repeat the todo 32 crossing sequence (crossings 1-6) and show presses on her keep reaching the stage; KWin native todo 9 failure scenario still revokes.
  Acceptance criteria: the new tests fail before and pass after; live XWayland crossings 1-6 keep verification with raw receipts; the todo 9 offset failure still revokes; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-33-xwayland-reentry.md`.
  Commit: Y | `fix(stage-tamagotchi): ignore stale XWayland re-entry samples when verifying the cursor`

- [~] 34. Diagnose the intermittent XWayland press that falls through while verification stays live (follow-up from the todo 33 gate)
  Gap [~]: no product defect found in the press path. Rested XWayland presses fall through only on transparent or edge model pixels (baseline 4/30 with the composite-screenshot locator; 30/30 with an alpha-qualified locator, 0 opaque fall-throughs). The original todo 33 loss and baseline crossings 2 and 7 have no independent alpha sample; crossing 7 was an edge pixel transparent for ~400 ms. The real shutdown relaunch offer is fixed in 4382a33cc (task-34-gate-review.md).
  Recommended task executor category: deep-low - live diagnosis with temporary instrumentation, then a fix or a recorded gap.
  Finding (`.omo/evidence/linux-sensor-parity/task-33-gate-review.md`, residual undelivered_press): in `/mnt/dev/projects/dtuber-wt/lsp-t33/.temp/qa/t33-xwayland/receipts/cross-3.json` a rested press on her at 917,690 went to Konsole with 0 stage pointerdowns while cursor, origin and displays were live and no revocation was logged; `c3-recheck.png` 76 ms earlier shows her torso under the aim. Trusted moves at the same point arrived just before and during the press, which suggests the click-through region toggled under a still pointer. 15 of 16 XWayland presses were delivered. Also seen: `[stage] Click-through is not usable on this desktop; offering the classic window` is logged at shutdown in every t33 XWayland app.log.
  What to do: reproduce on XWayland with temporary, uncommitted logging of the renderer hit-read result and every ignore-mouse toggle around each press (timestamps), running enough rested presses (at least 30) to measure the rate. Find the cause. If it is a product defect with a contained fix, fix it with a test first and show 30 or more consecutive delivered presses; otherwise record the root cause and rate and close the row `[~]` with the gap named. Separately, determine whether the shutdown offer line is a real offer at quit (fix if so, so no offer fires during teardown) or log-only noise. No motion constants changed; todo 13's Must NOTs hold.
  Acceptance criteria: a root cause with timestamps from instrumented runs; either a fix with a red-first test and 30+ consecutive delivered XWayland presses, or a named gap with the measured rate; the shutdown line explained (and fixed if it is a real offer); `pnpm verify` exits 0 for any commit.
  Evidence: `.omo/evidence/linux-sensor-parity/task-34-xwayland-press.md`.
  Commit: Y only if a fix lands | `fix(stage-tamagotchi): <describe the cause>`

- [x] 35. Fix the F2 final-pass findings (follow-up from the F2 final pass)
  Recommended task executor category: quick - test wait, one constant and one comment.
  Findings (`.omo/evidence/linux-sensor-parity/f2-code-quality.md`, "Final pass"): `control-button-tooltip.browser.test.ts:55` waits with `expect.poll` (vitest rule: subscribe to the exact event with a bounded timeout, no polling); `control-button-tooltip.vue:25` repeats the string `'linux-click-through-emulated'` instead of the `LinuxClickThroughEmulated` constant (`packages/stage-shared/src/host-capabilities/reasons.ts:27`); the NOTICE in `packages/electron-vueuse/src/composables/pointer-samples.ts:49` cites `.omo` evidence that is not in the repository.
  What to do: replace the `expect.poll` with a bounded MutationObserver promise set up before `hover()`; use the constant; point the NOTICE source at the bridge ADR section. Each change is a `fixup!` of its owning commit (todo 32 for the tooltip files, todo 33 for pointer-samples.ts).
  Acceptance criteria: the tooltip browser test passes three consecutive runs and still fails with the pointer-transparency removed; no `expect.poll` or `vi.waitFor` in branch-added lines; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-35-f2-final-fixes.md`.
  Commit: fixups into the todo 32 and todo 33 commits.

- [x] 36. Keep the floating chat window and the desktop overlay above other windows on KDE native Wayland (follow-up from F4, IS-3)
  Recommended task executor category: deep-low - route two existing callers through todo 10's actuator, tests first, live KWin read-back.
  Finding (`.omo/evidence/linux-sensor-parity/f4-ideal-state.md`, IS-3): `windows/chat/floating.ts:293-294,337,401` and `windows/desktop-overlay/window-contract.ts:60` call Electron `setAlwaysOnTop` directly, which KDE native Wayland ignores, so these windows are not kept above there; only the main stage window goes through the KWin keep-above actuator.
  What to do: route their keep-above requests through todo 10's KWin keep-above actuator and verification on KWin native, keeping the Electron call on other hosts; unit tests first. If Luke rules these windows out of scope, close the row `[~]` naming the gap in the plan and the ADR matrix.
  Acceptance criteria: unit tests fail before and pass after; live in a KWin qa:display session KWin reads back keepAbove true for both windows, and floating chat follows the main window's pin toggle; `pnpm verify` exits 0.
  Evidence: `.omo/evidence/linux-sensor-parity/task-36-keep-above-windows.md`.
  Commit: Y | `fix(stage-tamagotchi): keep floating chat and the desktop overlay above on KDE Wayland`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: unspecified-high - read-only audit. A fresh `omo-native-gate-reviewer` checks every todo's acceptance criteria against its evidence file, every Must have and Must NOT have against `git diff origin/main...HEAD`, the commit list against the Commit strategy, and that every `[~]` row names its reason. Verdict APPROVE or REQUEST_CHANGES with file:line.
- [x] F2. Code quality review
  Recommended task executor category: unspecified-high - read-only review of the full diff against `enforce-rules-for-typescript`, `enforce-rules-for-vitest`, root and nested `AGENTS.md`: `dbus-native` imported only in `transport.ts`; no `electron` import in `linux-desktop/` outside `index.ts`; no Linux/Wayland detection in consumers except the documented launch gate; NOTICE comments carry removal conditions; no `any`; no title logging; tests fail for the behavior they name.
- [x] F3. Real manual QA
  Recommended task executor category: unspecified-high - rerun, on the final tip, the happy and failure scenarios of todos 4, 8, 9, 11, 13 and the four todo 18 smokes inside fresh `pnpm qa:display` sessions with temp profiles; capture screenshots and run directories; tear every session down (`pnpm qa:display status` empty) and record receipts.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: unspecified-high - check the delivered behavior against IS-1 to IS-14 one by one using the Success criteria table and F3's evidence; any shortfall becomes a new `- [ ] N.` row, never a note.

## Commit strategy
- One branch, `luke/feat/linux-sensor-parity`, created from `origin/main` and rebased onto `origin/main` (never local `main`); one PR against `lschneiderny/airi`, rebase-merged, so every commit must pass `pnpm verify` on its own.
- One Conventional Commit per todo with the subject given in that todo; todo 7 adds a separate `docs(agents)` commit for agent configuration (root `AGENTS.md`: agent configuration changes stay separate); todo 19 commits nothing unless a triage todo lands.
- Docs that describe changed code ship in the same commit as the code (todos 2, 7, 8, 11, 13, 18); todo 20 carries the cross-cutting support statement.
- The last commit's body ends with `Plan: .omo/plans/linux-sensor-parity.md`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2, 7, 8 | todo 8 happy (konsole sample, own-process flip); todo 18 kwin and xwayland smokes with `foreground` verified | `.omo/evidence/linux-sensor-parity/task-8-foreground.md`, `task-18-host-smoke.md` |
| IS-2 | 2, 4, 9 | todo 9 happy (cursor event equals injected point); todo 18 kwin/xwayland `cursor` verified | `task-9-coordinates.md`, `task-18-host-smoke.md` |
| IS-3 | 9, 10 | todo 9 happy (origins live); todo 10 happy (keep-above read back, caption restores at 200,200) | `task-9-coordinates.md`, `task-10-actuators.md` |
| IS-4 | 5, 7 | todo 5 fake-ScreenSaver transitions; todo 7 lock forwarding test | `task-5-session.txt`, `task-7-bridge.md` |
| IS-5 | 11 | todo 11 happy (down then up over the portal) | `task-11-ptt.md` |
| IS-6 | 1, 13 | todo 13 happy (character click reaches stage, empty click reaches konsole) on KWin and X11; todo 13 failure (classic fallback) | `task-1-baseline.md`, `task-13-stage.md` |
| IS-7 | 12 | todo 12 happy (tone makes capture live) or recorded degraded cause | `task-12-audio.md` |
| IS-8 | 14 | todo 14 happy (konsole sample, fullscreen busy); todo 18 x11 smoke | `task-14-x11.md`, `task-18-host-smoke.md` |
| IS-9 | 15, 16, 17 | todo 15 happy; todo 16 fixtures (live `[~]`); todo 17 GNOME screenshot; todo 18 sway smoke | `task-15-sway.md`, `task-16-hyprland.md`, `task-17-gnome.md` |
| IS-10 | 2, 7, 9 | todo 2 mutation check; todo 9 failure (revocation); todo 4 failure (no KWin owner) | `task-2-contract.txt`, `task-9-coordinates.md`, `task-4-kwin-probe.txt` |
| IS-11 | 1, 2 | todo 1 steps 6-7 proxy (typecheck, Windows/macOS profile tests, release-note review); live smoke `[~]` for Luke in the PR body | `task-1-baseline.md`, `pr-body.md` |
| IS-12 | 4, 7 | todo 4 parallel-session probes and unload receipts; todo 7 `isScriptLoaded` false after quit | `task-4-kwin-probe.txt`, `task-7-bridge.md` |
| IS-13 | 2, 17, 20 | todo 20 claim-to-cell table | `task-20-docs.md` |
| IS-14 | 6, 18, 19 | todo 6 session commands; todo 18 four smokes; todo 19 matrix | `task-6-qa-display.txt`, `task-18-host-smoke.md`, `task-19-regression.md` |
