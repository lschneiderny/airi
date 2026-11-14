# Stage UI Guidance

## CONVENTIONS

- This fork uses local data and direct or local inference providers. Read the account-free policy in `README.md`.
- Hosted adapters remain for saved-provider cleanup. Their presence does not make hosted services available in clients.
- Package exports target TypeScript source. `build` only prints a message and does not validate or bundle the package.
- Put component stories beside their components. Put independent stories in `stories/`.
- `vitest.config.ts` separates serial Node tests from headless Chromium browser tests.
- Browser tests scan product UnoCSS sources before the initial stylesheet. Preserve this configuration when changing test setup.
- Visual baselines (`*.visual.browser.test.ts`) compare screenshots with committed Linux references in `__visual-baselines__`. Read the README section `Visual baselines` before adding a test or updating references.
- For synced stores, read the root `enforce-rules-for-pinia-synced` skill. Install both plugins returned by `setupSynced`.
- Keep provider records serializable. Executable instances, request epochs, and tool executors stay local to their runtime.
- Synced stores disable storage-event replication when Pinia owns propagation.
- One audio host owns capture and playback. Other windows issue commands and render snapshots.
- `src/stores/chat.ts` is the integration hub where chat meets presence, unprompted turns, and memory. It may gain wiring lines only. A new system, such as touch observations, lives in its own module and talks to chat through chat store actions or the hooks and controls the store hands out (`useSituationStore().observeChat` is the pattern).
- Read the document-sync README before changing callers. Its design record is `server/docs/ai/adr/2026-10-06-document-sync.md`.

## COMMANDS

Run from the repository root. Select the project that matches the test file.

```sh
pnpm -F @proj-airi/stage-ui exec vitest run --project node src/libs/document-sync/reconcile.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/history.browser.test.ts
pnpm -F @proj-airi/stage-ui test:run
pnpm -F @proj-airi/stage-ui exec vitest run --project browser --update visual.browser
pnpm -F @proj-airi/stage-ui run story:dev
pnpm -F @proj-airi/stage-ui run story:build
```

## ANTI-PATTERNS

- Preserve the public `@proj-airi/stage-ui/stores` forwarding barrel. Prefer explicit subpaths for new consumers.
- Do not infer provider availability from an adapter file. Check registration and catalog filtering.
- Do not save cards from settings watchers or invoke activation commands when applying replicated snapshots.
- Never copy a previous card's overrides into global defaults. Models inherit only within the same provider.
- Keep selected sessions local to each window. Queued turns retain their session character.
- Never replay a whole model turn after tool execution starts. Request-only tools require current explicit selections.
- Keep durable image/audio history intact when projecting provider requests. Tool reruns also require the tool-image reader.
- Do not open microphones while rendering controls. Unsupported push-to-talk stays off rather than enabling continuous capture.
- Do not let stale catalog requests, account work, or transcription generations overwrite newer state.
- Do not treat WebSocket closure as completed synthesis without `session.finished`.
- Document-sync accepts small JSON documents, not secrets, files, or large chat histories. Omit removed fields instead of `null`.
- Write `applyLocal` changes before awaiting. Serialize synchronization per feature/account and retain refused documents' sync state.
- Preserve unowned character-card extension fields. Unknown sticker IDs remain placeholders, never image URLs.
- Home Assistant calls name exactly one entity target. Service data must not carry another target key.
- Keep MCP call-tool arguments as a JSON string until schema conversion emits an object schema OpenAI accepts.
