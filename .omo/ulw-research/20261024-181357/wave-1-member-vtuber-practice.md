# A5 vtuber-practice (lane st_01a16f3e, journaled 2026-10-24T22:22:31.237Z)

st_01a16f3e [completed] transcript via event-log:
assistant: I read this as a read-only research assignment for axis A5 (Live2D, VTuber and desktop-mascot idle practice). I'll stop when I've fetched primary sources for the leads and written the EXPAND, CLAIMS and OBSERVATIONS sections.
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: web_search
tool: web_search
tool: web_search
assistant: Rich leads. Fetch the highest-value ones: Ikimotion idle tutorial, shiroikarasu guide, Live2DViewerEX config (EyeBlink, MouseTracking SmoothTime), arxiv paper, fanbo idle notes.
tool: eval
tool: eval
tool: eval
tool: eval
assistant: Ask: axis A5 research on Live2D, VTuber and desktop-mascot idle and reactive motion. Wanted: sourced findings plus the EXPAND, CLAIMS and OBSERVATIONS sections.
For you: I covered the three leads and several extra sources. Direct user opinion is thin. Steam reviews returned a bot page, Reddit gave 403 or noise, and a Desktop Mate source was never reached. The recommendations below that rest on mascot engines are mechanism-based, not review-based.
Now: none. Next: the lead agent merges this report.

## Findings

**1. VTube Studio value-provider priority** (wiki page "Interaction between Animations, Tracking, Physics, etc.")
- Priority runs P0 default, P1 idle animation, P2 face tracking, P3 one-time animation, P4 expression, P5 physics. The highest active provider wins per parameter.
- Handover between providers is "always faded smoothly". Expression Add/Multiply is applied last: all multiplies first, then all adds.
- Design takeaway: idle is the lowest layer. Reactions are higher layers that fade in and out per parameter, not a state switch. Physics stays on top so hair and cloth keep moving during reactions.
- VTS model settings say "More smoothing will make the movements less shaky but will introduce lag". Smoothing trades jitter for latency.
- The VTS animation settings include ending an animation after X seconds and holding on the last frame.

**2. Rigger loop practice**
- makotok1 (note.com, 2021): make start and end parameter values identical. Copy all keyframes and paste them before and after the motion, so the loop seam has no hitch. Keep the head and body keyframes offset by 2 frames so the head follows the body. Do not key physics-driven parameters.
- Ikimotion tutorial:
  - Use a 4 s loop at 30 fps (120 frames), with the head angle swinging ±5 against a 30-degree range and the body at about ±2.
  - Put keys at 0, 60 and 120, with eased handles at the turning points.
  - Blink every 4 s by default.
  - Set the breath cycle to a divisor of the loop length (4 or 2 s) instead of the default 3.2345 s.
  - The runtime preview plays a random Idle motion whenever nothing else is playing.
- shiroikarasu.net (2026): physics only moves hanging parts, so add slow sway to the body and head angle parameters yourself. Too much amplitude reads as restless. Scale amplitude to personality, small for calm and larger for energetic.
- gamedev.stackexchange: to hide loop repetition, give each element a different period and make the total loop the least common multiple. In a single short loop, offset cycles beat one big motion.
- Live2DViewerEX (Chinese-language fanbo.space guide): separate a "silent" layer (breathing, runs continuously) from an "idle" layer (blinks, small head or body turns, played at intervals). It suggests several Idle motions such as a gentle head turn and a stretch.
- Live2DViewerEX config exposes MouseTracking `SmoothTime` and EyeBlink `MinInterval`/`MaxInterval`. It can disable mouse tracking while a motion plays; the Steam thread quotes the command `mouse_tracking disable`.

**3. Shimeji-ee** (gil/shimeji-ee `conf/behaviors.xml`, `CalmBehavior.xml`, `actions.xml`)
- Behaviors are a weighted random graph. Each behavior has a `NextBehavior` list with frequencies. `Frequency="0"` means it is only reachable via a transition.
- `SitAndFaceMouse` transitions to itself at 100, `SitAndSpinHead` at 1 and `SitWhileDanglingLegs` at 1. That is about 98% repeat and 1% each for the rare moves.
- Behaviors are gated by environment `Condition`s: on the floor, on a wall, on the ceiling, on a window top. Floor behaviors are `StandUp` 200 and `SitDown` 100 in Calm (200 in the default).
- Poses are held for a long time. `Sit` is one pose with Duration 250 ticks. `SitAndDangleLegs` alternates poses of 5 and 15 ticks. The head-spin action is 8 poses of 5 ticks each.
- `SitAndLookAtMouse` picks a pose by cursor half-screen position (cursor y below or above half the screen height).
- Variants ship as different tempo profiles: Calm, Mischievous and Professional behavior files.
- Design takeaway: the long dwell is mostly stillness, with rare one-off flourishes. That is the opposite of frequent back-and-forth motion.

**4. VPet-Simulator** (`MainLogic.cs`, `EventTimer_Elapsed`)
- When idle, it draws `Rnd.Next(rnddisplay)` where `rnddisplay = Math.Max(20, InteractionCycle - CountNomal)`. While working it is `2*rnddisplay + 20`.
- Outcomes are 0–2 move, 3–5 idle, 6 an idle state variant, 7 sleep and 8–10 a random plugin interaction. The rest of the range does nothing.
- So at the floor of 20, about 55% of ticks do nothing and about 15% each move or idle. Working state makes actions rarer. `CountNomal` is a counter that lowers the cap over time.
- `IsIdel` is true only for Default or Work state and not while pressed. Random actions never interrupt other states.
- Needs (health, mood and so on) drain by `TimePass` and neglect scales with minutes since last interaction. The animation set is 32 types × 4 states × 3 stages (README says "32 * 4 * 3"; some combinations don't exist).

**5. Ukagaka** (zichqec.com `Idle_between_dialogues`)
- A YAYA script checks `OnSecondChange`. Every 15 s since the last dialogue, with the balloon closed, `RAND(4)==0` triggers a surface pose change from a pool. The author says "more organic" than changing every time.
- Design takeaway: a fixed check cadence with a probability gate, a quiet period after speech, and a pose pool.

**6. Idle believability research** (arxiv 2509.05023)
- Real-versus-acted idle animation user study. The prior engines it cites (PCA-based, blending) use small posture variation and weight shifts. Findings beyond that were not read.

## EXPAND
- LEAD: arxiv 2509.05023 full text (what separates real from acted idle) - WHY: only quantitative believability evidence found - ANGLE: extract features such as weight-shift frequency and gaze dwell.
- LEAD: Desktop Mate (Steam) - WHY: closest commercial analog and never reached - ANGLE: Steam review text via a fetch route that isn't bot-blocked, plus Chinese and Japanese community write-ups.
- LEAD: VPet DeepWiki animation system (deepwiki.com/LorisYounger/VPet/2.2-animation-system) and `IGraph.cs` - WHY: start, loop and end animation segments and state-variant selection - ANGLE: how A/B/C stages chain.
- LEAD: Shimeji-ee Mascot.xsd and the wiki for `Frequency` semantics and tick length - WHY: to convert durations to seconds - ANGLE: confirm the 40 ms tick.
- LEAD: Ukadoc SSP events (`OnMouseMove`, `OnSecondChange`, idle surfaces) - WHY: reaction taxonomy - ANGLE: the event list.
- LEAD: peyman-mass blog "Creating Non-Repetitive Randomized Idle Using Animation Blending" and r/vtubertech threads - WHY: practitioner randomization technique - ANGLE: blend-weight randomization.
- DEAD END: Steam appreviews API (returns a bot HTML page), reddit.com `.json` (403), PullPush semantic search (noise), DDG and Exa web search (bot challenge or 429 mid-run). GitHub raw paths for VTS wiki (404; the HTML page works).

## CLAIMS
- CLAIM: VTS layers idle under tracking and one-time animation, with physics on top and smooth fades between providers - RISK: normal - SOURCES: github.com/DenchiSoft - COUNTER: the wiki may be outdated against current VTS - PRIMARY: VTS wiki page.
- CLAIM: Shimeji-ee idle is a weighted graph whose dwell is overwhelmingly self-repeating with rare flourishes (e.g. 100:1:1) - RISK: normal - SOURCES: raw.githubusercontent.com (gil fork) - COUNTER: the fork may differ from upstream defaults, and the 98% figure is my arithmetic, not stated in the file - PRIMARY: `conf/CalmBehavior.xml`.
- CLAIM: VPet gates random actions behind an idle-state check and rolls a die so most ticks do nothing - RISK: normal - SOURCES: raw.githubusercontent.com (LorisYounger/VPet) - COUNTER: tick interval and `InteractionCycle` default were not read, so absolute rates are unknown - PRIMARY: `MainLogic.cs`.
- CLAIM: natural idle comes from small amplitudes (about ±5° head, ±2° body), offset body-versus-head phase and different periods per element, not large or fast motion - RISK: high - SOURCES: ikimotion.com, note.com, shiroikarasu.net, gamedev.stackexchange.com - COUNTER: these are tutorials and opinion, with no controlled comparison; the LCM trick is a general animation heuristic - PRIMARY: none found.
- CLAIM: short randomized, probability-gated pose changes after a quiet period feel organic - RISK: normal - SOURCES: ukagaka.zichqec.com - COUNTER: single author's judgment - PRIMARY: that script.
- CLAIM: what makes a corner companion feel alive versus annoying is supported by user data - RISK: high - SOURCES: none obtained - COUNTER: only vendor marketing pages (desksprite.com, which calls Desktop Goose "deliberately annoying") were read - PRIMARY: none.

## OBSERVATIONS
- OBS: https://github.com/DenchiSoft/VTubeStudio/wiki/Interaction-between-Animations,-Tracking,-Physics,-etc. - "always faded smoothly and not just set instantly to prevent any ugly jumps" - observed_at 2026-10-24
- OBS: https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings - "More smoothing will make the movements less shaky but will introduce lag" - observed_at 2026-10-24
- OBS: https://raw.githubusercontent.com/gil/shimeji-ee/master/conf/CalmBehavior.xml - `SitAndFaceMouse` 100 / `SitAndSpinHead` 1 / `SitWhileDanglingLegs` 1 - observed_at 2026-10-24
- OBS: https://raw.githubusercontent.com/gil/shimeji-ee/master/conf/actions.xml - `Sit` Duration 250; `SitAndSpinHeadAction` 8 poses × 5 - observed_at 2026-10-24
- OBS: https://raw.githubusercontent.com/LorisYounger/VPet/main/VPet-Simulator.Core/Display/MainLogic.cs - `Math.Max(20, InteractionCycle - CountNomal)`; Work: `2 * rnddisplay + 20` - observed_at 2026-10-24
- OBS: https://ukagaka.zichqec.com/function/Idle_between_dialogues.txt - "every 15 seconds"; `if RAND(4) == 0; OnSurfaceRestore` - observed_at 2026-10-24
- OBS: https://ikimotion.com/docs/tutorials/idle-animation/ - "five degrees out of the head's thirty is enough to look alive" - observed_at 2026-10-24
- OBS: https://ikimotion.com/docs/tutorials/idle-animation/ - blink Interval default 4 s; breath Cycle default 3.2345 s, set to divide the scene length - observed_at 2026-10-24
- OBS: https://note.com/makotok1/n/nad6a9605bac8?hl=en - paste all keyframes before and after the motion to remove the loop hitch - observed_at 2026-10-24
- OBS: https://gamedev.stackexchange.com/questions/134333/how-do-i-create-an-animation-without-noticeable-loops - "Make your animation duration the Least Common Multiple of varying loop times" - observed_at 2026-10-24
- OBS: https://live2d.pavostudio.com/doc/en-us/live2d/model-config/ - MouseTracking `SmoothTime`, EyeBlink `MinInterval`/`MaxInterval` options - observed_at 2026-10-24
- OBS: https://desksprite.com/desktop-pets-for-windows/ - "Free, deliberately annoying, endlessly quotable" (Desktop Goose; vendor page) - observed_at 2026-10-24
