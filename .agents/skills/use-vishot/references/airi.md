# Use Vishot for AIRI

Read the [capture workflow](../SKILL.md), [Electron](electron.md), and [input-file](input-file.md) references. Reuse the product helper at `packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts`.

## Local model capture

Set `MODEL_PATH` to an existing absolute model path. Build Electron, then pass that path and the explicit format through the environment:

```bash
pnpm build:tamagotchi

AIRI_DISPLAY_MODEL_FORMAT=live2d \
AIRI_DISPLAY_MODEL_PATH="$MODEL_PATH" \
pnpm exec vishot capture \
  ./packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts \
  --target electron \
  --app-entrypoint ./apps/stage-tamagotchi/out/main/index.js \
  --cwd . \
  --settle-ms 2500 \
  --output-dir ./.vishot/display-model/live2d
```

Use `AIRI_DISPLAY_MODEL_FORMAT=vrm` with `AIRI_DISPLAY_MODEL_PATH` set to an absolute local VRM path.

Use `AIRI_DISPLAY_MODEL_FORMAT=mmd` with `.zip`, `.pmx`, or `.pmd`. A license-readable public candidate is [CG-CA Gene](https://github.com/mmdagent-ex/gene), whose repository provides PMX/PMD models and textures under CC BY 4.0. Prefer a ZIP containing the model and its texture directories.

## Scenario contract

The AIRI helper:

- marks onboarding completed in the test profile and closes an already-open onboarding renderer;
- opens Settings → Models through product-owned window helpers;
- starts waiting for the Playwright file chooser before choosing Live2D, VRM, or MMD;
- correlates the import through the new IndexedDB model key;
- selects the imported card and waits for the main window selection to match;
- captures the main stage and removes the imported fixture afterward.

Treat the capture as failed when it still shows a preset model, an import dialog, a blank stage, or a loading state. Inspect every generated image.
