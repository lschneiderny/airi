# Computer-use MCP

## OVERVIEW
AIRI's deterministic execution substrate. Score: 15. Follow the [root guide](../../AGENTS.md) and [runtime guide](src/AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Public API and stdio startup | `src/index.ts`, `src/server.ts`, `src/bin/run.ts` |
| Execution, policy, approvals | `src/server/`, `src/policy.ts`, `src/session.ts` |
| Workflow state and recovery | `src/workflows/`, `src/state.ts`, `src/strategy.ts` |
| Remote Linux execution | `src/runner/`, `src/remote/`, `src/bin/bootstrap-remote.ts` |
| Terminal handoff | `terminal-lane-status.md` |
| Planning and memory boundaries | `planning-orchestration-contract.md`, `coding-plast-mem-bridge-contract.md` |
| CLI and experiment boundaries | `airi-cli-architecture.md`, `mimic-baseline-training-boundary.md` |
| Observation extension | `chrome-extension/README.md` |

## CONVENTIONS
- AIRI owns planning, chat UX, approval UX, provider integration, and MCP attachment.
- This service owns execution primitives, workflow orchestration, terminal/browser/desktop surfaces, trace, audit, and safety checks.
- Keep provider-specific behavior in AIRI or `packages/stage-ui`.
- Treat terminal, browser, editor, and desktop operations as one task system.
- Read `terminal-lane-status.md` before terminal work. Update it with terminal behavior changes.
- Use `pnpm -F @proj-airi/computer-use-mcp test`, `typecheck`, or `build` for package checks.
- Release gates live in `src/support-matrix.ts`. Only `product-supported` entries establish external support claims.
- `strictReleaseGateCommands` lists the strict gates: `e2e:developer-workflow`, `e2e:terminal-exec`, `e2e:terminal-pty`, `e2e:terminal-self-acquire`, and `e2e:airi-chat-terminal-self-acquire`. Other `e2e:*` and `smoke:*` scripts are probes, not gates.

## LOCAL COLLABORATION
- This policy applies only here. Do not promote it into the root guide.
- Default to GPT-5.5 Controller with Spark / mini read-only workers for non-trivial work.
- GPT-5.5 owns boundaries, conflicting evidence, patch decisions, verification commands, and final judgment.
- Use Spark broadly for parallel code-path exploration, test-gap discovery, diff review, CI triage, and PR-split planning.
- If Spark is unavailable or exhausted, use GPT-5.4-mini for those read-only roles.
- Workers must provide file paths and evidence. Unsupported claims remain guesses.
- Workers stay read-only unless the user explicitly requests a writer.
- This includes runtime, verification gates, coding runners, MCP permissions, action executors, and critical state machines.
- The main thread must verify findings against code and tests before edits. Runtime and test logs outrank model conclusions.
- Copilot is an external worker pool for review, candidate PRs, test-gap issues, and documentation cleanup.
- GPT-5.5 review is required before trusting or merging Copilot output.
- Prefer Copilot `gpt-5.4-mini` at high effort. Escalate hard reviews to `gpt-5.3-codex` at high effort.
- Use Copilot GPT-5 mini and GPT-4.1 broadly for low-risk triage, searches, test-gap brainstorming, documentation checks, and review opinions.
- Keep those models in plan/review mode. GPT-5.5 must verify their proposals before local edits.
- Gemini CLI is a local external research/review worker for impact scans, diffs, failure logs, third-party review, and instruction checks.
- Let Gemini choose its model unless the task requires a pin. If quota is exhausted, route the work to Copilot.
- Never let Gemini edit this worktree concurrently with Codex.
- Gemini candidate writes require a separate worktree and GPT-5.5 review before adoption.
- Separate Copilot governance, `.codex/` configuration, GitHub labels, and business/runtime changes into separate commits or PRs.
- Contributor-workflow PRs can contain related `.codex/` decisions.

## ANTI-PATTERNS
- Do not split terminal/browser/editor/desktop work into disconnected demos.
- Do not productize browser, native click/type/press, or VS Code before the terminal lane closes.
- Do not touch desktop overlay, Electron bridge, Chrome extension, or MCP registration without explicit task scope.
- Workspace memory, verification gates, and shell guards also require explicit task scope.
- Keep planning, archive eligibility, compaction, provider emission, and runner semantics separate unless evidence requires crossing layers.
- Keep changes narrow and evidence-backed. Do not broaden refactors without evidence.
- Keep agent configuration separate from runtime changes. Update code documentation with the behavior it describes.
- Prefer pure helpers for shared contracts. Add regression tests for boundary behavior.
- Parser coverage does not prove valid provider messages. Test projectors when final message shape is the contract.
- Report exact changed files, test commands, exit codes, relevant pass/fail output, and out-of-scope risks.
