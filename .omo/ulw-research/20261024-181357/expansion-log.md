# Expansion log

## Leads (every lead ever seen)
- L0 (lead scoping): posture continuous filters tuned to match recording jitter -> owner idle-code + magic-lineage

## Waves

### Wave 1 (launched 2026-10-24T18:16:21.962Z)
Team: ulw-research-natural-motion, team_run_id 8605e0ed-ad2f-4612-aa26-a22d4d4956fc.
Routing (requested -> spawned -> fallback): idle-code deep-low -> gpt-6.1-sol; emotion-code deep-low -> gpt-6.1-sol; magic-lineage deep-low -> gpt-6.1-sol; principles-web unspecified-low -> claude-sonnet-5-5; vtuber-practice-web unspecified-low -> claude-sonnet-5-5; procedural-research-web deep-low -> gpt-6.1-sol; emotion-exaggeration-web unspecified-low -> gpt-6.1-sol; skeptic ultrabrain -> claude-opus-5-5. No fallbacks.
Lanes: explore st_01a16f20 (history), librarian st_01a16f21 (repo dive), web st_01a16f26 (Live2D docs), st_01a16f27 (game-dev), st_01a16f28 (forums).
Workers: 8 members + 5 lanes = 13 (floor for "single topic, both": 13).
Degradation: browser collection unavailable (browser-doctor no-cli; browser-install: "cli: install failed", "spawn bsk ENOENT"). Web workers read with webfetch text; screenshots-as-provenance not possible this run.
- L1 (idle-code): liveliness gate rewards jitter level (detrended jitter band, still05) -> owner idle-code/magic-lineage; verification candidate
- L2 (vtuber-practice): Shimeji weighted random behaviors as variety model -> owner vtuber-practice-web, repo lane
- Note 2026-10-24T18:16:39.407Z: web_search rate-limited/bot-challenged across engines (Exa 429, DDG/Google challenges); members fetching directly.
- L3 (emotion-code): emotions without gesture clips (sad, think, question, curious) -> variety/exaggeration gap; owner emotion-code
- L4 (emotion-code): strong-band body follows yaw/roll only, no body-Y for pitch gestures -> exaggeration/follow-through gap
- L5 (procedural-research): coupled vs independent noise per axis (Egges) -> relevant to posture.ts per-axis independent OU; owner procedural-research-web + idle-code
- L6 (magic-lineage): reference bands from human performer recordings (likely face-tracking capture: tracking noise may be inside the "jitter" target) -> owner magic-lineage; check capture method
- L7 (magic-lineage): MAGIC jitter source = VAR noise + 30 Hz stepping without interpolation (filter exists); hypothesis "MAGIC lacks smoothing" corrected
- 2026-10-24T18:17:19.008Z: member emotion-exaggeration-web died (no heartbeat 30 s, 2 tools); A7 re-spawned as lane lane-a7-emotion-exaggeration (deep-low).
- 2026-10-24T18:17:46.177Z: member principles-web died (19 tools, no heartbeat); A4 re-spawned as lane lane-a4-principles (deep-low) with its found leads.
- Debate R1 sent: C1 -> skeptic.
### Wave 1 returns (2026-10-24T18:48:25.916Z)
- lane-web-live2d-docs: completed; leads: CubismTargetPoint/LAppModel update order; motion3 bezier restriction; official sample idle motion lengths (Hiyori/Mao); JP docs + note.com.
- lane-web-gamedev: completed; leads: GDC Vault/YouTube primaries (Rosen, Rain World, Juice); Eiserloh PDF text; Freya Holmer/t3ssel8r springs; Holden Animation Quality posts; shipped idle cooldown evidence.
- skeptic R1 verdict: partial; leads: shift reversal-angle stats; eyes vs head (ask Luke); interpolation effect on reference.
- Members died: vtuber-practice-web, procedural-research-web -> respawned as lanes lane-a5-vtuber-practice, lane-a6-procedural-research. Verification lane verify-jitter-ablation dispatched (Phase 4).
- L8: ask Luke whether the jitter he sees is in the eyes or the head (only he can answer).
- Wave 1 returns 2026-10-24T19:07:12.040Z: forums lane (leads: Reddit threads unreadable, Trutoiu 2011 blink asymmetry, Animation Mentor, audience exaggeration evidence, 1 Euro defaults); repo-dive (lead: Cubism framework effect/TargetPoint equations - covered by docs lane); explore-history (git unavailable to lane -> lead ran git: verify-git-history.md; dead end: band-limited jitter denominator attempt reverted).
- L9 (emotion-code): emotion-strength slider does not scale entry clip -> exaggeration lever gap
- L10 (emotion-code): habituation turns repeats into slight -> repeated emotions vanish (variety/readability)
- L8 asked to Luke 2026-10-24T19:07:12.040Z: eyes vs head jitter.
- L11 (idle-code): unfiltered face OU (mouthForm, lid) -> routed to verify-jitter-ablation as arms H/I
- L12 (idle-code): rig physics may dominate body coupling (body axes null) -> note for synthesis
- L13 (emotion-code): independent side draws (hold/impulse/gesture) -> incoherent tilt
- Debate R2 sent: C11 -> skeptic. Git SHAs recovered: cf87462ba, 4672ec409, cc25dae6e (verify-git-history.md).
- Luke question (eyes vs head) accepted 2026-10-24T19:13:05.579Z.
- L14 (skeptic): physics amplification of subpixel head wobble (hair shimmer) -> routed to verify-jitter-ablation (T2 physics if available)
- L15 (skeptic): tau change as the real lever; check still05/speedPeak -> ablation arm J
- L16 (emotion-code): long clip tails postpone idle shifts (activeUntil uses 15 tau lifetime)
- DEAD ENDs: retuning filters within gate band; body follower as jitter source; episode tau randomization.
- idle-code COMPLETE (3 reports). magic-lineage closing. E1 closed.
- L17 (idle-code): gate validity at product home vs desk home
- L18 (idle-code): gate forbids long stillness and forces a noise floor -> C17 -> skeptic
- emotion-code COMPLETE (3 reports). idle-code COMPLETE.
- L19 (skeptic R2): idle ducking via hold.modulation amplitude over gesture lifetime -> design lead (C19)
- L20 (skeptic): laugh 3.5-5 Hz distinct band -> note
- L21 (emotion-code): speech accent pulses can exceed clear clips
- L22 (magic-lineage): T2/T3 420 s jitter instability (C21)
- DEAD END: global exaggeration gain justified by facial literature (transfer).
- magic-lineage FINAL delivered 2026-10-24T20:15:39.579Z. Leads: recorder metadata (E1 closed, nothing found; only Luke can confirm sensor) -> optional question; HF vs visible changes -> ablation lane; T2/T3 duration (C21).
- verify-jitter-ablation COMPLETE 2026-10-24T20:48:04.036Z. Leads: add reversal-rate gate metric (C23); map head-driven physics params to rig parts; recording reversal rate -> verify-recording-reversals dispatched. DEAD ENDs: face OU / body follower / eye K cannot fix head jitter; shifts not a jitter source.
- L23 (skeptic H3): stretch gain OU to minutes-scale regimes; measure between-window CV at 60 s -> design recommendation (no further verification needed for synthesis; flagged as follow-up)
- DEAD END: raising OU SD / shift rate / amplitude for variety.
- 2026-10-24T21:58:57.911Z: Luke question "Jitter where" timed out (130 min). Decision (best judgment, logged): treat the verified head continuous OU as the primary target; eye counter-rotation and face OU are secondary, ranked by measured effect in the recommendations.
- 2026-10-24T21:58:57.968Z: Luke question "Jitter where" timed out (130 min). Decision (best judgment, logged): treat the verified head continuous OU as the primary target; eye counter-rotation and face OU are secondary, ranked by measured effect in the recommendations.
- 2026-10-24T22:22:31.237Z: A5 COMPLETE. Leads: arxiv 2509.05023 full text (real vs acted idle) -> feeds A6 lane; Desktop Mate reviews (blocked). Skeptic R3 lead "recording noise floor" folded into st_01a16fab. Skeptic "ask Luke quality vs variety": NOT asked - brief verbatim requests both ("improve motion ... in quality and diversity"); logged as answered by request. Render-scale visibility A/B needs the running app + Luke's eye -> recommendation, not run in this research turn.
- 2026-10-24T22:56:04.926Z: A6 COMPLETE. Leads (not dispatched; recorded as follow-ups): Hadar 1983/84 full text; Eyes Alive tables; Zibrek/McDonnell jitter thresholds (doi 10.1145/3238302); Freedman 2008; SmartBody/Greta idle code. Natural resting reversal target will come from st_01a16fab (Luke's recordings) instead. DEAD ENDs: Semantic Scholar 429, ACM/ScienceDirect 403.
- 2026-10-24T23:03:04.150Z: A7 COMPLETE. Leads (follow-ups, not dispatched): Hyde 2013 full text; Mousas 2018; PMC8582590 speed factors (directly usable for clip timing); Smith/Schyns spatial-frequency + small-avatar legibility (only route to size scaling); anime acting conventions. DEAD ENDs: web_search blanks; publisher pages blocked.

### Wave 2 (launched 2026-10-24T23:04:52.398Z)
- verify-wave2-slow-wander: slow-wander OU retune arms vs recordings + full gate + diversity CV (driven by C36 and refuted C17 pt3).
- Wave 1 lanes all returned: A1-A7 + skeptic + magic-lineage + ablation + recording verification. Remaining wave-1 leads recorded as follow-ups (paper full texts blocked; rendered widget-size A/B needs app + Luke).

### Wave 2 returns (2026-10-24T23:12:28.078Z)
- verify-wave2-slow-wander: hypothesis refuted; leads: intermittent step shifts (W7/W8), nonstationary regimes (CV gap .78 vs .1-.17). DEAD END: raw slow OU; longer-tau OU alone.
### Wave 3 (launched 2026-10-24T23:12:28.078Z)
- verify-wave3-step-regimes: human step/hold structure, step-based arms S1-S4, regime arms R1-R2; gate metrics and CV.

### Wave 3 returns (2026-10-24T23:28:04.677Z)
- verify-wave3-step-regimes: leads remaining are implementation tuning (OU sd x0.7-0.74 with regime sweep on more seeds; per-session jitter/SPLA band check) -> recorded as follow-ups. Research leads converged: no new mechanism or unknown surfaced in wave 3 beyond tuning.
- 2026-10-24T23:29:21.323Z: team 8605e0ed delete -> {"text":"Deleted team 8605e0ed-ad2f-4612-aa26-a22d4d4956fc; cancelled 0 member task(s).","details":{"kind":"deleted","team_run_id":"8605e0ed-ad2f-4612-aa26-a22d
- 2026-10-24T23:37:21.493Z: outcome.json startedAt corrected 22:13:57Z -> 18:13:57Z (session dir stamp is UTC; outcome.mjs parseSessionStart reads it as local EDT). Canonical [S<n>] lines appended to sources-ledger.md so the briefing counts them.
