# Live2D stage items

Date: 2026-11-22
Status: accepted; implemented on luke/feat/live2d-stage-items.

Current rules are in [Body ownership](../context/body-ownership.md) and [State persistence](../context/state-persistence.md). The upstream differences are recorded in the [upstream policy ledger](../context/upstream-policy.md).

## Context

A stage item is a picture, a GIF, or a Live2D model that the owner places on the Live2D stage beside her. Items reuse the expression store: each item is an entry in the expression catalog (`packages/stage-shared/src/expression-performance/catalog.ts`), so the store shows and refuses items the same way it handles other entries.

Upstream has no stage items. Her model draws alone, and the vendored `pixi-live2d-display` patch has no range draw. The fork adds both, and the decisions below record what the fork relies on and why.

## Decision

1. **Items are catalog entries.** The store decides which items show, the item layer draws what the store shows, and the library holds the files. An item never writes to a parameter or a slot directly.

2. **Insertion uses the vendored patch.** The layer gives her model a list of insertions (`Live2DItemInsertions`, `packages/stage-ui-live2d/src/types/live2d-item-insertions.d.ts`). The patch in `patches/pixi-live2d-display.patch` splits `doDrawModel` into `prepareDrawModel` and `drawModelRange`, adds `beginRangeDraw`, `drawRange`, and `resumeRangeDraw` to `Cubism4InternalModel`, adds `Live2DModel.drawSegments`, and calls the `itemInsertions` hook in `Live2DModel._render`. The layer draws an item between two of her draw segments. After an insert, `resumeRangeDraw` restores the framebuffer, the viewport, and the `preDraw` state. The restores are defensive, and `apps/stage-tamagotchi/src/test/live2d-range-draw.browser.test.ts` covers them.

3. **The motion clock does not change.** An animated GIF advances on its own elapsed item time (`gifFrameAt` in `packages/stage-ui-live2d/src/composables/live2d/items/gif-clock.ts`). Her frame loop, the Natural driver, and her SDK motion keep their timing, so motion QA and body ownership are unaffected.

4. **Hide lists and part opacity.** An item's `hides` field lists part ids. The layer captures her part opacities once, in `partBaseline`, when it attaches to her model. At her `beforeModelUpdate`, it sets each part a drawn item lists to opacity 0 with `setPartOpacityByIndex`, and it restores a part to its baseline once no drawn item lists it. When the layer is destroyed, it restores the baseline of each part it hid, unless her model is already destroyed.

5. **Parameters are mirrored at `beforeModelUpdate`.** A linked Live2D item copies her final parameter values through `Live2DParameterMirror` (`packages/stage-ui-live2d/src/composables/live2d/items/mirror.ts`). The copy runs at her `beforeModelUpdate`, and the item applies it at its `afterMotionUpdate`, so the item's own physics runs on her values. Physics outputs are excluded from the copy, so physics stays their only writer.

6. **ImageDecoder for GIFs (owner decision, 2026-11-22).** The upload validator reads a GIF with `ImageDecoder` (`packages/stage-ui-live2d/src/utils/stage-item-validator.ts`). `ImageDecoder` reports a frame's duration only by decoding that frame, so the texture (`Live2DGifTexture` in `gif-texture.ts`) reads the delays from the frame headers with `readGifFrameDelaysMs`. It decodes frame 0 when the item opens, then holds the shown frame and one decoded frame ahead.

7. **Live2D item cap.** At most `MAX_SHOWN_ITEMS` (16) items show at once, and at most `MAX_SHOWN_LIVE2D_ITEMS` (4) of them are Live2D models (`packages/stage-shared/src/expression-performance/items.ts`). The layer caps Live2D items in list order and warns past the limit. The store refuses a further show with the `item-limit` reason (`packages/stage-shared/src/expression-performance/types.ts`). Refusals that do not go through a slot reach the caller through `onItemRefusal` in `packages/stage-ui-live2d/src/stores/expression-store.ts`.

8. **No card export of items.** `exportAiriCardPackage` and `exportDisplayModel` in `packages/stage-ui/src/services/airi-card-import-export.ts` write the card, the display model, and the Live2D controls only, with no expression documents, so card data does not carry items. The library is its own IndexedDB mount, `airi-stage-item-library`, in `packages/stage-ui/src/database/storage.ts`, and it is registered in `packages/stage-ui/src/persistence/state-registry.ts`. The owner manages items from the expressions panel.

9. **Todo 9 scope narrowed.** The desktop stage host is built only for MMD: `selectHostMode` in `apps/stage-tamagotchi/src/main/windows/stage/mode.ts` has no Live2D reference, and `stage.vue` has no hit-read change. Live2D runs in the classic window (`apps/stage-tamagotchi/src/renderer/pages/index.vue`). There, click-through reads the canvas alpha through `useCanvasPixelIsTransparentAtPoint`, gated by `clickThroughAvailable`, so an item's opaque pixels capture the pointer. Outfit touch runs only on the Natural path: `touchSampleFrom` in `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` calls `live2DTouchRegionAt`. `touchAt` and the Universal and MAGIC drivers are unchanged.

10. **Data seam for future relationship mechanics.** The library and each model's placements are separate data, so gifts, owned items, and outfit choice can come later without a data migration.
    - The library holds each item once. `useStageItemLibraryStore` (`packages/stage-ui/src/stores/stage-item-library.ts`) mints its id as `asset-` plus a nanoid, and `stageItemsRepo` (`packages/stage-ui/src/database/repos/stage-items.repo.ts`) stores the asset. The id does not change when the item is placed on a model or removed from one.
    - A placement is an `ItemExpressionDocument` (`packages/stage-shared/src/expression-performance/catalog.ts`). Its `assetId` names the library id, and its `placement` is kept apart from that id. Placements live in the curated catalog document under `expression-catalog:<modelId>` (`packages/stage-ui-live2d/src/stores/expression-catalog-persistence.ts`).
    - An item joins a model only through "Add to this model" in `stage-items.vue`, which emits `create-item`. The library has no model field, so nothing treats a library item as belonging to every character. Removing an asset calls `removeItemsByAsset`, which drops its placements from each model that uses it.
    - Ownership, gifts, and outfit choice would live in per-card character state, the record that `useCharacterStateStore` keeps for each card (`packages/stage-ui/src/stores/character-state.ts`, record type `CharacterStateRecordV1` in `packages/stage-shared/src/character-state/types.ts`). No ownership or gift field exists on this branch yet, so this is the direction for later work, not a current feature.
    - Keep the existing guidance. Later relationship mechanics should read an item's state from the layer's `onStates` report (`packages/stage-ui-live2d/src/composables/live2d/items/layer.ts`) and act through the expression store. They should not add code to the layer's draw path.

11. **Placement editor.** An item's entry in the expressions panel opens `item-placement.vue`. `live2d.vue` mounts it only in the Live2D model settings. Its preview draws her with the stage's items: `previewItemsFor` in `item-placement.ts` takes the expression snapshot items with `shown` set, and the open item's draft replaces its stored document or is appended. It keeps within `MAX_SHOWN_ITEMS` (16) and `MAX_SHOWN_LIVE2D_ITEMS` (4) and returns the `item-limit` refusal past them. The editor works in her model canvas units: `Model.vue` exposes `originalModelWidth` and `originalModelHeight`, and `Live2D.vue` passes them to the expression store with `setModelCanvas`. `Live2D.vue` exposes `itemEditor()`, which wraps the accessor `Model.vue` provides.

    The controls:
    - Move: drag the item's shape. A pinned item re-pins under the pointer; over empty canvas it stays put.
    - Scale: four corner handles, clamped to [0.01, 100]. Rotate: a handle above the top edge.
    - Fields x, y, scale, rotation, anchor-x, anchor-y: an empty, NaN, or non-positive scale is ignored; anchors clamp to [0, 1]; rotation wraps to (-180, 180] degrees and is stored in radians. A value commits on blur or Enter.
    - Flip: `setFlip` sets `placement.flipX`.
    - Layer: behind, front, or above. Above offers her drawables grouped by part name, and a pick-layer button sets the drawable from a click on her canvas.
    - Pin: the pin button, then a click on her canvas, picks the topmost visible drawable through `pickLive2DItemPin`. A click on empty canvas shows a no-mesh message and pins nothing. Unpin keeps the pose the item was drawn in.
    - Align to canvas: clears the pin and applies `canvasAlignedPlacement` with her canvas size and the item's width.
    - Link (Live2D items only): sets `link` to `parameters` or `none`.
    - Hides: checkboxes over her part tree, labelled by cdi3 display names and falling back to part ids. They write `hides`.
    - Updates: each item's `update-item` patch is queued, and `createFramePatchQueue` flushes one per item per animation frame, and also on drag end, close, item change, and unmount.

12. **Upstream files changed.** The fork changes 21 files that exist upstream. The new item modules, stores, and tests are fork-only and do not appear here. The list comes from `git diff origin/main` restricted to files that exist upstream.

    - `apps/stage-tamagotchi/package.json`: adds the `@pixi` packages and `pixi-live2d-display` that the item layer imports.
    - `apps/stage-tamagotchi/src/renderer/pages/index.vue`: calls `useStageItemPruning` at setup and passes its unsubscribe to `onUnmounted`, so the library's asset-removed pruning stops when the page unmounts.
    - `apps/stage-tamagotchi/src/renderer/pages/workspace.vue`: passes the runtime snapshot's shown Live2D items to the settings preview, so the fullscreen window draws the items the stage shows.
    - `apps/stage-tamagotchi/vitest.config.ts`: adds a download of the preset model used by the browser tests.
    - `docs/ai/context/ui-components.md`: records the stage-item component API.
    - `packages/i18n/src/locales/en/settings.yaml`: English strings for the item settings.
    - `packages/stage-ui-live2d/README.md`: documents stage items.
    - `packages/stage-ui-live2d/package.json`: exports the item modules, the insertion type, and the validator.
    - `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`: takes the shown items and reports their states, and sets the model canvas size for the placement panel.
    - `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`: mounts the item layer under her model, and passes outfit hits to `live2DTouchRegionAt` on the Natural path.
    - `packages/stage-ui-live2d/src/components/scenes/live2d/index.ts`: exports `Live2DItems`.
    - `packages/stage-ui/README.md`: documents stage items.
    - `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`: forwards item commands from the settings panel to the expression store.
    - `packages/stage-ui/src/components/scenarios/settings/model-settings/preview-stage.vue`: draws the shown items in the settings preview through `useLive2DStageItems`.
    - `packages/stage-ui/src/components/scenes/Stage.vue`: draws the shown items on the stage through `useLive2DStageItems`, only when the renderer is Live2D.
    - `packages/stage-ui/src/database/storage.ts`: mounts the `airi-stage-item-library` store.
    - `packages/stage-ui/src/stores/display-models.ts`: deletes a removed model's expression documents from local storage.
    - `packages/stage-ui/src/stores/display-models.test.ts`: tests that removing a model deletes its expression documents and keeps the others.
    - `packages/stage-ui/src/stores/modules/airi-card.test.ts`: stubs `localStorage` so the card test can remove a model without a browser storage.
    - `patches/pixi-live2d-display.patch`: splits `doDrawModel` into `prepareDrawModel` and `drawModelRange`, adds `beginRangeDraw`, `drawRange`, and `resumeRangeDraw` to `Cubism4InternalModel`, adds `Live2DModel.drawSegments`, and adds the `itemInsertions` hook to `Live2DModel._render`.
    - `pnpm-lock.yaml`: the lockfile for the added dependencies.

## Consequences

Items reuse the store, so their caps and refusals follow the same rules as expressions. The vendored patch becomes a fork-owned change to the Live2D renderer, and a sync with upstream must carry it.

## Revisit

Revisit this ADR when upstream ships Live2D items, or when upstream changes `Live2DModel._render` in a way that the patch no longer matches. At that point, either drop the patch and the layer's draw path, or rebase them onto the new renderer.

## Verification

The symbols and paths named here are checked by grep against the branch, and the check output is saved with the todo 12 evidence. The GIF clock, mirror, and expression-store behavior are covered by the unit tests next to `gif-clock.ts`, `mirror.ts`, and `expression-store.ts`. The browser tests under `apps/stage-tamagotchi/src/test/` cover the render path, the outfit touch, and the range draw.
