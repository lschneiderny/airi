# Character-behavior settings and the conversation register

Date: 2026-11-22
Status: accepted; CM7c implemented, with headless and rendered acceptance assigned to the orchestrator.

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md) and [State persistence](../context/state-persistence.md). The [performers plan](../../../.omo/plans/character-mind-performers.md) records departures, commands, results, and the acceptance handoff.

## Context

Behavior controls were split across renderer settings, expression performance, and Presence. Live2D and MMD could disagree about idle activities or touch. A renderer setting named `screenAwareness` combined screen placement and chat attention. Speaking rules lived beside sensor consent even though they decide when the character speaks rather than what she may observe.

CM7a's capability routing, CM5b's beat lock, CM6b's gaze and director inputs, S2's settings owners, and c6's mapping editor are already present. This slice preserves their ownership and motion constants. It implements D6 to D11 of the performers plan, approved on 2026-11-21. It supersedes the placement of controls in the [nonverbal channels ADR](2026-10-31-nonverbal-channels.md) while preserving that ADR's D9 and its historical body.

## Decisions

### D6: one behavior document belongs to the user

`useCharacterBehaviorSettings` owns `settings/character-behavior` through `useSettingsDocument`. This is a tier 1 settings document with leader-routed, acknowledged writes and replicated memory. It is the ninth tier 1 owner after S2, not a new persistence tier. The state registry owns deletion, and the desktop reset path creates the same owner.

The document is user-wide. Per-character performance and character profiles remain on the card. Sharing a card does not share quiet applications or other behavior preferences. Per-character overrides of these fields remain a follow-up with explicit inheritance and sharing rules.

### D7: decision rules and realisation have separate owners

The behavior document owns `idleActivities`, `touchReactions`, `cursorAttention`, and `chatAttention`; emotion `bands`, `mood`, `heldEmotions`, `intensity`, `held`, and `moodDynamics`; and speaking `unpromptedEnabled`, `chattiness`, `dontDisturb`, `quietApps`, and `speakDuringGames`.

Live2D keeps energy, screen lean, petting geometry and button requirements, and emotion strength. MMD keeps its energy, petting button requirement, and emotion strength. Expression performance keeps its picker and slot realisation rules. Presence keeps foreground, title, and browser consent, blocked applications, and the unprompted cue display switch. The conductor combines emotion behavior with expression realisation and the active card profile without changing defaults, odds, cooldowns, or hold lengths.

`screenLean` replaces the renderer's `screenAwareness` spelling. Inspection found that the old switch now controlled placement and chat attention only; cursor dismissal already followed cursor permission and attention state. Import copies it to screen lean and chat attention. Cursor permission is shared with MMD independently.

The mind receives idle, touch, and chat switches through a `behavior` stimulus. These permissions are fast state, replayed after reset. Changing unrelated emotion or speaking fields does not send that stimulus, and replay writes no settings. Idle off suppresses acts, errands, and sleep; touch off yields no reaction intent; chat attention off yields neither chat-read nor chat attend.

The plan proposed removing the null idle drive. The existing performer also uses null to release active acts, remove energy offsets, prevent settling, and withdraw cues. Removing it would change Natural with idle disabled. It therefore remains the realisation cutoff while the mind independently suppresses decisions. A deterministic regression compares disabled policy with the null-drive reference. Touch classification remains available under the performer declaration; permission edges withdraw the hand without inventing a pet-end reaction, and the mind retains habituation history.

Renderer packages receive behavior as scene inputs because importing the stage-ui owner would create a package cycle. Emotion stimuli retain the expression slot hold constraint alongside emotion behavior because the current hold policy reads it. Neither boundary changes policy constants.

### D8: one Behavior page holds the controls

Settings > Behavior has Idle, Touch, Attention, Feelings, and Speaking up sections. Renderer pages keep realisation controls and link to Behavior. Presence keeps sensor controls and the cue display switch, and links to Behavior. Route metadata registers the entry and icon in both settings homes; search has the same owner. No shared component or layout API was added.

The controls use the owning store's acknowledged update action. The page exposes save failures, and quiet application text remains a draft until committed. Existing English labels are reused; other locales and the translation diagnostic baseline are unchanged.

### D9: old values import once, with off winning

If `settings/character-behavior` already exists, it wins. Otherwise a pure importer reads the four old raw documents before narrowing can discard their fields. It validates fields independently and also accepts the existing pre-document Natural keys when that renderer document is absent. Either renderer's valid false value wins for idle and touch. An empty profile uses defaults without creating a stored document.

The app creates the behavior owner before the mind and initializes it after leadership is available. Narrowing writers await the acknowledged import. A failed write leaves the old source intact. Once initialization has settled, deleting all data cannot recreate the behavior document from stale sources. The temporary importer states its removal condition: one release after CM7c and the retirement of the old import paths.

Contract extraction landed in c2; the four persisted schemas and their readers changed atomically in c3 so each commit remained buildable without compatibility accessors.

### D10: mapping weights stay in the card editor

The separately landed c6 editor belongs to the card's Performance section. Values are per card and per display model id, from 0 to 5; identity weight 1 is omitted. The key is `displayModelId`, not the avatar reference id.

The approved c6 departure uses the loaded stage's tier 5 catalog mirror, `useStageExpressionCatalogStore`, rather than stored catalogs, which contain curation rather than derived entries. The conductor publishes mapped entries and clears them on unload. A settings window reads the replicated snapshot; when its model is not loaded, the editor asks the user to show that character on stage. CM7c preserves this implementation and adds no derived catalog persistence.

### D11: the conversation register keeps its own document

`useConversationSettings` continues to own the user setting `settings/conversation`, shown in Settings > Conversation. `talking` remains the default; `texting` keeps its `plain` and `discord` flavors. The register renders prompt text, and no mind policy reads it, so it does not belong in the behavior document.

A per-conversation register on `ChatSessionMeta` fits future scene sessions better than a card-owned register. It remains a follow-up when scenes need it. This decision changes neither the upstream session type nor the stage contract, prompt hash, or card sharing rules.

## Consequences

A user who disabled idle or touch on only one renderer now has that behavior disabled on both. This is deliberate: importing settings must not enable something the user turned off. Controls move, but default Natural decisions and tuning remain unchanged. Universal, MAGIC, and classic retain CM7a's capability routing.

Node and browser tests cover import precedence, acknowledgement, narrowing, deletion, follower snapshots, behavior replay, disabled policies, renderer settings, and the new page. Dependent typechecks passed. The plan records command counts, repaired failures, and existing skips. Package browser fixture logs do not establish the app's renderer or main-process error count.

**Orchestrator acceptance placeholder:** headless scenario identity, rendered checks 6 to 9, light/dark Behavior page Vishot captures, and both-host smoke results are pending. The orchestrator must add run directories, gate/report lines, event kinds and counts without content, and renderer/main-process error counts here. This worker ran no `qa:*` command or Electron launch.

Headless acceptance includes all ten named scenarios, including `music`, at seed 1, with defaults identical to the comparison base. The disabled-idle run must emit no idle act. Rendered acceptance must verify old-profile import with MMD-only idle off, shared MMD cursor permission, c6's zero-weight exclusion over ten ACT emotions, and deletion without resurrection. Capture the Behavior page in light and dark at desktop and mobile widths.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.
