# Minecraft integration

## CONVENTIONS
- Read the README's migration notice. Mineflayer is being replaced by a Fabric runtime.
- Keep new long-term Mineflayer features inside that migration plan.
- This package uses Awilix, alien-signals, and isolated-vm, rather than the app's Pinia runtime.
- Perception emits frozen raw events. Reflexes and conscious actions share body/pathfinder ownership.
- Tests use `NODE_OPTIONS=--no-node-snapshot`. Vitest excludes `src/agents/action/*.test.ts`.
- Config precedence: `.env.local`, saved configuration, `.env`, process environment, then defaults.
- Debug workflow: `codex-skills/minecraft-debug-mcp/SKILL.md`.

## ANTI-PATTERNS
- Do not connect this bot to untrusted public servers.
- Never await `mineflayer.loadPlugin()` inside serialized lifecycle hooks. The queue is non-reentrant.
- Resolve rule paths with `fileURLToPath`, not URL pathname, for Windows drive paths.
- Never let lower-priority reflex work preempt a running async behavior.
- Keep player chat and AIRI commands ahead of stale system feedback.
- Treat sandbox action enqueue receipts as pending work, not completion evidence.
- Keep sandbox method restrictions, action limits, cancellation, and cleanup intact.
- Do not restore the deprecated `actionAgent` pattern. Use `ActionRegistry`.
- Claim AIRI relay only after successful execution. Offline context cannot establish relay.
