---
slug: linux-sensor-parity
status: reviewed-approved
intent: clear
review_required: true
plan_path: .omo/plans/linux-sensor-parity.md
plan_sha256: 04454544375f10e7daeea5add65d15daa327d59e29aa18401f2bae71a096c075
review_round_id: lsp-r4-mw9eebxy
review_round_limit: 5
pending-action: none (plan approved by plan-reviewer round 4; execution starts only on Luke's /ulw-execute)
review:
  plan_reviewer:
    status: approved
    workspace_root: <main checkout>
    runtime_home: null
    target: .omo/plans/linux-sensor-parity.md
    round_id: lsp-r4-mw9eebxy
    plan_sha256: 04454544375f10e7daeea5add65d15daa327d59e29aa18401f2bae71a096c075
    launch_id: lsp-r4-mw9eebxy-launch
    session: st_01a1c0dc
    result: OKAY (st_01a1c0dc, round 4, notes-only)
approach: one Linux desktop bridge in Electron main (KWin script backend first, then X11 EWMH via koffi, sway/Hyprland IPC; GNOME honest reason) feeding runtime-verified HostFacts; session lock/busy over D-Bus (dbus-native); portal GlobalShortcuts PTT with host Registry app id; Electron 43.8.7 + cursor-driven click-through emulation for the desktop stage; system-audio live verification; QA harness + docs/supported-platform statement
---

# Draft: linux-sensor-parity

> Status 2026-11-17: superseded in part. Only KDE Wayland is checked on Linux; sway, X11, and Hyprland are planned, not checked, and the classic window fallback is scheduled for removal. Current rules: [Linux desktop bridge ADR](../../docs/ai/adr/2026-11-09-linux-desktop-bridge.md), [README Platform support](../../README.md#platform-support), [character mind roadmap](../../docs/ai/context/character-mind-roadmap.md). Its body is frozen history.

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- U1 Linux desktop user (Luke: Fedora 45, KDE Plasma 6.8.2 Wayland; also Kubuntu/SteamOS/Bazzite KDE, X11 WMs, GNOME, Hyprland/sway). Today she cannot see what he is doing, cannot follow the cursor outside her window on Wayland, push-to-talk key-up fails on Wayland, there is no desktop stage on Linux, always-on-top does not work on Wayland, and lock is degraded. Afterwards the app behaves like it does on Windows wherever the desktop can prove the signal.
- U2 Windows/macOS users: they consume the same app after any shared-contract or Electron change and must see no regression.
- U3 Agents and developers: the capability contract, Presence sensing diagnostics, `pnpm qa:host smoke`, `pnpm qa:display`, and the host parity ADR.
- U4 Prospective users reading the README: what the fork claims per platform.

| id | ideal-state property | reason |
| --- | --- | --- |
| IS-1 | On KDE Plasma 6 (Wayland, XWayland, X11), foreground awareness matches Windows: focused app, title, pid, own-process flag, busy (fullscreen / do-not-disturb / game), with the same sharing, denylist, freshness and 120-character rules | chat pillar: "she knows what he is doing" |
| IS-2 | On KDE Wayland and XWayland, the global cursor feeds gaze and attention like Windows, including outside her window | motion pillar |
| IS-3 | On KDE Wayland, window origin and display origins are trusted, so placement and caption/widget persistence work, and always-on-top holds | parity for placement and the stage |
| IS-4 | Screen lock feeds away detection on every Linux session with a live status | away/idle behaviour parity |
| IS-5 | Push-to-talk delivers key-down and key-up on Wayland and XWayland (portal), and X11 keeps the proven uiohook path | voice chat parity |
| IS-6 | The Experimental 3D desktop stage runs on KDE Wayland and X11, with click-through that never traps the desktop (an unverified state fails to ignoring and falls back to the classic window) | motion pillar: the desktop stage |
| IS-7 | System-audio capture on Linux is verified live, or stays degraded with a reason the user can read | watching-mode parity |
| IS-8 | Any EWMH X11 session gets foreground window, cursor and lock | other Linux machines |
| IS-9 | Other compositors (GNOME, Hyprland, sway) report every signal they can prove, and every other signal is honestly unavailable with a reason | other Linux machines, honesty |
| IS-10 | A signal is live only after the running host proves it; a failure falls back to today's status with a stable reason; nothing stale or fabricated reaches consumers; Presence sensing shows verifying/live/degraded/unavailable | contract rule (2026-11-08 ADR) |
| IS-11 | Windows and macOS behaviour is unchanged, including after an Electron bump | no regression for U2 |
| IS-12 | The KWin bridge adds no noticeable compositor load: coalesced pushes, cursor pushes only while a cursor loop runs, the script unloads on quit, and a stale script from a crash is cleared on start | Luke's own desktop health |
| IS-13 | The host parity ADR matrix, the app README and the root README state per-platform support honestly, and English i18n labels exist for every new reason | the "don't advertise without sensors" thesis |
| IS-14 | Every Linux backend is proven by agent-run QA in `pnpm qa:display` (headless KWin), with `qa:host smoke` expectations per backend, without disturbing the user's desktop | verification parity |

| gap | today | reason |
| --- | --- | --- |
| GAP-1 | foregroundWindow unavailable on all Linux (`foreground-window.ts:44-72` has no Linux sampler) | no binding |
| GAP-2 | cursorScreenPoint unavailable on Wayland/XWayland (`index.ts` Linux branch; `screen.ts:13-48` uses Electron only) | Wayland hides the global pointer from clients |
| GAP-3 | windowOrigin, alwaysOnTop unavailable and displayOrigins degraded on native Wayland | no client-side origin or z-order on Wayland |
| GAP-4 | screenLock degraded on Linux; Electron `lock-screen` is Windows/macOS only (`powerMonitor.ts:8-18`) | no Linux lock source |
| GAP-5 | globalKeyUp unavailable on Wayland/XWayland (uiohook is X11-only, `global-shortcut-uiohook.ts:132-148`) | no portal driver |
| GAP-6 | Desktop stage forced to classic on Linux (`mode.ts:33-39`); clickThroughForward unavailable; Electron 43.4.1 breaks X11 ignore on resize (electron#52456) and lacks Wayland ignore | missing toggle, cursor and origin |
| GAP-7 | systemAudioCapture degraded "unverified" on Linux although `PulseaudioLoopbackForScreenShare` + `loopback` are already wired (`electron-screen-capture/src/main/index.ts:32,238-247`) | never verified live |
| GAP-8 | X11 has cursor/origin/idle but no foreground window | no EWMH binding |
| GAP-9 | GNOME/Hyprland/sway get the generic Wayland statuses with no backend | no backends |
| GAP-10 | Facts are static except `waylandIdleVerified`; no "verifying" state for new runtime proofs | contract has one runtime fact |
| GAP-11 | No regression gate covering Windows/macOS after an Electron bump | not needed until now |
| GAP-12 | No compositor-side code exists yet; no lifecycle rules | new |
| GAP-13 | ADR matrix, `apps/stage-tamagotchi/README.md:26,59`, and the root README do not state Linux tiers | docs follow code |
| GAP-14 | `qa:host smoke` knows only the static Linux profiles; no bridge expectations | QA follows contract |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
Full notes: the ulw notepad at /tmp/ulw-20261109-090626.mn7ytE.md (explore-sensors, explore-qa-docs, architect, librarian lanes). Live KWin probe on Plasma 6.8.2 (this session): loadScript+run, then callDBus returned caption/resourceClass/desktopFileName/pid/fullScreen/keepAbove/frameGeometry/cursorPos; probe unloaded (isScriptLoaded false).

## Decisions (with rationale)
Owner answers (ask_user_question, 2026-11-09, batch renderer, all recommended options):
- D1 Desktops: KDE Plasma 6 + X11 (EWMH) + Hyprland/sway IPC. GNOME reports `gnome-needs-extension` honestly; README lists GNOME as limited. No GNOME Shell extension in this plan.
- D2 QA environments: Luke installs packages (`sudo dnf install sway xorg-x11-server-Xvfb openbox`) before the affected rows; agents run each backend headless. Hyprland is not in Fedora repos (dnf shows none), so Hyprland live rows use fixtures and close [~] unless Hyprland is present at execution time (announced default).
- D3 Electron: bump 43.4.1 -> latest 43.x (43.8.7 on 2026-11-09) inside this plan; agents run Linux smoke; Windows/macOS smoke left to Luke ([~] rows).
- D4 D-Bus library: `dbus-native` (0.16.3, 2026-10-28, deps xml2js only, client + exportInterface), wrapped in a promise transport.
- D5 Live QA: allowed for this plan's execution, headless only via `pnpm qa:display` (KWin) and Xvfb/sway sessions, temp profiles, never Luke's desktop. This is a scoped override of the standing live-QA deferral agreement for this plan only.
- D6 Test strategy: TDD for pure parts (detection, resolver facts, verification state machines, sample mapping, KWin message parser); tests after for D-Bus/compositor glue; agent-executed live QA always.
Announced defaults (from evidence, vetoable at the gate):
- A1 One Linux desktop bridge in main (`apps/stage-tamagotchi/src/main/services/linux-desktop/`), per-desktop backends, runtime-verified HostFacts, existing eventa channels, bridge is the coordinate authority on Linux.
- A2 clickThroughForward on Linux = `degraded(linux-click-through-emulated)` after verification; consumers accept it for the stage; unverified fails to ignoring + relaunch to classic.
- A3 screenLock live after a successful logind LockedHint / ScreenSaver subscription.
- A4 PTT: portal driver on Wayland/XWayland; uiohook stays on X11 (portal fallback when uiohook fails).
- A5 Plasma 5.27: script feature-detects API level; only Plasma 6 live-tested.
- A6 System audio: verify the existing loopback wiring live; flip status only on proof.
- A7 Electron bump also gates X11 stage (electron#52456).

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (ask_user_question header Approval, answer "Approve", 2026-11-09)
next workflow action: write and review .omo/plans/linux-sensor-parity.md (pending_action_policy review_required)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan generation log
- Plan written 2026-11-09 after approval; plan-consultant st_01a1c0bd returned F1-F21, folded into todos 1-13 and 18 (coordinate provider, launch gate from detection, verifying excluded from notice, backend field, interim smoke tolerance, qa:display portals/compositor-aware env, per-pid KWin names, Plasma 5 failure path, dependency fail-fast checks, private PipeWire for audio QA, MMD QA model at <model library>/MMD/WuWa_Iuno_Rigged). F15 (dbus-native stale) disproved by npm registry 2026-11-09 (0.16.3, 2026-10-28); F17 resolved by a local MMD model.
- Structural self-check PASS: 0 violations, rows 1-20 + F1-F4, every todo has a category line, header order matches the template.
- Review round 1: lsp-r1-mw9e654x, sha e8711821f6b8cf37423bf94b3ae43c4ef1254cdf9ce2221d0f0e1d352d2de98b.
- Round 1 (st_01a1c0d6): REJECT (changes_requested), 2 new blockers: B1 stationary cursor invalidated by 1 s gap rule (todos 4/9); B2 X11 coordinate ownership conflict (todos 9/14). Both fixed: silence never invalidates the cursor (null only on transport failure), cursor script sends position at load, 5 s rest QA in todos 9 and 13; per-backend/session coordinate ownership table in todo 9 (X11 keeps Electron), X11 coordinate regression QA in todo 14, deps 13<-14.
- Self-check after fixes: 0 violations. Round 2: lsp-r2-mw9e8z6e, sha 91c7b1210ed18e3d5ebf4f33d91bb79ab4e348a5cc95018869898d9cb20a1153.
- Round 2 (st_01a1c0d8): REJECT, 2 new blockers: B3 inherited KDE env can make sway/X11 QA sessions pick kwin (todos 3/6); B4 todo 19 required desktop stage on sway, which todo 13 excludes. Fixed: detection checks compositor sockets before desktop names; todo 6 defines set+deleted env keys per compositor with tests from an inherited KDE env and a live env check; todo 19 has per-session expected host mode (sway = classic window), README wording updated.
- Self-check: 0 violations. Round 3: lsp-r3-mw9ec03v, sha 99a4fb3a4d0851fd7054278ddfa63909727b8059a162506b42025b4a2afb04f9.
- Round 3 (st_01a1c0da): REJECT, 2 new blockers: B5 clickThroughToggle excluded XWayland while todo 19 required the XWayland stage; B6 portal readiness on CreateSession contradicted denied-bind QA. Fixed: toggle on every Linux session >= 43.7.6 plus resolver case for kwin+xwayland; portalShortcuts absent|session|bound lifecycle (bound only after a successful key-up bind; revoked on denial, ShortcutsChanged, Closed), new reason linux-portal-shortcut-unbound excluded from the notice, driver lifecycle tests.
- Self-check: 0 violations, stale tokens []. Round 4: lsp-r4-mw9eebxy, sha 04454544375f10e7daeea5add65d15daa327d59e29aa18401f2bae71a096c075.
- Round 4 (st_01a1c0dc): OKAY, no blockers. Live plan sha 04454544375f10e7daeea5add65d15daa327d59e29aa18401f2bae71a096c075 matches the recorded round sha. Review converged after 4 rounds (6 blockers raised and closed).
