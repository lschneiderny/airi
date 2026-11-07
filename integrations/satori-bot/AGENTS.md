# Satori bot

## OVERVIEW
Standalone Satori adapter with a provisional cognitive loop and PGlite persistence. Score: 10. Follow the [root guide](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Startup and validated configuration | `src/index.ts`, `src/config.ts` |
| Satori protocol and heartbeat lifecycle | `src/adapter/satori/` |
| Queue readiness and channel scheduling | `src/core/loop/` |
| Action planning and prompts | `src/core/planner/` |
| Dispatcher and action schemas | `src/core/dispatcher.ts`, `src/core/types.ts` |
| Action registry and handlers | `src/capabilities/` |
| Database and migration entry | `src/lib/db.ts`, `src/lib/schema.ts`, `drizzle/` |
| Flow and persistence explanations | `docs/HANDLER.md`, `docs/PERSISTENCE.md` |

## CONVENTIONS
- Read the README's provisional architecture notice before changing `src/core/`.
- The scheduler, loop, and planner are temporary. They do not define AIRI's final core architecture.
- Retain protocol handling, capabilities, dispatcher, and database as adapter/tool boundaries.
- Configuration validates with Valibot at module import. Startup initializes persistence before connecting.
- PGlite stores channels, messages, queued events, and unread events.
- Queue draining and per-channel work are separate. Release locks in `finally`.
- Use `pnpm -F @proj-airi/satori-bot dev`, `start`, or `typecheck`.
- Schema scripts are `db:generate` and `db:push`. These change migration or database state.
- The manifest has no build or test script.

## ANTI-PATTERNS
- Never use `saveEventQueue` for a single item. It deletes and rewrites the queue.
- Use incremental queue helpers for individual arrivals and removals.
- Do not commit local database persistence, environment secrets, or logs.
- Do not assume documentation's message-window sizes agree. Check `getRecentMessages` and its actual callers.
- Do not describe the provisional standalone planner as shared AIRI orchestration.
