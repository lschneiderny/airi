# Telegram bot

## OVERVIEW
grammY bot with an LLM action loop, PostgreSQL vector memory, and telemetry. Score: 10. Follow the [root guide](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Startup and telemetry | `src/index.ts` |
| Telegram dispatch and loop | `src/bots/telegram/index.ts` |
| Action handlers | `src/bots/telegram/agent/` |
| Photo and sticker interpretation | `src/llm/` |
| Velin prompt templates | `src/prompts/` |
| Database connection and schema | `src/db/` |
| Message persistence and retrieval | `src/models/` |
| Schema changes | `drizzle.config.ts`, `drizzle/` |
| Bulk embedding job | `scripts/embed-all-chat-messages.ts` |
| Local database and observability stack | `docker-compose.yaml`, `deploy/` |

## CONVENTIONS
- This bot owns its state-aware LLM loop. It does not use the Stage UI chat store.
- PostgreSQL storage uses Drizzle and vector embeddings. Set `DATABASE_URL` and `EMBEDDING_DIMENSION`.
- Keep embedding dimensions aligned with model output and the database schema.
- Prompts use Velin Markdown templates. `LLM_RESPONSE_LANGUAGE` controls response language.
- Animated sticker interpretation uses ffmpeg frames before image conversion.
- Start with `pnpm -F @proj-airi/telegram-bot start`. Typecheck with the same filter and `typecheck`.
- `db:generate`, `db:push`, and `script:embed-chat` are state-changing maintenance scripts.
- Vitest has a Node project excluding browser tests, but the manifest has no test script.
- Root Vitest also runs these tests through its `telegram-bot` project: `pnpm exec vitest run --project telegram-bot`.

## ANTI-PATTERNS
- Do not treat generated Drizzle snapshots as application code or manually maintained instruction locations.
- Do not run bulk embedding or schema push as a read-only validation check.
- Do not assume the Compose database's host port equals PostgreSQL's container port. Compose exposes host port 5433.
- Check environment loading before schema operations. Drizzle configuration and startup scripts reference different local filenames.
