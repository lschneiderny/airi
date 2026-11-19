# State registry

Date: 2026-11-19
Status: accepted. Step S of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/refactor/state-registry`. It lands State persistence Target rules 1, 2, and 6, which the [character mind ADR](2026-11-17-character-mind-direction.md) accepted on 2026-11-17, and builds on the [persistence tiers ADR](2026-11-01-persistence-tiers.md). The owner was away while the step ran, so each decision below took the recommended option and stays open to the owner's veto. Current rules: [State persistence](../context/state-persistence.md).

## Context

The members of persisted client state were listed only in a hand-kept table of the state persistence doc, and nothing checked the table against the code. The table missed the theme key `vueuse-color-scheme`, the OPFS copies of imported models, and the Transformers.js cache, and it named an IndexedDB database that does not exist.

"Delete all data" reset a fixed list of stores in `useDataMaintenance`. It missed more than thirty owners, among them three stored credentials (the Artistry API keys, the mods server channel token, and the desktop server channel token), uploaded background and sticker images, saved tool-card results, and the OPFS model copies. Audit revision R1 of the [architecture audit](../audits/2026-10-31-architecture-boundaries.md) had asked for the fork's stores to be added to that list; the list kept falling behind.

A failure in one reset stopped every later deletion, except among the module resets, which settled together. Two keys had two writers each: `settings/language` and `vueuse-color-scheme`. Four settings documents still hand-rolled their persistence instead of using `useSettingsDocument`.

## Decision

### The registry

1. **One PR (D1).** The four settings documents and the registry land in one PR of eight commits. Each commit passes `pnpm verify`, and one rendered check covers both parts.
2. **The registry is runtime code (D2).** `stateRegistry` in `packages/stage-ui/src/persistence/state-registry.ts` holds one registration per owner reset, and "Delete all data" runs it. A declaration that only a test read would be a second list that drifts from the first.
3. **App and stage-layouts state is declared in stage-ui (D3).** Their locations are data in the same registry, swept without an owner reset, and their files are named in `writers`. This keeps one registration point, and no package imports the app.
4. **Caches get the tier value `cache` (D8).** The OPFS model copies, the Sherpaw model assets, and the Transformers.js cache are copies that the app can download or rebuild. Tier 4 means IndexedDB records, so folding caches into it would blur the tier.
5. **The Members tables are replaced by a pointer to the registry (D11).** The registry holds the same facts and a test checks it. The "Per-model display settings" section stays.
6. **The unused `outbox` mount is registered, not deleted (D14).** It is upstream's mount, and deleting it would conflict at every sync for no gain.
7. **Legacy keys are registered and swept, and a write to one fails the test (D15).** Without this, the orphan analytics key and the old sticker database survived "Delete all data". The scan's findings added a `retired-account-credentials` registration for seven legacy `auth/v1/*` keys.

### "Delete all data"

8. **Every registration runs, and so does the host step (D5).** A failure no longer stops later deletions. The first failure is reported after the last registration ran, and the host data step runs after a renderer failure too. A failed step must not keep later personal data.
9. **The gaps found are fixed in S (D6).** Each gap holds data that "Delete all data" promises to delete, and three of them are credentials.
10. **Both caches are cleared (D7).** The OPFS copies are the user's imported files. The Transformers.js cache follows the Sherpaw model assets, which were already cleared.
11. **The partial resets are typed id lists with today's membership (D12).** The providers, modules, chats, models, and desktop resets keep what they reset before, and no reset exists twice.

### Enforcement

12. **The focused test has two halves (D4).** A browser test captures every write while it creates and resets every owner, so it sees keys built at run time and the defaults that VueUse writes. A static scan reads every storage call site in the renderer source, so it sees writes in actions and components that no reset runs, in the app too.
13. **The static scan lives in `scripts/dev-tools` (D16).** Root tooling may read the whole repository, and `pnpm verify` already had a file guard for the policy docs, which now also runs the scan.
14. **Second writers become readers (D10).** `useLanguage` reads `settings/language` with `localStorage.getItem`, and the notice and loading screen read `useTheme().isDark` instead of calling `useDark`. Registering them as co-writers would break rule 6.

### Settings documents and QA

15. **Expression performance validates per field (D9).** It moves onto `useSettingsDocument` like the other five documents, so one invalid section resets alone instead of the whole document.
16. **QA triggers "Delete all data" through a bridge verb (D13).** The dev-only `deleteAllData` verb is reliable, and CM4 needs the same check. Importing the module in the stage window or clicking through the Data page would be fragile.
17. **The decisions are recorded in this ADR (D17).** The registry is a lasting design; the plan is history.

## Consequences

- "Delete all data" now deletes credentials and data it used to leave behind: the Artistry API keys, the mods and desktop server channel tokens, background and sticker images, tool cards, and the OPFS model copies. It also deletes the Transformers.js cache, so the Kokoro and VAD models download again.
- Retired `auth/v1/*` tokens are swept.
- Deleting the models also clears the in-memory stage selection.
- Settings documents are removed instead of being rewritten with defaults.
- A failure no longer stops later deletions, and the host step always runs.
- The `fade-on-hover` notice lost its theme transition.
- Upstream data handling: fixing these gaps deletes upstream-owned credentials that upstream's own "Delete all data" keeps. The fork does it because Target rule 1 ("Delete all data resets exactly the registered set") was accepted on 2026-11-17. This is an intersection with upstream's data handling, and it stays open to the owner's veto.
- A new storage key fails `pnpm verify` until it has a registration. A new slice adds its registration in the same commit.
- The main-process records stay with `storedDataDeleteActivity`, and perf records are a named exception.

## Not decided

- The storage that the PostHog and OpenPanel SDKs keep when an analytics build loads them. It waits for the ledger's open question on the analytics endpoints.
- State persistence Target rules 3, 4, and 5: tier moves for plain refs, one behavior settings document (CM7), and the mind's slow state in the per-card record (CM4).
- Deleting one display model still leaves its OPFS copy.
