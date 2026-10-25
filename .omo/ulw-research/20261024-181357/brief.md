# Brief: Natural motion quality and diversity for a "VTuber stuck in the corner of the screen"

## Request (verbatim)
"We are trying to create a "vtuber stuck in the corner of the screen" which means the model needs to move both because of environmental factors, and independetly. I want to improve motion (both idle and emotion based) in quality and diversity. Some notes I have would be we should use exaggeration/exaggerated movements as a tool. Current idle movements can sometimes carry over the worst aspects of MAGIC (nonsensical, weird back and fourth quick jittering)."

<analysis>
Core question: How should AIRI's Natural Live2D motion driver change so idle and emotion motion read as higher quality and more varied for a desktop-corner VTuber - motivated by environment AND self-driven - using exaggeration deliberately and removing MAGIC-like quick back-and-forth jitter?
Axes:
- A1 codebase-idle: Natural idle layers (posture OU/shifts, gaze, breath, blink, body follower, energy presets) and where high-frequency reversals come from; liveliness gate metrics that reward jitter.
- A2 codebase-emotion: emotion path (impulses, holds, gesture clips, mood, speech emphasis, band table) and its capacity for exaggeration and variety.
- A3 magic-lineage: MAGIC (VAR / AR-HMM) generator, the reference recordings and reference-stats the Natural gate was tuned against; what Natural inherited.
- A4 principles: animation principles (exaggeration, anticipation, follow-through/overlap, arcs, slow in/out, timing, staging, secondary action, appeal) and how practitioners apply them to procedural/2D-rig motion.
- A5 vtuber-practice: Live2D / VTube Studio / desktop-mascot practice for idle loops, physics, breathing, idle variety, desktop-pet behaviors ("stuck in the corner").
- A6 procedural-research: research and engineering on procedural idle/head/gaze motion for virtual agents (Perlin/Improv, gaze/saccade models, head motion statistics, smoothing filters, behavior selection for variety, avoiding jitter).
- A7 emotion-exaggeration: research and practice on emotional body/face expression and exaggeration in virtual characters (perception studies, Laban/EMOTE, anime acting conventions, caricature).
- A8 skeptic: attack evidence, independence, transfer from 3D/humans to 2D Live2D rigs, and synthesis choices.
Codebase relevant: yes · External: yes · Collection: browser (attached engine not installed at start: no-cli; fallback web_search + webfetch text, journaled as degraded) · Verification likely: yes (frequency/reversal analysis of Natural output vs filter settings) · X/social signal: no
Scale: 8 axes, codebase + web + research literature, standard-length report · Precision demand: moderate (design guidance for a personal fork; a wrong claim costs tuning time, not money) -> lifecycle: single team
Debate need: "exaggeration improves perceived quality/appeal" (transfer from cartoon/3D studies), "matching human recording jitter makes idle look natural" vs "jitter reads as noise on 2D rigs", "OU noise vs Perlin vs keyframed idle clips", "more randomness = more diversity".
</analysis>

## Axis owners
| Axis | Owner | Category |
|---|---|---|
| A1 | member idle-code | deep-low |
| A2 | member emotion-code | deep-low |
| A3 | member magic-lineage | deep-low |
| A4 | member principles-web | unspecified-low |
| A5 | member vtuber-practice-web | unspecified-low |
| A6 | member procedural-research-web | deep-low |
| A7 | member emotion-exaggeration-web | unspecified-low |
| A8 | member skeptic | ultrabrain |
Lanes: explore (git history of jitter tuning + recordings), librarian repo-dive (open-source desktop-pet / procedural idle implementations), 3 web lanes (Live2D official motion/physics docs; game-dev procedural animation talks on noise, smoothing, variety; practitioner forums on idle complaints).
Routing note: unspecified-high route is unavailable this session ("No credential slots available"); no slot requested it.

## Expected truths (seed intent-diff.md)
- I1: Idle motion contains no visible quick back-and-forth reversals (no sustained >2-3 Hz direction flips at visible amplitude).
- I2: Idle varies over minutes (no audibly/visibly repeating loop; distinct activity states).
- I3: Emotion motion at clear/strong bands reads at a glance from a small corner window (exaggerated enough), and differs between emotions.
- I4: Environmental reactions (cursor, touch, desktop activity, speech) and self-driven motion coexist without fighting or snapping.
- I5: Natural does not reuse MAGIC generator output; any MAGIC-like artifact is a property of Natural's own tuning.

## Deliverable
lane: no-format (answered_by: default)
state: none
formats: md, post (answered_by: default) - a Markdown research report in the session dir plus the chat answer
destination: Luke, chat + repo-local report (answered_by: default)
audience: Luke (project owner, animation-literate developer), standard (answered_by: default)
template: clean analyst register (answered_by: default)
format description: none

## Run log
- 2026-10-24T18:16:21.962Z: team 8605e0ed-ad2f-4612-aa26-a22d4d4956fc created (8 members), 5 lanes launched. Browser engine unavailable (CLI install failed); web collection is text-only via webfetch.
