# Stage UI

Shared core for stage

## Account-free clients

This fork uses local data and direct or local inference providers. Accounts, hosted providers, billing, and cloud synchronization have been retired.
Startup removes saved AIRI account credentials without contacting a server. Direct provider credentials remain unchanged.
The local-only provider cleanup removes retired hosted records and resets their module selections. Cards that still name those providers inherit the local defaults; their other fields and local chat histories remain intact. No hosted adapter is needed to load existing local data.

## OpenCode Go desktop transport

`createOpenCodeGoDesktopProvider` in `libs/providers/providers/opencode-go/index` creates the desktop definition.
The host supplies credential availability and a restricted fetch transport. The definition contains no Electron imports.
The Electron app installs this definition before provider stores start. Main owns encrypted keys, request routing, and cancellation.
Desktop setup and verification are described in `docs/ai/adr/2026-10-15-opencode-go-desktop-network.md`.

## MCP tool exposure

The Desktop Host exposes the four stable Agent entrypoints (`computer_observe`, `computer_act`, `computer_verify`, and `terminal_exec`) as Direct. It keeps extensions behind the existing MCP discovery and call tools.
Direct calls use the same Main request binding, approval, cancellation, execution slot and settlement path.
Exposure metadata grants no execution permission. External server metadata cannot opt into the Desktop Host's Direct policy.
The Host rejects disabled bundled Desktop tools even when a caller invokes them through MCP directly.
Unadmitted native AUV tools are absent from normal Chat registration. Their Main observation gates remain closed.

The generic `builtIn_mcpListTools` and `builtIn_mcpCallTool` proxies are disabled by default. A Host that needs secondary MCP work registers them with `proxy: 'explicit'` and passes the allowed external names in `proxyServers`.
This keeps them out of the default Agent catalog and blocks generic routing to the bundled Computer Use server. `proxy: 'active'` is reserved for an intentional model-visible route.

`builtIn_mcpListTools` returns the live catalog. Supply an exact `name` for one current schema, or null for the full catalog.
Registration descriptions contain server counts instead of every tool name. A discovery timeout leaves live discovery available.
MCP schemas retain optional arguments. Direct definitions use non-strict provider schemas and retain server validation.

`projectMcpCatalogHistory` keeps fresh discovery results intact for the next decision.
Later request copies omit old schemas while retaining tool names, descriptions, identities and result links.
The projection marks historical catalogs as snapshots and points to live schema discovery.
It updates both portable output and correlated native continuation output. Stored history, generation records and unrelated provider fields remain intact.
Failed results and other tools never enter this projection. Compact receives the projected copy and retains its existing scheduling modes.

## Optional modules

Provider lists expose `None` for optional features. Switches control module activation.
Consciousness remains required. Minecraft runs as an external service and keeps its own lifecycle.

Hearing, Speech, and Vision persist their enable states separately from provider and model selections.
Disabling these modules preserves credentials and selections. Re-enabling restores their use.
Their synchronized stores replicate the enable states across desktop windows.
Hearing cancels active transcription and rejects results from its previous enabled period.
The voice host also stops listening and dictation. Text chat can continue without transcribing stored recordings.
Disabling Speech stops its producers and playback. Text generation and tool work continue until the chat turn ends.

## Experimental features

Conversation Compact starts Off. Enable its local experiment and select Synchronous or Background to summarize older observations.
The soft byte estimate only schedules compaction. Off mode and failed summaries still send the request to the provider, which decides whether it fits.
Background compaction never pauses a request; Synchronous waits only for a summary started at the soft threshold. Disabling Compact invalidates summaries without cancelling tool execution.

Register flags in `libs/feature-flags.ts`. Read their state through `useFeatureFlagsStore().isEnabled(key)`.

## Notifications

Notifications are private messages from AIRI Cloud to the signed-in account. Code and API names use `inbox`.
`useInboxStore()` in `stores/inbox.ts` owns the unread count, the loaded pages, and the read actions for one window.
The store reads the count at sign-in, on window focus, and every 5 minutes. A list loads only when a panel opens.
Opening a message marks it read. The count changes at once and rolls back if Cloud rejects the write.
Sign-out and account changes clear all state. Responses from the old session are dropped.
Requests use the generated `@proj-airi/cloud-client` functions with `authedFetch`, so a 401 refreshes the token once.
The store keeps only kinds that `inbox-presentation.ts` can render. It skips unknown kinds and invalid params.
Entry points: the web account menu opens `InboxPopover` anchored to the account pill.
The mobile menu opens `InboxDrawer` as a sub-panel with a back button. The Electron island shows `InboxPanel` in place.
Entry points show nothing while the user is signed out. Announcements are a separate public surface.

## Message times

Chat history shows a centered timestamp before the first dated message and after five minutes without a message.
Timestamps use stored message times, the interface locale, and the device timezone. Messages without valid timestamps have no separator.
Today's separators show only the time. Yesterday and the day before use relative labels.
Older separators show the month and day. Dates outside the current year also show the year.
Click a separator to toggle its full date and time. Relative labels refresh every minute while the history is open.
`date-fns` handles calendar comparisons and localized formatting through `intlFormat` and `intlFormatDistance`.
The session list displays and sorts by the latest valid user or assistant message timestamp.
Sessions without dated conversation messages use their creation time. Loading messages updates the list from the stored history.
Saving or synchronizing a session does not change its displayed activity time unless its messages change.

## Chat bursts and wordless replies

An assistant message with break slices renders one bubble per run of slices between breaks; a leading, repeated, or trailing break adds no empty bubble. While the message streams, a bubble after a break appears `seconds` after that break slice arrived. The schedule keeps running after generation ends, so later bubbles of a short reply still appear on time. A message that is already complete when the history mounts, for example after a reload or a session switch, shows every bubble at once. A window that shows another renderer's reply, such as the Chat window, receives the whole reply with its break slices after each change (`assistant-progress` on the context channel), so the bubbles of a streaming reply follow the same schedule there. That window keys the stream with the context's `assistantMessageId` and keeps it in view until the session refresh loads the stored reply, so the stored reply takes over the same history item and its pending bubbles still wait. Copy still joins the text with blank lines.

A wordless or silent reply (an assistant message with `wordless`) renders as a small chip outside any bubble, such as "reacted - nodded" or "stayed quiet". It has no copy text and no reply action.

Chat bursts, wordless replies, and unprompted turns stay in local history.

## Voice integration

The audio host owns one VoiceController and one shared microphone input.
Other windows send Eventa commands and render snapshots. They do not create competing capture or playback runtimes.
Consumers subscribe to the microphone input with their own abort signal. The last subscriber to leave releases the device.

- `useVoiceStore` owns application routing, drafts, responses, and host command registration.
- `useVoiceController` binds public controller state to Vue and moves the controller to the input of the selected device.
- `useVoiceInput` maps hold and release controls to host commands.
- `VoiceInputButton` is the voice control of the desktop app composers. Click it to start, and click again to stop. Hover or right-click it for the mode, Auto send, the microphone, and continuous listening. Its status bar shows the waveform and time, and keeps a voice message that waits to be sent. Dictation writes its live transcript into the composer text and creates no voice draft.
- `ChatComposerVoiceInput` is the microphone inside the web and mobile composer text field. A tap acts on the mode. A long press or a right-click opens a menu with the mode and Auto send. Other Hearing options are in settings.
  - Dictation, the default: a tap records. The microphone becomes a neutral stop button in place, and the waveform and time fill the host area beside it. A second tap puts the text into the composer, or sends it with Auto send.
  - Walkie-talkie: a tap turns the field into a hold-to-talk bar. A release ends the speech. A drag up before the release cancels it.
  - Voice message: a tap records audio. A second tap sends it with Auto send, or keeps it for the send button.
- `ChatComposerAddMenu` is the `+` button of the web and mobile composers. It attaches images or starts a voice call.
- `VoicePresence` shows live speech, editable drafts, and the sent text. The desktop app inlay window and the web composers share it. A window host adds its own Escape shortcut, hit testing, and position through `shownChange` and the exposed `dismiss`.
- `useVoiceCallStore` owns a voice call. A call is continuous listening that the user starts. It starts an input on speech in every input mode and sends each input at once, so it never keeps a draft. Mute keeps the microphone open, cancels the speech that is captured now, and starts no input: no voice activity input, no Push to Talk hold, and no wake. A call ends when Hearing turns off or loses its transcription provider. An input that began during a call is sent at once, also when it finishes after the hang-up. The microphone switch in Hearing closes the microphone for every feature, so a call does not start while it is off, and turning it off ends the call. `VoiceCallCapsule` is the call UI of every layout. It shows at the top of the page for the whole call, with the hang-up button, the time, and a fading waveform. Only its hang-up button ends the call. The composer shows the mute button in place of the microphone during a call.
- `useVoiceMessagesStore` owns voice message recordings and their attachment submission.
- Hearing selects providers and converts captured PCM to each provider's upload format. It does not open the microphone.
- Speech uses direct or local provider output. Chunked synthesis never speaks the ASCII faces of the texting register and pauses the speech track at each `<|BREAK|>` and each valid `<|DELAY n|>`; the speech pipeline in `@proj-airi/pipelines-audio` owns both. The stage captions a face that forms its own segment through the output's `onDisplayText`, after the clip before it.
- `createVoiceRephrasePlugin` rewrites final transcripts with a chat model through a checked transcript patch. The raw text stays in the transcript history. Each segment gets its own rewrite, so segment boundaries stay for later speaker labels. A reply with another segment count leaves the text unchanged.
- `createVoiceEndJudgePlugin` ends a paused input early when a chat model reads its transcript as a finished message. The model is the rephrase model, or the chat model when no rephrase provider is set.
- `createSpeakerEvidencePlugin` compares each automatic input with the owner's voiceprint while Speaker recognition is on. It writes the mean cosine of the speech as speaker evidence, and the IO trace of the input records it. It never changes an input, and the chat prompt does not include it.

A pause of 1.2 seconds can end an input. With the end judge on, which is the default, the voice activity silence limit grows by 3 seconds.
The judge then ends a finished message at the pause, and an unfinished one waits for the speaker to continue.
A failed or slow judgement never blocks new speech. Without the end judge, the 1.2-second pause ends every input.

The host snapshot carries the corrected transcript segments of the active input. `VoiceDrafts` is the draft composer inside `VoicePresence`. It shows them as the continuation of the draft, in one paragraph. The paragraph is read-only while speech is transcribed, and becomes the editable draft when the speech settles. Final text uses the body color. Pending text uses the theme color at a lower opacity, and the newest pending segment uses full opacity.
A draft that the host is sending stays hidden. Drafts of other conversations show as named chips. `VoiceDrafts` emits `presence`, so a host can react when it shows nothing, for example after a send or a discard.
Rephrasing is on by default. A failure or a 10-second timeout submits the provider text.

A recording is sent only when its control asks for it with `finish` and `send: true`, or with an explicit `send`. A failed send keeps the recording and its message identity, so the control can send it again or discard it.
While a control records or dictates, the host publishes the microphone level on `voiceInputLevel`.
Native audio requires declared model support and Chat Completions. Other models transcribe the recording with the configured Hearing provider.
Each model request makes this decision again. A tool step that changes the model also changes the audio projection.
Local history keeps the audio and cached transcription. Audio turns remain local with their media.

### Hearing input mode

The Hearing store keeps `inputMode`. The microphone switch (`useSettingsAudioDevice().enabled`) turns the selected mode on or off.

- `always-on` keeps the microphone open and runs voice activity detection. This is the default.
- `push-to-talk` starts a speech input only while the user holds a key. The microphone opens only during the hold.
- `wake-word` keeps the microphone open and runs voice activity detection and wake word detection. Only a wake starts an input.

`startsInputOnSpeech(mode)` decides if VAD alone starts an input. In `wake-word` mode, the voice store's speech target is undefined.
`SileroVad` (`workers/vad/silero-vad`) runs the VAD model in a Worker of its own, so the inference of each 32 ms window does not block the Stage render on the main thread.
Wake word detection runs in every mode that listens continuously. In `always-on` mode, a wake also moves the input to the matched character's session.
The voice host publishes the detector preparation in its snapshot as `wakeWords`, so a settings window can show it.

Each stage page calls `useVoiceListening` once. It is the one place that starts or stops continuous listening.
A voice call always listens. Disposing the scope also ends the call, because the stage page that listens shows the call controls. Outside a call, the `continuous` option decides if the input mode can listen. The web and Pocket stages turn it off on small screens, because they have no control for it there. The microphone settings store reads the same decision as `continuousAllowed`, so the listening preference does not hold the microphone open there either. `HearingConfig` then hides the input mode and the microphone switch outside the desktop app.
`listensContinuously(mode)` in `stores/modules/hearing.ts` decides which modes run detection and keep the microphone open.
To add a mode, extend `HearingInputMode`, `listensContinuously`, `startsInputOnSpeech`, and `useVoiceListening`.

`useVoicePushToTalk` connects a hold to `voice.beginManual`. The press captures the active session, so a session switch during the hold does not move the speech.
`useVoiceHold` owns the hold lifecycle: it ignores key repeats, cancels a tap shorter than 300 ms, and cancels on disable or disposal.
`useVoiceHoldKey` drives a hold with an in-page key, Space by default. It ignores text fields, controls, and modified keys, and cancels when the page loses focus.
The desktop stage uses a configurable global shortcut.

Each host app declares whether it has a Push to Talk trigger. It provides `pushToTalkTriggerKey` from `composables/push-to-talk-trigger` at the app level.
Without a provider, the host has no trigger. The input mode selector of `HearingConfig` then disables the Push to Talk option.
If the saved mode is already `push-to-talk` on such a host, listening stays off. `HearingConfig` and the voice button menu show a warning.
`HearingConfig` is used on the Hearing overview page and in the Hearing dialogs. It asks for microphone permission only when the user turns the microphone switch on.
The mode does not fall back to `always-on`, because that opens the microphone all the time.

| Host | Trigger |
| --- | --- |
| stage-tamagotchi | Yes. All windows share one app, so the settings window offers the mode too. |

### Wake words

`useWakeWordsStore` validates pronunciations against a supplied model vocabulary and preserves them in exported character cards.
Its device-local catalog pauses unresolved pronunciation conflicts. `chooseOwner` activates the selected character's copy.
`setWords` returns conflicts for tools or settings to present. It does not invent a model or a keyword-management UI.

The `configure_wake_words` tool edits the wake words of the character that owns the turn's session.
It validates tokens against the pinned KWS vocabulary in `libs/voice/kws-model`. It returns `saved` with conflicts, or `rejected` with a reason.

`voice.startListening` runs the built-in KWS detection when the host passes no `detectWakeWord`.
`WakeWordDetector` listens to `useSettingsAudioDevice().unprocessedInput`, a second capture of the selected microphone without browser echo cancellation, noise suppression, or gain.
That processing changes the phones that the keyword model hears. The second capture opens only while the catalog has an active pronunciation.
The detector queues 100 ms batches of finite mono samples for a Sherpaw keyword spotter Worker. Sherpa-ONNX resamples them to the model rate.
Recognition does not wait for the Worker. The voice activity plugin collects a wake on its next window. A backlog over 1 second is dropped.
The plugin also passes its VAD result to the detector. A pause of 0.5 seconds starts a new spotter stream, because a stream that runs for minutes misses most calls.
Each keyword uses the search settings of `kwsSearch` and adds tone variants from `kwsToneVariants`. A variant changes the tone of one pinyin final, because a called name often changes its tone.
A match maps through the active catalog to `voice.resolveWakeTarget(characterId, signal)`. This selects a session without navigating the chat window.
Catalog changes rebuild the spotter keywords. A result after a stop or a keyword rebuild is discarded.

`useWakeWordDetectionStore().preparation` reports `unconfigured`, `preparing`, `ready`, or `error` for UI.
The model loads only when the catalog has a pronunciation for the pinned model. Until the model is ready, detection returns no wake.
While no listener runs, the preparation is `unconfigured`.

`useSpeakerTrackerStore` owns the voice host's Sherpaw speaker tracker Worker. `acquire` downloads the pinned CAM++ pack and starts the Worker on first use.
The tracker enrolls the saved voiceprint as speaker 0, and follows each change of it. `release` terminates the Worker.
`preparation` reports `idle`, `preparing`, `ready`, or `error` for UI. No feature acquires the tracker yet.

`useVoiceprintStore` keeps the voiceprint of the device owner in local storage. Only one person can enroll.
`useVoiceEnrollment` records one enrollment from the speech input of the calling window, keeps only the speech that Silero VAD finds, and saves the voiceprint.
The enrollment belongs to the calling component, so it ends when the component unmounts.
While it records, it holds a capture lease (`holdCaptureLease`). The voice host follows leases with `useVoiceCaptureLeaseStore`.
While a lease holds, the host begins no input and records no voice message. A new lease cancels the active input and keeps a voice message that records as a draft.
A lease that nobody renews ends after 3 seconds.

A host can pass its own `detectWakeWord` to `voice.startListening`. Then the built-in detection does not start.
The detector remains active during playback. A supplied `acceptSpeech` classifier can reject playback echo before admission.
The default policy allows barge-in when the browser reports echo cancellation. Without that support, automatic admission waits for playback to end.
Model selection, acoustic echo classification, and enrollment remain external integrations.

## Web search

Open **Settings → Modules → Web Search**, select **Tavily** or **DeepSeek**, enter that service's API key, and enable search.
Tavily is the default. Each service keeps its own device-local key when you switch services.
These credentials are independent of the chat provider. Any chat model that supports tool calls can use the selected search service.
Resetting settings clears both keys and restores Tavily with search disabled.

DeepSeek uses the [Search API](https://api-docs.deepseek.com/zh-cn/api/search/).
Queries accept 1–128 Unicode characters and support operators such as `site:` and `after:`.
The tool requests five results by default, with a maximum of ten. It uses summaries without fetching full pages.
Results retain source links and site icons in the existing search cards. Search requests time out after 15 seconds and stop when the turn stops.
An API error fails the tool call without switching services. Use another search service when your network cannot reach the selected endpoint.

## Chat sampling

In **Settings → Modules → Consciousness**, custom temperature and Top P are off
by default. Enable each parameter only when the selected model supports it.
Some models accept only one sampling parameter at a time.

Disabling a parameter keeps its slider value but omits it from chat requests.
Previously saved values remain disabled until the user enables them. Explicit
per-request overrides still take precedence over these settings.

## Chat images

The chat composers share image drafts and previews. They accept PNG,
JPEG, WebP, and GIF files up to 20 MB each, through file selection or paste.
Previews own their Object URLs. Session changes discard pending image reads.
Failed sends restore the draft through the shared composer.

Choose a provider and model in **Settings → Modules → Vision** and enable
**Use the vision model for chat images**. The vision model describes images before
the selected chat model replies. This flow runs when the chat provider does not
report image input for the selected model. Most providers do not report it.
Local history keeps the images. Provider prompts replace images with descriptions,
including images from earlier turns and retries.
A failed read of an image in the current turn fails the send. The leader keeps a
failed read of an earlier image in memory for its session and vision selection,
so later turns do not read that image again.

**Use the vision model for tool images** applies the same flow to images that tools
return, such as `computer_use_read_image` screenshots and MCP image content. The
vision model reads each image when the tool runs, and a tool rerun reads it too.
While the vision model reads tool images, provider prompts replace stored tool
images with a short note. Stored history keeps the images.

Disable these options to send images directly to a chat model that supports them.
Without a configured vision model, images also go directly to the chat model.
Use this flow for chat attachments and tool images, not periodic screen capture.

## Character-card module settings

The settings of these modules have two sources:

- The module stores (`consciousness`, `vision`, `speech`) hold the global defaults. They hold nothing else.
- Each card stores the values of its character. An empty string means inherit.

`getModules(characterId)` of the card store resolves the two. Chat turns and speech output use it.
The activation of a card does not write the module stores.
See `docs/ai/adr/2026-11-11-module-defaults-and-character-values.md`.

Startup initializes device-local module defaults and clears retired hosted selections.
The module settings pages edit the global defaults. The character editor edits the values of one character.
Settings pages must not save cards from watchers: replicated snapshots also trigger them.
The synchronization leader owns the card commands. Followers receive snapshots.

Models inherit only within the same provider. Voices also require the same
model. Selecting a vision provider on the vision page stores the catalog default
model of that provider as the default. A different provider without a model stays unconfigured rather than
receiving an unrelated model id. The editor requires a model for an explicit
chat or vision provider unless that model can be inherited safely.

Versions before this design kept the defaults in the `airi-card-module-defaults` key. The first start moves
them into the module stores one time. A selection that a user made on a module settings page in those versions
stays a value of the character that was active at that time.
Existing `speech-noop` selections are preserved because they may represent
intentional silence. Users can explicitly choose **Inherit global settings**
in the editor; importing or saving an unrelated card field does not change it.

## Character sessions

Each chat session belongs to one character. A send reads the provider, model, and system prompt of that character, not the selected card.
Selecting another card while a turn waits in the queue does not change the turn.
Before each model request, the turn reads its character's settings again. A tool that edits the character changes the next request.
Each request rebuilds the analytics correlation headers for its provider.
Tool and content-array compatibility failures belong to the model of the failing request, not the first model of the turn.
Session resets and autonomous artistry hooks also use the session character.
Each concurrent turn owns its IO trace. `activeTurnSpan` points to the most recently started turn that is still running.

A tracer view reads spans from the source that `setIOTraceSource` sets. Without a source, it reads
the spans of its own window and the spans that other windows broadcast.

Tamagotchi sets the IO trace hub of the main process as the source. Each window sends its ended spans to the hub.
The hub sends them to the disk recording and to open tracer views. When **Keep recent IO traces in memory** is on, the
hub also keeps the spans of the last 30 minutes, up to 5000. A tracer view that opens later shows them.

A spoken turn is one IO trace, from the wake word to playback:

- `Wake word` (KWS) is the root when a wake started the input. It covers the match and the session selection.
- `Voice input` is the root otherwise. It records the trigger (`control`, `speech`, or `wake-word`) and the outcome.
  `activeVoiceInputSpan` points to it while the input runs.
- Its children are `Voice activity detection` (one span for each speech segment), `Speech recognition`,
  `End of speech judgement`, and `Transcript rephrase`.
- The `Interaction turn` of the submission is also its child. The input ID is the turn ID, and `takeVoiceTurnParent`
  connects them. The turn holds the LLM, streaming control, TTS, and playback spans.
- A composer dictation returns its text to the composer, which sends it later under a new ID. The next turn of the
  same session within 60 seconds continues the dictation trace through `takeComposerVoiceParent`. This link is by
  session, so a typed turn that replaces discarded dictated text in that time also joins the dictation trace.

A typed turn starts its trace at `Interaction turn`.

## Button analytics

Register the shared plugin once in each Vue application:

```ts
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'

createApp(App)
  .use(trackButtonPlugin)
  .mount('#app')
```

Buttons that represent a product-analysis click intent can then declare a
typed event without wrapping their business handler:

```vue
<Button
  v-track-button="{ name: 'update_check_clicked', channel: selectedChannel }"
  @click="checkForUpdates()"
/>
```

Keep async outcomes, confirmed state changes, impressions, and lifecycle events
in their owning business flows instead of attaching them to the initial click.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

The **Misc → Swipe Actions** story renders one row with two start actions and three end actions. Its **Show labels** control switches between
text labels and surfaces that fill the available height. Use this story to
compare gesture presentation, not conversation storage behavior.

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`

## Visual baselines

Visual baseline tests compare screenshots of shared components with committed reference images. They use Vitest's built-in `expect.element(locator).toMatchScreenshot(name)` in the `browser` project, with the pixelmatch comparator.

`src/components/misc/shared-components.visual.browser.test.ts` covers `Alert`, `Button`, `Callout`, `Checkbox`, and `Input` from `@proj-airi/ui`. Each test renders the component states once on a light panel and once on a dark panel. Because these tests import `@proj-airi/ui`, `pnpm verify` runs them when a file of that package changes.

### Where the files live

- References: `<test directory>/__visual-baselines__/<test file>/<name>-<browser>-<platform>.png`, for example `src/components/misc/__visual-baselines__/shared-components.visual.browser.test.ts/button-chromium-linux.png`. Commit them.
- Actual and diff images of a failed comparison: `.vitest-attachments/<test directory>/<test file>/<name>-actual-<browser>-<platform>.png` and `<name>-diff-<browser>-<platform>.png`. Git ignores this directory.
- `__screenshots__` holds Vitest's failure screenshots of any browser test. Git ignores it, so references must not live there.

### Platforms

Fonts and anti-aliasing differ between operating systems, so each platform has its own references. `<platform>` is the Vitest server's `process.platform`, such as `linux` or `win32`. `referencePlatforms` in `src/test/visual-baseline.ts` lists the platforms whose references are committed. It contains only `linux`.

| Run | Reference for this platform | Result |
| --- | --- | --- |
| Listed platform | Present | Compares. A difference beyond the tolerance fails the test and writes actual and diff images. |
| Listed platform | Missing | Fails. Vitest writes the new reference beside the test and asks you to review it. The next run compares against it. |
| Unlisted platform, such as Windows | Not consulted | Reports the test as skipped with the note `no committed chromium-<platform> visual references`. It neither fails nor passes. |
| Any platform with `--update` | Present or missing | Writes the reference when it is missing or differs, then passes. |

To add a platform, run the update command below on it, review the new images, and add the platform to `referencePlatforms` in the same commit as the images.

### Determinism

- Text uses the bundled `DM Sans Variable` font. The test fails if the font does not load instead of falling back to a system font.
- The frame is 360 CSS pixels wide, and the Playwright page matches the 414x896 viewport, so screenshots are not scaled.
- Vitest disables CSS animations and hides the text caret while it captures. It also retakes the screenshot until two captures match.
- All browser tests share one page, and its pointer stays where the last test left it. `renderVisualBaseline` moves the pointer to the corner of the frame, which is panel padding, so no control is captured in its hover state.
- Content must not depend on time, network, or random input. Leave out animated states such as spinners.
- Icon collections resolve from this package directory, so a run from the repository root (`pnpm verify`) renders the same icons as a run from the package.
- Classes and icons must come from scanned `.vue` files or the UnoCSS safelist. The test frame (`src/test/visual-baseline-frame.vue`) owns the layout classes for this reason.

### Tolerance

`browser.expect.toMatchScreenshot.comparatorOptions` in `vitest.config.ts` applies to every visual test. It ignores anti-aliased pixels, treats a YIQ color distance up to 0.1 as unchanged, and allows 0.1% of the frame to differ. A color, size, or spacing change of a covered component fails. A change confined to anti-aliased edges, such as a smaller corner radius on a low-contrast border, passes. Do not pass per-test comparator options; change the shared setting and its comment instead.

### Update references

Update references only when a visual change is intended, and commit them with that change:

```shell
pnpm -F @proj-airi/stage-ui exec vitest run --project browser --update visual.browser
```

The `visual.browser` filter selects every `*.visual.browser.test.ts` file. Add a file path to update one file. Review each changed image before you commit it, for example with `git diff --stat` and an image viewer.

### Review a failure

1. Open the reference, actual, and diff paths that the failure message prints. Red pixels in the diff image changed; yellow pixels are anti-aliasing that the comparator ignored.
2. A dimension mismatch, such as `Expected image dimensions to be 360×392px, but received 360×380px`, means the layout changed size. No diff image is written in that case.
3. If the change is intended, run the update command and commit the new references with the change. If it is not, fix the component.

### Add a visual test

Name the file `*.visual.browser.test.ts`. Render through `renderVisualBaseline(context, () => content, { layout })` from `src/test/visual-baseline.ts` so the platform rule, font loading, and frame apply. Then assert `await expect.element(frame).toMatchScreenshot('<name>')` with a unique name per test file.

## Local Hearing with Sherpaw

Select **Sherpaw** in Hearing settings. Choose a language to see models that support it, then choose a model.
For a new Sherpaw configuration, the interface language sets the filter and selects a compatible model.
Chinese and English start with X-ASR.
An existing model selection stays in place. Choosing a language switches to a compatible model when needed.
The model detects one of its supported languages. Changing the model saves
the Provider configuration and replaces its runtime.
Each speech session currently owns a Worker, released when the session ends or is cancelled.

Hosts must enable `@proj-airi/vite-plugin-sherpaw` to expose model assets.
`provider-inference` owns recognition and Worker cleanup. `stage-ui` supplies model URLs, local asset fetching, the Worker URL, and the Hearing view.
The Provider is unavailable when the host does not include models.
Use this Provider for local streaming recognition without API credentials.
It requires Workers and WebAssembly.
Desktop development stores selected models in the app user data directory.
Desktop releases bundle X-ASR and store other models in the user data directory.
Sherpaw settings show download state and let users install or remove remote models.
Use a remote Provider when model download size or local memory makes that unsuitable.
The existing VAD pipeline has separate model and runtime downloads.

`libs/inference/transformers-cache` manages the browser cache used by Transformers
and Kokoro. Sherpaw file pairs use the shared model asset repository.

### Compact Stage status

`HearingStatus` shows the shared, always-on microphone session. Place it above a
mobile composer or at the bottom of a desktop Stage. It reads local request
activity, microphone amplitude, the last transcript, and device or provider
errors.

`StatusCapsule` owns the capsule surface and expandable details. Its indicator
slot receives business content: Hearing owns the audio bars, while sign-in owns
its waiting and result icons. The shell has no request or microphone state. Its details
stay inside its layout bounds so Electron can include them in mouse hit testing.
`HearingStatus` uses the details slot to match chat error cards without adding
microphone failures to chat history.
The component supports reduced motion. Desktop users can enable Streamer mode in
General settings to hide these overlays without stopping microphone input or sign-in.
Streamer mode is off by default.

## Chat stickers

Open **Settings → Modules → Stickers**, then enable stickers. This preference is off by default and applies to this device.
Select a frequency: 25%, 50%, 75%, or 100%. The default is 50% when enabled.
The percentage controls reply eligibility. It does not force an image or guarantee an exact observed ratio.
The model selects one catalog ID from the image names and emotion tags. No separate emotion classifier runs.
Each prepared or queued request retains its catalog, provider, prompt, and eligibility.
No extra provider, API request, character card, or memory module is required.

### Manage the library

Import a PNG, JPG, WebP, or GIF image. Files must decode successfully and remain within 2 MB and 4096 × 4096 pixels.
Preview the image, enter a name with 1–80 characters, and select at least one emotion tag.
Each image can use several tags. Bundled and imported images use the same catalog format.
Edit any image's name or tags. Imported images also support replacement.
Deletion removes the entry from future catalogs. It does not remove images from existing or already prepared replies.
Unknown saved IDs display a translated placeholder and never become image URLs.

IndexedDB stores metadata and immutable image versions on this device.
Replacement creates a new image ID. Chat slices retain the ID selected when their request was prepared.
Deleted entries retain their images. Archived images use storage until the application's site data is cleared.
Web Locks serialize edits across renderer windows. BroadcastChannel signals refresh the local snapshots without transferring image bytes.
The toggle and frequency follow existing same-origin storage events. Reset restores these preferences without clearing the library.
Cloud chat sync transfers text only. Neither imported images nor sticker slices transfer to another device.
Runtime generation does not require an image service or image-generation model.

### Bundled artwork

The default pack contains twelve generated chibi reactions of AIRI's official blue-haired Live2D character.
See [artwork provenance](src/assets/stickers/README.md) for references, exact prompts, and inspection notes.
These are static assets. No runtime image-generation dependency is included.
The four development-only Fluent Emoji images are removed. No old-ID migration is included.

## Situational presence

The character can reach out a few times a day for her own reasons, with long quiet stretches between messages. The pure urge gate and reason rules live in `@proj-airi/stage-shared/situation`; this package owns their state, sensors, settings, persistence, and delivery. The [cadence ADR](../../docs/ai/adr/2026-10-29-unprompted-reach-out-cadence.md) records the current design.

### Situation store

`useSituationStore` in `stores/situation` holds the situation of the leader window. Situation observations are neither synced nor persisted.
Each host calls `initialize(syncedPinia)` next to the chat store. The leader starts the sensors, the listeners for the user's voice and composer activity in every window, and a 1-second advance ticker. A follower ignores every other call and reads no input.
Every chat request carries the block from `renderForRequest` as its only runtime context. Outside the leader, `renderForRequest` returns `undefined`, so a host that never initializes the store sends no block.

- `setHostCapabilities({ unprompted: true })` runs the gate loop in the leader: every 2 seconds the store sends the connected character mind a `voice-tick`, and the mind evaluates the urge gate. Only the Electron app sets it. With no mind connected, the tick is dropped.
- `setStageVisible(visible)` reports whether the stage is on screen. A host that never calls it counts as hidden, so the gate stays quiet.
- `ingest(observation)` folds one observation. Sensors call it; other code rarely needs it.
- `markAddressed(topicKey)` keeps an eligible screen topic from being raised again. A thread reason is used up only when she speaks about it.
- `requestVoice(request)` asks the character mind to speak about a widget or plugin request; see [Widget reactions](#widget-reactions).
- `onNotifySpoken(listener)` reports each spoken gate fire about a notify, with its topic key and reply text.
- `onExchangeEnd(listener)` reports each finished chat exchange in the leader: at least one user turn, then a quiet stretch with no generation. An unprompted turn alone never opens an exchange.

The gate integrates an urge against a changing hazard instead of firing as soon as a cooldown expires. This gives her a long-tailed cadence: another opening can come soon, but long quiet stretches are normal. Chattiness controls only the mean rate; its calibrated rate at the default setting is `BASE_RATE_AT_HALF_PER_HOUR = 1.3`. A short floor separates non-urgent openings, and a small hourly safety cap bounds them. While an exchange is active, no new topic can open at first, and the exchange factor eases toward normal over about half an hour. After one unanswered opening, only a continuation can open for a while; when that window ends, openings can resume at a reduced rate. Only after a second unanswered message, including a continuation, does she go quiet for hours unless the message is urgent. A reply gradually restores the rate. One double text may follow shortly after her message. The Timings section of the cadence ADR (`docs/ai/adr/2026-10-29-unprompted-reach-out-cadence.md`) lists the exact values.

Most openings come from ripe threads in the current chat session, daily rituals, or an improvised thought from her own day. Only an eligible long session, a return, or a notification can open a turn from screen context. App switches, bursts, wakes, and ordinary context cannot.

The logical day rolls over in the early morning. A greeting can open on his first appearance in its morning window, a sign-off while he is present late at night, and a welcome-back after a long absence that began within the same logical day. The gate learns of a return only from the character mind: the stage's conductor hands the mind's `observe-return` and `observe-wake` intents to `observeReturn`, and the welcome-back window opens from the time of that return, so a later flip between `here` and `idle` does not open it again. Each ritual runs at most once per logical day; an absence across the rollover can prompt the greeting, not welcome-back. The Timings section of the cadence ADR lists the ritual windows.

Gate memory, threads, ritual completion, and the thread extraction read positions are written directly to non-synced local storage. They survive reloads without entering synchronized Pinia state. Use this store to give the model situation awareness and to run unprompted remarks.
The existing hard suppressors, including Do Not Disturb, hidden stage, active calls, typing, and games, still hold unprompted turns; urgent notifications bypass timing, forced turns speak, only the leader fires, and one request can be pending at a time. A forced widget or plugin turn that speaks starts the same short floor and never counts as unanswered, and so does a spoken touch reaction.
Do not read it in follower windows, and do not store its block or window titles in chat history.

### Thread extraction

While the gate runs, the leader makes one `createThreadExtractor` attempt (`features/situation/thread-extraction`) for each ended exchange. It asks the active chat provider and model which questions, events, promises to come back "later", or dropped topics are still open, and, in the same answer, which relationship events (a disclosure, a kept promise, an unkind or hurtful remark, a milestone, or significant positive or negative news) clearly happened; the answer is one JSON object `{"threads": [...], "events": [...]}`. Validated events go to the extractor's `onEvents` dependency, which the store hands to the character state through its situation bridge (`onExtractedEvents`). A thread or an event whose text repeats a window or page title that the situation holds (the extractor's `heldTitles` dependency) is dropped, and the rest of the answer is kept. The store adds the threads with `addThreads` as reasons for that chat session, then saves them with the gate memory. Each extraction reads only the messages after the newest one that the previous extraction of that chat session read, so a later exchange never brings back the threads of an earlier one. The read position moves only when the answer was read (`ok` or `empty`), so the messages of a failed or invalid attempt are read again next time. Read positions are saved with the threads and survive a reload.
The call reads the last 12 user and assistant messages (400 code points each, 4000 in total, without unprompted trigger messages), caps output at 2000 tokens, times out after 20 seconds, and runs once at a time. The cap also covers reasoning that the provider does not return, such as the default thinking of Claude 5 models behind the Anthropic OpenAI-compatible endpoint. An answer that stops at the cap or is aborted is recorded as `failed`, never parsed. Every ledger entry of a sent request keeps the answer's length and finish reason for the inspector, and an `invalid` or `failed` entry also keeps a sanitized excerpt of its first 200 code points. It goes straight to `useLLM().stream` with an `unprompted` origin, so it carries no tools, fires no chat hook, and adds nothing to chat history.
The answer is untrusted: Valibot accepts at most 3 threads with a known kind, a summary of at most 160 characters, and a cue of at most 200. Each text loses control characters and goes through `situationContextText`, and an entry whose text contains `<|`, `|>`, `SILENT`, or a line starting with a chat role is dropped. Valibot also accepts at most 3 events with a known kind, a reason of at most 60 characters, and a memory text of at most 150 that only milestones keep; a milestone without memory text is dropped. Event text is cleaned like thread text, but an event whose text contains a marker or a role line makes the whole answer `invalid`, because an event moves the relationship. A bare array, an unknown kind, or text over a cap also makes the answer `invalid`. Every attempt, failures included, appears only in the devtools Situation inspector's extraction ledger.

### Sensors

`stores/situation/sensors/` turns host signals into observations: desktop presence (returns and desktop wakes come from the character mind), the foreground app and busy state, conversation turns and the end of each exchange, the stage expression and mood, plugin and vision context, Minecraft context, and `spark:notify` events.
Only the leader runs them. Context messages from the context bridge reach the situation through `ingestContextMessage`, and notifications through `notifyObservationFrom`.
A follower window forwards its notify observations to the leader over the speech bus with `situationNotifyObservedEvent`.
The foreground sensor skips AIRI's own windows and treats a sample older than 5 seconds (20 seconds while the stage is hidden) as stale. Apps on `blockedApps` and private browser windows never reach it, because the host drops their readings. While `shareWindowTitles` is false, the host sends every sample with an empty title. `foregroundReadPolicy` builds what the host receives with each read from `blockedApps` and `shareWindowTitles`; when its key (`foregroundReadPolicyKey`) changes, the sensor forgets what it reported and the situation forgets the foreground app.
While `shareForegroundWindow` is false, it reports nothing, and the store drops every app, title, and app category from the situation with `forgetForeground`. The gate then holds with `stale-signal`.
While `shareBrowserActivity` is false, `ingest` drops every context and notify whose source key belongs to the web extension (`WEB_EXTENSION_SOURCE`, `proj-airi:plugin-web-extension`), and the store removes what the extension already sent with `forgetSource`. The character orchestrator also runs no spark agent for such a notify. `sharesSource(sourceKey)` answers whether a source is shared.

Add a sensor when a new signal should reach the model's view of the situation.
Do not send ambient context to the model in any other way: the situation block is the only ambient channel.

### Presence settings

`useSituationSettings` in `features/situation/settings` stores one document at `settings/situation`: `unpromptedEnabled`, `chattiness` (0 to 1, default 0.5), `dontDisturb`, `shareForegroundWindow` (default true), `shareWindowTitles` (default true), `shareBrowserActivity` (default true), `quietApps`, `blockedApps`, `showUnpromptedCue`, and `speakDuringGames`.
An invalid field falls back to its default. The leader routes `update` and `reset`.
**Settings > Presence** edits it in the Electron app.

Use these settings to control the mean rate of unprompted turns and which foreground details the model may see.
Turning `shareForegroundWindow` off also stops unprompted speech, because the gate needs a fresh foreground sample. Replies to the user still work.
Turning `shareBrowserActivity` off removes the web extension's page and video titles, links, subtitles, and video notifications from the situation. It does not affect foreground sharing or the gate.
Do not read them in the Electron main process.

### Conversation settings

`useConversationSettings` in `features/conversation/settings` stores one document at `settings/conversation`: `register` (`talking` or `texting`, default `talking`) and `textingFlavor` (`plain` or `discord`, default `plain`, read only while texting).
The value sets come from `@proj-airi/stage-shared/conversation-register`. An invalid stored field falls back to its default, and defaults are never written until the first `update` or `reset`. The leader routes `update` and `reset`.

The chat prompt composer renders the register section with `renderRegisterSection(register, textingFlavor, t)`. Each request's system prompt places it after the character prompt and before the stage contract, so the stage contract text and its hash never depend on the register. An empty section is left out. A session stores no system message, so a register, flavor, or locale change reaches the next request; an unchanged setting keeps the system prompt byte-identical across turns.

### Unprompted turns

`useChatStore().submitUnprompted({ topicKey, topicText, widget?, messageId?, supplement? })` starts one turn without user input in the leader's active session. It resolves to `spoken` with the text, `declined`, `cancelled`, or `failed`.
Every instruction invites the model to decline with `<|SILENT|>`, the `declineMarker` of `STAGE_RUNTIME_CONFIG` that the chat store passes to the runtime. `widget` changes only the instruction: a widget turn takes `base.prompt.unprompted-widget`, a brief reaction to what the widget reports, instead of the instruction of its reason's category. A turn also declines when its reply has no visible speech. A decline writes an `unprompted-declined` control record and nothing else.
At most one unprompted turn is pending at a time. A user send in the same session cancels it.
The trigger message keeps `topicText` in chat history, so no line passes a window title or a web extension title or link as `topicText`: `useSituationStore().speak` calls `unpromptedTopicText` from `@proj-airi/stage-shared/situation` for reach-outs and widget lines. Its trigger kind identifies the reason source. Thread text reaches the model only as labelled data in the trigger, never in the instruction. For a web extension topic it passes only the kind of topic, and the situation block of the request carries the details.
`userSending` ignores unprompted turns, so the presence bubble and the streaming placeholder follow user turns only.
Chat history shows a muted "Reached out: ..." cue above the reply unless **Show unprompted cue** is off. The trigger kind identifies whether the reason is a thread, ritual, own-day thought, eligible screen event, or touch. Unprompted turns are excluded from cloud sync.

### Widget reactions

Only the leader serves widget reaction requests (`dispatchSparkNotifyReaction` and `dispatchSparkNotifyPerformance`): the Electron app sets the spark role `main` in the leader window and `client` in every other window, which forwards its requests over the `airi-spark-notify-bridge` BroadcastChannel.
The context bridge calls `useSituationStore().requestVoice({ turnId: 'spark:<id>', topicKey, topicText, supplement, timeoutMs })` before the notify enters the situation, so the mind holds its topic from the gate from the start. The topic text is the replacement message or the headline and note. `timeoutMs` is the caller's `timeoutMs` (a client forwards its performance wait), else 30 seconds.
`requestVoice` resolves `failed` at once in a follower window, while the gate loop does not run, and when no mind is connected. Otherwise the mind holds the request while she or the user is busy, and lets it through as a `widget` line. `speak` applies `unpromptedTopicText` (a request from the web extension stores only the kind of topic) and calls `submitUnprompted` with `widget: true` and the message id `spark:<id>`, which the CALL handlers of the request listen to.
The mind gives up a request that found no quiet moment within 20 seconds (`drop`), and stops a line that has not spoken by the caller's deadline less 1 second (`cancel`, which calls chat `cancelTurn`); both answer the caller `cancelled`. The mind's earliest deadline reaches `publishVoice` as `wakeAtMs`, and the store ticks the mind then.
A request returns the spoken text, or the fallback text when the turn is declined, cancelled, dropped, or failed. A spoken reaction addresses its topic at its first literal, and a declined one at its end. A cancelled, dropped, or failed one leaves the topic for the gate, so she may raise the notify on her own.
The character store no longer speaks spark reactions through its own `Speech` client. A spoken notify reaction, from a gate fire or a widget request, is posted on the `airi-spark-notify-bridge` BroadcastChannel and recorded once per notify id in the `reactions` of every window.

Only `useSituationStore().speak` calls `submitUnprompted`, for lines the character mind decided: reach-outs and widget reactions.
Do not pass a raw window title in `topicText`, because the trigger message is stored in history.

### Reaction turns

`useChatStore().submitReaction({ kind, topicText, eventId })` starts a short in-character reaction to a touch on the stage in the leader's active session. `kind` is the `ReactionKind` of `@proj-airi/stage-shared/situation`: `pet-soft` or `poke-protest`. It is a synced action like `submitUnprompted` and resolves to the same outcomes.
A reaction is an unprompted turn with the turn ID `reaction:<eventId>`, so it shares the single pending turn: while any unprompted turn is pending, another reaction or unprompted turn fails with `Another unprompted turn is still pending`, and a repeated call for the pending event joins it.
The trigger message is `base.prompt.reaction-trigger` with `topicText`, and its trigger is `{ topicKey: 'touch', text: topicText, kind }` with kind `touch-pet` or `touch-poke`. The instruction is `base.prompt.reaction`, or `base.prompt.reaction-protest` for a poke protest. A reaction has no reason category and is never forced: it gets only `builtIn_readMemory`, and a `<|SILENT|>` reply declines it with one control record.

Only `useSituationStore().speak` calls `submitReaction`, for a line the character mind decided about a touch. Do not use it for notify or widget reactions; they use `submitUnprompted`.

### Stage touch

Only the Natural driver classifies touches. The Live2D scene reports a pet start, a pet end, or a poke with its `naturalTouch` event and the MMD scene with its `touch` event, each as a `TouchReport` of `@proj-airi/character-mind`. `Stage.vue` hands every report to `StagePerformanceConductor.touch`, and nothing shows the touch before the mind answers.

Under a Natural driver, `conductor.touch(report)` answers one touch once, in the call stack of the scene's event:

1. For a finished pet and a poke it calls `voice().observeTouch(observation)`, which is `useSituationStore().observeTouch`. The leader folds the `TouchObservation` into the situation and returns a `TouchVoiceView`, or `null` in a follower window and while the urge gate does not run. A pet start is not observed.
2. It sends the mind one `touch` stimulus with the active card's effective settings and that view.
3. It dispatches the mind's intents in order: `touch-reaction` to the scene's `reactToTouch`, `mood` to the scene's `addMood`, `moment` to `markMoment` (`useIdleProps().onMoment`, which keeps the chance, the pick, and the entry rest), `speak` to `voice().speak`, and `attend` to the scene's `attend`.

The scene performs only what `reactToTouch` hands it: a poke starts Natural's poke at the reported point, and the pet hand reaches Natural only between a pet `start` and its `end`. The asset decider is not involved, and an affect trace records no touch.

### Stage chat

`Stage.vue` sends the mind each typed send (`chatComposerSentEvent`, with its word count, never its text) and each time the host's chat turns visible (`chatTarget.visible`; the first observation only records it) through `conductor.chat(cue, words)`. The conductor steps the mind under every driver and, only under Natural, hands the mind's `chat-read` intent to the scene's `chatRead` and its `attend` intent to the scene's `attend`. The scene's chat input (`chatTarget`, `chatActivity`) carries only the target and typing for Natural; `chatActivity.sentSeq` stays for the MMD body director until it acts on intents. The motion QA bridge sends scripted `chat-sent` and `chat-unfold` events through the same call.

The conductor reaches the leader's situation store through its `VoicePort` (`composables/performance/mind-voice.ts`). `conductor.desktop(events)` dispatches the mind's `observe-wake` and `observe-return` intents, in intent order and under every driver, to `voice().observeReturn`, which folds a `WakeObservation` or a `ReturnObservation` into the situation in the leader and does nothing in a follower window.

### Reach-outs through the mind

The leader's character mind decides every reach-out; the situation store is its voice port. The mind lives in `useCharacterMindStore` (`stores/character-mind.ts`), not in a stage: `App.vue` calls `initialize(syncedPinia)` after the character state and situation stores, and `dispose()` on unmount. `Stage.vue` hands `store.mind` to its conductor and calls `attachStage({ idleCue, idle })` on mount, which returns a `MindStageHandle`; it calls `detach()` on unmount. The cues of a line go to the newest attached stage and are dropped with none. The mind's idle intents go to every attached stage, and the handle's `report(reports)` gives the mind that stage's idle reports, which count only from the newest attached stage; a detach of the reporting stage sends the dormant view, and so does the attach of a newer stage, until that stage reports. The store arms one timer at `nextIdleWakeAt` and sends `idle-wake`, so idle decisions land on their deadlines. Every window that creates the store constructs its own mind, but only the leader's connects, so a follower's mind answers its stage's touch and desktop steps and decides no line.

The mind hears music only while the window leads. At promotion, where beat sync runs (`isBeatSyncSupported`), the store starts a `MindMusic` (`composables/performance/mind-music.ts`) over `listenBeatSyncBeatSignal`: beats that last 8 s with no gap over 1.8 s, outside game, call, and chat apps (`advanceMusic` of `@proj-airi/stage-shared/music`), send `music` with `playing: true`, and a 1.8 s gap or a quiet app in front sends `playing: false`. One timer at `nextMusicDeadline` decides between beats, and the store feeds each change of `foregroundCategory`. A demotion stops it and tells the mind the music stopped; a reset re-sends `playing: true` while music plays (`replay`). The user starts and stops the detector on the beat sync settings page; nothing starts it on its own. `Stage.vue` reads the mind's `state.music.playing` for the `music` pastime occasion.

- `connect(send)`: the store connects on promotion, after `useCharacterStateStore().ready()`, and disconnects on demotion, so the gate runs whether or not a stage is mounted. The newest connection wins. While the gate runs, the new mind gets a tick at once, then the user turn that arrived while no mind was connected.
- The tick: the store prunes the threads and sends `voice-tick` with a `VoiceView` built from the gate signals, the gate settings, the local time, the threads, the reading's urge factor, and whether an unprompted turn is pending. `user-turn` follows each user turn. A widget request arrives as `voice-request` with the same view.
- The store's `MindVoice` answers each stimulus in one mind step and dispatches `speak` for every line kind to `voice().speak(turnId, line)`, `cancel` to `voice().cancel(turnId)`, and `drop` to `voice().drop(turnId)`. A line's outcome returns to the mind as `voice-outcome` with the same `turnId`.
- `publishVoice({ runId, memory, decision, wakeAtMs })`: after each step that changed the gate memory or decided, the mind's `MindVoice` publishes it. The store keeps the memory as its read model (`gateMemory`), which the inspector and the character state read, carries its user slice (`userGateMemoryOf`: the floor, the hourly cap's fires, and the ritual day) in `VoiceRun.user`, saves the floor and the ritual day with the leadership token when they changed, and records the decision in the inspector. A step also publishes when its widget deadline changed: the store arms one timer at `wakeAtMs` that ticks the mind, or clears it when `wakeAtMs` is null.
- Runs: each promotion and "Delete all data" starts a new `VoiceRun` id, and a promotion seeds `user` with the saved slice and no fires. The mind restores its gate memory at its first tick of a run, or after a reset: a promotion with `run.user` and its own pacing laid over it (`restoreGateMemory`).
- Her pacing: `useCharacterMindStore` resets the mind to the active record's `pacing` at promotion, after `ready()`, and whenever `useCharacterStateStore().leaderEpoch` changes (a card switch, an import over the active card, a forget, "Delete all data"), then connects again, so a widget request the old state held answers `failed`. An away span open at the reset reopens at it, so the return after it still gets its response. After each step that gives `state.slow.pacing` a new object, it calls `recordPacing(cardId, epoch, pacing)` with the card and epoch it loaded. A card switch keeps the user's floor and hourly cap through `run.user`, and the old card's open line ends as an ordinary unprompted turn: the reloaded mind has no line for its outcome.

`useSituationStore().speak(turnId, line)` runs a line. It resolves `refused` without sending while another unprompted turn is pending, and `failed` in a follower window, while the gate does not run, and when the window stopped leading before the turn had a result. Otherwise it resolves at the first spoken literal, at a decline, or with the turn's result.

- A reach-out applies `unpromptedTopicText`, addresses its topic before the send (a thread only once her turn speaks), and calls `submitUnprompted` with its reason under a new message id; the mind's `turnId` is not the chat message id. At the first literal a thread topic is raised. The outcome is recorded per reason kind for the inspector.
- A widget line calls `submitUnprompted` with `widget: true` under its `turnId`, and its caller receives the turn's result; see [Widget reactions](#widget-reactions).
- A touch line marks the touch event shown and calls `submitReaction`. It resolves `failed` when its event is gone. The mind starts the gate's short floor for a spoken one (`recordExternalSpeech`); reaction outcomes never reach `recordUrgeFireOutcome`.

The pacing of these lines (the 45 s refractory, the retry wait, the burst roll) is the mind's fast state. It is not saved, so it starts over at every launch. `useCharacterMindStore` feeds the mind's voice decisions to the devtools reaction inspector of its window. Two stages that render in one window share its one mind; only their Natural idle draws stay separate.

A reaction turn's own cues dose no mood, because the touch already did. When a turn's trigger has the `touch` topic key, `Stage.vue` calls `markMoodless(turnId)` on the conductor, and every episode of that turn carries a mood gain of 0.
Under a Natural driver, `conductor.cursor(reports)` answers the scene's `cursorReports`: it steps the mind once per report and sends each `cursor-episode` intent back to its own scene's `cursorEpisode`, because the cursor's geometry belongs to the stage that saw it. Under another driver it drops the reports and the mind draws nothing.
`conductor.interaction(source)` tells the mind of a drag release (`Stage.vue` calls it when its `interactionSeq` prop changes) or a sent chat message (where `chatComposerSentEvent` increments `chatSentSeq`), under every driver, and sends the mind's `attend` intent to the scene's `attend` only under the Natural driver. Under the classic driver the attend intent is not dispatched, so the director gets no attend window: the MMD body walks only under Natural. A scene without `attend`, such as the Live2D scene, drops it.
The conductor's `gesture(kind, count)` plays an ACT `gesture` field on the scene under the Natural driver of Live2D and MMD; Universal, MAGIC, and MMD Classic ignore it.
The conductor's `action(label, gesture?)` forwards an ACT `action` label to the scene under every driver. `Stage.vue` routes an action label, with its cue gesture, only while the MMD renderer is active, and the MMD scene resolves the label against the clips the user exposed. A Live2D scene never receives one.
The [nonverbal channels ADR](../../docs/ai/adr/2026-10-31-nonverbal-channels.md) records the design and its consequences.

### Stage action tool

`tools/action.ts` defines `perform_action`, registered as `action:perform_action` beside the body tools (`tools/body.ts`: `come_here`, `go_home`, `look_at`). Its `action` argument is an enum of the exposed action and dance labels plus `stop`, so the model can name only clips the user exposed with **AI may use**; gestures are not tool actions and ride on the ACT `action` field instead. `createActionToolRegistration` rebuilds the tool when the exposed set changes and removes it when the set is empty or the scene has no action port. `Stage.vue` passes the MMD scene's `actionPort` and `listActions()` to the conductor whenever the MMD renderer is active, with or without the desktop stage, so the tool works in the classic window too.

The body director decides every request. The result mirrors the body tools: `{ success, state, error?, retryAfterSeconds? }`, where a refusal names the reason (`refractory` with the seconds to wait, `busy`, `asleep`, or `dragging`), and a label outside the enum answers with the exposed labels. Tool executors live only in the renderer that registers them, which is the synced leader (the stage window on the desktop stage); a chat-window turn reaches them because the composer's `chatStore.send` runs the turn in the leader.

The exposed labels also reach the system prompt through `useStageActionsPrompt` (`composables/use-airi-runtime-prompt.ts`), as the `actions` tail segment that `stores/chat/prompt.ts` adds after the stage contract. The [clip actions ADR](../../docs/ai/adr/2026-11-03-mmd-clip-actions.md) records both channels.

### Situation inspector

**Settings > System > Developer > Situation** shows the live situation, event table, last rendered block, urge and hazard trace, phase and expected wait, ripe reasons and their weights, thread ripeness and expiry, pick trace, ritual state, per-reason outcomes, extraction ledger, spend, and ACT compliance.
`useSituationObservabilityStore` serves the page from the leader through Eventa invokes on a BroadcastChannel context, not through synced actions, so polling leaves nothing in the shared synced state.
**Evaluate now** sends the connected mind one tick with `forceTiming`, past timing guards and the short floor; hard suppressors still apply. It answers with the decision the mind published in the same call, or as skipped: `unprompted-pending` while a line or another unprompted turn is open, `gate-not-running`, or `no-mind` when no stage is mounted.

Use the inspector to tune the gate and to see why the character spoke or stayed quiet.
Do not use it as a user-facing settings page.

## Character state

The character-state store in `stores/character-state/` holds the active character's mood, temperament, and relationship. The desktop app creates it at startup.

Each chat request sends the worded mood and the relationship stage as a per-request runtime context message with the id `system:character`, beside `system:situation`. It is never part of the system prompt, and the model never receives the numeric mood. A MOOD cue in a reply is applied as a bounded contribution that fades within a few hours, so the model cannot push its own mood far in one turn. A cue whose reason repeats a window or page title that the situation holds applies nothing, because the reason is stored.

The situation bridge is the only seam between the situation store and the character state, and it runs only in the leader. It feeds touch, reach-out, and extraction events into the state. It also hands the situation gate's tick the reading's urge factor as the mood factor, so a better mood makes an unprompted turn slightly more likely and a low or tense mood can make it pointed.

The character-state store depends on the card store, never the reverse. A store that keeps data per card registers a listener with `useAiriCardStore().onCardRemoval`; the character-state store uses it to forget the record of a deleted card.

The stage drives the resting face from the mood through the Live2D and MMD adapters. A devtools page lets you inspect the current reading.

The [layered character state ADR](../../docs/ai/adr/2026-11-03-layered-character-state.md) records the design and its known gaps.

## Long-term memory

`useMemoryStore` in `stores/memory.ts` keeps entries in IndexedDB, in the database `airi-memory` and its store `entries`, through the unstorage mount in `database/storage.ts`. It uses the `airi:memory` BroadcastChannel to reload changes in other windows and stores the toggle at `memory/enabled`.

`tools/memory.ts` defines `builtIn_readMemory`, `builtIn_writeMemory`, and `builtIn_forgetMemory`. `composeMemoryHeader` renders the memory rules, and `composeMemoryPrompt` adds the index below them. The index lists one line per entry, oldest change first, and marks general entries with `(general)`. Card selection does not change the character bound to a queued turn.
`memoryWriteRefusal` checks every entry of a `builtIn_writeMemory` call. It refuses an entry that repeats a window or page title the situation holds, unless the user's message of the same turn contains that title, and it always refuses an entry that matches a credential shape. The tool result gives the model the reason. Pass `guard` to `createMemoryTools` with the held titles and the user's message of the turn.

Chat requests build their system prompt with `useChatPrompt` in `stores/chat/prompt.ts` and `composePrompt` from `@proj-airi/stage-shared/stage-contract`. The memory index follows the `actions` segment, which leads the tail after the identity and stage contract. Its rules are the segment header, and its lines are the entries that the composer drops oldest first past its budget. The index stays out of `session-store.ts`, so the stage-contract prompt hash does not change. The [prompt composition ADR](../../docs/ai/adr/2026-11-01-prompt-composition.md) lists every segment.

Unprompted turns receive only `builtIn_readMemory` through the core-agent runtime's `unpromptedTools` option. In `stores/ai/chat-llm/llm.ts`, unprompted requests resolve only the supplied custom tools and no built-in tools.

The [adoption ADR](../../docs/ai/adr/2026-10-30-long-term-memory-adoption.md) records the design and its consequences.

## Persisted state

`stateRegistry` in `persistence/state-registry.ts` declares every piece of persisted renderer state: localStorage and sessionStorage keys, IndexedDB stores, OPFS directories, and Cache Storage caches. Each registration names its owner, the files that write it, its tier, its locations, and an optional owner reset. `resetRegisteredState` runs the owner resets in registry order and then removes everything the locations match. "Delete all data" (`useDataMaintenance().deleteAllDataWithHost(useHostDataDeletion())`) runs it over every registration and then runs the host's own deletion step: every registration runs even when an earlier one fails, the host step runs even when the registry failed, and the first failure is thrown at the end. The narrower Data page actions run fixed lists of registration ids.

When you add persisted state, add a registration in the same commit and run `src/persistence/state-registry.browser.test.ts` and `src/composables/use-data-maintenance.browser.test.ts`. The first creates and resets every owner in a leader and a follower window, and fails on a write that no registration owns and on two registrations that claim the same storage. The second fills every registered location, runs "Delete all data", and fails on a location that still holds data. [State persistence](../../docs/ai/context/state-persistence.md#state-registry) states the rules.

Use the registry for renderer storage only. The desktop app's main process deletes its own files through `storedDataDeleteActivity`.
