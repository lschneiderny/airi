# A6 procedural-research (lane st_01a16f3f, journaled 2026-10-24T22:56:04.926Z)

st_01a16f3f [completed] transcript via event-log:
assistant: I read this as an information ask: research axis A6 and report sourced findings with no edits. I'll stop when I've fetched the key primary sources and delivered the EXPAND, CLAIMS and OBSERVATIONS sections.
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
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: eval
tool: eval
tool: eval
error: Idle timeout waiting for provider stream after 300000ms
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: web_search
tool: eval
tool: eval
tool: eval
assistant: ## A6 findings: procedural idle, head and gaze motion

**Ask:** research axis A6 (procedural idle, head and gaze motion) and report sourced findings. **Wanted:** evidence on why the Natural driver reads as jittery and how to get diversity. **For you:** five points are checked against primary text I fetched; the head-at-rest numbers you most need are still missing. **Now / Next:** none; this is the final report.

## Findings
- **Perlin's Improv is not a model of head dynamics.** Noise is one layer, and behavior selection is a separate one. Improv's motion actions are built from sine, cosine and coherent noise. Behaviors are chosen by weighted random picks that can depend on mood and environment. Perlin says viewers perceive the statistics of the motion, not its mechanism. So noise matched to the right statistics counts as believable, and nothing in the paper says what those statistics are.
- **Egges 2004 supports your owner's complaint.** The paper says idle motion "cannot easily be solved by using noise functions on all joints, because of dependencies between joints". Its fix is PCA over captured idle postures, so joints move coherently, plus a separate balance-shift layer. The independent per-axis OU noise in AIRI is exactly the case it warns against. It is not a direct finding on reversal rate.
- **Eye-head rules from the Ruhland et al. 2014 survey** (Eurographics STAR, fetched 2026-10-24):
  - The eye-head threshold is about 15–20°, and graphics work commonly uses 10–15°.
  - Eyes start first at about 200 ms latency, and head motion starts 20–50 ms later.
  - For a predictable target the head leads the eyes by about 100 ms.
  - The VOR latency is 7–15 ms, and the eyes counter-roll at −θ.
  - 5–10° saccades last 30–40 ms, and the shortest inter-saccadic interval is about 150 ms.
  - Head movements have a consistent velocity-magnitude relationship, like saccades.
  - Your fixed counter-rotation K=(0.31, 0.40) is a simplification of that VOR note.
- **Gaze timing from Eyes Alive** (second-hand; the original PDF was blocked):
  - Vinayagamoorthy 2004 tabulates mean inter-saccadic intervals of 2.5 s looking at and 1.6 s looking away while listening. While speaking the figures are 1.8 s and 2.1 s.
  - A summary of Lee et al. gives maximum saccade magnitudes of 27.5° talking and 22.7° listening.
  - Lee's talking-mode intervals depend on mutual-gaze versus away state, so gaze is state-driven rather than one stationary process.
- **Jitter versus latency from the 1 Euro filter (Casiez 2012).**
  - The filter is first-order low-pass with fc = fcmin + β·|speed|, and the derivative is smoothed at a fixed 1 Hz.
  - The paper says people are very sensitive to jitter at low speed and to latency at high speed.
  - Tuning procedure: set β=0 and fcmin≈1 Hz, tune fcmin down until jitter at rest is gone, then raise β to cut lag.
  - Its intended input is noisy tracker data. Using it on synthetic noise is my extrapolation, not a finding.
- **Noise preference is not universal.** Bodenheimer 1999, a running study with 30 subjects, found preferences bimodal for the female runner. Many liked slight noise and many liked a lot. Users preferred some variability, but the result gives no firm guidance on amount.

## Recommendations (inference, not sourced fact)
- Add structure at the behavior level: states such as attending, thinking and settling, each with its own timing, rather than one stationary noise process.
- Correlate the head axes, for example through a shared latent or a PCA-style mix.
- Give gaze a state-dependent interval distribution of roughly 1.6–2.5 s.
- Use the 1 Euro filter's speed-adaptive idea only if the residual jitter is high-frequency.

## Gaps
- I could not verify the actual head reversal rate at rest or the 1/f spectrum of resting head motion; my searches returned only brain-imaging and gait hits.
- I did not get the Hadar 1983/1984/1987 numbers beyond search snippets.
- SmartBody and Greta idle code are unchecked.
- Perceptual jitter thresholds for head motion are unchecked.

## EXPAND
- LEAD: Hadar 1983 "Kinematics of head movements accompanying speech" and Hadar 1984 "timing of shifts of head postures" - WHY: the only quantitative head-kinematics lead; snippets give a 1.4–2.2 Hz and 3.2–4.2 Hz probability minimum, and posture shifts as linear movements over 25° in under 1.2 s at about 4.6 per minute - ANGLE: get the full text via Semantic Scholar or a library, then compare against your 2.4 s shift cadence.
- LEAD: Eyes Alive original PDF (repository.upenn.edu/hms/51, or the Lee 2002 thesis AAI3073025) - WHY: exact saccade tables and listening-mode Gaussian parameters - ANGLE: pull the tables for a state-based gaze interval model.
- LEAD: Zibrek/McDonnell "Perceptual Adjustment of Eyeball Rotation and Pupil Size Jitter" (doi 10.1145/3238302) and "Smooth Movers" (doi 10.5555/1272690.1272726) - WHY: perceptual jitter thresholds for eye and body motion - ANGLE: extract numeric thresholds.
- LEAD: Freedman 2008, Exp Brain Res 190:369 (doi 10.1007/s00221-008-1504-8) - WHY: eye-head coordination primary review - ANGLE: head velocity profiles and eye-in-orbit dependence.
- LEAD: Frontiers 2018 "Frequency-specific fractal analysis of postural control" - WHY: the only 1/f candidate, and it covers centre of pressure, not the head - ANGLE: find head or trunk spectra.
- LEAD: Ishi/Ishiguro head-motion corpora, Busso 2007 head-motion statistics, SmartBody and Greta idle code - WHY: head amplitude and velocity numbers and idle architecture - ANGLE: papers and source repos.
- DEAD END: Semantic Scholar API (429), ACM DL (Cloudflare 403), ScienceDirect (403), the old Perlin Improv URLs (404), and core.ac.uk and academia.edu for Eyes Alive (403).

## CLAIMS
- CLAIM: Improv separates coherent-noise motion layers from weighted behavior selection - RISK: normal - SOURCES: mrl.cs.nyu.edu - COUNTER: none found - PRIMARY: yes (Perlin & Goldberg 1996 text)
- CLAIM: independent per-joint noise misses inter-joint dependencies, and Egges proposes PCA instead - RISK: normal - SOURCES: dspace.library.uu.nl - COUNTER: none found - PRIMARY: yes
- CLAIM: eye-head thresholds, latencies and VOR timing as listed above - RISK: normal - SOURCES: graphics.cs.wisc.edu (survey of Lee, Zangemeister and others) - COUNTER: individual variation noted - PRIMARY: no, a secondary survey citing LZ99, Sta99 and Ful92
- CLAIM: mean inter-saccadic intervals of 1.6–2.5 s in conversation - RISK: high - SOURCES: www0.cs.ucl.ac.uk - COUNTER: Lee's own equations give different values - PRIMARY: no, Vinayagamoorthy citing Lee
- CLAIM: the 1 Euro filter's speed-adaptive cutoff trades jitter against lag - RISK: normal - SOURCES: gery.casiez.net - COUNTER: designed for tracker noise, not synthetic motion - PRIMARY: yes
- CLAIM: user preference for noise amount is bimodal (Bodenheimer, running) - RISK: normal - SOURCES: publications.ri.cmu.edu - COUNTER: none found - PRIMARY: yes
- CLAIM: no sourced statistic for resting head reversal rate or 1/f spectrum - RISK: high - SOURCES: none - COUNTER: Hadar's snippets suggest a quantitative literature exists - PRIMARY: no

## OBSERVATIONS
- OBS: https://mrl.cs.nyu.edu/~perlin/improv-paper/ - "viewers do not perceive the mechanism itself. Instead they perceive some statistics" - observed_at 2026-10-24
- OBS: https://dspace.library.uu.nl/bitstreams/5ce13e74-0aac-44f8-9d80-5c1c399786d2/download - "cannot easily be solved by using noise functions on all joints, because of dependencies" - observed_at 2026-10-24
- OBS: https://graphics.cs.wisc.edu/Papers/2014/RABPBGMM14/STAR_Eyes_Final.pdf - "approximately 15-20 degrees" for the eye-head gaze shift threshold - observed_at 2026-10-24
- OBS: https://gery.casiez.net/publications/CHI2012-casiez.pdf - "fc = fcmin + β |Ẋ|", derivative cutoff fixed at 1 Hz - observed_at 2026-10-24
- OBS: http://www0.cs.ucl.ac.uk/research/equator/papers/Documents2004/Vino_cgf_2004.pdf - Table 1: listening 2.5 / 1.6 s, speaking 1.8 / 2.1 s - observed_at 2026-10-24
- OBS: https://publications.ri.cmu.edu/storage/publications/pub_files/pub4/bodenheimer_bobby_1999_1/bodenheimer_bobby_1999_1.pdf - "This distribution is bimodal" - observed_at 2026-10-24
- OBS: https://www.sciencedirect.com/science/article/pii/0167945783900040 (search snippet only) - "1.4-2.2 Hz and ... 3.2-4.2 Hz" - observed_at 2026-10-24
