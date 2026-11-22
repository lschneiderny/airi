# Stage UI Guidance

## CONVENTIONS

- Read the README section `Visual baselines` before adding a `*.visual.browser.test.ts` test or updating references.
- Put a component that serves one page or one use case in `src/components/scenarios/`.
- Dispatch a mind intent only through `permits`; do not branch on the motion driver to decide what she does.
- Keep provider records serializable. Executable instances, request epochs, and tool executors stay local to their runtime.
- `src/stores/chat.ts` is the integration hub where chat meets presence, unprompted turns, and memory. It may gain wiring lines only. A new system, such as touch observations, lives in its own module and talks to chat through chat store actions or the hooks and controls the store hands out (`useSituationStore().observeChat` is the pattern).
- The character mind decides whether and when she speaks unasked: reach-outs, spoken touch reactions, and widget or plugin turns. `chat.ts` and the orchestrator runtime run the turn it decided and report its outcome. Start an unprompted turn only from `VoicePort` `speak` in `src/stores/situation`, and add no timing, holds, or retries for unprompted turns in chat or the runtime. Only the user's own turns and notices bypass the mind.

## ANTI-PATTERNS

- Prefer explicit subpaths over the `@proj-airi/stage-ui/stores` forwarding barrel for new consumers.
- Do not infer provider availability from an adapter file. Check registration and catalog filtering.
- Do not invoke activation commands when applying replicated snapshots.
- Never copy a previous card's overrides into global defaults.
- Keep selected sessions local to each window.
- Never replay a whole model turn after tool execution starts. Request-only tools require current explicit selections.
- Do not let stale catalog requests or transcription generations overwrite newer state.
- Preserve unowned character-card extension fields.
