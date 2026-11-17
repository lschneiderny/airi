# Stage UI Guidance

## CONVENTIONS

- Read the README section `Visual baselines` before adding a `*.visual.browser.test.ts` test or updating references.
- Keep provider records serializable. Executable instances, request epochs, and tool executors stay local to their runtime.
- `src/stores/chat.ts` is the integration hub where chat meets presence, unprompted turns, and memory. It may gain wiring lines only. A new system, such as touch observations, lives in its own module and talks to chat through chat store actions or the hooks and controls the store hands out (`useSituationStore().observeChat` is the pattern).

## COMMANDS

Run from the repository root. Select the project that matches the test file.

```sh
pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/modules/default.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/history.browser.test.ts
```

## ANTI-PATTERNS

- Prefer explicit subpaths over the `@proj-airi/stage-ui/stores` forwarding barrel for new consumers.
- Do not infer provider availability from an adapter file. Check registration and catalog filtering.
- Do not invoke activation commands when applying replicated snapshots.
- Never copy a previous card's overrides into global defaults.
- Keep selected sessions local to each window.
- Never replay a whole model turn after tool execution starts. Request-only tools require current explicit selections.
- Do not let stale catalog requests or transcription generations overwrite newer state.
- Preserve unowned character-card extension fields.
