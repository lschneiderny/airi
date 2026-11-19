# Character mind widget turns: widget and plugin turns go through the voice policy

Date: 2026-11-19
Status: accepted. Slice CM3b of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-widget-turns`. It builds on the [character mind voice ADR](2026-11-19-character-mind-voice.md). The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D8 to D12 name the forks in the slice's plan, `.omo/plans/character-mind-voice.md`.

## Context

After CM3a the mind's voice policy decided every reach-out and spoken touch line, but a widget or plugin turn still took its own path (overlap 10 of [Autonomous behavior](../context/autonomous-behavior.md)):

- **Any window served it.** Every window that was not a widget window answered the spark notify bridge, though only the leader runs the mind.
- **It waited on its own timers.** The context bridge waited for a quiet moment with `untilQuietMoment`, `untilCharacterQuiet`, and the user input waiters, while the store held the notify topic from the gate with `holdTopic`.
- **It forced the turn.** `force` bypassed the gate and the model's veto, and a pending unprompted turn failed the request.
- **Its deadline was not enforced.** A turn that started late could speak after the widget had already shown its fallback.
- **`Stage.vue` cued the body.** Hooks in `Stage.vue` played the `about-to-speak` and `let-go` cues for every unprompted turn, apart from the mind's decision.

## Decision

### Requests

1. **Widget and plugin turns are `voice-request` stimuli.** `performSparkNotifyReaction` sends the request through `requestVoice` before the notify is ingested, so the mind holds its topic from the start.
2. **Only the leader serves** (D9). The spark role is `main` only in the window that leads, and user input listeners run only while a window leads.

### When she speaks

3. **The mind defers a request while she or the user is busy.** The busy rule is: `userSpeaking` not false, `userTyping`, `characterSpeaking`, `generating`, `queued > 0`, a pending unprompted turn, or an open line. A pending unprompted turn now defers a request instead of failing it.
4. **A waiting request goes before a reach-out.** The gate skips while a request waits, and the request's topic is held from the gate.
5. **The gate's hard holds and settings do not apply to widget turns** (D10). A widget is a feature the user turned on.
6. **Deadlines run on the mind's clock** (D12):
   - `startBy` is 20 s after the request. When it passes, the request is dropped.
   - `speakBy` is the caller's timeout less 1 s. When it passes, the turn is cancelled.
   - A wake timer from `nextVoiceWakeAt` and the `wakeAtMs` of `publishVoice` enforces both, so a deadline is met when it passes, not at the next tick. This fixes the defect where a line could be spoken after the widget had already shown its fallback.
7. **A dropped or cancelled request leaves its notify unaddressed,** so she may raise it later on her own.

### The turn

8. **The caller always gets a `ChatUnpromptedResult`.** The widget protocol is unchanged: the widget receives the spoken text, or its fallback (D11).
9. **The model keeps its veto.** `widget: true` replaces `force`, and the new instruction `base.prompt.unprompted-widget` offers `<|SILENT|>`. LLM prompt Target rule 6 has landed.
10. **The mind cues the body** (D8). `cue` intents replace the `Stage.vue` hooks.
11. **The boundary between the mind and chat is written** in `packages/stage-ui/AGENTS.md` (audit R11): the mind decides whether and when she speaks unasked, and chat runs the turn and reports its outcome.

### Overlaps

12. **Overlap 10 is closed. Overlap 3 is narrowed** to Natural's idle draw. **Overlap 12 stays open** as a question for the owner.

## Consequences

- A deferred request starts at the next tick, so it can come up to 2 s after she falls quiet.
- When a mind disconnects, every waiting caller gets `failed`.
- A newly promoted leader can miss an existing composer draft for up to about 5 s.
- In a scene-bound session that does not speak on the host, a reach-out now shows the `about-to-speak` look, which ends on its own after 10 s.
- The situation records a spoken widget line as her speaking up on her own about that topic, as before.

## Alternatives considered

- **Keep the `Stage.vue` hooks for the cues** (D8). The cue is part of the response to the decision, and it moves with widget turns, which the hooks also cued. Rejected.
- **Let any window that is not a widget window serve** (D9). The mind runs only in the leader, so a follower would have to forward the request anyway. Rejected.
- **Apply the gate's settings to widget turns** (D10): `unpromptedEnabled`, `dontDisturb`, `quietApps`, games, and presence. Presence and freshness holds would mute widgets for users who do not share the foreground window. Rejected.
- **Add the outcome status to the widget protocol** (D11). Upstream's bridge stays unchanged, and the internal path always has the outcome. Rejected.
- **Check the speak deadline only at the next tick** (D12). A line spoken late, after the widget gave up, is the defect this slice fixes. Rejected.

## Not decided

- One mind per character in the leader, and the idle draw moving into the mind, which closes overlap 3: CM4.
- The mind issues no `cue` intent to a driver that does not declare it: CM7.
- Overlap 12: whether a notice turn counts as the owner's own turn or as unasked speech is an open question for the owner. Notices stay outside the mind.
