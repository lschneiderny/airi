# Twitter services

## OVERVIEW
Browser-driven X automation exposed through AIRI and MCP adapters. Score: 8. Follow the [root guide](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Bootstrap and shutdown | `src/main.ts` |
| Configuration and defaults | `src/config/` |
| Browser context and saved sessions | `src/core/browser/` |
| Authentication and domain operations | `src/core/services/` |
| AIRI and MCP integration | `src/adapters/` |
| DOM selectors and extracted data | `src/parsers/` |
| Logging and error helpers | `src/utils/` |
| Historical design | `docs/` |

## CONVENTIONS
- Operations automate Playwright Chromium pages. They are not direct Twitter API calls.
- Parsers share `src/parsers/selectors.ts`. Check selectors against current page structure when behavior changes.
- Initialize the browser context before calling `useContext()`.
- `CONFIG_PATH` overrides `twitter-config.json`.
- Saved authentication uses `data/twitter-session.json` relative to the process working directory.
- MCP transport uses H3 and SSE sessions. AIRI uses the server SDK adapter.
- Use `pnpm -F @proj-airi/twitter-services dev` for startup.
- That command installs Chromium before launching `src/main.ts` with `.env.local`.
- Use `pnpm -F @proj-airi/twitter-services typecheck` for types.
- The manifest has no build or test script. Root Vitest runs `src/**/*.test.ts` through its `twitter-services` project: `pnpm exec vitest run --project twitter-services`.

## ANTI-PATTERNS
- Do not infer implemented operations from exported service factories. User operations include an explicit unimplemented path.
- Do not treat the dated architecture document's Stagehand or BrowserBase description as current implementation evidence.
- Do not move authentication cookies into environment variables based on obsolete assumptions.
- Do not report live authentication or selector health from typecheck results alone.
