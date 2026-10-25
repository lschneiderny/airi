# wave-1-lane-web-gamedev.md (journaled 2026-10-24T18:48:25.916Z)

st_01a16f27 [completed] transcript via event-log:
assistant: I read this as a read-only web research assignment on procedural animation practice. I'll stop when I've fetched the primary sources and returned the EXPAND and CLAIMS sections.
tool: webfetch
tool: webfetch
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: web_search
tool: webfetch
tool: web_search
tool: webfetch
tool: webfetch
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
tool: web_search
assistant: Fetch the key primary sources: Eiserloh PDF, Bevy source, the Holden remainder, the Rain World / Rosen transcripts via alternative hosts.
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: web_search
tool: web_search
tool: web_search
assistant: Fetch the transcript-bearing pages.
tool: webfetch
tool: webfetch
tool: webfetch
assistant: # Web lane: game-industry procedural animation practice

All pages below were accessed 2026-10-24. Everything is read-only; I changed no files.

**Not read directly:**
- The GDC Vault pages were down for maintenance, and the YouTube pages returned only footers.
- The Rain World GDC 2016 talk is therefore not read at all. I have only its chapter list (from search snippets), the Game Developer write-up and the Unity interview.
- "Juice it or lose it" was read only through a secondary summary (Arzola).
- Rosen and Eiserloh were read through auto-generated transcripts (lilys.ai), which contain caption errors. For example, Rosen's gravity is captioned "9.18 or 9.81".
- Search ran on Exa only and hit its rate limit twice. Roughly 20 searches and fetches succeeded, short of the requested 10+ varied queries per site: I did no `site:` or `filetype:pdf` queries. The one PDF I fetched (Eiserloh) came back as raw bytes.

## 1. David Rosen, "An Indie Approach to Procedural Animation" (GDC 2014)
URL: https://lilys.ai/ar/notes/1049760 (transcript). Also https://www.gamedeveloper.com/design/video-an-indie-approach-to-procedural-animation (confirms a ~26-30 min Animation Bootcamp talk).

- **Movement first, animation draped on top.**
  - Quote: "controller input equals acceleration... never interfering with it."
  - Quote: "at first, you do no harm to the gameplay."
  - He drapes an idle pose on a physics sphere. The character rotates toward its actual velocity, not the stick direction. He adds acceleration tilt on top.
- **Very few keyframes.** He uses 13 keyframes in total: 2 standing, 6 locomotion, and the rest for crouch, flips and rolls.
- **Linear interpolation is avoided for organic motion.**
  - Quote: "organic creatures almost always [look bad] with linear interpolation."
  - He uses a spring-damper with two parameters, stiffness and damping, "tweaked until it looked right". He gives no numeric constants.
  - It gives "nice easing in and follow-through". He says the same spring absorbs landings: "adds some downwards force to the crouching spring."
  - Because the spring is decoupled from the poses, it works for any stand-to-crouch pair, which avoids a combinatorial explosion of transitions.
- **Cubic interpolation between keyframes.** It fixes a velocity jar at the end of the arm swing when linear interpolation is used.
- **Anticipation and overshoot as reusable curves.**
  - Flips get "a little bit of acceleration or anticipation at the beginning" in the curve.
  - Quote: "If you keep on having to animate an overshoot for your punch, you could just add a new curve."
- **Secondary motion as a per-bone softness parameter.** Quote: "every animation has sort of a softness parameter for each bone." Arms wobble when he runs. No constants given.
- **Receiver's rotational spring** is used for "gun recoil... footsteps and even... taking out a magazine."
- **Randomised variety.** Because reload is split into stages, a bullet can stick or the cylinder can spin on return. He says this makes variety easy to add.
- **Rain World mention.** He cites the slugcat tilting into its run, a tail that is "always physically simulated", and IK limbs to the nearest surface.

## 2. Rain World procedural animation
- https://www.gamedeveloper.com/design/crafting-the-complex-chaotic-ecosystem-of-i-rain-world-i-
  - Quote: "a bunch of points in space and I connect them at certain distances."
  - A "paper doll" of parts is drawn on top of a point frame. The creatures are soft and bendable as a result.
- https://unity.com/blog/exploring-procedural-design-rain-world
  - The slugcat is two spherical chunks locked at a fixed distance. Limbs and tail are cosmetic additions animated from input.
  - Quote: "Early on I used a mixture of classical and procedural animation, but later I gravitated more towards procedural."
- https://candlesign.github.io/Rain-World-Devlog/Pages/001
  - Creatures are "a few freely moving pieces that are interconnected and rendered as a soft body."
- GDC 2016 chapter titles (from the YouTube search listing, not the talk itself): "Separation of cosmetics and physics", "Pragmatism", "AI/behaviour == animation", "Faking weight and balance".
- No spring constants or noise specs were found in anything I could read.

## 3. "Juice it or lose it" (Jonasson and Purho, 2012)
- Read via https://devblog.heisarzola.com/gdcr-juice-it-or-lose-it/ and https://gamedesign.gg/watch/juice-it-or-lose-it/ (16 min, Nordic Game Indie Night 2012).
- Secondary-source quote: "showing a maximum output for each minimal input."
- Reactions listed in the summary:
  - The paddle squashes and stretches with mouse speed.
  - The ball stretches with velocity and wobbles after impact.
  - The ball is enlarged and flashes white on impact.
  - Destroyed blocks shrink, spin and darken.
  - Walls bounce like gum.
  - Hit pitch rises in succession.
- The summary gives no numeric constants. The playable demo is at grapefrukt.com/f/games/juicy-breakout/.
- Counterpoint, from the Game Developer headline only (not opened): https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-
- Related, from a search snippet only (page not opened): "A shake that's too long or too strong stops being feedback and becomes noise" (manuelsanchezdev.com).

## 4. Daniel Holden, "Spring-It-On"
URL: https://theorangeduck.com/page/spring-roll-call. I read the first ~50 KB of ~58 KB. The truncated tail covers Resonance and the other spring types (double, timed, velocity, quaternion).

- **The naive per-frame lerp is wrong.** `lerp(x, g, damping*dt)` is framerate-dependent and goes unstable when `damping*dt > 1`.
- **Exact damper:** `x = lerp(x, g, 1 - exp(-ln2*dt/(halflife+eps)))`.
  - Constants: `ln2 = 0.69314718056`, `eps = 1e-5`.
  - Fast negative exponential: `1/(1 + x + 0.48x² + 0.235x³)`.
- **Spring-damper parameterisation:**
  - `damping = 4*ln2/(halflife+eps)`.
  - `stiffness = (2π·frequency)²`.
  - `ratio = d/(2√s)`. Ratio 1 is critical, below 1 is under-damped (overshoot), above 1 is over-damped (slow).
  - Critical case: `s − d²/4 = 0`.
- **Critical spring:** `y = d/2; j0 = x − g; j1 = v + j0·y; eydt = exp(−y·dt); x = eydt(j0 + j1·dt) + g; v = eydt(v − j1·y·dt)`. Quote: "returns to the goal as fast as possible without extra oscillation."
- **Lag:** a critical spring tracking a constant-velocity target lags by `halflife/ln(2)`, from https://www.theorangeduck.com/page/microblog (2025/02/24).
- **Inertialization:** decay an offset with `decay_spring_damper_exact` at a halflife. Quote: "a spring does not provide a fixed blend time and can easily overshoot."
- **Smoothing and filtering:** "Springs also work well for filtering out sudden changes or jitters... even... quite a small halflife."
- **Peak acceleration (Fitting Code Driven Displacement):** https://www.theorangeduck.com/page/fitting-code-driven-displacement
  - From rest, `t_max = 1/y` and `v_max = y·e⁻¹`.
  - Worked fit: a 0→5 m/s change with a 2 m/s² limit needs halflife 1.27 s.
  - Mocap fits: halflife 0.63 s (run), 0.60 s (180° turn at 154.68°/s), 1.90 s (Usain Bolt).
  - One of his own numbers looks wrong: "0.14 m/s²" for a 0→5 m/s change at halflife 0.2 s. By his own formula the peak acceleration would be about 8.6 m/s², so do not reuse it.
- Cross-check (Mom's Basement University): the same critical spring written as `omega = 2/smoothTime`, "In doubt on a camera?... smooth time around 0.3 s." https://momsbasementuniversity.com/applied/3d-game-development/easing-smoothstep-and-damping/
  - Its measurement: at 0.01 s a decay has closed 6.7% of the gap and a spring 0.2%.

## 5. Noise on poses, why raw noise looks like jitter, and band-limiting
- **Eiserloh, GDC 2016, "Juicing Your Cameras With Math"** (transcript: https://lilys.ai/it/notes/791665). The PDF itself was unreadable.
  - Per-frame random values are "effectively an infinite frequency regardless of how slow the time is."
  - Perlin noise "feels like it's coherent... not just teleporting to a random place every frame."
  - It is also "frame rate independent" and has "adjustable frequency". Slowed enough it reads as handheld camera.
  - Use different noise per channel by staggering seeds.
  - Shake = trauma² or trauma³, with trauma decaying linearly. Quote: "Camera shake is trauma 2 or trauma 3."
  - Rationale: "similar to real physics" (spring and damper).
  - 3D: rotational shake is preferred. Translational shake can clip into walls.
- **Bevy reference port with constants:** https://docs.rs/bevy/latest/src/2d_screen_shake/2d_screen_shake.rs.html
  - Trauma decay 0.5/s (1.0 reaches 0 in 2 s), exponent 2.0, max angle 10°, max translation 20 px, noise speed 20.0/s, trauma per hit 0.4.
  - Noise channels are offset by +0, +100 and +200.
- **Godot port with constants** (search snippet only; the page fetch returned no body): https://www.strayspark.studio/docs/godot-camera-system/noise-and-shake
  - Defaults: 14 Hz, decay 0.9, exponent 2, 2 octaves.
- **Ken Perlin:** https://blog.kenperlin.com/?p=7640
  - Quote: "noise by itself is rather flavorless... a signal that goes up and down over time smoothly but unpredictably."
  - He adds gain "to move more decisively", so the signal spends more time near its extremes.
  - Quote: "you create signals, and then you run those signals through filters to give them character."
- **How practitioners band-limit it.**
  - Drive coherent noise by time, not by a per-frame random draw.
  - Pick the frequency by scaling the time input.
  - Low-pass the target with a critical spring or exponential damper (Holden).
  - Keep amplitude low and use an odd power such as trauma² for strong events.
- **Eye-jitter study:** Krejtz et al. 2018 studied synthetic gaze jitter (https://onlinelibrary.wiley.com/doi/10.1002/cav.1745). I read only the search snippet, so it is unverified.

## 6. Idle variation systems
- **Unity 3D Game Kit sample** (https://kybernetik.com.au/animancer/docs/samples/animator-controllers/3d-game-kit/idle/):
  - `idleTimeout = 5 s` of no input while grounded.
  - Then a random wait of 0–5× the idle clip length. At 3.933 s per clip that is up to 19.665 s.
  - `RandomIdle` picks an index in [0,2].
  - The sample's `_MinRandomizeInterval` is 0 and `_MaxRandomizeInterval` is 20 s.
  - Fade 0.25 s in Mecanim, 0.5 s with sine in-out easing in Animancer.
  - Any input resets the timer.
  - The Animancer sample draws from a uniform random index with no cooldown or no-repeat.
- **Vendor blogs (low authority):**
  - MoCap Online, https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide:
    - Fidget timer 30–60 s, played as additive clips.
    - Breathing 15–20/min relaxed, 20–25 alert, 1–2 cm travel.
    - Weight shift over a 4–8 s cycle.
    - Idle loops of 2–4 s, or 8–12 s.
    - Blend-in 0.2–0.4 s.
  - Charios, https://charios.com/blog/idle-blend-tree-2d-character:
    - Blink every 2–5 s, weight shift every 5–10 s.
    - "add a cooldown to prevent immediate repeats."
    - Blends of 0.1–0.2 s.
    - Micro-idles of 15–30 frames.
- Neither vendor blog cites a shipped game. I did not find a primary source for no-repeat or cooldown rules in a shipped title.

## EXPAND
- LEAD: The GDC Vault session pages (1020583 and the other Rosen/Rain World IDs) and the YouTube pages (Rain World `sVntwsrjNe4`, Rosen `LNidsMesxSE`, Juice `Fy0aCDmgnxg`) - WHY: the primary talks were unreadable; Rain World has no transcript at all and the Juice talk is only secondary - ANGLE: retry later with a transcript source; also pickscribe.com/lilys.ai transcripts for `sVntwsrjNe4`.
- LEAD: Eiserloh's slides PDF (mathforgameprogrammers.com) - WHY: it came back as raw bytes - ANGLE: extract the text, then confirm the trauma², noise and spring-and-damper statements and the smoothing slides.
- LEAD: Freya Holmer's talk on framerate-independent lerp smoothing (linked from Holden's microblog) and t3ssel8r's spring video - WHY: both are cited as top-tier on spring feel and overshoot constants - ANGLE: pull their damping-ratio and overshoot guidance.
- LEAD: Holden's "Inertial Easing", "Perfect Tracking Springs" and "Animation Quality" posts - WHY: the last two are relevant to judging motion quality - ANGLE: extract spring-tuning rules.
- LEAD: Vlambeer "Art of Screenshake", Disney-principle write-ups for squash, anticipation and impact, and primary evidence of idle cooldowns in shipped games (for example Overwatch or Zelda talks) - WHY: no primary source yet for impact squash constants or idle no-repeat rules - ANGLE: search with `site:gdcvault.com` and `filetype:pdf`.
- DEAD END: DuckDuckGo, Startpage, Mojeek, Ecosia and Google HTML endpoints all return bot challenges here. The Exa free tier rate-limits after a few queries.
- DEAD END: YouTube watch pages via webfetch return nothing useful.
- DEAD END: the StraySpark page fetch returned only a header, so its constants are from the search snippet.

## CLAIMS
- CLAIM: Practitioners treat spring-damper smoothing as the default way to make procedural reactions and transitions feel natural. Linear interpolation and per-frame lerp are rejected for organic motion. - RISK: normal - SOURCES: theorangeduck.com, lilys.ai (Rosen) - COUNTER: Holden says springs can overshoot and give no fixed blend time; for UI with a fixed duration, easing curves fit better (momsbasementuniversity.com) - PRIMARY: https://theorangeduck.com/page/spring-roll-call
- CLAIM: A critically damped spring (damping ratio 1) is the safe default because it is the fastest approach without overshoot. Overshoot needs a ratio below 1. - RISK: normal - SOURCES: theorangeduck.com, momsbasementuniversity.com - COUNTER: Rosen's ease-in and follow-through come from a tuned, probably under-damped spring, not a critical one; his constants are not given - PRIMARY: https://theorangeduck.com/page/spring-roll-call
- CLAIM: Halflife is the best tuning parameter for exact springs. A halflife of about 0.2–0.6 s is typical for locomotion reaction, and a critical-spring camera uses a smooth time of about 0.3 s. - RISK: normal - SOURCES: theorangeduck.com, momsbasementuniversity.com - COUNTER: 0.2–0.6 s comes from a velocity and heading fit to mocap (0.6 and 0.63 s) plus a hand-picked 0.2 s example, not an animation-feel study; Holden's own "0.14 m/s²" figure looks wrong by his formula - PRIMARY: https://www.theorangeduck.com/page/fitting-code-driven-displacement
- CLAIM: Raw per-frame random noise reads as jitter because it has effectively infinite frequency. Practitioners use time-driven coherent noise (Perlin, a few octaves) with a chosen frequency, a different seed per channel, and amplitude scaled by trauma² or trauma³. - RISK: high - SOURCES: lilys.ai (Eiserloh transcript), docs.rs/bevy, blog.kenperlin.com - COUNTER: the exact constants (14 Hz or 20/s noise speed, 2 octaves, decay 0.5–0.9/s) are demo defaults, not tested against perceived-jitter thresholds; the StraySpark numbers come from a snippet only - PRIMARY: http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf (unreadable here)
- CLAIM: For shake or impact, escalate non-linearly. Add trauma in 0.1–0.5 steps and decay it linearly (about 0.5/s), so repeated small hits compound. - RISK: normal - SOURCES: lilys.ai, docs.rs/bevy - COUNTER: 3D and VR reverse the rule: avoid translation and prefer rotation; VR should avoid forced motion entirely - PRIMARY: Eiserloh slides
- CLAIM: Idle variety is usually built as a base loop plus randomly timed one-shot variations (fidgets) that are interrupted by input. A shipped sample uses a 5 s idle timeout and a uniform random pick among 3 clips. - RISK: high - SOURCES: kybernetik.com.au (Unity 3D Game Kit), mocaponline.com, charios.com - COUNTER: the cooldown, no-repeat and 30–60 s fidget figures come from vendor blogs, not shipped games; the Unity sample itself has no cooldown or no-repeat - PRIMARY: https://kybernetik.com.au/animancer/docs/samples/animator-controllers/3d-game-kit/idle/
- CLAIM: Blend durations for idle transitions are commonly 0.1–0.5 s. The Unity sample uses 0.25 s (Mecanim) and 0.5 s (Animancer, sine in-out). - RISK: normal - SOURCES: kybernetik.com.au, charios.com, mocaponline.com - COUNTER: the 0.1–0.2 s and 0.2–0.4 s figures are vendor guidance; only the Unity sample is primary - PRIMARY: kybernetik.com.au (same URL as above)
- CLAIM: Rain World and Overgrowth use a physics or point-chain body as the foundation. Limbs, tails and tilt are layered procedurally on top, with secondary motion on appendages. - RISK: normal - SOURCES: gamedeveloper.com, unity.com, lilys.ai (Rosen) - COUNTER: I could not read Rain World's own GDC talk, and there are no constants - PRIMARY: https://www.youtube.com/watch?v=sVntwsrjNe4 (unread)
- CLAIM: Anticipation and overshoot are best implemented as reusable curves and springs applied to a key pose, not as hand-keyed frames. - RISK: normal - SOURCES: lilys.ai (Rosen) - COUNTER: Rosen reports his own game's practice and gives no numeric overshoot value; a questioner raised that physics-driven in-betweens lose intentional animator control, and his answer was to abstract the intentional in-betweens into reusable curves - PRIMARY: https://gdcvault.com/play/1020583/Animation-Bootcamp-An-Indie-Approach (GDC Vault down)
- CLAIM: "Juice" means maximum output for minimal input, with squash and stretch, wobble and flashes on impact. It should be added after the core is final. - RISK: normal - SOURCES: devblog.heisarzola.com, gamedesign.gg - COUNTER: Folmer Kelly argues against over-juicing at the cost of immersion (gamedeveloper.com, headline only) - PRIMARY: https://www.youtube.com/watch?v=Fy0aCDmgnxg (unread)
