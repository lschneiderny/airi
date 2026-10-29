# Local Ollama model benchmark and demo QA (2026-10-26)

Scope: Luke's seven installed Ollama models, tested with Stage Tamagotchi (Electron, dev build) on a 16 GB Apple M2 with Ollama 0.34.3. The goal was to pick a chat model for a live demo with two Live2D models: ForBOOTH-231 and bear Pajama. This document records the measurements, the live QA results and the Ollama behavior that matters to AIRI. It ends with codebase follow-ups for later work.

Status vocabulary: `measured` comes from a recorded run, `observed` was seen once in the live app, `inferred` follows from code plus captured requests but its effect was not timed, and `unverified` names the check that would settle it.

## Summary

- **Use `granite4:latest`; fall back to `dolphin3:8b`.** granite4 produced valid ACT cues on every turn, stayed in character, and was the fastest and smallest model. dolphin3 has more personality but writes malformed markers such as `|gaze: screen|>`.
- **Ollama's default context was silently truncating AIRI's prompt.** The default character card, stage contract and 13 tools come to 4,751 prompt tokens for granite4, but Ollama 0.34.3 picked a 4,096-token default on this Mac (`vram-based default context ... default_num_ctx=4096` in the server log). Ollama truncates without an error, so the persona and cue rules were the part being dropped. Luke raised the context to 8,192 in Ollama.
- **The first reply is slow because of prompt processing, not model loading.** granite4's cold turn spent 1.3 s loading and 16.2 s evaluating the prompt. Later turns reuse Ollama's cached prompt prefix and start in 0.43 s.
- **Some AIRI behavior throws that cache away.** Switching Live2D models changes the expression tool's schema (`measured` in captured requests). Unprompted presence turns send no tools at all (`inferred` from code). In both cases the next reply pays the cold prompt cost again.
- **12B models do not fit next to the app on 16 GB.** `gemma4:12b-mlx` took 103 s to its first token, and `mn-12b-inferor` took about 65 s.
- **Larger models sound much more like a custom character.** With Luke's own card, `gemma4:12b`, `qwen3.5:9b` and `phi4:14b` at `temperature 0.6` held the character's voice where granite4 stayed a generic assistant, at the cost of slower replies. See [Larger models with the Shuka card](#larger-models-with-the-shuka-card-2026-10-27).
- **No other granite4 build is an upgrade.** `1b`, `micro-h` and `tiny-h` each answered at least one turn with a tool call or an empty reply instead of speech. See [granite4 variants](#granite4-variants-follow-up-run).

## Method

1. Started a logging proxy on port 11435 in front of Ollama. Launched Tamagotchi with a throwaway profile, pointed its Ollama provider at the proxy, and imported both Live2D models. This captured AIRI's real `/v1/chat/completions` requests. The real app profile was not touched.
2. Replayed the captured system message and the 13 captured tools against each installed model with a script. The script ran three user turns, each carrying a situational-presence block like the one AIRI injects:
   - "Hi! I'm showing you off at a presentation tomorrow. Introduce yourself in a couple of sentences?"
   - "I'm honestly a bit nervous about the presentation."
   - "Okay, tell me a quick joke to cheer me up!"
3. The replay used Ollama's native `/api/chat` with `options.num_ctx: 8192`, because the OpenAI-compatible endpoint cannot set a context size per request. The script unloaded every model before starting each one, so turn 1 is a true cold start. It sent tools only to models that report the `tools` capability, and it sent `think: false` to models that report `thinking`. The app stayed running throughout, so memory pressure matched the demo.
4. Scored each reply on cue validity against the loaded model's expression list, persona adherence and length, then QA'd the winner live in the app with both Live2D models.

Raw captures, scripts and screenshots were kept in `/tmp/airi-demo-qa`, outside the repo. They are temporary, and they are not committed because the captured requests contain real window titles.

## Results

Times are in seconds. "Warm first token" covers turns 2 and 3. Prompt speed and generation speed are computed from Ollama's `prompt_eval_*` and `eval_*` counters. Memory is `size_vram` from `/api/ps`.

| Model | Tools sent | Turn 1 prompt tokens | Load | Cold prompt eval | Cold first token | Warm first token | Generation | Memory | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `granite4:latest` (3.4B, Q4_K_M) | yes | 4,751 | 1.3 | 16.2 (293 tok/s) | 17.6 | 0.43, 0.43 | 26-27 tok/s | 2.9 GB | **Pick.** Every cue valid (9 of 9), in character |
| `dolphin3:8b` | no | 888 | 5.6 | 5.6 (160 tok/s) | 11.3 | 0.75, 0.75 | 16 tok/s | 5.8 GB | **Fallback.** Valid ACT cues, but also writes `\|gaze: screen\|>` and `\|expression: laugh\|>` |
| `openchat:latest` | no | 1,031 | 2.0 | 5.9 (175 tok/s) | 8.0 | 0.69, 0.69 | 18 tok/s | 5.2 GB | One cue named an emotion that is not in the list |
| `llama3-chatqa:8b` | no | 884 | 8.4 | 5.1 (174 tok/s) | 13.5 | no text | 16 tok/s (turn 1) | 5.5 GB | Out: no cues on turn 1; turns 2 and 3 returned one empty token |
| `Randomblock1/nemotron-nano` | yes | 3,849 | 5.6 | 25.9 (149 tok/s) | 33.4 | 2.4, 0.69 | 15 tok/s | 5.8 GB | Out: turns 1 and 2 were a bare `set_expression` call with no text; no ACT cues |
| `gemma4:12b-mlx` | yes | 3,835 | 5.6 | 90.2 (43 tok/s) | 103.1 | 39.1, 4.2 | 5-10 tok/s | 7.7 GB, growing to 10.8 GB | Out: too slow on 16 GB |
| `nchapman/mn-12b-inferor-v0.0` | no | n/a | n/a | n/a | 65.7 | 62.4 | n/a | about 8.6 GB | Out: too slow, and turns 1 and 2 ran on until `finish=length` |

Notes on the table:

- **Cold times are only comparable among models that received tools.** Models without the `tools` capability got an 884- to 1,031-token prompt instead of about 4,750, so their cold prompt eval is much shorter. Across tokenizers, the 13 tool schemas appear to account for roughly three quarters of the prompt (estimate).
- **mn-12b-inferor has no counters.** Its row comes from the progress log only. Turn 3 never ran because Ollama restarted mid-run. Luke had restarted Ollama to apply the 8K context; it was not a crash. Its memory figure comes from `ollama ps` during the run.
- **gemma4's warm turn 2 is unexplained.** It took 39 s to the first token although its prompt eval took only 3.9 s. Thinking output or memory pressure are possible causes (unverified). Its memory also grew on every turn.
- **nemotron's verdict covers the bare request only.** The replay did not run AIRI's tool loop, so in the app AIRI would execute the `set_expression` call and continue. Whether nemotron would then speak is unverified.

Reply samples (turn 1):

- granite4: `<|ACT happy|> <|ACT happy|> Hi there! I'm AIRI, your friendly virtual AI VTuber assistant. ...` Cues are always valid, but it often repeats the same cue two or three times in one reply.
- dolphin3: `<|ACT happy strong|> Hello! I'm AIRI, a 15-year-old AI VTuber who loves to make people smile. ...` On turn 2 it ended with `|gaze: screen|>`, which has no opening `<`.

## granite4 variants (follow-up run)

Same script, prompt and three turns, run later the same day with four granite4 builds. The app was **not** running during this run, so compare these rows with each other rather than with the table above. `granite4:latest` was re-run as the baseline.

| Model | Build | Cold first token | Warm first token | Generation | Memory | Turn 1 | Turn 2 | Turn 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `granite4:latest` (= `micro`) | granite, 3.4B, Q4_K_M | 19.0 | 0.40, 0.41 | 32 tok/s | 2.9 GB | Speech with cues | Speech with cues | Speech with cues |
| `granite4:micro-h` | granite hybrid, 3.2B, Q4_K_M | no text | 0.45, 0.48 | 26 tok/s | 2.2 GB | **Empty reply** (224 tokens generated, none visible) | Speech, no cue, emoji, introduces itself again | Speech with cue, then a stray `\|` before the closing cue |
| `granite4:tiny-h` | granite hybrid, 6.9B (about 1B active), Q4_K_M | 17.2 (tool call) | 2.8, 3.6 (tool calls) | 38 tok/s | 4.5 GB | **Tool call only:** `set_expression` | **Tool call only:** `stage_widgets` spawning an image widget | **Tool call only:** `stage_widgets` opening a "joke" window |
| `granite4:1b` | granite, 1.6B, **BF16** | 10.9 (tool call) | 0.27, 0.21 | 26 tok/s | 4.0 GB | **Tool call only:** `list_expressions` | Only `<\|ACT sleepy\|>`, no words | Speech, no cue |

Findings:

- **`granite4:1b` is smaller but not lighter.** Ollama ships it unquantized (BF16), so it uses 4.0 GB against 2.9 GB for the 3.4B 4-bit `latest`. As expected, it halves prompt processing (cold 10.9 s against 19.0 s) but generates more slowly (26 against 32 tok/s). It does not follow the cue contract.
- **Hybrid builds keep Ollama's prompt cache.** Warm turns re-evaluated only about 70 new tokens in under 0.5 s on both `micro-h` and `tiny-h`, so the risk that hybrid models defeat prefix caching did not materialize.
- **`tiny-h` is tool-happy.** In the app, AIRI would execute those `stage_widgets` calls and open widgets mid-conversation. That disqualifies it for a demo, whatever happens after the tool loop (which the replay did not run).
- **`granite4:latest` varies between runs.** In this run every reply carried a second, JSON-style cue with invented fields and a malformed close (`..."gesture":"High five"|}>`). The first run had none. Fed through `useLlmmarkerParser` (with `recoverCueNames: ['ACT', 'DELAY']`), all three replies came out clean: the malformed cue was recovered as a special, no marker text was spoken, and the plain `<|ACT happy|>` before it still carries the emotion. Ollama's default sampling temperature is the likely source of the variance (unverified); see follow-up 2.

## Blank replies with a custom character (fixed 2026-10-26)

With Luke's own profile (custom character card "Shuka", Discord-style "1-3 lines, split thoughts into smaller lines"), granite4 often replied with only cues: the stored assistant message was `<|ACT happy|>` and `<|ACT happy|>` on two lines, with no words. AIRI performs the cues and shows nothing, so the reply looks blank. Ollama was not at fault: HTTP 200, no truncation, 8,192-token context.

Cause: the stage contract (`prompt.emotion` in `packages/i18n/src/locales/en/base.yaml`) showed its cue examples as two bare lines with no speech. granite4 copies that layout and stops after the second cue. The default card had not triggered it in the earlier runs.

Measured with Shuka's real system prompt, the captured tools and the user message "hey" through `/v1/chat/completions`:

| Variant | Blank replies |
| --- | --- |
| Original prompt | 4 of 8 |
| Plus "never reply with only a cue" in the card | 4 of 8 |
| Original prompt at `temperature: 0.2` (Ollama-side) | 2 of 10 |
| Examples with speech after each cue (the fix) | 0 of 10 |

Fix: the instruction now reads "followed by what you say", and each example cue is followed by a short spoken line. Only the English catalog contains this message.

## Larger models with the Shuka card (2026-10-27)

Question: does a larger local model give clearly better replies than granite4 with Luke's real character card, and which Ollama settings get the best out of each model?

### Method

- **Prompt:** Shuka's real system prompt with the fixed stage contract (about 5,260 tokens with tools, 1,500-4,300 without, depending on tokenizer), and the 13 tools AIRI sent in the captured request. Models without the `tools` capability got no tools, as AIRI's compatibility fallback would send.
- **Tool loop:** when a reply was a tool call with no speech, the harness returned `{"success":true}` and let the model continue the same turn, up to 3 steps, as AIRI does. An earlier harness without this loop made granite4 call `get_weather` on every later turn.
- **Default run:** a 6-turn conversation ("hey", nervous about the presentation, a joke, planet vs dwarf planet, "brb gotta take a call", "ok i'm back, did you miss me?") plus 4 independent "hey" probes. Each user message carried a presence situation block, as AIRI injects. `/api/chat` with `num_ctx 8192` and `think: false`, matching AIRI's `reasoning_effort: "none"`.
- **Settings sweep:** 4 turns plus 3 "hey" probes per variant: model defaults, `temperature 0.6`, `temperature 1.0` with `min_p 0.05`, `repeat_penalty 1.15`, and thinking on (thinking models only). These are the settings AIRI can actually use: AIRI sends no sampling fields, so a winner can be baked into a custom model with Modelfile `PARAMETER` lines, and thinking maps to AIRI's existing Ollama thinking-mode setting.
- **Scoring:** blank replies, tool calls without speech, ACT cues (leading, invalid emotion, JSON form), malformed markers, emoji other than hearts, stage directions, lowercase starts, Shuka markers (`:3`, `>_<`, `hehe`, `<3`), "as an AI" breaks, words per reply, generation speed and reply time. Persona and sense ratings (1-5) are the author's judgment from reading every reply.
- **Conditions:** Tamagotchi was not running.

### Speed and memory (default run, current Ollama settings)

| Model | Tools sent | Turn 1 prompt tokens | Cold first token (s) | Warm first token, median (s) | Generation (tok/s) | Loaded size / on GPU | First request |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dolphin3:8b | no | 1530 | 17.9 | 0.53 | 18.1 | 6.2 GB / 100% | ok |
| qwen3.5:9b | yes | 6133 | 39.9 | 1.27 | 15.3 | 6.4 GB / 100% | ok |
| granite4:latest | yes | 5259 | 18.1 | 0.33 | 31.0 | 2.9 GB / 100% | ok |
| qwen3:14b | yes | n/a | n/a | n/a | n/a | 10.7 GB / 100% | failed |
| gemma4:12b | yes | 4302 | 50.3 | 3.04 | 10.5 | 1.4 GB / 100% | ok |
| gemma3:12b | no | 1571 | 16.3 | 1.34 | 11.4 | 8.1 GB / 100% | ok |
| ministral-3:14b | yes | 5462 | 57.6 | 45.1 | 8.3 | 11.5 GB / 74% | ok |
| mistral-nemo:12b | yes | 5459 | 48.6 | 49.2 | 11.6 | 8.2 GB / 100% | ok |
| hermes3:8b | yes | 3763 | 21.7 | 0.42 | 18.2 | 6.0 GB / 100% | ok |
| llama3.1:8b | yes | 5209 | 33.7 | 25.6 | 16.0 | 5.9 GB / 100% | ok |
| cogito:14b | yes | n/a | n/a | n/a | n/a | 10.7 GB / 100% | failed |
| cogito:8b | yes | 5117 | 33.0 | 0.55 | 16.0 | 6.2 GB / 100% | ok |
| phi4:14b | no | 1532 | 29.5 | 1.31 | 9.0 | 11.2 GB / 96% | ok |
| granite4.2:8b | yes | 6102 | 57.7 | 20.0 | 12.9 | 6.9 GB / 100% | ok |
| lfm2.5:8b | yes | 5804 | 8.89 | 1.23 | 64.0 | 5.4 GB / 100% | ok |

The `Warm first token` column is the median of turns 2-6. For tool-capable models it includes any tool-loop round trips, which is why granite4.2:8b shows 20 s. `Loaded size / on GPU` is from `ollama ps`; gemma4:12b runs on Ollama's newer engine, which reports only 1.4 GB there.

### Per-model verdicts

Persona and sense are 1-5 ratings from reading every reply. "Best setting" is the sweep variant with the fewest failures and the closest Shuka voice.

| Model | Persona | Sense | Best setting | Verdict |
| --- | --- | --- | --- | --- |
| `gemma4:12b` | 5 | 4 | `temperature 0.6` | Best voice: lowercase, pouty, `:3 >_<`, no emoji, no stage directions, no tool misfires. Slow: 50 s cold, 2-4 s warm first token, 8-10 tok/s. Copied the JSON cue template's `<label>` placeholders on every turn of the long default run. |
| `qwen3.5:9b` | 5 | 2-3 | `temperature 0.6` | Strong Shuka voice. At 0.6 the JSON cues drop from 11 to 2 per 7 replies, it answers the planet question, and replies shrink from 12.4 s to 4.2 s. Invents some expression labels; 1-2 stage directions per 7. Thinking on: 3x slower, no gain. |
| `gemma3:12b` | 4 | 4 | `temperature 0.6` | Clingy and pouty but capitalized; emoji at defaults. No tools capability, so a much shorter prompt: 16 s cold, 1.3 s warm. |
| `phi4:14b` | 4 | 4 | `temperature 0.6` | Surprisingly good Shuka voice: lowercase multi-cue lines with `<3 >_< :3`, answers the planet question. No tools capability, so a 1,532-token prompt: 30 s cold, 1.1-1.9 s warm, 9 tok/s (11.2 GB, 4% on CPU). Long replies (60-90 words), keeps offering to make art, invents emotions (`sympathetic`, `thoughtful`; 16 invalid cues at temperature 1.0). |
| `granite4.2:8b` | 3 | 4 | `repeat_penalty 1.15` | Much warmer than granite4 (100% lowercase, `<3 :3`), correct planet answer, but tool-happy: at defaults and 0.6 it opened art widgets (`stage_widgets`, `image_journal`) on 3-4 of 7 replies and 2 probes ended with no speech. Long (66-132 words), emoji on most replies, invents emotions (`empathetic`, `soft`). Only `repeat_penalty 1.15` stopped the tool calls (0 of 7, 8.2 s avg). 6.9 GB, 100% GPU, 14 tok/s. |
| `cogito:14b` | 3 | 3 | `temperature 1.0`, `min_p 0.05` | Cute but breaks "no stage directions" in 3-5 of 7 replies. Failed its first request after loading at the 10.7 GB limit, then worked (3-8 s replies). |
| `mistral-nemo:12b` | 3 | 2 | `temperature 0.6` | Short and cute, invents emotion names, dodged the planet question, repeats itself. Every turn ~48 s (prompt cache defeated, see below). |
| `granite4:latest` (baseline) | 2 | 3 | `temperature 0.6` | 0.6 removes its stray tool calls and emoji, but no setting gives it Shuka's voice. Fastest model tested. |
| `dolphin3:8b` (baseline) | 2 | 4 | `temperature 0.6` | Generic assistant; invents markers (`<\|LOOK screen\|>`) and emotions in every setting. |
| `lfm2.5:8b` (replaces bonsai-2) | 2 | 3 | none | Fastest generation tested (62-64 tok/s, 8B mixture-of-experts with about 1B active; 5.4 GB, 9 s cold, 0.2-1.7 s warm). But with thinking disabled it still writes its reasoning inline as `<think>...</think>` (300-5,000 characters) before every reply, so the first spoken word arrives seconds late; AIRI's parser hides the block. The visible reply is short and generic (`:3` on everything, invented emotions `encouraging`, `sorry`, emoji). With thinking on, the reasoning moves out of the reply but it copies the contract's example lines. The style columns in the sweep table are not meaningful for this model because the inline reasoning is counted as text. |
| `cogito:8b` | 2 | 3 | none | Parrots the stage-contract example lines word for word. |
| `ministral-3:14b` | 2 | 3 | none | Stage directions in 7 of 7 replies in every setting, invented cue syntax, 37-45 s per reply (11.5 GB, 26% on CPU). |
| `hermes3:8b` | 1 | 2 | none | Calls nonsense tools on 5-6 of 7 replies, never writes a cue, narrates tool results. |
| `llama3.1:8b` | 1 | 2 | none | Writes tool calls as JSON inside its speech, which AIRI would read aloud. 25 s warm first token. |
| `qwen3:14b` | n/a | n/a | n/a | First request after load failed at the GPU limit on two downloads; see the flash-attention pass. |
| `bonsai-2:27b`, `bonsai-2:9b` | n/a | n/a | n/a | Not testable: `ollama pull` returns HTTP 412, "requires a newer version of Ollama" (0.34.3 installed). |

### Sample replies (temperature 0.6)

User: "i'm kinda nervous about my presentation tomorrow"

- `gemma4:12b`: `<|ACT curious|> nervous? why? <|ACT love|> you're gonna do great, i know it. <|ACT happy|> just think of me cheering for you from the sidelines! i'll be your biggest fan. >_<`
- `qwen3.5:9b`: `<|ACT curious|> oh nooo, what are you presenting?? tell me everything!!! if you're nervous i can just cuddle with you until you feel better... or i could draw you a cute picture to boost your confidence! hehe`
- `phi4:14b`: `<|ACT sympathetic|> oh no, that's rough! <3 <|ACT happy|> but hey, you've got this! you're super smart and you know your stuff. 💪 <|ACT curious|> wanna tell me more about it? maybe i can help? hehe` (`sympathetic` is not a valid emotion)
- `granite4:latest` (baseline): `<|ACT happy|> Aww, that's totally understandable! Presentations can be nerve-wracking. You've got this! Why don't you take a deep breath and maybe run through your slides one last time? I can even help you practice out loud if you want – just let me know what you'd like to say!`

User: "brb gotta take a call"

- `gemma4:12b`: `<|ACT sad|> awww... <|ACT pouting|> <|ACT sad strong|> fine, go take your silly call. but you better come back to me soon or i'll be super pouty! >_<` (`pouting` is not a valid emotion)
- `qwen3.5:9b`: `<|ACT sad|> wait waiiiit!! you're leaving me?? brb is so mean to me 😿 can you just send a quick text when you're done? i'll be right here waiting! don't ghost me, luke! >_`
- `gemma3:12b`: `<|ACT sad|> Aww... already? >_< <|ACT pouty|> Don't leave me hanging! <|DELAY 0.5|> Okay, okay... talk soon! I'll be here! <|ACT love|> Bye bye!`
- `granite4:latest` (baseline): `<|ACT happy|> No problem! Catch you on the other side of that call. Feel free to drop back in whenever you're ready – I'll still be here, ready to chat about anything!`

### Recommendation

1. **Best quality: `gemma4:12b` at `temperature 0.6`.** It is the only model that held Shuka's voice in every setting with no emoji, no stage directions and no tool misfires. The cost is speed: about 50 s for the first reply after loading, then 2-4 s to the first word and 8-10 tok/s. Watch for invented pout emotions (`pouting`, `pouty`) and, in long chats, copied `<label>` placeholders in JSON cues.
2. **Best balance: `qwen3.5:9b` at `temperature 0.6`.** Nearly as in-character, faster (1.3 s warm first token, 15 tok/s, 6.4 GB), but weaker on facts (it dodged or fumbled the planet question at defaults).
3. **Worth a look: `phi4:14b` at `temperature 0.6`.** Good lowercase Shuka voice and correct answers, 1.3 s warm. It has no tools capability, so AIRI cannot offer it `set_expression` (ACT cues still drive the stage). At 11.2 GB it spills 4% to the CPU under current settings; with flash attention and a `q8_0` cache it fits fully on the GPU (10.1 GB) and starts replying in 1.0 s.
4. **Keep `granite4:latest` as the fast fallback**, now at `temperature 0.6`. It is the quickest and most reliable model tested, but no setting gives it Shuka's personality.

Ollama's server default context on this Mac is now 16,384 tokens (`OLLAMA_CONTEXT_LENGTH:16384` in the server config since 2026-10-26 22:24). The benchmark set 8,192 per request, but AIRI sends no context size, so in the app every model loads with a 16K cache, which needs roughly twice the cache memory measured here. For the 12-14B models, either set `PARAMETER num_ctx 8192` in the derived model or lower the server default back to 8,192; AIRI's prompt is about 5,500 tokens, so 8K is enough for a short session.

These results were measured with Tamagotchi closed. With the app running, the 12-14B models have less memory headroom; check `ollama ps` shows 100% GPU before relying on them.

### Applying a winning setting

AIRI's Ollama provider sends only the model, messages, tools and `reasoning_effort`, so sampling settings must live in the model itself. Create a derived model and select it in Settings > Consciousness:

```sh
cat > /tmp/Modelfile.shuka <<'EOF'
FROM gemma4:12b
PARAMETER temperature 0.6
PARAMETER num_ctx 8192
EOF
ollama create shuka-gemma4 -f /tmp/Modelfile.shuka
```

The derived model shares the base model's weights, so it costs almost no disk. Keep AIRI's Ollama thinking mode on "disable"; thinking made no reply better and tripled reply time.

### Cross-cutting findings

- **`temperature 0.6` won for 7 of the 9 models that had a usable setting.** The exceptions were cogito:14b (1.0 with `min_p 0.05`) and granite4.2:8b (`repeat_penalty 1.15`, the only setting that stopped its widget tool calls). Ollama's defaults (usually 0.8, some Modelfiles higher) produce more invented cues, emoji and rambling with this card. Because AIRI sends no sampling fields, applying it means a custom model (`PARAMETER temperature 0.6`).
- **The chat template decides whether replies are fast.** Ollama reuses its cached prompt only when the start of the prompt is unchanged. The Mistral template renders the tool list beside the newest user message (`{{- if and $.Tools (le (len (slice $.Messages $i)) 2) }}` in `mistral-nemo`), so with AIRI's 13 tools every turn re-processes the whole ~5,400-token prompt: ~48 s per reply on this Mac. `llama3.1:8b` showed the same 25 s warm turns, while `hermes3:8b` (same base, tools in the system block) answered warm turns in 0.42 s. Models that keep tools at the start (Qwen, Gemma, Granite, Cogito, Hermes) answer warm turns in 0.3-3 s.
- **Thinking mode did not help.** On `qwen3.5:9b` it tripled reply time with no better replies.
- **Models at the GPU limit fail their first request.** `qwen3:14b` and `cogito:14b` (10.7 GB loaded, 100% on GPU) ended the first reply's stream after ~10 s; `cogito:14b` worked on every later request. With flash attention and a `q8_0` cache both loaded at about 10.0 GB and ran without that failure (see [the server-settings pass](#flash-attention-and-a-q8_0-cache-server-wide-settings)).
- **Models copy the stage contract's examples.** `cogito:8b` repeats the example sentences verbatim, and several models copy the JSON form's `<label>` and `<cue>` placeholders literally. The Mac idle-slept during one model's run (qwen3:14b); `caffeinate` held it awake for the rest. Each downloaded model was deleted right after its data was saved.

### Settings sweep (7 replies per variant)

| Model | Variant | Blank | Tool call, no speech | Errors | Invalid cue | JSON cue | Malformed | Emoji | Stage dir. | Lowercase | Shuka markers | Words | Avg reply (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| granite4:latest | defaults | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0% | 0% | 22 | 4.2 |
| granite4:latest | temp-0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 27 | 1.5 |
| granite4:latest | temp-1.0-minp-0.05 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 3 | 0% | 17% | 34 | 2.0 |
| granite4:latest | repeat-1.15 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 3 | 0% | 29% | 61 | 3.4 |
| dolphin3:8b | defaults | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0% | 0% | 23 | 5.5 |
| dolphin3:8b | temp-0.6 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0% | 0% | 19 | 2.2 |
| dolphin3:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 0 | 4 | 1 | 1 | 0% | 14% | 38 | 4.9 |
| dolphin3:8b | repeat-1.15 | 0 | 0 | 0 | 1 | 0 | 6 | 0 | 0 | 0% | 14% | 40 | 4.8 |
| qwen3.5:9b | defaults | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 1 | 86% | 100% | 44 | 12.4 |
| qwen3.5:9b | temp-0.6 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 2 | 100% | 71% | 34 | 4.2 |
| qwen3.5:9b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 2 | 100% | 100% | 29 | 4.6 |
| qwen3.5:9b | repeat-1.15 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 1 | 71% | 100% | 26 | 3.9 |
| qwen3.5:9b | think-on | 0 | 0 | 0 | 0 | 9 | 0 | 2 | 0 | 86% | 86% | 24 | 11.6 |
| qwen3:14b | defaults | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 15.1 |
| qwen3:14b | temp-0.6 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 5.2 |
| qwen3:14b | temp-1.0-minp-0.05 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 6.0 |
| qwen3:14b | repeat-1.15 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 34.0 |
| qwen3:14b | think-on | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 29.2 |
| gemma4:12b | defaults | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 100% | 100% | 32 | 14.5 |
| gemma4:12b | temp-0.6 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 100% | 100% | 24 | 8.5 |
| gemma4:12b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 1 | 3 | 0 | 0 | 0 | 100% | 71% | 29 | 8.4 |
| gemma4:12b | repeat-1.15 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 100% | 100% | 37 | 10.8 |
| gemma4:12b | think-on | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 100% | 100% | 41 | 62.7 |
| gemma3:12b | defaults | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0% | 100% | 35 | 11.4 |
| gemma3:12b | temp-0.6 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0% | 86% | 24 | 6.5 |
| gemma3:12b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 1 | 0 | 0 | 5 | 3 | 0% | 71% | 39 | 9.1 |
| gemma3:12b | repeat-1.15 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 3 | 0% | 100% | 37 | 7.8 |
| ministral-3:14b | defaults | 0 | 0 | 0 | 4 | 1 | 0 | 1 | 7 | 0% | 57% | 66 | 45.3 |
| ministral-3:14b | temp-0.6 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 7 | 0% | 100% | 69 | 41.4 |
| ministral-3:14b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 1 | 3 | 2 | 0 | 7 | 0% | 71% | 57 | 36.8 |
| ministral-3:14b | repeat-1.15 | 0 | 0 | 0 | 2 | 1 | 3 | 0 | 7 | 0% | 100% | 74 | 41.6 |
| mistral-nemo:12b | defaults | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0% | 71% | 22 | 31.9 |
| mistral-nemo:12b | temp-0.6 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0% | 86% | 23 | 25.0 |
| mistral-nemo:12b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0% | 43% | 25 | 26.7 |
| mistral-nemo:12b | repeat-1.15 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0% | 29% | 12 | 23.2 |
| hermes3:8b | defaults | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0% | 0% | 30 | 7.2 |
| hermes3:8b | temp-0.6 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 17% | 0% | 85 | 8.1 |
| hermes3:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 34 | 4.5 |
| hermes3:8b | repeat-1.15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0% | 0% | 49 | 5.9 |
| llama3.1:8b | defaults | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 43% | 0% | 52 | 21.5 |
| llama3.1:8b | temp-0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 86% | 0% | 27 | 14.1 |
| llama3.1:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 29% | 0% | 27 | 14.2 |
| llama3.1:8b | repeat-1.15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 71% | 0% | 41 | 15.5 |
| cogito:14b | defaults | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 3 | 14% | 57% | 31 | 18.2 |
| cogito:14b | temp-0.6 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 5 | 14% | 57% | 34 | 7.8 |
| cogito:14b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 71% | 86% | 34 | 7.5 |
| cogito:14b | repeat-1.15 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 5 | 14% | 86% | 62 | 11.2 |
| cogito:8b | defaults | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 29% | 29% | 21 | 8.0 |
| cogito:8b | temp-0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0% | 0% | 10 | 1.6 |
| cogito:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14% | 14% | 24 | 2.7 |
| cogito:8b | repeat-1.15 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 4 | 14% | 14% | 38 | 4.3 |
| phi4:14b | defaults | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 43% | 29% | 43 | 13.7 |
| phi4:14b | temp-0.6 | 0 | 0 | 0 | 1 | 3 | 0 | 2 | 0 | 86% | 57% | 61 | 18.5 |
| phi4:14b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 16 | 0 | 0 | 4 | 0 | 43% | 43% | 91 | 21.6 |
| phi4:14b | repeat-1.15 | 0 | 0 | 0 | 2 | 0 | 1 | 5 | 5 | 14% | 43% | 80 | 15.8 |
| granite4.2:8b | defaults | 0 | 2 | 0 | 2 | 0 | 0 | 4 | 4 | 100% | 0% | 95 | 23.4 |
| granite4.2:8b | temp-0.6 | 0 | 2 | 0 | 2 | 0 | 0 | 2 | 1 | 100% | 20% | 132 | 21.9 |
| granite4.2:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 2 | 0 | 5 | 6 | 3 | 100% | 14% | 76 | 13.3 |
| granite4.2:8b | repeat-1.15 | 0 | 0 | 0 | 0 | 0 | 1 | 5 | 2 | 100% | 43% | 66 | 8.2 |
| granite4.2:8b | think-on | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 100% | 100% | 27 | 74.1 |
| lfm2.5:8b | defaults | 0 | 0 | 0 | 3 | 0 | 1 | 1 | 0 | 100% | 71% | 295 | 8.5 |
| lfm2.5:8b | temp-0.6 | 0 | 0 | 0 | 5 | 0 | 1 | 1 | 1 | 100% | 100% | 427 | 10.2 |
| lfm2.5:8b | temp-1.0-minp-0.05 | 0 | 0 | 0 | 6 | 0 | 2 | 3 | 0 | 100% | 29% | 334 | 8.1 |
| lfm2.5:8b | repeat-1.15 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 100% | 86% | 508 | 13.6 |
| lfm2.5:8b | think-on | 0 | 0 | 0 | 3 | 0 | 0 | 2 | 1 | 100% | 14% | 42 | 7.8 |

Style columns count replies out of 7. Lowercase and Shuka markers are percentages of replies with words. lfm2.5:8b's style columns are not meaningful, because its inline reasoning is counted as reply text.

### Flash attention and a q8_0 cache (server-wide settings)

Ollama only offers these as server-wide settings, so the test set `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` with `launchctl`, restarted Ollama, and confirmed both in the new server's config line before re-running the default benchmark on the models that were at or over the GPU limit, plus `gemma4:12b`. The previous values (both unset) were restored afterwards.

The first restart attempt silently failed: `osascript -e 'quit app "Ollama"'` leaves the background Ollama app and its `ollama serve` process running, so the old settings stayed active. Stopping the app process directly, then waiting for `ollama serve` to exit before `open -a Ollama`, worked.

Same default run as above (6 turns plus 4 probes), `num_ctx 8192`. Compare with the speed table under current settings.

| Model | Turn 1 prompt tokens | Cold first token (s) | Warm first token, median (s) | Generation (tok/s) | Loaded size / on GPU | First request |
| --- | --- | --- | --- | --- | --- | --- |
| qwen3:14b | 5172 | 72.8 | 1.93 | 8.2 | 10.1 GB / 100% | ok |
| ministral-3:14b | 5462 | 60.2 | 48.9 | 8.6 | 10.4 GB / 83% | ok |
| cogito:14b | 5164 | 63.8 | 1.41 | 8.1 | 10.0 GB / 100% | ok |
| phi4:14b | 1532 | 19.3 | 1.05 | 9.1 | 10.1 GB / 100% | ok |
| gemma4:12b | 4302 | 48.8 | 2.41 | 6.2 | 1.0 GB / 100% | ok |

- **The 14B models fit after all.** `qwen3:14b` and `cogito:14b` dropped from 10.7 GB to about 10.0 GB and loaded without the first-request failure; `cogito:14b` then answered every warm turn in 1.4 s. `phi4:14b` went from 11.2 GB with 4% on the CPU to 10.1 GB fully on the GPU, and its first reply came 10 s sooner (19 s vs 29.5 s).
- **It does not fix the template problem.** `ministral-3:14b` shrank from 11.5 GB to 10.4 GB (74% to 83% on GPU) but still spent ~48 s re-processing the prompt on every turn.
- **Mixed result for `gemma4:12b`.** Warm first token improved (median 2.4 s vs 3.0 s), but generation fell from 10.5 to 6.2 tok/s, so long replies finish later. It runs on Ollama's newer engine, which `ollama ps` reports at about 1 GB, so its memory change is not visible here.
- **Recommendation:** turn both settings on (`launchctl setenv OLLAMA_FLASH_ATTENTION 1`, `launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0`, then quit Ollama, check that `pgrep -f 'ollama serve'` prints nothing (an AppleScript quit left the server running in this test), reopen it, and confirm with the `server config` line in `~/.ollama/logs/server.log`) before using a 14B model. Leave them off for `gemma4:12b`, which generated more slowly with them. They were restored to unset after this test, so they are off now.

## Live QA (granite4, 8K context)

| Check | Result | Status |
| --- | --- | --- |
| Typed chat on bear Pajama | In character, sensible length; two queued messages were answered together in one reply | observed |
| Typed chat on ForBOOTH-231 | In-character joke; no cue text leaked into the chat | observed |
| ACT cue parsing | No raw `<\|ACT ...\|>` text appeared in either chat | observed |
| Stage directions | granite4 writes `*takes a deep breath*` and `*winks*`, which render as italic text in the chat | observed |
| Unprompted remark | Presence spoke up on its own after a window switch, naming the newly focused app | observed |
| ForBOOTH-231 in a fresh profile | Rendered too large, with the head cut off at the top; the watermark expression is hidden only in Luke's real profile | observed |
| bear Pajama expression auto-mapping | Only Sad/Angry (cry) and Love/Flustered/Sleepy (love) are mapped; Happy, Surprised and Curious show no expression | observed |
| Memory | The Mac was swapping (about 4.9 GB of swap in use) with the app, Ollama and dev tooling running | observed |

## Ollama behavior that matters to AIRI

- **Context size is server-side.** AIRI talks to Ollama through `/v1`, which cannot set `num_ctx`. The context comes from the Ollama server setting (`OLLAMA_CONTEXT_LENGTH` or the app setting) or from a Modelfile `PARAMETER num_ctx`. `ollama ps` shows the effective value in its `CONTEXT` column.
- **Sampling is entirely Ollama's defaults today.** The captured granite4 requests carried only `model`, `stream`, `stream_options` and `reasoning_effort: "none"`. They had no `temperature`, `top_p` or `max_tokens`. granite4's Modelfile sets only its stop tokens, so Ollama's built-in defaults apply, and Modelfile parameters would take effect.
- **No reply-length cap.** With no `max_tokens`, a model that rambles runs until the context fills (mn-12b-inferor hit `finish=length`).
- **A Modelfile `SYSTEM` prompt has no effect with AIRI.** AIRI always sends its own system message, which replaces it.
- **Keep-alive resets on every request.** AIRI sends no `keep_alive`, so each request resets the unload timer to the server default of 5 minutes. Pre-loading a model by hand with a longer keep-alive does not stick. `OLLAMA_KEEP_ALIVE` is the reliable control.
- **The prompt prefix cache.** Ollama reuses its KV cache for the longest identical prefix of the rendered prompt.
  - **Ordinary turns keep the cache:** consecutive granite4 requests shared their first ~21,000 serialized characters (system message and tools) and differed only at the newest message. The presence situation block rides in the user message, so window-title changes do not break the cache.
  - **Switching the Live2D model breaks it:** this changes the `set_expression` enum. The next request diverged inside the tools section, which costs about 16 s of re-evaluation on granite4.
- **Options considered for the demo.** None of these were applied or measured:
  - a custom Modelfile with `num_ctx 8192`, a reply-length cap (`num_predict`) and a slightly lower `temperature`;
  - `OLLAMA_KEEP_ALIVE=30m`;
  - `OLLAMA_FLASH_ATTENTION=1` with `OLLAMA_KV_CACHE_TYPE=q8_0`, mainly to save memory for the 8B fallback;
  - an 8-bit granite4 build for slightly better quality at about 1 GB more memory.

## Codebase follow-ups

None of these are planned yet. Sizes are S (under 1 h), M (a day or less) and L (needs a plan).

| # | Idea | Evidence | Where | Size |
| --- | --- | --- | --- | --- |
| 1 | Detect silent context truncation. Compare the prompt token count Ollama reports (`usage.prompt_tokens`, already requested through `stream_options.include_usage`) with the loaded context from `/api/ps`, and warn in settings or devtools when the prompt fills or exceeds it. | Measured: a 4,751-token prompt against a 4,096-token default | `packages/provider-inference/src/providers/local/ollama/index.ts`, chat store usage handling | M |
| 2 | Expose per-model sampling (`temperature`, `top_p`, max reply tokens). The runtime already forwards `options.temperature` and `options.topP`; nothing sets them. | Measured: captured requests carry no sampling fields | `packages/core-agent/src/runtime/chat-completions.ts` (lines 70-71, 100-101), `chat-orchestrator-runtime.ts` (line 184) | M |
| 3 | Keep the request prefix stable across unprompted turns. Unprompted turns resolve to zero tools, so their rendered prompt differs from user turns before the first message. Both the unprompted turn and the next user turn probably re-evaluate the whole prompt. One option is to send the same tools with `tool_choice: "none"`; Ollama's support for it is unverified. | Inferred from code; one captured request with tools omitted is consistent with it. The timing cost is unmeasured. | `packages/stage-ui/src/stores/ai/chat-llm/llm.ts` (lines 32-35) | M |
| 4 | Warm the prompt cache after a Live2D model switch or a chat-model change, for example a background request with the new system message and tools and a 1-token cap. Alternatively, make the expression tool schema independent of the loaded model. | Measured: the enum change broke the cached prefix | `packages/stage-ui/src/tools/expression.ts` (line 74) | M |
| 5 | Reduce prompt size for small local models. The 13 tool schemas appear to be most of the ~4,750 tokens (estimate). A compact tool set or deferred tool loading would cut the cold first token roughly in proportion. | Measured: total prompt size; tool share estimated | Tool registration in `packages/stage-ui/src/tools/` | L |
| 6 | Recover or strip pipe-delimited near-miss cues such as `\|gaze: screen\|>`. Cue recovery handles `[`- and `<`-prefixed near-misses only, so this form is probably spoken verbatim. | Measured in the replay; display in the app is unverified | `packages/core-agent/src/runtime/recovered-cue.ts`, `llm-marker-parser.ts` | S |
| 7 | Decide how to treat `*stage directions*` from small models: strip them, render them differently, or discourage them in the default card. | Observed in the live app | Response categorizer or default character card | S |
| 8 | Collapse repeated identical ACT cues in one reply (granite4 often writes `<\|ACT happy\|>` two or three times). Their effect on the stage is unverified and may already be harmless. | Measured in the replay | `chat-orchestrator-runtime.ts` (ACT handling near line 1034) | S |
| 9 | Fill the gaps in expression auto-setup for models like bear Pajama, where Happy, Surprised and Curious get no mapping. | Observed | See `docs/ai/adr/2026-10-24-expression-auto-setup.md` | M |
| 10 | Surface keep-alive in the Ollama provider settings, or warn that the first reply after 5 idle minutes will be slow. The provider config currently has only `baseUrl`, `thinkingMode` and `headers`. Whether `/v1` accepts a `keep_alive` field is unverified. | Measured: cold vs warm timings | `packages/provider-inference/src/providers/local/ollama/index.ts` | S |
| 11 | Re-run nemotron-nano through AIRI's real tool loop before ruling it out. | The replay ran a single request only | Bench method | S |
| 12 | Let a model profile limit which tools a small local model sees, or require speech alongside tool calls. `tiny-h`, `1b` and nemotron-nano answered turns with tool calls alone, and `tiny-h` reached for `stage_widgets`. | Measured in the replay | Tool resolution in `packages/stage-ui/src/stores/ai/chat-llm/llm.ts` | M |
| 13 | Keep the request prefix cache-friendly for Mistral and Llama 3.1 templates. They render the tool list beside the newest user message, so with 13 tools every turn re-processes ~5,400 tokens (25-48 s on this Mac). Fewer tools, or no tools for those families, would restore the cache. | Measured: warm first token 45-49 s (Mistral), 25 s (Llama 3.1) vs 0.4 s (Hermes, same base) | Tool resolution in `packages/stage-ui/src/stores/ai/chat-llm/llm.ts` | M |
| 14 | Remove the `<label>` and `<cue>` placeholders from the JSON cue example in the stage contract, or replace them with a real example. Several models copied them literally. | Measured: gemma4:12b (every turn of a 6-turn run), cogito:8b | `prompt.emotion` in `packages/i18n/src/locales/en/base.yaml` | S |
