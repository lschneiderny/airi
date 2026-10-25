# Skeptic simulation (member skeptic, 2026-10-24T19:40:48.143Z)
Method: real NaturalPostureLayers (posture.ts) in Bun, product home, dt 1/120, 30 Hz samples, 600 s, seeds 1-3, yaw, deg = x30.

| arm | rev/s >0.25 deg | >0.5 | >1 | accel RMS deg/s^2 | >5 Hz ratio |
|---|---|---|---|---|---|
| baseline | 2.38 | 1.22 | 0.48 | 79 | 1.2e-4 |
| OU off | 0.33 | 0.30 | 0.26 | 32 | 3.5e-7 |
| OU only | 2.43 | 1.11 | 0.24 | 72 | - |
| pre-gate filters .07/.08/.10 | 2.26 | | | | |
| filters 0.25 s | 1.33 | | | | |
| tau x3 | 1.46 | | | | |
| shifts off | | | | | 0.011 |

Verdict: CONFIRMED (simulation) that the continuous OU is the main source of small fast head reversals and all >5 Hz power; REFUTED that the gate-floor retune caused it (~6%). Code not pasted by the member; independent reproduction requested from verify-jitter-ablation.
