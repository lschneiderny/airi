# A4 principles (lane st_01a16f2e, journaled 2026-10-24T23:03:39.442Z)

st_01a16f2e [completed] transcript via event-log:
assistant: I read this as a read-only research lane on animation principles for procedural Live2D motion - I'll examine the supplied leads, broaden the evidence, and map findings to motion parameters. I'll stop right away when the sourced report, expansion leads, claims, and dated observations are complete.

tool: todo
assistant: The research plan is set toward a sourced motion-design report. You need: 0/6 items done; the supplied leads remain unverified. Now: Read supplied animation research leads first. Next: Search varied principle and procedural evidence.

tool: webfetch
tool: webfetch
tool: tool_search
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
error: Provider stream start timed out after 300000ms (raise streamStartTimeoutMs — retry.provider.streamStartTimeoutMs in senpi settings; 0 disables)
tool: webfetch
error: Provider stream start timed out after 300000ms (raise streamStartTimeoutMs — retry.provider.streamStartTimeoutMs in senpi settings; 0 disables)
tool: task_send
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: webfetch
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: eval
tool: todo
tool: eval
tool: eval
error: You have hit your ChatGPT usage limit (prolite plan). Buy credits at https://chatgpt.com/settings/usage. To keep going now, add an OpenAI API key, sign in with another ChatGPT account, or switch providers. Try again in ~8675 min.
assistant: Handoff - Ask: A4 research on animation principles for procedural Live2D motion - wanted: sourced principle-to-parameter mapping plus claims. For you: 1/6 done; the search tool is empty, so I'm using direct fetches. Now: Search varied principle and procedural evidence. Next: Fetch primary sources and record observations.
tool: eval
assistant: Handoff - Ask: A4 research on animation principles for procedural and 2D-rig motion - wanted: principle-to-parameter mapping, evidence, and claims. For you: the sourced material is thinner than the brief wanted, and the gaps are listed first. Now: Deliver claims, expansion leads and observations. Next: nothing; the lane ends here. No files were changed.

## Gaps
- **Search:** `web_search` returned empty bodies on every query. Bing and DuckDuckGo via `webfetch` returned junk or a CAPTCHA, so I do not have 10+ useful searches.
- **Lasseter 1987:** only the ACM DOI, the OpenAlex abstract and the Wikipedia citation were reachable. The ACM page returned 403, and the siggraph.org, Wayback and jina mirrors failed or timed out. I did not read the paper text.
- **Wang 2006 full text:** the University of Washington URLs return 404, and the CiteSeerX and Microsoft PDFs timed out. I only have the abstract (Microsoft Research page and Crossref). The filter's formula and strength parameters are unverified beyond that abstract.
- **Perceptual evidence:** I found no user study showing these principles raise perceived quality, apart from the abstract's claim about the filter. OpenAlex and Crossref listed candidates, but I did not fetch them.
- **Anime timing:** the Wikipedia pages and Frank and Ollie are the only sources. There is no primary account of threes or of anime holds.

## Principle-to-parameter mapping
Parameters are my inference from the sources, not measured values.

| Principle | Source meaning | Procedural control |
|---|---|---|
| Exaggeration | Caricature of real motion, not constant extremes. Rotoscoped motion reads "stiff and mechanical". Restraint needed. | One global gain on amplitude, applied per channel and capped, with emotions scaled differently from idle. The Wang filter (acceleration added back inverted) is the generic tool. |
| Anticipation | A counter-motion before the main action, scaled to its size. Omitting it can be a gag. | Before a gesture or head turn, a short opposite-direction offset of about 10-25% of the move. Scale it with the gesture's size and skip it for startles. |
| Follow-through and overlap | "Nothing stops all at once." Parts lag the body, overshoot, then settle. | A damped spring per secondary part (hair, ears, body sway). Frequency 0.5-6 Hz, damping ratio 0.1-1.2. Run springs after the final pose, each chain root to tip, with a fixed step. |
| Slow in and out | More drawings near the extremes. Omitted deliberately for snap or shock. | Ease-in-out on holds and gestures. Use a hard-out curve for surprise reactions. |
| Arcs | Head turns and eye movements follow arcs. | Give the head's yaw and roll a coupled arc rather than independent straight-line axes. |
| Timing | Fewer frames means faster and crisper. Varying speeds adds texture. | Vary duration by weight and mood, and mix fast and slow within one phrase. |
| Secondary action | Supports the main action without drawing attention away. | Blinks, breathing and small sway kept low amplitude. Put them at the start or end of a big move, not during it. |
| Staging | One action stated clearly. | Do not run a gesture, head move and emotion change all at once. Use one priority channel at a time. |
| Appeal | Readable design and clear poses. | A held pose that reads clearly matters more than continuous micro-motion. |
| Moving hold | Near-still poses keep a small movement so they are not lifeless. | Keep a small, slow OU amplitude during emotion holds. |

## Limited animation, holds and jitter
- **Holds:** the limited-animation sources describe reused drawings, held poses and "twos" as the default. Hand-timed motion therefore reads as deliberate pose changes with holds, not constant drift.
- **Jitter (inference):** OU noise has energy at all frequencies, and the Wang filter amplifies acceleration. Applied to raw OU it would amplify exactly the quick back-and-forth the owner wants removed. Low-pass or quantize the noise first, then apply exaggeration.
- **Holds with quantized updates:** target updates every 2-3 frames with spring smoothing, and holds on emotion poses, would give a hand-timed feel. This is untested.
- **Springs and jitter:** the haotian article says persistent jitter at rest usually means a constraint projection is not mirrored in velocity. It also says a teleport (pose snap) must reset the springs explicitly.

## EXPAND
- LEAD: Wang et al. 2006 full text (CiteSeerX 10.1.1.62.958, or `grail.cs.washington.edu/pub/papers/animationFilter.pdf`, now 404) - WHY: it gives the exact filter formula, smoothing width and strength parameters needed to implement exaggeration - ANGLE: find an archived copy through the Wayback Machine or a different text mirror, then extract the formula.
- LEAD: Lasseter 1987 text (doi 10.1145/37402.37407) - WHY: the primary source for staging, timing and exaggeration for computer animation - ANGLE: search the SIGGRAPH HyperGraph mirrors with `web_search` once it works, or `archive.org` full-text search.
- LEAD: Park and Hodgins, and Metoyer et al. 2007 (DOI 10.1109/tvcg.2007.70427) - WHY: procedural anticipation for head and upper-body impacts, with a psychology basis - ANGLE: fetch the IEEE PDF link from Crossref and the references on reaction timing.
- LEAD: Orange Duck "Spring-It-On" and inertialization (`theorangeduck.com/page/spring-roll-call`) - WHY: exact closed-form spring, half-life parameterisation and inertialization for pose blending - ANGLE: read the sections on critical, timed and velocity springs and on inertialization.
- LEAD: OpenAlex titles "Rubber-like Exaggeration for Character Animation" (10.1109/pg.2007.25), "Anticipation Effect Generation for Character Animation" (10.1007/11784203_61), and "The Effects of Anticipation in WALL-E (2008)" - WHY: procedural exaggeration and anticipation papers - ANGLE: find abstracts and any user studies.
- LEAD: Sakugabooru blog (`blog.sakugabooru.com`) - WHY: practitioner accounts of anime timing, held frames and animating on twos or threes - ANGLE: find tagged posts, since the site's `?s=` search returned nothing.
- DEAD END: `web_search`, Bing and DuckDuckGo via `webfetch`; `evl.uic.edu/ralph/508S99` (404); `grail.cs.washington.edu` project and paper paths (404); `dl.acm.org` (403); `siggraph.org` HyperGraph (redirect or blank); `awn.com` article (404); `people.eecs.berkeley.edu/~maneesh` (404); `docslib.org/doc/7898161` (a different document).

## CLAIMS
- CLAIM: The Cartoon Animation Filter adds a smoothed, inverted, optionally time-shifted acceleration (second derivative) back into the input signal. Its output shows anticipation, follow-through, exaggeration and squash-and-stretch that the input lacked. - RISK: normal - SOURCES: microsoft.com, crossref.org - COUNTER: this is the authors' own abstract. I did not read the paper's experiments or any user study, and the filter amplifies noisy input. - PRIMARY: ACM TOG 2006, doi 10.1145/1141911.1142010
- CLAIM: A damped spring parameterised by frequency and damping ratio gives follow-through. A ratio below 1 swings a few times, which suits hair and ears. A ratio of 1 is critical damping, for follow with no overshoot. Semi-implicit Euler with a fixed step and root-to-tip ordering is needed for stability. - RISK: normal - SOURCES: haotianblog.com, theorangeduck.com - COUNTER: the article is a practitioner blog. The slider ranges are its suggestions, not tested on Live2D. - PRIMARY: `haotianblog.com/en/spring-secondary-motion-2d-en/`
- CLAIM: Frame-rate-independent smoothing uses `1 - exp(-rate*dt)`, with half-life as the control. A per-frame lerp factor behaves differently at different frame rates. - RISK: normal - SOURCES: haotianblog.com, theorangeduck.com - COUNTER: none found. - PRIMARY: `theorangeduck.com/page/spring-roll-call`
- CLAIM: The Disney animators' own guidance treats exaggeration as caricature that needs restraint, and notes traced realism looks "stiff and mechanical". - RISK: normal - SOURCES: frankanollie.com, wikipedia.org - COUNTER: this is craft guidance, not experimental evidence of improved perceived quality. - PRIMARY: Thomas and Johnston, *The Illusion of Life* (1981). I read only the authors' summary on frankanollie.com.
- CLAIM: Anticipation and follow-through can be omitted deliberately for comic or shock effect. Anticipation scale depends on the action. - RISK: normal - SOURCES: frankanollie.com - COUNTER: the source is guidance, with no measured effect. - PRIMARY: same.
- CLAIM: Classical animation mostly ran on twos, with ones for camera moves and subtle quick dialogue. Fewer drawings between poses makes motion crisper. Anime is a limited-animation tradition with reused drawings and holds. - RISK: normal - SOURCES: frankanollie.com, wikipedia.org - COUNTER: no source says holds and twos read better than continuous motion. That conclusion is my inference. Threes in anime are not sourced. - PRIMARY: same, plus the Wikipedia article on limited animation.
- CLAIM: Applying the filter to raw OU noise would amplify high-frequency jitter, so jitter should be removed before exaggeration. - RISK: high - SOURCES: none - COUNTER: this is my own inference from the filter's acceleration term. It is untested against the owner's pipeline. - PRIMARY: none.
- CLAIM: Quantizing motion updates to twos or threes with spring smoothing will read as hand-timed rather than drifting. - RISK: high - SOURCES: none - COUNTER: unverified design hypothesis, with no study found. - PRIMARY: none.

## OBSERVATIONS
- OBS: https://www.haotianblog.com/en/spring-secondary-motion-2d-en/ - "`f` controls speed only, `ζ` controls the number of bounces only" - observed_at 2026-10-24T18:30:00Z
- OBS: https://www.haotianblog.com/en/spring-secondary-motion-2d-en/ - "A teleport is a fact the caller knows; make the caller say so." - observed_at 2026-10-24T18:30:00Z
- OBS: https://www.microsoft.com/en-us/research/publication/the-cartoon-animation-filter/ - "adds a smoothed, inverted, and (sometimes) time shifted version of the second derivative" - observed_at 2026-10-24T18:40:00Z
- OBS: https://api.crossref.org/works?query.title=The%20Cartoon%20Animation%20Filter&rows=2 - "exhibits anticipation, follow-through, exaggeration and squash-and-stretch effects which are not present in the original" - observed_at 2026-10-24T19:00:00Z
- OBS: https://frankanollie.com/PhysicalAnimation.html - "Nothing stops all at once. This is follow through." - observed_at 2026-10-24T18:35:00Z
- OBS: https://frankanollie.com/PhysicalAnimation.html - "Action traced from live action film can be accurate, but stiff and mechanical." - observed_at 2026-10-24T18:35:00Z
- OBS: https://frankanollie.com/PhysicalAnimation.html - "Twos are used most of the time" - observed_at 2026-10-24T18:35:00Z
- OBS: https://frankanollie.com/PhysicalAnimation.html - "Fewer drawings make the action faster and crisper." - observed_at 2026-10-24T18:35:00Z
- OBS: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation - "animated motions that strive for a perfect imitation of reality can look static and dull" - observed_at 2026-10-24T18:32:00Z
- OBS: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation - "emphasize, rather than take attention away from the main action" - observed_at 2026-10-24T18:32:00Z
- OBS: https://theorangeduck.com/page/spring-roll-call - "if we change the framerate of our game (or the timestep of our system) we get different behavior" - observed_at 2026-10-24T19:20:00Z
- OBS: https://en.wikipedia.org/wiki/Limited_animation - "Limited animation (or planned animation) is a process in the overall technique of traditional animation that reuses frames" - observed_at 2026-10-24T19:10:00Z
- OBS: https://en.wikipedia.org/wiki/Anticipation_(animation) - "An anticipation pose or drawing is a preparation for the main action of an animated scene" - observed_at 2026-10-24T21:50:00Z
