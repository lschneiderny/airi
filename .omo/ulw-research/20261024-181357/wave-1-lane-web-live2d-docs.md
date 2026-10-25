# wave-1-lane-web-live2d-docs.md (journaled 2026-10-24T18:48:25.916Z)

st_01a16f26 [completed] transcript via event-log:
assistant: I read this as a read-only web research assignment on official Live2D docs. I'll stop when I've fetched the relevant pages and delivered the sourced notes with EXPAND and CLAIMS sections.
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
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
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
tool: webfetch
tool: web_search
tool: web_search
tool: web_search
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
assistant: I read 20 official Live2D pages, plus 3 official framework source files that supply the numbers the manual omits. The official docs give no recommended idle-loop duration, no recommended breath cycle in seconds, and no named "natural vs mechanical" rule set beyond the motion-hint tutorial. Everything below is dated 2026-10-24 (access date).

I could only fetch the Native C++ framework source, so the Web and Unity ports are unchecked. Search was limited to 10 queries because DuckDuckGo, Google, Startpage, Mojeek and Ecosia returned bot challenges and Exa hit a rate limit. Only the Exa-routed queries and a few early DuckDuckGo ones produced results.

## Idle authoring: fades, loops, curves

| Topic | Source (URL) | Quote | Number |
|---|---|---|---|
| Default fade | docs.live2d.com/en/cubism-editor-manual/motion-setting/ | "If the motion has no fade value set and is unset, the value is 1000." | 1000 ms; SDK manual says "default value of 1 second" |
| Fade precedence | docs.live2d.com/en/cubism-sdk-manual/motion/ | "applied in the order B, C, A" (B = per-parameter fade in motion3, C = model3, A = overall fade in motion3) | |
| Overlap rule | docs.live2d.com/en/cubism-editor-manual/about-fade/ | "no significant movement be added during the fade-in" | The doc's example: a 1.0 s fade swallows a first blink, giving ~0.5 eye-open instead of 0; 0.3 s fixes it |
| Per-parameter fade | same page | "Use this function when you want to adjust individual fadings, such as for blinking" | Doc example: overall 2.0 s plus eye parameters 0.3 s. It says this makes body transitions and physics "more natural"; overall 0.3 s made the body fade "unnatural" and cut physics off |
| Interrupt fade | same page | "determined by the fade-in time of Motion B" | Crossfade length is B's fade-in, not A's fade-out. If A's fade-out is shorter, B is weakened in the gap |
| Loop with fade | same page | "set the fade value to 0" | Fading a looped motion makes it "not loop smoothly" |
| Loop in SDK | motion SDK page | MotionBehavior_V2 interpolates end to start | With V1, "choppiness" appears when start and end values are equal |
| Loop editing | docs.live2d.com/en/cubism-editor-manual/loop-editing-support/ | "efficiently creation of loop motions such as idling" | Duplicates keys before and after the scene and adjusts curve shape so the loop joins |
| Idle group | motion-setting page | "If you enter 'Idle'... the motion can be played back automatically." | |

- **Blend formulas** (docs.live2d.com/en/cubism-editor-manual/motionblending/): Override is `s*w + d*(1-w)`. Additive is `s*w + d`. Weight runs 0 to 1.
- **Priority and parallel layers** (SDK motion page): `CubismMotionManager` only stores a priority integer. The manual says "Denial of playback by priority must be done outside of CubismMotionManager." `PriorityNormal` is 2. The manual shows `PriorityForce` but gives no numeric value. I recall the sample using Idle=1, Normal=2, Force=3, but I did not fetch that, so treat it as unverified.
- **Starting a motion** fades out all running motions via `StartFadeout(GetFadeOutTime())`. For parallel layers, use one manager per body region. The manual warns: "the parameters of the last updated motion will take effect" and "the fade may not be applied cleanly" if layers share parameters.
- **Curves** (docs.live2d.com/en/cubism-editor-manual/grapheditor/): Five types: Smooth (default), Linear, Step, Inverse step, Bezier. Smooth "begins to move slowly and decelerates toward the next keyframe". Bezier handles auto-adjust "to prevent the curve from bending through". Bezier presets exist. The manual calls them "often used primarily in motion graphics".
- **`motion3.json` bezier restriction:** docs.live2d.com/en/cubism-sdk-manual/motion-unity/ warns that if Beziers are not exported in restricted mode, "curves might be off".

## Natural vs mechanical

The only official guidance is docs.live2d.com/en/cubism-editor-tutorials/motion-hint/ (updated 2019). Quotes:
- "If the model only turns its face around, it will look robotic."
- "If the face and body move at exactly the same time, it still looks robotic."
- Body should "follow later" than the face.
- "Humans are not able to stop moving instantly" → overshoot then settle, or brake before the stop.
- "Humans often blink when they turn their faces or change the direction of their eyes."
- "the model should be made still while waiting, and when the model is moved, you should move it clearly enough."
- Character-specific amplitude: adult male is "sturdy and calm", reduce Z tilt; young female uses large movements and head tilts.
- Standard parameter ranges (docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/): AngleX/Y/Z ±30, BodyAngle ±10, EyeBall ±1, EyeOpen 0..1, ParamBreath 0..1.

## Physics

Sources: docs.live2d.com/en/cubism-editor-manual/physics-operation/ and .../physical-operation-setting/.
- Calculate FPS options are 15/30/60/120. The default is 60 as of Cubism 5.0 beta1, previously 30. The SDK matches Editor behavior via the FPS stored in `physics3.json` (SDK R5 beta3 and later). Without it, behavior follows render FPS (see docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-4-2/).
- Pendulum parameters:
  - **Duration** (smaller is quicker).
  - **Ease of swinging**: "As a rule of thumb, use a setting in the range of 0.7 to 0.99."
  - **Reaction time**: 1 is standard; above 1 is more agile.
  - **Speed of convergence**: 1 is standard; above 1 settles faster.
- Input types are Position X and Angle. Normalization defaults to −10/0/10. Input influence totals cannot exceed 100% per type.
- Output: Scale multiplies the pendulum angle in radians. The Output Maximum (%) display shows how much of the destination parameter's range is used. If it is above 100%, the manual says the pendulum "is trying to move to a range where it is not creating movement, which causes choppiness". Use "Increase Output (down)" to rescale.
- Skinning of about 10 steps works at a scale of about 20. Multi-stage presets are 2/3/10/20-step hair. A mismatched Pendulum No. means it "will not swing cleanly".
- Overlapping outputs across groups: total influence over 100% gives "jerky motion". Group order matters: with cursor tracking plus two groups, 50% and 33% gives equal shares.
- SDK: default gravity is (0, −1) and wind is (0, 0), and these override the `physics3.json` values. Call `Stabilization()` on the first frame, or non-default parameters make physics "run unstable" (docs.live2d.com/en/cubism-sdk-manual/stabilize-physics/).
- Motion fades interact with physics: a short overall fade "cut off" physics in the about-fade example above.

## Breath, blink, look-at: SDK defaults

**Breath** (docs.live2d.com/en/cubism-sdk-manual/breath/ plus `CubismBreath.cpp`, github.com/Live2D/CubismNativeFramework)
- The formula in code is `offset + peak*sin(t*2π/cycle)`, added to the parameter with `weight`.
- Official sample values (offset, peak, cycle in seconds, weight):

| Parameter | Offset | Peak | Cycle (s) | Weight |
|---|---|---|---|---|
| AngleX | 0 | 15 | 6.5345 | 0.5 |
| AngleY | 0 | 8 | 3.5345 | 0.5 |
| AngleZ | 0 | 10 | 5.5345 | 0.5 |
| BodyAngleX | 0 | 4 | 15.5345 | 0.5 |
| ParamBreath | 0.5 | 0.5 | 3.2345 | 0.5 (C++), 1 (Web) |

- The cycles are deliberately non-commensurate, so the motion rarely repeats. "Peak" is really the amplitude.

**Eye blink** (docs.live2d.com/en/cubism-sdk-manual/autoeyeblink/ plus `CubismEyeBlink.cpp`)
- Defaults: interval 4.0 s, closing 0.1 s, closed 0.05 s, opening 0.15 s, all linear. The doc samples use `SetBlinkingSettings(0.8, 0.2, 0.8)` and interval 6 or 8.
- The manual says the interval is "random, ranging from 0 seconds to twice the set time". The code is `now + r*(2*interval − 1)`, so the real upper bound is 2×interval − 1 (7 s for the default 4).
- Blink writes the parameter directly rather than adding to it. That makes it override whatever the motion put on the eye-open parameter.
- Editor blink track (docs.live2d.com/en/cubism-editor-manual/eye-blink-settings/): multiplies the eye parameter by a 0 to 1 factor.

**Look-at / drag** (`CubismTargetPoint.cpp` — the manual does not document it)
- Frame rate is hard-coded at 30. Epsilon is 0.01.
- `FaceParamMaxV = 40/10 = 4.0` per second, so max velocity per frame is 0.133. The source comment says "7.5 s / 5.3 per sec", which does not match the code.
- Time to max speed is 0.15 s, which sets the acceleration cap.
- A braking limit derived from the acceleration and the remaining distance decelerates smoothly as the target nears.
- The Japanese comment gives the intent: average neck swing speed, with "twice that as max speed" to allow for accel/decel.
- Target coordinates are normalized, with center 0 and edges ±1.
- Unity `CubismLookController` (docs.live2d.com/en/cubism-sdk-tutorials/lookat/) uses `Vector3.SmoothDamp` with a `Damping` field: "time it takes to follow the target. The smaller the value, the faster."
- The Unity `Factor` field note says adjusting range or sign "may result in more natural motion."
- The Unity look-at doc says the input range is −1 to 1.
- Unity `HarmonicMotion` (docs.live2d.com/en/cubism-sdk-manual/harmonicmotion/): a sine wave with `Duration` default 3 s and range 0.01 to 10 s, blend mode default Additive.

## EXPAND
- LEAD: `CubismTargetPoint` plus the sample `LAppModel` update order - WHY: the manual is silent on it; the source holds the real accel and speed constants and the order of motion, eye blink, breath, look-at, physics, pose - ANGLE: fetch `LAppModel.cpp` Update() from github.com/Live2D/CubismNativeFramework and the samples repo, and the CubismPhysics.cpp solver constants.
- LEAD: Cubism Core motion3 `Meta.Fps` and bezier restriction notes - WHY: bezier restriction decides whether exported idle curves match the Editor - ANGLE: docs.live2d.com/en/cubism-editor-manual/notes-for-sdk/ and docs.live2d.com/en/cubism-sdk-manual/motion3-consistency/.
- LEAD: official Cubism sample models' Idle motion lengths, e.g. Hiyori, Mao - WHY: the only real numeric reference for idle loop length - ANGLE: parse the `.motion3.json` `Meta.Duration` and Fps from the Live2D/CubismWebSamples repo.
- LEAD: Japanese-language `docs.live2d.com/cubism-editor-tutorials/*` and Live2D official note.com articles - WHY: the JP site may carry more motion advice than the EN one - ANGLE: fetch docs.live2d.com/cubism-editor-tutorials/ index, `motion-hint` JP, and note.com/live2dnote.
- DEAD END: official numbers for idle loop duration, breath cycle in seconds, or "natural" thresholds. Not in the SDK or Editor manuals. DuckDuckGo and the other engines were blocked by bot challenges. `CubismTargetPoint.cpp` is not under `src/Utils/` (404); the working path is `src/Math/`.

## CLAIMS
- CLAIM: Fade defaults to 1 s, and crossfade length on interruption is the incoming motion's fade-in time. - RISK: normal - SOURCES: docs.live2d.com - COUNTER: Unity's Mecanim path blends differently, and the manual says the Viewer "not a perfect reproduction" - PRIMARY: about-fade and motion-setting pages.
- CLAIM: Looped idle motions should have fade 0 and matching start and end values, because fading at the loop boundary breaks the loop. - RISK: normal - SOURCES: docs.live2d.com - COUNTER: MotionBehavior_V1 vs V2 differ in end-of-loop handling - PRIMARY: about-fade and SDK motion pages.
- CLAIM: Set blink and eye parameters with a short per-parameter fade (about 0.3 s) while the body uses a longer overall fade (about 2 s). - RISK: normal - SOURCES: docs.live2d.com - COUNTER: this is one example, not a prescription - PRIMARY: about-fade.
- CLAIM: Face and body should lag each other, with overshoot and braking, and blinks should accompany head or eye turns. - RISK: normal - SOURCES: docs.live2d.com - COUNTER: 2019 beginner tutorial, no numbers - PRIMARY: cubism-editor-tutorials/motion-hint.
- CLAIM: Official breath sample uses four angle channels with weight 0.5 and cycles of 3.2345 to 15.5345 s, deliberately non-commensurate. - RISK: normal - SOURCES: docs.live2d.com, github.com/Live2D - COUNTER: sample values only, not a recommendation, and the Web weight for ParamBreath differs (1) - PRIMARY: SDK breath manual and `CubismBreath.cpp`.
- CLAIM: Default blink is 0.1 s close, 0.05 s closed, 0.15 s open, with a 4 s base interval. The interval is random up to 2×interval−1, not 2×interval as the manual says. - RISK: high - SOURCES: github.com/Live2D, docs.live2d.com - COUNTER: manual wording differs from code, and I only read the C++ port - PRIMARY: `CubismEyeBlink.cpp` develop branch.
- CLAIM: Official look-at smoothing caps velocity at about 4 units/s (0.133 per frame at 30 fps) with a 0.15 s ramp to max speed, and brakes based on remaining distance. - RISK: high - SOURCES: github.com/Live2D - COUNTER: the source comment says 5.3/s, the code computes 4.0, the 30 fps constant makes it frame-rate dependent, and the Unity version uses SmoothDamp instead - PRIMARY: `CubismTargetPoint.cpp` (src/Math/).
- CLAIM: The limit exists to mimic human neck swing speed, with accel/decel considered. - RISK: high - SOURCES: github.com/Live2D - COUNTER: the reasoning comes from a Japanese source comment that I read and paraphrased, and its numbers are internally inconsistent. Not stated in the manual - PRIMARY: `CubismTargetPoint.cpp`.
- CLAIM: Physics ease of swinging 0.7 to 0.99, with Output Maximum held near 100% (above 100% causes choppiness) and total output influence at or under 100%. - RISK: normal - SOURCES: docs.live2d.com - COUNTER: the manual targets Editor tuning, not runtime procedural motion - PRIMARY: physical-operation-setting and physics-operation pages.
- CLAIM: Priority-based rejection of idle vs triggered motions is the host app's job. `CubismMotionManager` only stores an integer. - RISK: normal - SOURCES: docs.live2d.com - COUNTER: sample code does reserve and force semantics, but that is an app-level convention - PRIMARY: SDK motion page, CubismMotionManager section.
