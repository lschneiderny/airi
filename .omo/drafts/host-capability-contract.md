---
slug: host-capability-contract
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/host-capability-contract.md
plan_sha256: b3993c319a68d1791578c357282fbab69ded95371de1a26aa569eeec9aab40ca
review_round_id: hcc-r13-1794168094906
phase: review_approved
round_status: approved
review_round_limit: 5
pending-action: handoff (execution via /ulw-execute host-capability-contract)
review:
  plan_reviewer:
    status: approved
    workspace_root: /mnt/dev/projects/dtuber
    runtime_home: null
    target: .omo/plans/host-capability-contract.md
    round_id: hcc-r13-1794168094906
    plan_sha256: b3993c319a68d1791578c357282fbab69ded95371de1a26aa569eeec9aab40ca
    launch_id: hcc-r13-1794168094906-launch1
    session: st_01a1bcc0
    result: "r13 OKAY (unconditional approval, no notes)"
    previous: "r1 st_01a1bca7 REJECT (B1-B3) fixed; r2 st_01a1bca9 REJECT (B4 frozen idle accepted by >=5 rule in todos 4/16; B5 todo 18 attribution branch could skip tuning without all-level pass, T3 permission path) fixed; r3 st_01a1bcab REJECT (B6 per-machine idle constant generalised to all Wayland hosts; B7 raw cursor via screen.ts invokes and spotlight) fixed; r4 st_01a1bcae REJECT (B8 smoke exact-equality vs runtime idle flip; B9 todo 6 required a live fixture todo 4 may not produce) fixed; r5 st_01a1bcb0 REJECT (B10 XWayland stale inside-window cursor; B11 host-profile sink bypassed the resolver; B12 final smoke missing --expect-idle) fixed; r6 st_01a1bcb2 REJECT (B13 watching-window expectation 63 s vs resolver 70 s and idle-only scope; B14 smoke rejected startup-verified idle) fixed; r7 st_01a1bcb3 REJECT (B15 chat anchoring and other main-process consumers of the hidden window origin) fixed via new todo 22 covering all 38 getBounds sites; r8 st_01a1bcb7 REJECT (B16 tray applyWindowSize origin anchoring) fixed, plus pre-emptive fixes for rect invokes and ambient-light origin use; r9 st_01a1bcb9 REJECT (B17 uiohook accessibility/start failures reported live; B18 smoke canonical macOS snapshot vs version-dependent audio) fixed; r10 st_01a1bcbc REJECT (B19 degraded foreground stopped sampling; B20 runtime hook failures made recovery unreachable) fixed; r11 st_01a1bcbd REJECT (B21 caption initial placement from origin; B22 notice missing in desktop-stage mode; B23 commit order vs dependency order) fixed; r12 st_01a1bcbf REJECT (B24 resizeWindowByDelta misclassified as size-only) fixed"
approach: host capability contract (C1-C6) + idle retune + lint guard on branch luke/feat/host-capability-contract; probes settle Wayland cursor/idle statuses
---

# Draft: host-capability-contract

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- U1 Luke as the end user on any of the three OSes: runs the Electron app daily and judges whether she feels like a VTuber living in the corner of the screen. Today on Linux Wayland she silently runs blind (idle-only, stale cursor), and he only noticed by feel.
- U2 Developers and agents changing host or motion code: today they re-detect Wayland/Linux per call site and accept features on one OS; after, they read one capability snapshot and see a host parity matrix.
- U3 The QA harness (qa-tools gates, T3 runner): today it injects perfect signals and cannot notice a host that delivers none; after, it checks host delivery per OS and holds idle-on-a-blind-host to liveliness bands.
- U4 Consumers of the performance resolver / situation / Natural: today they get null, stale, or wrong values indistinguishably; after, they get only live values or an explicit unavailable.

Ideal state (draft, refined after discovery):
- IS-1 | One main-process source answers, per launch, which host the app runs on (OS, session type, Ozone backend, compositor when knowable) and the status of every host signal and actuator as live / degraded(reason) / unavailable(reason) | one answer stops drift like the XWayland idle bug
- IS-2 | No sensor ever emits a stale or fabricated value; an unmeasurable signal is reported unavailable instead (Wayland cursor outside the window, Wayland window origin) | consumers cannot tell stale from real
- IS-3 | Every capability-shaped platform branch reads the capability snapshot; OS-convention branches (key labels, updater, icons) stay as they are | single source of truth
- IS-4 | The resolver keeps unknown -> idle (Luke's decision) and Natural idle passes every natural-idle-liveliness metric at T1, T2 and T3 with the committed bands unchanged (today T3 fails still2 0.49 > 0.447) | a blind host must not look lifeless; retune is in this plan (Luke 2026-11-08)
- IS-5 | Luke can open a presence diagnostics panel listing each signal's status and reason on his machine | degradation is visible
- IS-6 | On the first launch on a host where a presence signal is unavailable, one dismissible notice names what she cannot sense; it never repeats once dismissed and is reset by delete-all | visible once, not nagging
- IS-7 | A per-OS host-signal smoke launches the real app and asserts the capability report matches the host and that live signals actually change | catches host delivery regressions
- IS-8 | A degraded-host motion-gate profile runs the gates with the inputs a blind host provides (mode idle, no cursor/placement) and fails when idle is lifeless | catches lifeless-on-Linux regressions
- IS-9 | A host parity matrix ADR exists, and feature ADRs state per-host support | design-time visibility
- IS-10 | The web host reports the same capability shape (mostly unavailable) | one shape everywhere
- IS-11 | No regression on Windows/macOS: every currently-live signal stays live with identical values | Windows experience is the reference
- IS-12 | A new ad-hoc Wayland/Linux capability check cannot land silently: resolveIsWayland is importable only by the capability resolver and the pre-ready Chromium switch block, enforced by lint | prevention, the point of the redesign

Gap rows:
- GAP-1 (IS-1) | No capability service; Wayland detected in 7 places (findings: platform branches) | drift caused the XWayland idle bug | todos C1
- GAP-2 (IS-2) | Cursor stale/0,0 outside window on Wayland is emitted as real (screen.ts:14-25; electron#53794); window origin 0,0 on Wayland feeds placement as a real left-edge position (Electron docs getBounds note; index.vue:445-450); lock/unlock undocumented on Linux; always-on-top unavailable on Wayland (electron#50403); click-through forward is macOS/Windows only (verified docs) | consumers cannot tell | todos C2
- GAP-3 (IS-3) | isWayland branches in index.vue, stage.vue, use-chat-floating-click-through.ts; desktop-activity/uiohook/mode.ts compute their own | single source | todos C3
- GAP-4 (IS-4) | T3 idle liveliness fails still2 (memory dtuber-live-qa-linux-2026-11-08); T1 passes | lifeless blind host | retune todos
- GAP-5 (IS-5) | No diagnostics surface | invisible | todos C4
- GAP-6 (IS-6) | No notice | invisible | todos C4
- GAP-7 (IS-7) | No host-signal smoke; bridge state has no capability fields (bridge.ts:16-43) | QA bypasses host | todos C5
- GAP-8 (IS-8) | Scenarios cannot declare a host; T3 bridge forces mode via override (use-motion-qa-bridge.ts:150-154) | QA bypasses host | todos C5
- GAP-9 (IS-9) | No host parity matrix; renderer matrix only (2026-11-04 ADR) | design-time blind spot | todos C6
- GAP-10 (IS-10) | Web host writes no snapshot (stage-shared/README.md:52-54) | one shape | todos C1
- GAP-11 (IS-11) | Risk only: refactor touches Windows/macOS paths | reference experience | regression todos + F-wave
- GAP-12 (IS-12) | Nothing prevents new ad-hoc checks | recurrence | lint todo

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
- C1 | Capability contract: stage-shared type + reason codes + holder store; electron-eventa contract; main resolver service; web constant snapshot | active | architect memo st_01a1bc8e
- C2 | Truthful sensors: cursor reported only while trustworthy (null outside window on Wayland), window origin status, idle/foreground/global-key status read from the snapshot | active | screen.ts:14-25, window.ts:37-50, use-electron-mouse.ts:22-29
- C3 | Consumer migration: capability-shaped branches read the snapshot; electronAppIsWayland retired | active | index.vue:214-219,376; stage.vue:384-386,442; use-chat-floating-click-through.ts:130-133; desktop-activity.ts; global-shortcut-uiohook.ts:129-131,274-279
- C4 | Visibility: presence diagnostics devtools page + one-time dismissible notice | active | explore-ui st_01a1bc8c
- C5 | Host-boundary QA: per-OS host-signal smoke (resolver unit + live T3-path launch reading capability via bridge state) and degraded-host gate profile | active | explore-qa st_01a1bc8b
- C6 | Docs: host parity matrix ADR + feature-ADR per-host statements + READMEs | active | docs/ai/adr/2026-11-04-interaction-portability.md:53-79

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
- Diagnostics location | user-facing Settings > System > "Presence sensing" page, also linked from the Developer devtools menu | the notice must link somewhere a user can read | yes
- Notice form | vue-sonner toast with a "Details" action opening that page, shown once per host key (platform + sorted unavailable reason codes); dismissal stored in a settings document registered with useDataMaintenance per the persistence-tiers ADR | DESIGN.md preserves stage space; ADR forbids new plain useLocalStorage refs | yes
- Cursor rule | cursorScreenPoint unavailable on every Wayland session (native: origin hidden, #53794; XWayland: stale last position over native surfaces); live on Windows, macOS, X11 | plan-reviewer r1 B1, r5 B10 | yes
- Native Wayland idle | unavailable(wayland-idle-unverified) at launch; flips live once the running host shows idle advancing (idleAdvances over the existing 1 Hz poll); no per-machine constant | plan-reviewer r3 B6 | yes
- Window origin on Wayland | windowOrigin unavailable('wayland-window-origin-hidden'); Stage receives screenPlacement null there | documented Electron behaviour | yes
- Delivery | branch luke/feat/host-capability-contract from origin/main (8f24621f8), PR against lschneiderny/airi | plan-sized work per AGENTS.md; local main carries another session's unpushed commit | yes
- Idle fix carry-over | todo 1 applies .omo/drafts/host-capability-contract.idle-fix.patch (uncommitted 2026-11-08 desktop-activity fix) | it lives only in the dirty main checkout | yes
- Idle retune bounds | bands frozen; only the idle constants from 8e424fd1b may change (OU sd/tau/filterTau, hold distribution divisor, activity-spell exponents, yaw gain); smallest change that passes T1/T2/T3 median; Luke's visual review is a partial [~] row | qa-tools guide forbids tuning gates to pass | yes
- darwin-arm64 observer hash pins | re-pin rows marked partial for Luke's Mac | 8e424fd1b precedent | yes

## Findings (cited - path:lines)
- Cursor: main loop screen.getCursorScreenPoint() emits on change (apps/stage-tamagotchi/src/main/services/electron/screen.ts:14-25); contract packages/electron-eventa/src/electron/screen.ts:5-6; consumer packages/electron-vueuse/src/composables/use-electron-mouse.ts:22-29, use-electron-relative-mouse.ts:8-14; Stage.vue:553-557 sets cursorMovedAtMs on every prop change. Wayland: stale outside window (#2521 NOTICEs at controls-island/index.vue:166, pages/stage.vue:380).
- Window bounds: main loop emits getBounds (main/services/electron/window.ts:37-50); contract electron-eventa/src/electron/window.ts:5-10; composable keeps last value, initial zeros (electron-vueuse/src/composables/use-electron-window-bounds.ts:7-31). Feeds screenPlacement (renderer/pages/index.vue:445-450, stage.vue:161-164).
- Idle: desktop-activity.ts:34-42 (null only under XWayland after 2026-11-08 fix, uncommitted at time of drafting); contract electron-eventa/src/electron/powerMonitor.ts:15-19; renderer producer stores/desktop-activity.ts:107-140.
- Power events: main/services/electron/powerMonitor.ts:27-30; consumer stage-ui/src/stores/situation/sensors/desktop.ts:84-115.
- Foreground: foreground-window.ts:41-65 returns null off win32/darwin; contract electron-eventa/src/electron/foreground-window.ts:30-35; consumer stage-ui/src/stores/situation/sensors/foreground.ts:38-48,106-118.
- System audio: renderer/features/live2d/system-audio-lipsync.ts:43-53 getDisplayMedia({video,audio}); no setDisplayMediaRequestHandler in main; store stage-ui/src/stores/system-audio-lipsync.ts:49-59,91-96.
- Screen change: renderer/composables/use-screen-ambient-light.ts:289-290 getDisplayMedia; stores/desktop-activity.ts:97-114 null when inactive.
- Global keys: global-shortcut.ts:81-117 (Electron globalShortcut vs uiohook for key-up); uiohook refuses native Wayland global-shortcut-uiohook.ts:129-131,274-279.
- Actuators: click-through forward main/services/electron/window.ts:82-85; host mode Linux -> window windows/stage/mode.ts:35-40; always-on-top levels windows/shared/window.ts:94-116; drag plugin off on Linux windows/main/index.ts:202-225, dashboard :147-170.
- Platform branches (renderer): ResizeHandler.vue:6-12 isWindows (OS convention), push-to-talk-shortcut.vue:10,55 isMacOS (convention), controls-island/index.vue:77,304,567 isLinux (drag API choice - platform fact), use-chat-floating-click-through.ts:131-132 isWayland (capability), about.vue:85-103 updater (convention), pages/index.vue:214-219,376,389 isWayland (capability), settings/system/general.vue:15-21 isLinux (platform fact: app icon), pages/stage.vue:384-386,442 isWayland (capability), utils/shortcut-recording.ts:3,19 isMacOS (convention); packages/electron-vueuse/src/composables/use-electron-window-resize.ts:8 isWindows (convention). Main: index.ts:105-152 Chromium switches pre-ready (stays), desktop-activity, foreground-window, global-shortcut-uiohook, windows/stage/mode.ts (launch-time; cite reason code), app.ts:16-21 (electronAppIsWayland source).
- Web host: apps/stage-web/src/pages/index.vue:76-79,114-117 passes DOM useMouse coordinates; desktop snapshot stays null (stage-shared/README.md:52-54).
- QA: idle liveliness gate already runs with mode idle and NO cursor/placement/chat inputs (qa-tools/src/motion/gate/t3-scenario.ts:396-402; scenario-sink.ts:178-188); gate defs stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts:47-84 (v2); still2 band [0.22,0.4467] reference-stats.ts:31; T3 on Linux: cursor parking/pointer Windows-only (t3/cursor.ts:10-20,84-89; t3/pointer.ts:32-48; run-t3.ts:94-102). Bridge state has no capability fields (stage-shared/src/motion-scenario/bridge.ts:16-43; stage-ui/src/composables/performance/use-motion-qa-bridge.ts:88-112). T3 launch path reusable: qa-tools/src/t3/launch.ts:20-47,93-101. Existing Linux built-app smoke: apps/stage-tamagotchi/scripts/linux-window-render-smoke.ts.
- UI: devtools pages registered in settings/system/developer.vue:48-175; closest panels: stage-pages/src/pages/devtools/situation/index.vue, components/devtools/live2d-ambient-light/diagnostics-metrics.vue; primitives Callout (packages/ui/src/components/misc/callout.vue), StatusCapsule, Alert; i18n en source packages/i18n/src/locales/en/tamagotchi/settings.yaml; persistence-tiers ADR closes plain useLocalStorage refs to new state (docs/ai/adr/2026-11-01-persistence-tiers.md:13-38) and requires useDataMaintenance registration (stage-ui/src/composables/use-data-maintenance.ts:92-166).
- Architect memo (st_01a1bc8e): type in packages/stage-shared/src/host-capabilities, store stage-shared/src/stores/host-capabilities.ts (not synced), main service main/services/electron/host-capabilities.ts with pure resolveHostCapabilities(facts), eventa contract in packages/electron-eventa (electron-vueuse consumes it); cursor gated to inside-bounds when degraded + cursorScreenPointLost event; nullable useElectronMouse is the riskiest seam; snapshot is an event (statuses can flip at runtime: koffi load failure, accessibility grant), served per window.

## Decisions (with rationale)
- [2026-11-08 Q1] Host scope: all Electron hosts; web same shape mostly unavailable (Luke, recommended).
- [2026-11-08 Q1] Fallback: keep unknown -> idle, no substitute signals (Luke, declined recommended substitutes).
- [2026-11-08 Q1] Visibility: panel + one-time notice (Luke, recommended).
- [2026-11-08 Q1] QA: per-OS smoke + degraded-host gate profile + host parity ADR (Luke, recommended all).
- [2026-11-08 Q2] Degraded gate = host-profile scenarios: scenario declares host; T1 sink and T3 bridge strip signals that host cannot deliver via resolveHostCapabilities; T3 uses the real resolver (no mode override); bands unchanged (Luke, recommended).
- [2026-11-08 Q2] Idle retune INCLUDED in this plan (Luke overrode recommended separate plan).
- [2026-11-08 Q2] Live smoke allowed on this Linux machine (Wayland + XWayland) in a worktree with temp profiles; Windows/macOS live rows partial [~] for Luke (Luke, recommended). This is a one-plan override of the standing live-QA deferral agreement.
- [2026-11-08 Q2] Tests: TDD for pure parts (resolver, reason codes, cursor validity rule, scenario host stripping); tests after for wiring and UI (Luke, recommended).
- Librarian (st_01a1bc8d) verified-by-me: setIgnoreMouseEvents forward is macOS+Windows (docs at Electron 43.4.1 commit 340bae15); getBounds on Wayland returns x:0,y:0 (same docs); issue #53794 reports getCursorScreenPoint always {0,0} on Hyprland/Electron 43.1. Unverified: native Wayland idle providers, Linux lock/unlock delivery, display origins on Wayland, getDisplayMedia audio on Linux.

- Plan consultant st_01a1bc9b (2026-11-08): 26 findings folded in (worktree --base/--branch, T3 mode contamination + mode-left-idle + override reset, XWayland globalKeyUp/cursor rows, cursor rule without dedupe-as-rejection, regex lint pattern, rg checks per commit, web main.ts, mock-dependent tests, delete-all proof + ADR row, T3 budget baseline+2 and unattended confirmation, qa-tools anti-pattern override recorded, attribution step 0, data-testid assertions, check-doc-paths).
- Convergence ledger (frozen after r1): B1 native-Wayland cursor accepted via untrusted origin (todos 2,4,7); B2 host-profile leaks via bridge placement (use-motion-qa-bridge.ts:168-171) and sink pointer->cursor (scenario-sink.ts:295) (todo 17); B3 failing-test commits and todo 5 contract break vs green-commit rule. B4 (r2, new): frozen idle reading passes todos 4/16. B5 (r2, new): todo 18 step 0 and T3-permission path leave IS-4 unproven. B6 (r3, new): committed idle constant generalises one machine. B7 (r3, new): raw cursor escapes via invokes/spotlight. B8 (r4, new): smoke equality vs runtime idle flip. B9 (r4, new): conditional live fixture. B10-B12 (r5, new). B13-B14 (r6, new). B15 (r7, new). B16 (r8, new). B17-B18 (r9, new). B19-B20 (r10, new). B21-B23 (r11, new). B24 (r12, new). Notes: none. Rounds: 13; r13 approved unconditionally on the live digest.

## Scope IN
- C1-C6 components; idle retune; lint guard; parity ADR; README/AGENTS updates for touched packages.

## Scope OUT (Must NOT have)
- No substitute signals and no change to resolver unknown -> idle semantics.
- No liveliness/emotion gate band or version changes.
- No new compositor-specific sensors (KWin D-Bus, GNOME extensions, X11 _NET_ACTIVE_WINDOW foreground).
- No Electron version bump (X11 click-through regression electron#52456 is a follow-up note).
- No edits to frozen non-English locales.
- No edits to the other session's dirty files in the main checkout (turbo.json, vitest configs, scripts/dev-tools/*, electron.vite.config.ts).
- No re-enabling the desktop stage on Linux.

## Open questions
- none (all forks answered 2026-11-08)

## Approval gate
status: approved (Luke, 2026-11-08, "Approve")
approach: six components (contract, truthful sensors, consumer migration, visibility, host-boundary QA, docs) plus idle retune and a lint guard, delivered on branch luke/feat/host-capability-contract; probes settle the Wayland cursor and idle statuses before they are fixed.
next-action: on Approve -> scaffold plan, plan-consultant, append todos, TL;DR last, self-check, plan-reviewer rounds.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
