# Verification economics

| claim | risk | error cost | cost/time | path | decision | outcome | residual |
|---|---|---|---|---|---|---|---|
| C1' OU is the jitter source | high | wrong fix target wastes tuning | 2 lanes (sim + ablation), ~2.5 h | executed ablation + independent simulation | verify | CONFIRMED (source); visibility not measured | pixel visibility at widget size |
| C3 shifts cause reversals | high | wrong lever | in same ablation | executed | verify | REFUTED | none |
| C4 eye counter-rotation darting | normal | minor | in same ablation | executed | verify | PARTIAL (mechanism yes, ~0.1 deg) | perceptual |
| C14 face OU flicker | normal | minor | in same ablation | executed | verify | PARTIAL (measurable, tiny) | perceptual |
| hair shimmer via physics | normal | wrong mechanism | T2 headless physics | executed | verify | NOT SUPPORTED (RMS 0.997) | rig-part mapping |
| recording reversal rate | normal | no natural target | 1 lane | executed (pending) | verify | pending | tracker contamination |
