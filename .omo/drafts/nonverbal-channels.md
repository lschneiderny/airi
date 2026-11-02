---
slug: nonverbal-channels
status: approved
approved-by: Luke, 2026-10-31, reply "write the plan" after the brief (no default vetoed)
intent: clear
review_required: true
plan_path: .omo/plans/nonverbal-channels.md
plan_sha256: 82e0a1d9c1dd63ae9a6288b15e7aa42c576504f7ec2445d8dd08a6a4ae634763
review_round_id: r2-2026-10-31T04-00-34-259Z
review_round_limit: 5
pending-action: none (plan approved; execution starts with /ulw-execute nonverbal-channels)
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/nonverbal-channels.md
    round_id: r2-2026-10-31T04-00-34-259Z
    plan_sha256: 82e0a1d9c1dd63ae9a6288b15e7aa42c576504f7ec2445d8dd08a6a4ae634763
    launch_id: r2-2026-10-31T04-00-34-259Z-launch
    session: st_01a1901e
    result: approved (unconditional, round 2)
approach: see Approval gate section
---

# Draft: nonverbal-channels

> Rebuilt 2026-10-31 after `scaffold-plan.mjs --reset --force` wiped the draft together with the plan; content restored verbatim from the session's earlier draft edits.

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

**Affected users**
- U1 Luke at the desk (primary). Today: petting or poking her moves pixels for ~2 s and nothing else; every reply is a paragraph of spoken text; she cannot answer without words. After: touch shifts her mood and her next words know it; sometimes she says one line about it; she can answer a message with a look or a nod; in texting mode she sends short bursts with ASCII faces the way a Discord regular would.
- U2 The character/model (consumes the stage contract, the situation block, the reaction instruction; emits ACT/BREAK/SILENT cues). Today: no gesture vocabulary, SILENT is meaningless on a user turn, no register. After: a stable contract, a gesture field, a wordless-reply rule, a break cue, a touch line in the situation block, a one-line reaction instruction, and a register section in the character prompt.
- U3 Plugin and widget authors (spark:notify, forced turns, widget reactions). After: unchanged, except a spoken touch reaction starts the gate refractory like a forced turn.
- U4 Luke as tuner (devtools Natural Motion Lab, Situation inspector). After: fires each gesture, sees touch events and reaction-policy decisions.
- U5 QA and model-eval (qa-tools motion scenarios, cue-contract scorer). After: T1 scenarios assert gesture trajectories; the scorer counts gestures, breaks, wordless replies, and ASCII faces.
- U6 Executor/maintainer. After: pure policies with explicit time and seeded RNG; READMEs and ADRs match behavior.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Every pet and poke doses mood through the existing dynamics (pet: +valence, -tension; poke: +arousal; a third poke within 10 s: +tension) with saturation and a per-gesture cooldown, so a cursor resting on her head does not pump mood every frame; the Natural flinch and pet layer behave exactly as today | "mood or expression" every time (Luke) |
| GAP-1 | `Live2D.vue:232-234` re-emits `touch`; nothing listens; the poke surprise impulse is kept out of mood (`natural-motion/touch.ts`) | Touch is a dead end |
| IS-2 | A recent touch is a situation event with a `New:` bullet ("petted your head for about 4 s", "poked you 3 times in a few seconds") that decays like a notify and is marked shown once rendered, so her next user or unprompted reply can know it; it is never a reason for the urge gate to open a reach-out | Her mind must hear about it; speech about touch belongs to the reaction policy, not the reach-out gate |
| GAP-2 | `types.ts:119-130` has no touch observation or event kind; `GATE_ELIGIBLE_EVENT_KINDS` would make any new kind a reach-out topic | No channel from touch to the prompt |
| IS-3 | A pure reaction policy decides, with explicit time and a seeded RNG, when a touch earns one short spoken line: first pet of a session silent; a sustained pet (>= 3 s) may speak with p 0.3; a third poke within 10 s speaks with p 0.8 (protest); >= 45 s between lines; never while the hard suppressors hold (DND, hidden, speaking, typing, generating, queued, quiet app); at most one pending; a spoken line calls `recordExternalSpeech` so the reach-out gate waits | "occasionally a line" (Luke), without colliding with speech or reach-outs |
| GAP-3 | No reaction policy exists; the urge gate's 2 min floor and urge timing would make a poke protest arrive minutes late or never | Reactions need their own clock |
| IS-4 | The reaction line is a short unprompted send (instruction `base.prompt.reaction` / `reaction-protest`, trigger kind `touch-pet` / `touch-poke`, SILENT allowed, read-only tools) that is spoken, stored in chat history with a cue ("Reacted to a poke"), and never talks over a conversation | Luke rejected spoken-but-forgotten reactions in 2026-10-19 (Observe + gate) |
| GAP-4 | `unpromptedInstructionKeys` (`chat.ts:133-141`) and the cue labels know no touch kind | No prompt or label for a reaction |
| IS-5 | On a user turn, a reply whose visible text is empty after cues and whitespace and that carries >= 1 ACT and a `<\|SILENT\|>` is a wordless reply: the stage performs the cue, nothing is synthesized, an assistant item with empty text and the performed cue is stored locally so history shows a small non-text cue (the emotion or gesture) and the user's message never looks ignored (the item is excluded from cloud sync like unprompted turns; cloud sync is inactive in this fork); the contract says when a look or a gesture is the whole answer | Luke: a user turn must be answerable with an expression alone |
| GAP-5 | `chat-orchestrator-runtime.ts:662-666, 1021-1028`: SILENT declines only for `origin === 'unprompted'`; on a user turn it is a plain special; persistence is guarded by slices (`1345-1350`) | No wordless path |
| IS-6 | ACT JSON accepts `gesture` in {nod, shake, shrug, lean, glance} (bare form unchanged); Natural plays each as a time-shaped clip (nod: two pitch dips ~0.9 s; shake: two yaw cycles ~1 s; shrug: body bob + brow lift ~1.1 s; lean: body roll/forward hold ~2.6 s; glance: eye-only aside saccade ~0.6 s and return), composed with attention and the pet layer; a repeated gesture while active is dropped; MAGIC and Universal ignore the field; the contract lists the five names | Full gesture vocabulary (Luke) |
| GAP-6 | `payloads.ts:134-174` normalizes emotion/intensity/motion/expression/look only; `gestures.ts` clips are emotion-triggered (laugh, recoil, shake, drop, sway, tilt-in, look-away, nod-off) with no host command; the adapter has no gesture queue | Gestures exist as a primitive, not as a channel |
| IS-7 | A user setting `register` (talking \| texting, default talking) with a texting flavor (plain \| discord) persists and syncs like Presence settings and is edited on a Conversation settings page; the stage contract is register-neutral (one hash) and the register text rides in the character-prompt section, so the prompt prefix stays cache-stable within a session and model-eval keeps one contract version | Register is a user setting (Luke); contract versioning (model-eval) |
| GAP-7 | No register exists; `base.prompt.response` says "talking, not writing" while `base.prompt.unprompted` says "text them" | Two prompts disagree today |
| IS-8 | In texting, `<\|BREAK\|>` (optional seconds, clamped 0.3-3.0, default 1.0) splits one reply into at most 3 bubbles with a delay between them; the reply is one persisted assistant item carrying break slices (reply, edit, delete, and history layout unchanged; over cloud sync it travels as its content); later bubbles appear on a schedule that keeps running after generation ends, while a message opened from history shows all at once; speech speaks segments in order with the pause; the same semantics hold in talking (only the texting prompt teaches BREAK); extra breaks are ignored; the token cap is unchanged | Bursts are what makes texting feel like texting (Luke) |
| GAP-8 | `controller.ts:14-54` knows ACT/DELAY/CALL only; the stream store holds one content string (`stream-store.ts:8-38`); history renders one bubble per item | No break cue, no segments |
| IS-9 | The texting-discord flavor allows a fixed ASCII face set (`:3 ^^ ^_^ >_< >.< T_T ;_; :) :( :D ;) :P xD XD o_o O_O -_- ^w^ <3`), shown in bubbles and stripped before synthesis in the TTS chunker; Unicode emoji stay forbidden; the character card's own system prompt supplies persona voice, with no schema change | Discord = texting flavor with ASCII faces (Luke) |
| GAP-9 | `tts-chunker.ts:249-254` strips only internal tokens; `base.prompt.emoji` forbids all unpronounceable text | Faces would be spoken as punctuation |
| IS-10 | Devtools: the Situation inspector shows touch events and the last reaction decisions (roll, refractory, suppressor); the Natural Motion Lab fires each gesture; the model-eval scorer reports gestures, breaks, wordless replies, and faces; T1 touch and gesture scenarios pass | Tuning without evidence is guessing |
| GAP-10 | No touch or gesture appears in any inspector; `cue-contract.ts` counts ACT/DELAY/CALL only | Invisible behavior |
| IS-11 | Every policy (touch affect, reaction policy, break splitting) is pure with explicit time and memory in/out; tests pin the invariants; READMEs (stage-shared, stage-ui, stage-ui-live2d, pipelines-audio, core-agent, qa-tools), the reply-shape ADR, and a new ADR describe the channels; English locale only; plugin contracts unchanged | Repo conventions |
| GAP-11 | None of this exists | Documentation and determinism |

## Components (topology ledger)
| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 touch -> mind | touch observation + event + mood dose + situation bullet + inspector | active | IS-1, IS-2, IS-10 |
| C2 reaction policy + reaction turn | pure policy, reaction unprompted send, prompt keys, history cue, gate refractory | active | IS-3, IS-4 |
| C3 wordless reply | runtime rule for user-turn ACT + SILENT, persistence, history cue, no speech | active | IS-5 |
| C4 gestures | ACT `gesture` field, NaturalCueGestures clips, scene API, lab buttons, T1 scenarios | active | IS-6, IS-10 |
| C5 register + bursts + faces | setting, register-neutral contract, register section, BREAK cue, break slices, TTS pause + face strip | active | IS-7, IS-8, IS-9 |
| C6 observability, QA, docs | scorer fields, inspector panels, READMEs, ADR | active | IS-10, IS-11 |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Touch and the reach-out gate (fork timed out 2026-10-31) | touch stays out of the gate (D1) | gate is minute-scale; a touch fire would corrupt unanswered/damping memory | yes: add 'touch' to GATE_ELIGIBLE_EVENT_KINDS later |
| Register setting UI (fork timed out) | new Conversation settings page (D9) | clean home for "how she talks"; Presence is "when she speaks up" | yes: move the fields |
| Wordless reply in history (fork timed out) | bubble-less cue chip (D6) | the user's message must not look ignored after a reload | yes: hide the chip |
| Test strategy (fork timed out) | tests after (D11) | Luke's choice on the last two plans | yes |
| BREAK persistence | one assistant item with break slices (D8) | runtime/transcripts/regenerate/sync assume one message per turn; copy already joins slices | costly later: a migration if bubbles become messages |
| Card flavor field | none; setting-selected flavor text + card system prompt (D9) | Luke chose a user setting; no schema change | yes: add extensions.airi.textingStyle later |
| Reaction constants (p 0.3/0.8, 45 s refractory, 20 s retry, 3 s pet, 10 s burst) | ultrabrain values (D4) | shown in the inspector; tuned from real days | yes |
| Gesture amplitudes (~6-7 deg) | ultrabrain values (D7) | 3-5x smaller than the first guess; existing clips are 0.06-0.12 | yes: tuned on screen |
| Delivery | branch + PR to lschneiderny/airi (D12) | root AGENTS.md source-control rule | yes |
| Extrinsic axes | budget: none (local, own models); stack: repo-mandated; scale: one user, one or two Electron windows; audience: Luke | explored | - |

## Findings (cited - path:lines)
- Touch event `Live2DTouchEvent = poke{region,x,y} | pet-start | pet-end{durationMs}` (`packages/stage-ui-live2d/src/composables/live2d/touch-gestures.ts:24-27`); `Model.vue:1549-1558` applies pokes to Natural locally then emits; `Live2D.vue:232-234` re-emits; `Stage.vue:923-949` mounts `<Live2DScene>` with no `@touch` binding.
- ACT routing: `Stage.vue:438-456` `streamingControl.onSignal` -> `emotionsQueue` -> `performanceConductor.emotion(name, nominal, source 'act'|'tool'|'devtools', turnId)` (`use-stage-performance-conductor.ts:216`); episodes reach `scene.setEmotion` (`:84,461`), `moodGain` per band (`:525-526`); mood published only for the natural driver (`:680-691`); comment `:477`: reaction state must not leak into Universal/MAGIC.
- Mood: `expression-performance/settings.ts:91-109` taus 45/20/30 s, gains .15/.25/.4; `natural-motion/mood.ts:40-60` doses keyed by `episode.id` with escalation rules; a poke runs only the surprise impulse, glance, and `energy.react` (`pending-actions.ts:59-72`).
- Natural gestures exist: `NaturalGestures.trigger(kind, strength, band, at)` (`natural-motion/gestures.ts:243`), kinds `laugh|recoil|shake|drop|shake-or-drop|sway|tilt-in|look-away|nod-off` (`emotions.ts:51`), cooldowns `gestures.ts:48`, lifetimes `gestures.ts:60-69`; `gaze.glance(point, hold, at)` (`natural-motion.ts:509,531`, `gaze.ts:225`); `impulse(episode)` `:374-377`; `poke()` `:418`; adapter input `Live2DNaturalMotionAttention` (`natural-motion-adapter.ts:25-65`) drained in `compose` (`:303-353`); head units normalized, adapter writes `neutral + command*halfRange` (`:381`).
- Situation: Observation union `types.ts:109-117`; event kinds `:120-128`; `origin: 'world'|'self'` `:145`; `GATE_ELIGIBLE_EVENT_KINDS` = long-session/returned/notify (`reasons/types.ts:121-125`); `New:` lines capped at 2 (`render.ts:13-18`), rendered `New: <text> (<ago>)` (`:246`); hard suppressors `gate.ts:79-117`; `recordExternalSpeech` `urge-gate.ts:702-706`; store ticks 2 s (`stores/situation/index.ts:80`), skips while `firing || unpromptedPending()` `:625`, `fire()` `:675-726`, leader-only `:200-211`; notify crosses windows via `situationNotifyObservedEvent` `:60`.
- Chat: `ChatUnpromptedPayload` `chat.ts:109-125`; `unpromptedInstructionKeys` by `ReasonCategory` `:134-141`; `submitUnprompted` refuses a second pending `:1177`, stores `trigger.kind` `:1188`, synced action `:1474`; widget reactions use `force` (stage-ui README `:427`); `ChatTurnTrigger.kind` is a free string (`types/chat.ts:65`).
- Runtime: `origin?: 'user'|'unprompted'` `chat-orchestrator-runtime.ts:198`; decline marker only for unprompted `:661-666`, `:785`, `:1021-1029`; held specials replay at first speech `:975-983`; empty reply declines `:1317-1330`; assistant commit requires `slices.length > 0 || generatedTurn?.rounds.length` `:1345`; `origin` reaches plugins via `ChatStreamEventContext` `:706`, `cueStats` `:1083`.
- Cues: `controller.ts:14-54` default parsers ACT/DELAY/CALL; `parsers/act.ts:44-65` accepts any JSON object; `payloads.ts:134-174` normalizes emotion/intensity/motion/expression/look only (unknown keys ignored); `stream-store.ts:8-38` one content string; history renders one bubble per item.
- Speech: `Stage.vue:780-792` literals -> `voice.write`, specials -> `voice.special`; `voice.ts:473-478` forwards to the speech producer; `pipelines-audio/src/processors/tts-chunker.ts:249-254` `sanitizeChunk` strips internal tokens only; specials flow as chunks with `reason: 'special'` (`:263-268`); `streaming-pipeline.ts:82-88` forwards text verbatim (service splits sentences).
- Contract: `stage-contract/index.ts:28-31` joins emotion/list/emoji/response; `composeSystemPrompt` `:43-46`; `STAGE_CONTRACT_EN_SHA256` `:49`; `session-store.ts:1803` rewrites the stored system message when the contract ref changes; `base.yaml:56-69` response text; `base.yaml:54-55` emoji rule forbids all unpronounceable text; `:28-29` "spoken aloud ... write only words that can be said".
- Settings pattern: `features/situation/settings.ts:24-131` (valibot strictObject, `useLocalStorageManualReset`, synced store `:127`); page `stage-pages/src/pages/settings/presence/index.vue` (route meta `:75-81`); copy `i18n/en/settings.yaml` `settings.pages.presence`; `settings/modules/consciousness.vue` exists as the chat-module page.
- qa-tools: `cue-contract.ts:12-43,130-230` counts ACT/DELAY/CALL/specials; `stage-contract.ts:35-41` `buildSystemPrompt({locale, cardPrompt})`.
- Advisory lanes: architect st_01a18f97 and ultrabrain st_01a18f98 (full text in the task completion results); both integrated in the decisions below.

## Decisions (with rationale)
Sources: Luke (memory reference/projects/dtuber-character-feel-2026-10-31.md), architect lane st_01a18f97, ultrabrain lane st_01a18f98, planner verification.
- D1 Touch never enters the reach-out gate. `'touch'` is NOT added to `GATE_ELIGIBLE_EVENT_KINDS`; a pure reaction policy owns touch speech. (Luke's earlier "gate reason" wording reversed with reasons; timed-out fork, recommended default adopted.)
- D2 Touch awareness = a situation EVENT: `TouchObservation { kind:'touch', gesture:'pet'|'poke', region, atMs, durationMs? }` reduced by `applyTouch` into one event with the single topic key `touch` (each touch replaces the previous), salience keys `touch-pet .3 / touch-pet-long .4 / touch-poke .25 / touch-poke-burst .4`, half-life 3 min, text without a time phrase, rendered as a `New:` bullet; pets merge within 5 s; pokes window 10 s (max 8 kept); `pet-start` yields no observation; never `markAddressed`; the reaction turn calls `markShown` first. (ultrabrain 1.)
- D3 Mood from touch = a decider signal: `expression-performance/touch-affect.ts` pure `touchAffect(memory, input, settings) -> { dose, memory }` with doses in `unit(band) = gain[band] x intensity[band]`: pet-start slight [v+1, a0, t-0.5]; pet-end >= 3 s escalates to clear along the same vector; pet-end < 3 s no dose; poke slight [0, +1, 0] (x0.6 body); 3rd poke in 10 s once per burst clear [0, +0.5, +1]; habituation `h = max(floor, base^n)` over 60 s; pet cooldown 4 s, poke cooldown 1 s. New `AffectSignal` kind `touch`, `PerformanceDecision.moods`, memory in `PickerState`; conductor forwards to `scene.addMood` -> `NaturalMood.addDose` (id-deduped, same clamps, skipped when `settings.mood` is false). Reaction-turn episodes get `moodGain: 0` (`conductor.markMoodless(turnId)`). The Natural poke surprise impulse and pet layer stay as they are. (ultrabrain 2.)
- D4 Reaction policy = `situation/reaction-policy.ts` pure `reactionPolicy(input, memory)` + `settleReaction`, own Mulberry32 checkpoint, constants PET_SPEAK_MIN_MS 3000, PET_QUIET_SINCE_LINE_MS 20000, PET_SPEAK_P 0.3, POKE_BURST_COUNT 3, POKE_BURST_WINDOW_MS 10000, POKE_PROTEST_P 0.8, REACTION_REFRACTORY_MS 45000, REACTION_RETRY_MS 20000, REACTION_PENDING_MAX_MS 30000; order: time/memory normalize -> bookkeeping -> candidate -> pacing (pending, refractory, retry-wait) -> hard suppressor subset (disabled, dont-disturb, stage-hidden, user-speaking, user-typing, character-speaking, generating, queued, quiet-app) -> roll. On `spoken`: `lastLineAtMs`, a `conversation` observation with origin `reaction`, and `recordExternalSpeech` on the urge memory (floor only, never unanswered). (ultrabrain 3 + architect.)
- D5 Reaction turn reuses `origin: 'unprompted'` through a sibling `chat.submitReaction({ kind, topicText, eventId })` (same single-pending guard, read-only tools, SILENT decline, decline record), `trigger: { topicKey: 'touch', text, kind: 'touch-pet' | 'touch-poke' }`, instruction keys `base.prompt.reaction` ("They just touched you on the stage; the last message says how. React in the moment, in character: one short line, a few words is plenty. If a look says it better, reply only with <|SILENT|>. Do not ask a question and do not narrate the touch.") / `base.prompt.reaction-protest` ("They keep poking you; the last message says how. Protest in one short playful line in character, or reply only with <|SILENT|>. Do not ask a question."), trigger text `base.prompt.reaction-trigger` = "(Just now, on the stage: they {touch})"; NO new ReasonCategory; history cue labels for the two trigger kinds. (ultrabrain 4.)
- D6 Wordless reply in the runtime: decline pattern built for every origin; on a user turn SILENT is consumed (never forwarded, never stored); at turn end `noVisible && silentSeen && actCount >= 1` = wordless, `actCount === 0` = silent; one assistant item persists with `content: ''`, `slices: []`, `wordless: { cues: { emotion?, gesture? }[] }`; provider projection renders it as its raw cue text; no TTS; history shows a bubble-less chip; `ChatTurnCueStats` gains `silent`, `wordless`; unprompted semantics unchanged. (ultrabrain 5 + architect; timed-out UI fork -> chip.)
- D7 Gestures: ACT JSON `gesture` = `"nod"|"shake"|"shrug"|"lean"|"glance"` or `{ kind, count }` (count 1-3 for nod/shake, default 2; others 1), JSON only, normalized in `payloads.ts`; a gesture-only ACT is valid and not inert. Natural: new `natural-motion/cue-gestures.ts` `NaturalCueGestures` with its own RandomStream, not gated by `heldEmotions`, in `compose` and `compensationHead`; shapes: nod head-Y dips A=0.22 (~6.6 deg) 0.45 s each decaying 0.8x; shake head-X 2 Hz A=0.25 with body-X 0.25x, 0.5 s per count; shrug 1.1 s body-Y +0.15, head-Z 0.06, head-Y +0.04, browY +0.3, mouthForm -0.15; lean 2.6 s body-Z 0.12 / body-X 0.08 / head-Z 0.05 toward the inward placement side; glance = `gaze.glance({x: s*0.35, y: 0.05}, 0.6, at)` eyes only. Channels head{nod,shake,shrug} body{lean,shrug} eyes{glance}; same kind while active ignored; one-slot queue (<= 1.5 s wait), newer conflicting replaces queued; emotion recipe clips refused while a cue head gesture is active. Transport: Stage ACT handler -> scene API -> `PendingAction { kind:'gesture' }`; conductor dispatches only when the driver is natural. Amplitudes are starting values tuned on screen. (ultrabrain 6.)
- D8 BREAK: `tokenBreak()` beside `delay.ts`; `<|BREAK|>` default 1.0 s, `<|BREAK n|>` clamped 0.3-3.0, non-numeric body stripped; signal `{ type:'break', seconds, explicit }`; runtime rule in visible speech: ignore before any text, max 2 accepted breaks (3 bubbles; extra counted `breaksIgnored`), adjacent breaks merge keeping the larger seconds, push slice `{ type:'break', seconds }` + `\n\n`, drop a trailing break; `cueStats.breaks/breaksIgnored`; one persisted assistant message per turn; UI renders one bubble per text slice and reveals later bubbles after the delay only while streaming; speech: BREAK is a hard TTS segment boundary (flush, play, wait, continue), handled in Stage like DELAY; same semantics in every register. (ultrabrain 7 + architect.)
- D9 Register: `packages/stage-shared/src/conversation-register/index.ts` (`CONVERSATION_REGISTERS = ['talking','texting']`, picklist schema, `parseConversationRegister` falls back to talking, `TEXTING_FLAVORS = ['plain','discord']`, `REGISTER_PROMPT_KEYS`, `ASCII_FACES`), stage-ui `features/conversation/settings.ts` (`{ register: optional(..., 'talking'), textingFlavor: optional(picklist(['plain','discord']), 'plain') }`, key `settings/conversation`, synced like Presence settings), a new settings page `stage-pages/src/pages/settings/conversation/index.vue` registered in both settings layouts. Prompt: the stage contract stays register-independent; a one-time register-neutral contract revision (emotion opens "Your reply is performed by an animated avatar."; emoji becomes "Do not use emojis."; response drops "You are talking, not writing."; the gesture line and the wordless sentence are added) bumps the hash once; the register text (`base.prompt.register-talking` / `register-texting` / `register-texting-discord`) is appended to the character prompt in `getSessionSystemPrompt` before the contract, rewritten when the setting changes. No card schema change. (ultrabrain 8-9 + Luke.)
- D10 ASCII faces: closed set `:3 ^^ ^_^ >_< >.< T_T ;_; :) :( :D ;) :P xD XD o_o O_O -_- ^w^ <3` (word-like uwu/owo excluded as pronounceable); `stripAsciiFaces` in pipelines-audio with start-or-whitespace prefix and end/whitespace/punctuation lookahead (`10:30`, `C:D`, `x^^y` untouched), applied to the TTS chunker's assembled segment, never to raw deltas, regardless of register; bubbles and captions keep the faces; an empty segment after stripping is skipped while its bubble shows. (ultrabrain 8.)
- D11 Test strategy: tests after, inside each todo, sized like neighbors; agent-executed QA always (timed-out fork -> Luke's choice on the last two plans).
- D12 Delivery: branch `luke/feat/nonverbal-channels`, atomic commits each passing `pnpm verify`, PR against `lschneiderny/airi` (root AGENTS.md: plan-sized work goes on a branch). Announced default.
- D13 Out of scope: the Discord bot integration (`integrations/`, `messaging-discord.vue`) is untouched; "Discord" in this plan is a texting flavor only.

## Gap analysis (plan-consultant st_01a1900e, 2026-10-31)
28 findings, all folded into the plan; none required an owner question. Amendments to the decisions above:
- D3/D8 amendment: `NaturalMood.addDose` + scene `addMood` move to todo 8 (same Natural facade as the gesture API); the moodless flag lives only in the conductor (todo 9).
- D8 amendment: the BREAK pause lives in the speech pipeline's ordered playback timeline (`pipelines-audio/src/speech-pipeline.ts`), not in Stage: `SpeechOutput.onSpecial` returns void and Stage fires `void playSpecialToken`, so Stage's DELAY handling never pauses playback (recorded as a follow-up, not changed here). Todo 13 never edits Stage.vue.
- D9 amendment: chat.ts owns the localized register text (`renderRegisterSection(register, flavor, t)` exported from stage-shared conversation-register) and hands it to `chatSession.setRegisterPrompt`; session-store keeps a ref defaulting to '' and omits an empty section, so existing session-store tests pass unchanged. qa-tools `buildSystemPrompt` gains `register`/`textingFlavor` and uses the same renderer (model-eval can elicit BREAK and faces).
- D5 amendment: `base.prompt.unprompted*` keys are reworded register-neutral in todo 5.
- D6 amendment: user-turn `<|SILENT|>` no longer reaches plugin hooks (U3 wording updated); wordless items are excluded from cloud sync like unprompted turns (cloud sync is inactive in this account-free fork; README:10, :425) and bursts sync as content; both documented in the ADR. (Round 1 reviewer B1 replaced the earlier "carry wordless on the wire" default: that needs server-sdk, outbox, transport, and server changes for a feature this fork does not use.)
- D7 amendment: the cue gesture union is `CueGestureKind` (the emotion `GestureKind.shake` is untouched); a composition bound test (|command| <= 1 with a strong emotion clip and the pet layer) backs the amplitudes; todo 20 (d) may halve them.
- Ordering: Wave 2 split into 2a (12), 2b (9, 10, 13, 14), 2c (11); touch bus contract in a new `stores/situation/touch-bus.ts`; qa-tools README owned by todo 18; the stream-end listener at `stores/situation/index.ts:394` routes touch turns to `settleReaction`.

## Scope IN
- IS-1..IS-11 above across packages/stage-shared (situation touch event, reaction policy, touch affect, conversation-register, contract revision), packages/pipelines-audio (gesture normalization, tokenBreak, stripAsciiFaces, chunker boundary), packages/core-agent (wordless/silent user turns, break slices, cueStats), packages/stage-ui-live2d (NaturalCueGestures, gesture pending action, scene API, NaturalMood.addDose), packages/stage-ui (Stage @touch wiring, touch store, conductor moods/moodless/gesture dispatch, submitReaction, situation store reaction tick, conversation settings, history bubbles + wordless chip, speech BREAK/face strip, devtools panels), packages/stage-pages (Conversation settings page, Situation inspector touch/reaction panel), packages/i18n/en (prompt keys, settings copy), packages/qa-tools (scorer v3, T1 gesture scenarios), docs (ADR, READMEs).

## Scope OUT (Must NOT have)
- No touch reason in the urge gate; no change to hard suppressor order, urgent bypass, forced-turn contract, holdTopic, double-text.
- No new origin value; no plugin-protocol changes; no card schema change; no new npm dependencies.
- No Discord bot integration changes. No Unicode emoji anywhere. No non-English locale edits.
- No changes to MAGIC/Universal drivers beyond ignoring the gesture field. No new mood model; touch uses the existing valence/arousal/tension dynamics.
- No contract text changes beyond the one register-neutral revision + gesture and wordless lines (one hash bump); no second contract hash per register.
- No edits to unrelated dirty-worktree files (.omo/plans/* other than this plan, .omo/drafts/* other than this draft, .agents/skills/*).
- No `any`, no suppressed diagnostics, no skipped tests, no fixed sleeps in tests.

## Open questions
- None blocking. The four interview forks timed out and were resolved to their recommended defaults (ledger above); Luke approved the brief without vetoing any.

## Approval gate
status: approved
approach: touch -> single-topic situation event + decider mood dose + pure reaction policy -> reaction turn via submitReaction (origin unprompted); wordless user replies in the runtime with a history chip; ACT gesture field rendered by a new NaturalCueGestures layer; register as a user setting with a register-neutral contract and a register section in the character prompt; BREAK as a runtime slice rendered as bubbles and a TTS boundary; ASCII faces stripped at the TTS segment. Branch + PR delivery, tests after.
approved-by: Luke, 2026-10-31, "write the plan" (after the brief; no default vetoed)
next-action: none. Review complete: round 1 st_01a1901a REJECT (B1-B3, all fixed), round 2 st_01a1901e OKAY at sha 82e0a1d9c1dd63ae9a6288b15e7aa42c576504f7ec2445d8dd08a6a4ae634763; final live-plan validation matched the approved digest.

## Review ledger
<!-- rounds: round_id | plan_sha256 | session | verdict | blockers (accepted) | notes -->
| r1-2026-10-31T03-56-25-288Z | dc552595bddf3840619718f2e973a07224511b876055a152c13957b4dda7a116 | st_01a1901a | changes_requested | B1 wordless-over-sync scope, B2 reveal-after-generation contradiction, B3 todo-7 green commit | plan-consultant st_01a1900e folded (28 findings) before this round |
| r2-2026-10-31T04-00-34-259Z | 82e0a1d9c1dd63ae9a6288b15e7aa42c576504f7ec2445d8dd08a6a4ae634763 | st_01a1901e | approved | ledger frozen after round 1: B1, B2, B3 (all fixed in this revision) | - |
