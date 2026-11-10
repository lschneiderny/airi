# Store and state browser test audit

Audited on 2026-11-10 against `5f5b1152d` for test-qa-revamp todo 12. All 41 original browser suites passed before the routing change. Four suites move to the existing node projects without changing assertions or adding environment shims.

The inventory command below returns 33 files. Git's slash-containing patterns omit eight root-level files, which are audited separately below.

```sh
git ls-files 'packages/stage-ui/src/stores/**/*.browser.test.ts' 'packages/stage-ui/src/features/**/*.browser.test.ts' 'packages/provider-inference/src/**/*.browser.test.ts'
```

## Required inventory

| Original file | Decision | Reason |
| --- | --- | --- |
| packages/provider-inference/src/providers/cloud/opencode-go/index.browser.test.ts | kept | Browser transport must omit User-Agent; the existing index.test.ts independently expects Node's Project-AIRI header. |
| packages/provider-inference/src/providers/local/browser-web-speech-api/index.browser.test.ts | kept | Creates real AudioContext media destinations and MediaStreams for speech recognition lifecycle checks. |
| packages/provider-inference/src/providers/runtime-matrix.browser.test.ts | kept | Verifies the browser-resolved portable provider registry imports; runtime-matrix.test.ts already owns the distinct Node import and browser-only availability contract. |
| packages/stage-ui/src/features/conversation/settings.browser.test.ts | kept | Reads real localStorage and spies on Storage.prototype persistence during leader/follower replication; the node project supplies neither. |
| packages/stage-ui/src/features/devtools/motion/live2d/components/procedural-motion.browser.test.ts | kept | Mounts ProceduralMotion and checks its rendered selector ordering. |
| packages/stage-ui/src/features/devtools/motion/live2d/components/workbench.browser.test.ts | kept | Mounts Workbench and measures computed tab borders and drop feedback colors. |
| packages/stage-ui/src/features/devtools/motion/live2d/composables/use-playback-keys.browser.test.ts | kept | Mounts a keyboard harness and dispatches real KeyboardEvents with browser focus and input behavior. |
| packages/stage-ui/src/features/devtools/motion/mmd/devtools.browser.test.ts | kept | Mounts MMDMotionDevtools and exercises rendered switches, numeric inputs, and clip buttons. |
| packages/stage-ui/src/features/devtools/motion/natural/devtools.browser.test.ts | kept | Mounts NaturalMotionDevtools and exercises rendered controls, capture readouts, and clipboard feedback. |
| packages/stage-ui/src/features/performance/runtime-state.browser.test.ts | moved | runtime-state.test.ts preserves snapshot replication assertions using native Node BroadcastChannel; no mounted component or browser storage. |
| packages/stage-ui/src/features/performance/settings.browser.test.ts | kept | Reads real localStorage and spies on Storage.prototype.setItem; the node project has no storage environment. |
| packages/stage-ui/src/features/situation/inner-state.browser.test.ts | kept | Round-trips and compares real localStorage saves across independently created stores; no node storage shim is allowed. |
| packages/stage-ui/src/features/situation/settings.browser.test.ts | kept | Uses real localStorage, enumerable storage keys, and Storage.prototype persistence; the node project supplies none. |
| packages/stage-ui/src/stores/chat/session-store-lifecycle.browser.test.ts | kept | Mounts a character-store component with document.body and i18n before driving session lifecycle races. |
| packages/stage-ui/src/stores/chat/session-store.browser.test.ts | kept | Mounts a character-store component and seeds localStorage before testing synchronized sessions. |
| packages/stage-ui/src/stores/chat/stream-store.browser.test.ts | kept | Uses vitest-browser-vue to mount the stream store's i18n-dependent component harness. |
| packages/stage-ui/src/stores/devtools/situation-observability.browser.test.ts | moved | situation-observability-sync.test.ts preserves Eventa inspection and native BroadcastChannel assertions; the -sync suffix avoids overwriting the existing node suite. |
| packages/stage-ui/src/stores/mods/api/context-bridge.contract.browser.test.ts | kept | Mounts ChatHistory to verify bubble scheduling and uses browser-backed chat asset persistence. |
| packages/stage-ui/src/stores/modules/airi-card-inheritance.browser.test.ts | kept | Seeds and clears real localStorage while verifying persisted card defaults and replicated selections; no node storage shim is allowed. |
| packages/stage-ui/src/stores/modules/airi-card.browser.test.ts | kept | Initializes browser-persisted character/module stores and clears real localStorage; airi-card.test.ts already covers separate node behavior. |
| packages/stage-ui/src/stores/modules/consciousness-settings.browser.test.ts | kept | Checks real localStorage writes and absent keys after follower replication; node has no storage environment. |
| packages/stage-ui/src/stores/modules/hearing-status.browser.test.ts | kept | Mounts HearingStatus and asserts rendered transcription and provider-error status text. |
| packages/stage-ui/src/stores/modules/home-assistant.browser.test.ts | kept | Dispatches window StorageEvent and uses localStorage; forced node run fails with localStorage/window not defined (task-12-kept-node-failure.txt). |
| packages/stage-ui/src/stores/modules/optional-modules.browser.test.ts | kept | Mounts a document-backed hearing/vision/speech harness with i18n and real localStorage. |
| packages/stage-ui/src/stores/modules/speech-card-preview.browser.test.ts | kept | Mounts CardEditor and RouterView and interacts with rendered voice options. |
| packages/stage-ui/src/stores/modules/speech-settings.browser.test.ts | kept | Mounts SpeechSettings and uses vitest/browser page locators and real controls. |
| packages/stage-ui/src/stores/modules/speech.browser.test.ts | kept | Mounts separate document-backed speech renderers with i18n and browser persistence. |
| packages/stage-ui/src/stores/modules/stickers.browser.test.ts | kept | Mounts settings controls, draws canvas images, decodes Image objects, uploads files, and exercises navigator.locks and localforage. |
| packages/stage-ui/src/stores/modules/vision.browser.test.ts | kept | Uses real localStorage around replicated vision settings; node has no storage environment. |
| packages/stage-ui/src/stores/modules/vision/activity.browser.test.ts | moved | activity.test.ts preserves counters and concurrent leader actions using native Node BroadcastChannel; ticker handler returns fixture data without capturing a screen. |
| packages/stage-ui/src/stores/providers/onboarding-save.browser.test.ts | kept | Mounts document-backed provider renderers with i18n and verifies persisted localStorage credentials. |
| packages/stage-ui/src/stores/providers/provider-model-catalog.browser.test.ts | kept | Mounts document-backed provider renderers to test model catalogs, instance ownership, and configuration snapshots. |
| packages/stage-ui/src/stores/settings/audio-device.browser.test.ts | kept | Mounts a device harness and exercises browser microphone permissions, MediaStreams, audio tracks, and capture subscribers. |

## Root-level supplemental inventory

These files are included by `git ls-files 'packages/stage-ui/src/stores/*.browser.test.ts' 'packages/provider-inference/src/*.browser.test.ts'` but omitted by the required command above.

| Original file | Decision | Reason |
| --- | --- | --- |
| packages/provider-inference/src/responses.browser.test.ts | moved | responses.test.ts preserves SSE terminal lifecycle and validator assertions using native Node Response and streams; no browser API. |
| packages/stage-ui/src/stores/chat-stickers.browser.test.ts | kept | Mounts the chat runtime with vitest-browser-vue and reads browser-backed sticker images and session persistence. |
| packages/stage-ui/src/stores/memory.browser.test.ts | kept | Uses localforage storage and cross-store persistence; node lacks its IndexedDB/WebSQL/localStorage backends. |
| packages/stage-ui/src/stores/natural-performance-override.browser.test.ts | kept | Unchanged node probe loses pre-coordination override writes (null instead of listening/0.8); browser synchronization passes unchanged, so retain without timing or environment shims. |
| packages/stage-ui/src/stores/presence-bubble.browser.test.ts | kept | Unchanged node probe loses pre-coordination follower writes (undefined override and 0 instead of 14); retain browser synchronization coverage without changing assertions. |
| packages/stage-ui/src/stores/speech-output-control.browser.test.ts | kept | Exercises real navigator.locks ownership and host-crash release, plus browser localStorage cleanup. |
| packages/stage-ui/src/stores/voice-messages.browser.test.ts | kept | Mounts a microphone host and exercises AudioContext, audio capture worklets, and WAV encoding. |
| packages/stage-ui/src/stores/voice.browser.test.ts | kept | Mounts the voice runtime, captures fake browser microphones, observes audio levels, and dispatches window pagehide. |
