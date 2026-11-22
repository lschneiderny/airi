# Fork-owned store tiers

Date: 2026-11-21
Implementation: 2026-11-22
Status: accepted. Slice S2 of the [character mind roadmap](../context/character-mind-roadmap.md) implements these decisions. Worker checks pass; rendered, applicable motion, and branch-gate acceptance belong to the orchestrator. Current rules: [State persistence](../context/state-persistence.md).

## Context

State persistence Target rule 3 applies where the fork owns the storage contract. The seven synced plain-ref stores, direct-command onboarding/card/tool settings, and the five renderers' per-model display keys already exist in adopted upstream `bd4f30391`. Rewriting them would contradict the upstream-first decision. Their registrations also mixed repository data with plain toggles, and broad prefixes could admit another fork setting without an explicit ownership decision.

Two fork-owned durable gaps remained: explicit analytics consent and five MMD realisation settings. Derived MMD clip metadata also lived on disk even though the stage rebuilds it from loaded clips. S2 addresses those gaps while preserving upstream keys and serialized formats.

## Decisions

The standing preference accepts every recommended option in the S2 plan.

| Decision | Choice | Reason |
| --- | --- | --- |
| S1 | Migrate fork-owned keys; retain explicit upstream exceptions | Preserves upstream intake without calling replicated plain refs safe tier 1 documents |
| S2 | One registry with literal ownership, exact keys, and honest mixed-tier splits | Prevents an upstream prefix from granting permission to add unrelated fork state |
| S3 | A leader-owned consent document with an SDK-independent main mirror | Consent and reset must work without an analytics SDK or DSN |
| S4 | One MMD realisation document with explicit model-id maps | Keeps one lifecycle and persistence owner while preserving per-model choices |
| S5 | Epoch-scoped synced memory for derived clip metadata | Settings can read the stage's catalog without loading clips or persisting stale derived data |
| S6 | Leader-only import, new-document precedence, acknowledged save before cleanup, and one deferred driver claim | Preserves valid existing choices and the only saved copy when a write fails |
| S7 | An independent S2 slice | CM7c owns the character-behavior document; CM8's driver decision is outside this change |

## Persistence and migration contracts

### Consent

`useSettingsAnalytics` owns `settings/analytics` with one validated boolean, `optedIn`, default false. Its public `analyticsEnabled` projection remains readable; writes use awaited leader-routed actions.

The import reads only `settings/analytics/opted-in`. Missing or malformed values mean false. The older upstream `settings/analytics/enabled=true` was a default, never consent, and is not imported. A new document wins even when its value is false. After an acknowledged document save, cleanup removes both old keys. Reset writes false instead of importing.

The desktop startup bridge installs the existing `electronErrorReportingSet` boundary independently of SDK construction. Only the leader initializes and mirrors consent. Update and reset await that same boundary; a follower snapshot never calls it. Main's `errorReportingEnabled` remains a derived early-start copy using the existing main config persistence, not a second user setting. A rejected Eventa call is reported; there is no retry loop and no telemetry endpoint change.

### MMD realisation

`useMMDPerformanceSettings` owns `settings/mmd/performance`. Driver choices, stance slots, and clip curation are maps keyed by model id. Stage character height and roam mode are global fields. Height keeps its 560 DIP default and 200 to 1200 DIP range; roam defaults to `stay`. Upstream display, physics, lighting, and imported-motion storage remain unchanged.

The one-time reader enumerates every old scoped driver key, including inactive models, and reads the four old global fields. Validation preserves valid siblings, false permissions, null labels, and empty maps. A new document always wins. An invalid scoped driver resets only that model's driver to Natural.

A valid old unscoped driver is held in the optional `unassignedMotionDriver` import field when no eligible model is available. The first model-selection action without a scoped choice commits that driver and removes the import field from the saved document. An existing scoped choice wins and leaves the unassigned value available for the next eligible model. Model publication awaits the claim, so a renderer does not start with a different default.

Curation and stance actions merge against the leader's current maps, rather than accepting a follower's stale whole-map proposal. Curation actions reject duplicate or malformed labels and clear permissions for stance or unusable kinds. Read projections require own dictionary entries, so a valid name such as `constructor` cannot manufacture curation or an unloaded catalog entry.

Model deletion removes only that model's driver, stance, and curation entries. Reset ignores imports, clears transient metadata, writes defaults, and removes legacy keys. Every one-time reader carries a NOTICE removal condition: no supported release writes the old fork keys. There is no recurring old-key fallback or compatibility writer.

### Save acknowledgment

`useSettingsDocument` keeps persistence private with storage listening and default writes disabled. VueUse catches write errors, so assigning its ref alone was not proof of success. The helper now observes the synchronous error callback and publishes the document only after a successful save. Failed updates and resets reject, leaving migration cleanup unexecuted. Existing document callers use the same corrected boundary.

### Runtime metadata

`useMMDClipMetadata` holds only `{ modelId, loadEpoch, clips }` in synced memory. The stage is the producer. Settings reads `clipFor(modelId, name)` and never writes a snapshot back or saves it.

Every model or library load starts a new epoch and clears the previous inventory. Completed cached clips are republished from their loaded masks. A stale completion or failure is ignored at await boundaries; it cannot register a clip after a model switch, re-import, removal, or reset. Published data is cloned and contains no Three objects, timers, or pending promises.

Old global and scoped metadata keys are discarded, not imported. The runtime store has no persisted-state registration. The sweep-only `mmd-clip-metadata-legacy` registration owns those retired keys, and any surviving write to them fails the scanner.

## Registry and reset

Upstream plain owners declare their pinned revision, writers, and exact keys in the existing registry. The source scanner rejects new fork plain state, open upstream prefixes, undeclared keys and writers, overlapping owners, and legacy writes, including per-model writes. Removals remain legal. The two existing dynamic sites stay bounded by declared members; no second ownership list exists.

Mixed registrations split into `memory-settings`, `recipe-settings`, `layout-background-settings`, `sticker-settings`, and `mmd-motion-files`. Owner resets are not duplicated, and partial reset lists include the split locations. Voiceprints remain first, expression documents precede display-model removal, chat remains sweep-first, and caches are last. The Sherpaw cache was previously interleaved and is now in that cache tail. Voiceprint deletion time and the sticker migration marker remain the only kept locations.

The seven upstream replicated-plain-ref stores still write storage when replicas receive snapshots. Upstream direct-command and per-model plain settings also remain explicit exceptions. S2 closes the fork-owned target; it does not relabel or conceal those limitations.

## Verification and remaining acceptance

The plan records every command, pass count, implementation departure, and commit. Node tests cover import precedence, save failures, per-model preservation, reset, deletion, curation invariants, and epoch rejection. Real synchronized Pinia runtimes cover leader-only persistence, follower snapshots without proposals, and runtime catalog replication. Registry and maintenance browser tests cover new and retired keys across models. Full touched-package Node suites and dependent typechecks pass.

The orchestrator still runs the disposable-profile rendered scenarios and `pnpm verify --gate`, with motion checks if the gate selects them. No Electron or QA run, push, install, package manifest change, or lockfile change was performed by this worker.

## Outside this decision

CM7c's behavior document, CM8, upstream plain-ref redesign, analytics endpoint selection, unrelated main-process settings, background mount consolidation, and retirement of the unused outbox remain separate work.
