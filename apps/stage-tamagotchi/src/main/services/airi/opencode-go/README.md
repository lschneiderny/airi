# OpenCode Go main service

Main owns encrypted per-provider credentials and window-scoped, pull-based requests.
Construct `createGoNetworkService()` after `app.whenReady()`.
Bind only main and settings windows before renderer load. Await `dispose()` from application shutdown.

Use this service for desktop Go requests. Do not use it as a general HTTP proxy or in web clients.

## Credential persistence

`createConfig.update()` returns void, throttles writes, and catches save errors.
It cannot acknowledge a migration before renderer copies are deleted.
This service instead serializes updates to `userData/opencode-go-v1.json`.
Valibot validates the document. Only safeStorage ciphertext, revision, and masked preview are persisted.
Saving awaits a flushed temporary-file write and atomic rename before acknowledging success.
Failed writes leave the previous configuration active. Callers can remove migration sources only after a successful set response.
This protects against process termination after acknowledgment, not every filesystem or hardware power-loss failure.

Encryption uses the installed Electron asynchronous safeStorage APIs.
Unavailable secure storage and Linux `basic_text` refuse nonempty writes and outbound decryption.
Clearing a profile does not require encryption.

## Requests

Only fixed models GET and chat completions POST routes are available.
Redirects fail. Main supplies authorization, identity, and session headers.
Only content type and retry delay response headers cross IPC.
Upstream HTTP errors keep their status and body for the provider adapter.
Transport, decryption, and reader errors use sanitized messages.
Each request has a 120-second total deadline, including idle streaming time.
Window navigation, closure, renderer loss, credential replacement, and disposal cancel requests.
