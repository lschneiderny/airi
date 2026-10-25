# wave-1-lane-web-forums.md (journaled 2026-10-24T19:07:12.040Z)

st_01a16f28 [completed] transcript via event-log:
assistant: I read this as a read-only web research assignment on what makes VTuber and Live2D idle motion look alive, robotic, or jittery. I'll stop when I've run 10+ varied searches, fetched the candidate pages, and written the EXPAND and CLAIMS sections.
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: web_search
tool[error]: webfetch
assistant: Good candidates surfaced. Fetching them now.
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: webfetch
tool: webfetch
tool: webfetch
tool[error]: webfetch
tool: webfetch
tool: webfetch
tool: web_search
tool: web_search
assistant: Fetching the most relevant new candidates.
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool[error]: webfetch
assistant: Ask: web-lane research on what makes VTuber and Live2D idle motion read as alive, robotic, or jittery. Wanted: sourced quotes with URL and access date, then EXPAND and CLAIMS. For you: partial coverage. Reddit, Twitter and YouTube content could not be read, and most of the VTuber community-voice material is missing. Now: report. Next: none.

All access dates are 2026-10-24.

## Coverage and limits
- **Search:** I ran about 17 `web_search` queries. About 8 returned results, and the rest failed because Exa returned HTTP 429 and the other providers served bot challenges. The site:reddit, site:twitter and quoted-phrase ("jittery", "too stiff", "floaty") queries mostly never ran.
- **Reddit:** `.json` and `old.reddit` URLs were blocked or returned only "Welcome to Reddit", so no Reddit thread was read. The Reddit titles below are search snippets only.
- **Other unreadable pages:** YouTube returned only the page footer. Animation Mentor was blocked by Cloudflare. The Steam jitter thread returned only the opening post. The Trutoiu PDF and the Disney blink PDF exceeded the 5MB fetch limit.
- **Net effect:** the evidence is mostly tutorial and vendor prose, plus the VTube Studio manual. There is almost no first-person audience or VTuber commentary.

## Findings (fetched and read)

**Idle loop design**
- **ikimotion.com/docs/tutorials/idle-animation/** (Live2D idle tutorial)
  - "Keep idle values small: five degrees out of the head's thirty is enough to look alive without looking busy."
  - It uses a 4 s loop at 30 fps with Angle X keyed -5 / +5 / -5 at frames 0 / 60 / 120. Body swing is smaller than head swing (-2 / +2).
  - Blink interval defaults to 4 s. Breath cycle should divide the scene length (the 3.2345 s default would not loop).
  - It notes Cubism-SDK-style apps add their own breathing and stop auto-blink while a motion plays.
- **blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/**
  - "Consider adding macro variations that occur over three to six loops"
  - "Remember not to just repeat the fidget multiple times"
  - It also recommends layered motion and overlapping fidgets "so that the character is never still", which hides the loop.
- **charios.com/blog/breathing-cycle-2d-character/** (vendor blog)
  - "breathing cycle lasts about 2-4 seconds"
  - It gives a 3 s cycle: 30 frames inhale, 15 hold, 30 exhale, 15 hold.
  - Chest scale is about 102%, with 1-2 degrees of rotation.
  - Robotic causes it names: linear interpolation, all parts in sync, loop-point jumps. Fixes: ease in/out, offset timings, and a slow 10 s sway layered on top.
  - "If a player *notices* the breathing cycle explicitly... it's probably **too exaggerated**."
- **charios.com/blog/idle-blend-tree-2d-character/** (vendor blog)
  - "A blink might happen every 2-5 seconds, while a weight shift could be every 5-10 seconds."
  - It recommends a cooldown so micro-idles don't repeat back-to-back.
- **mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide** (vendor blog, 3D game idles)
  - "Hand-keyed idle animation tends to be either too still (wooden) or too exaggerated (floaty)."
  - Natural asymmetry matters: "Perfectly symmetrical idle poses look artificial".
  - It gives 15-20 breaths/min relaxed and 20-25 alert, and 2-4 s base loops.
- **shiroikarasu.net/live2d-idle-motion-guide-2026/** (Japanese, translated by me)
  - Physics alone leaves the torso and head fixed, so add slow wobble to `ParamBodyAngleX` and `ParamAngleZ`.
  - It reports a viewer comment of looking stiff ("カクッと止まって見える") when silent. This is a fictional dialogue in the article, not a real audience quote.
  - Too much sway reads as restless. It should be barely noticeable at actual stream size.
- **live2dnote.com/05 Motion & Animation/Clean Communication of Motion Intent in Live2D/**
  - "Motion without purpose feels awkward."
  - Exaggerated physics on a static pose in showcase videos is called out as a common failure, and "a small amount of movement is usually enough" to avoid stiffness.
  - It recommends anticipation, at least 5 key poses for a smooth arc, and a small overshoot. It also says a forward-lean hotkey helps for users with unreliable tracking.

**Tracker jitter and smoothing**
- **github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings** (official manual)
  - "More smoothing will make the movements less shaky but will introduce lag."
  - "On iOS, you will most likely need very little smoothing."
  - Auto-breath and auto-blink exist per parameter. Physics framerate should match the rigger's setting.
- **note.com/frusumi/n/n6c7553219af8** (Fuyuse Frusumi, VTube Studio guide)
  - Without smoothing, "Movement tends to be jittery, and physics-based items can easily look strange".
  - At about 45% smoothing, items stay stable even when moving fast.
  - FaceAngleY gets higher smoothing so swaying parts don't look jittery.
  - FaceAngleX: input a bit higher, plus smoothing.
  - The author says they don't use auto-blink. Output range wider than the model max makes reactions easier.
  - The frame rate section says "Higher doesn't necessarily mean smoother."
- **saraemi.com/en/2025/11/17/vts_tracking/** (rigger)
  - "If your blinking looks too snappy or 'flappy,' try increasing Smoothing"
  - The cause it names for blink problems is eye-open thresholds, and it suggests the default half-open fix.
- **gery.casiez.net/1euro/** (1€ filter)
  - Tuning rule: "if high speed lag is a problem, increase beta; if slow speed jitter is a problem, decrease fcmin."
  - This is the principled alternative to a fixed smoothing slider: a low cutoff at rest and a higher cutoff when moving fast.
- **steamcommunity.com/app/1325860/discussions/0/4205867488907489708/**
  - The opening post only: "All my vtubers are violently shaking and jittering."
  - A reply surfaced only in a search snippet: "setting the eye XY to 25 smoothness solves alot of it".

**Blink timing (science)**
- **pmc.ncbi.nlm.nih.gov/articles/PMC3565584/** (interblink interval)
  - Mean inter-blink interval is 5.97 s for normal eyes versus 2.56 s for dry eye, with 10 subjects per group.
  - Variability is higher in normal subjects (coefficient of variation 1.10 vs 0.70), so blink intervals should be irregular.
  - Viewing video lowers blink rate.
- **pmc.ncbi.nlm.nih.gov/articles/PMC10466800/** (blink review)
  - "roughly 15 times per minute"
  - The down phase is about 50-130 ms, and the up phase is slower, "roughly twice as fast" down versus up.
  - Occlusion lasts about 40-200 ms.
  - Blinks cluster in low-information moments, such as the end of a sentence.

## Search-snippet only (candidates, not fully read)
- **iainm.com/assets/pdf/Trutoiu-2011.pdf**: fast close and slow open; "Conventional methods... employ temporally and spatially symmetric sequences". Viewers can tell forward from backward blinks.
- **animationmentor.com/blog/tutorial-animate-blinks-eye-movement/**: "3-5 frames down", then a hold, then "2-4 frames to open"; lids offset.
- **vtubermodelcommissions.com/vtuber-facial-expression-range-optimization/**: viewers notice "Timing, Clarity, Consistency" and ignore micro-muscle accuracy and subtle asymmetry. This is a commission-site claim, and the fetch failed with ECONNREFUSED.
- **reddit.com/r/Hololive/comments/1ptqg2m/**: top comment praises "Mumei's upward head tilt when she listens". Audience-perception evidence, but a single data point from the snippet.
- **github.com/lxfight/astrbot-live2d-desktop commit 3fd25a6**: this fetch returned a store diff, not the commit message. The snippet describes layered noise-driven idle (head/eye/body at different frequencies, sinusoidal breath with sway coupling).
- **npmjs.com/package/@soullink-emotion/engine**: aperiodic breath, micro-motion and blink; low-frequency idle gestures (small nod, head tilt, side-look, slow blink); anti-repeat on recent gestures.
- **Reddit titles:** r/Live2D `klsn1k` (top comment says idle animations are common and improve the model); r/VirtualYoutubers `1kc132w` (Warudo "weird breathing").

## EXPAND
- LEAD: Fetch Reddit threads r/Live2D `klsn1k`, `10buxkv`, `1kmwi1r`, r/vtubertech `z7pvd4`, and r/VirtualYoutubers `1kc132w`. WHY: they are the only first-person VTuber and rigger voice found, and none were readable. ANGLE: use a host with working Reddit access (Pushshift/Arctic Shift/browser) and search "idle", "too stiff", "loop", "jitter".
- LEAD: Trutoiu et al. 2011 and the Disney paper. WHY: blink asymmetry and closure amplitude with perceptual-study evidence. ANGLE: fetch the DOI or PMC mirror, or read in chunks, for the exact close/open durations and the "naturalness" study results.
- LEAD: Animation Mentor blink and breathing tutorials. WHY: concrete frame counts. ANGLE: retry from another host, or the Wayback Machine.
- LEAD: YouTube tutorials (Ray "VTuber 101" `uutuYbqEXaw`, `Fo4EYNCqtiE`). WHY: practitioner advice such as "don't max physics, it looks jagged". ANGLE: transcript extraction.
- LEAD: Audience-perception evidence for exaggeration (bounce, head tilt, pop). WHY: nothing sourced beyond one Hololive comment and a commission-site claim. ANGLE: r/Hololive, r/VirtualYoutubers, and Twitter/Bluesky riggers' threads on "expressive" versus "stiff" models; search "model feels alive".
- LEAD: Tracker-smoothing complaint threads (VSeeFace, VNyan, Warudo, the Steam VTS forum). WHY: only one thread's opening post was read. ANGLE: full Steam thread pages, GitHub issues, and the Casiez paper for exact fcmin/beta defaults.
- DEAD END: Reddit `.json` and `old.reddit` via webfetch (blocked). Web search while Exa is rate-limited (429) and the other providers show challenges. The ECONNREFUSED site (vtubermodelcommissions.com) from this host.

## CLAIMS
- CLAIM: Idle sway should be small, about 5 degrees on a ±30 head range, and the body should follow the head at a smaller amplitude. - RISK: normal - SOURCES: ikimotion.com, live2dnote.com - COUNTER: a calm, small-sway character versus an energetic one; the Japanese guide says to scale by personality. - PRIMARY: ikimotion tutorial (a vendor manual, not a perceptual study).
- CLAIM: Looping idle reads mechanical when the loop is exactly periodic, linear, or perfectly in sync. Add irregularity through offset timings, a slow independent sway layer, and macro variations over 3-6 loops. - RISK: normal - SOURCES: blog.animschool.edu, charios.com - COUNTER: no controlled viewer test found; two sources are game and VTuber tutorials, not studies. - PRIMARY: AnimSchool (an instructor's talk summary).
- CLAIM: Human blink interval averages about 6 s while viewing video, with high variability (CV about 1.1). Blinks are asymmetric: close roughly twice as fast as open. - RISK: normal - SOURCES: pmc.ncbi.nlm.nih.gov - COUNTER: the 6 s figure comes from 10 normal subjects (mean age 26); reviews cite about 15 per minute (4 s); the 4 s default in ikimotion and the 2-5 s range in the Charios blog are authoring defaults, not measurements. - PRIMARY: PMC3565584 and PMC10466800. The Trutoiu perceptual blink study was not read.
- CLAIM: Tracker jitter is controlled by per-parameter smoothing, with a lag tradeoff. Typical practice is about 25-45% for jittery channels (eye XY, FaceAngleY, physics-driving channels). - RISK: high - SOURCES: github.com/DenchiSoft, note.com, steamcommunity.com - COUNTER: iOS tracking needs little smoothing; 45% and 25 are individual settings on specific setups, not recommendations that generalize. - PRIMARY: the VTube Studio manual states the tradeoff; the numeric values come from one creator's note and one forum reply.
- CLAIM: An adaptive filter (1€) is a more principled fix than uniform smoothing because it cuts jitter at rest without adding lag during fast motion. - RISK: normal - SOURCES: gery.casiez.net, dl.acm.org snippet - COUNTER: VTube Studio exposes only a fixed smoothing slider, and no evidence was found that VTuber users prefer 1€. - PRIMARY: Casiez et al., CHI 2012 (the page was read; the paper itself was not).
- CLAIM: Viewers weigh timing, clarity and consistency over anatomical subtlety, and prefer purposeful exaggeration over constant exaggerated physics. - RISK: high - SOURCES: vtubermodelcommissions.com (snippet only), live2dnote.com, reddit.com (snippet only) - COUNTER: live2dnote says clients still expect jellyfish-style physics; the commission-site text is unverified marketing copy. - PRIMARY: none found; no audience study or comment thread was read.
