# OpenCode Go desktop network service

## Decision

Electron main owns Go credentials and outbound requests. Renderers use restricted, typed Eventa operations.
The service exposes model discovery and chat completions, not arbitrary URLs or headers.
It connects only to `https://opencode.ai/inference/go/v1/`, refuses redirects, and identifies AIRI.
The existing chat correlation supplies `x-opencode-session`. Validation uses a separate stable session identifier.

This follows the Home Assistant service's ownership pattern. It adds no HTTP listener and does not disable browser security.
The web provider remains browser-based. A web relay is outside this change.

## Boundaries

- Shared contracts live in `apps/stage-tamagotchi/src/shared/eventa/opencode-go.ts`.
- Main owns a per-provider credential store, request controllers, response readers, and caller ownership.
- Only the main and settings windows receive service bindings. Subframes cannot use privileged operations.
- Credential writes use Electron safeStorage encryption and a validated, atomic file under `userData`.
- Saving finishes before removal of renderer copies. Existing throttled config writes cannot acknowledge that durable save.
- If secure storage is unavailable, key saving fails rather than writing plaintext.
- Public configuration returns a revision and masked preview, not the stored key.
- The desktop provider adapter supplies a fetch-compatible transport without exposing Electron to portable provider definitions.
- The native definition factory lives in `packages/stage-ui/src/libs/providers/providers/opencode-go/`.
- The application supplies credential availability and IPC fetch through the factory's host interface.
- Discovery, connectivity checks, manual completion checks, and streaming chat use that transport.

## Streaming and cleanup

Opening a request returns response metadata. Each renderer pull requests one response chunk through Eventa.
This keeps upstream reading bounded by consumer demand instead of queuing an entire response through IPC.
Cancellation aborts the upstream request and releases its reader.
Request IDs belong to their initiating window. Another window cannot read or cancel them.
Window closure, renderer navigation, credential replacement, and application shutdown cancel affected requests.

## Settings and existing records

Desktop Go settings keep a replacement key in transient form state until save.
Provider snapshots contain credential references and revision numbers, not raw keys.
Existing Go keys transfer to main before inference starts. Successful transfer removes their renderer persistence copies.
If transfer fails, existing copies remain intact. Other providers can start, but Go requires a key saved in main.
Keys for custom endpoints do not transfer automatically to the official Go service. The user must enter a replacement explicitly.
Opening settings never deletes a key retained after a failed transfer.
Other providers and unrelated workspace edits remain unchanged.
The existing Go page URL continues to work for built-in and custom provider instance IDs.

## Implementation sequence

1. Add contracts, main-owned credentials, restricted request handling, and owner cleanup.
2. Add the desktop provider adapter and startup credential transfer.
3. Add desktop Go settings through the existing provider settings components.
4. Cover request restrictions, secret isolation, streaming, cancellation, and native validation.
5. Run affected package tests, typechecks, root lint, and desktop surface checks.

## Acceptance

Go requests originate in main, including automatic validation and manual completion checks.
Actual conversation IDs survive into upstream session headers.
Response chunks, completion, upstream errors, and cancellation reach the correct renderer.
Stored keys never return through configuration reads or synchronized provider snapshots.
No private credentials or paid requests are needed for automated or desktop diagnostic checks.
