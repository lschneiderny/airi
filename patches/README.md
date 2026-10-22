# Dependency patches

## @xsai-ext/responses 0.5.1

This patch fixes behavior in the published SDK. AIRI's protocol and billing code remain in workspace packages.

- Reject `response.incomplete` and stream error events so AIRI does not store failed turns.
- Type native `web_search` tools and their output Items for replay across steps.
- Await `onNativeEvent` before transcript commit so consumers can retain sources and search activity.

Browser regressions are in `packages/provider-inference/src/responses.browser.test.ts`. Core integration tests use the real patched SDK with synthetic HTTP responses in `packages/core-agent/src/runtime/responses.test.ts`.

The patch changes `dist` because the npm artifact ships compiled code. To contribute upstream, port these changes to the corresponding sources in [xsAI](https://github.com/moeru-ai/xsai), then run the same regressions.

Remove the patch when an upstream release passes these tests and provides native event callbacks and web search types. Recheck incomplete-response behavior before removal: AIRI treats an incomplete turn as a failure.

To update the patch:

```sh
pnpm patch @xsai-ext/responses@0.5.1
# Edit the directory printed by pnpm.
pnpm patch-commit <directory>
```

## nano-staged 1.0.2

This patch splits `git add` and `git checkout` over long path lists into several commands. Without it, `pnpm nano-staged` fails with `spawn ENAMETOOLONG` after the lint tasks pass once about 300 files are staged, because Windows rejects command lines over 32767 characters.

The root `nano-staged.mjs` splits the lint commands the same way. Remove the patch when nano-staged chunks its own git commands. `git diff` for partially staged files is not chunked, so a commit that stages more than about 300 partially staged files can still fail.

To update the patch:

```sh
pnpm patch nano-staged@1.0.2
# Edit the directory printed by pnpm.
pnpm patch-commit <directory>
```
