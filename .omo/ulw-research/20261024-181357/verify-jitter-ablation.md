# Verification: jitter ablation (lane st_01a16f2f, journaled 2026-10-24T20:48:04.036Z)
Scripts and stdout: C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/{ablate.ts,calib.ts,physics.ts,out.txt,out2.txt,calib.txt,physics.txt}

st_01a16f2f [completed] transcript via event-log:
assistant: I read this as a read-only ablation study: drive the natural-motion code headless per arm and report the measurements. I'll stop when the arms-by-metrics table and the verdict are written.
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
tool: eval
assistant: Ask: ablation of AIRI's Natural idle motion to find which component produces quick head, eye and face reversals - wanted: a measured verdict per component and per gate. For you: the OU wobble in the head posture is the only head-side source of quick reversals, and every arm that removes or smooths it fails the jitter gate. All H1 verdicts are below. Now: report written. Next: nothing owed.

## Environment and artifacts
- Windows 11 10.0.26340 x64, node v26.11.1, tsx v4.23.12, repo main at f5bc5cec7.
- Nothing tracked was edited, and the app was not launched. Every arm is a runtime monkey-patch applied in the script. All scratch files are in `.temp/ulw-ablation/`:
  - `ablate.ts`: the facade ablation, arms A-K.
  - `calib.ts`: the direct `NaturalPostureLayers` calibration.
  - `physics.ts`: the headless rig run with physics on.
  - Stdout files: `out.txt` (arms A-I), `out2.txt` (arms A-K), `calib.txt`, `physics.txt`.
- I did not paste the scripts into this report; the files are the exact code. Read the stdout files rather than this report for per-seed numbers.
- `out2.txt` reproduces `out.txt` for arms A-I.
- The facade `Live2DNaturalMotion` is driven with seeds 1, 2 and 3, idle performance state, energy 0.5, no cursor, 600 s of active time per arm, sampled at 60 Hz. Tables show the median of the three seeds, for home=`product`. The `desk` home is in `out2.txt` and agrees within a few percent.

Arm patches:

| Arm | Patch |
| --- | --- |
| B | `posture.continuous[i].sd = 0` |
| C | `posture.nextShiftAt = Infinity` (also disables attention-led shifts) |
| D | `NaturalGazeLayer.eye = gaze => gaze` (K = 0), restored after the arm |
| E | `body.step = gain * head + residual`, with the follower removed |
| F | `filterTau = 0.07/0.08/0.10` |
| G | `filterTau = 0.25` |
| H | `face.mouthForm.filterTau = face.lid.filterTau = 0.3` |
| I | `sd = 0` on `face.mouthForm` and `face.lid` (brows left alone) |
| J | OU `tau ×3` (0.6/0.72/0.96) |
| K | `filterTau ×3` (0.18/0.21/0.27) |

- **Arm J SD:** stationary SD does not change with tau, because `FilteredOu` compensates its filter gain. Measured continuous yaw SD is 0.361 deg in all arms, so no rescale was needed.
- **Arm F:** I read the comment "tuned from 0.07 / 0.08 / 0.10" as the previous `filterTau` values. I did not look at git history to confirm.
- **Streams:** every patch keeps random-stream consumption identical, so seeds stay paired across arms.

Metric definitions:
- **Scale:** the deg-equivalent scales are head ×30, body ×10, eye ×20 (from the `gaze.ts` comment). The thresholds in the head, body and eye columns apply in those units. Face channels have no degree mapping and use normalized thresholds.
- **Reversal:** a direction change after an excursion of at least 0.25 deg-eq (hysteresis zigzag). Face channels use 0.004 and 0.01 normalized instead.
- **Quick reversal:** a reversal whose half-swing lasts 0.125-1 s, i.e. the 0.5-4 Hz band.
- **PSD:** Welch, Hann window, 1024 samples, 50% overlap, in deg-eq².
- **Jitter:** `scoreLiveliness().metrics.jitter` on head X/Y/Z in degrees, compared with the band [1.469e-5, 3.918e-5].
- **Eye saccade attribution:** an eye reversal counts as saccade-related if it falls within 0.15 s of a saccade start.

## Results (home=product, median of 3 seeds)

| Arm | Yaw quick/s ≥0.25° | Pitch quick/s | Roll quick/s | Body quick/s | Eye X quick/s | Yaw quick/s ≥1° | Yaw >5 Hz power (deg²) | Jitter median | Gate |
|---|---|---|---|---|---|---|---|---|---|
| A baseline | 1.52 | 1.20 | 0.26 | 0.06 | 0.32 | 0.208 | 1.12e-3 | 2.16e-5 | PASS (3/3 seeds) |
| B OU SD=0 | 0.05 | 0.06 | 0.03 | 0.00 | 0.12 | 0.023 | 3.4e-6 | 2.8e-6 | LOW |
| C no shifts | 1.75 | 1.31 | 0.32 | 0.04 | 0.25 | 0.245 | 1.12e-3 | 1.7e-4 | HIGH |
| D K=0 | 1.52 | 1.20 | 0.26 | 0.06 | 0.17 | 0.208 | 1.12e-3 | 2.16e-5 | PASS |
| E body lag off | 1.52 | 1.20 | 0.26 | 0.37 | 0.32 | 0.208 | 1.12e-3 | 2.16e-5 | PASS |
| F filters 0.07/0.08/0.10 | 1.43 | 1.11 | 0.24 | 0.06 | 0.32 | 0.183 | 8.8e-4 | 1.76e-5 | marginal (seed 2 LOW) |
| G filter 0.25 | 0.68 | 0.49 | 0.10 | 0.04 | 0.23 | 0.052 | 1.3e-4 | 5.2e-6 | LOW |
| H face low-pass | 1.52 | 1.20 | 0.26 | 0.06 | 0.32 | 0.208 | 1.12e-3 | 2.16e-5 | PASS |
| I face OU off | 1.52 | 1.20 | 0.26 | 0.06 | 0.32 | 0.208 | 1.12e-3 | 2.16e-5 | PASS |
| J OU tau ×3 | 0.78 | 0.48 | 0.06 | 0.03 | 0.22 | - | 3.2e-4 | 7.1e-6 | LOW |
| K filterTau ×3 | 0.85 | 0.57 | 0.10 | 0.04 | 0.24 | - | 2.1e-4 | 5.9e-6 | LOW |

All reversal-rate and band-power tables for every channel are in `out2.txt`. The two points that change a decision are below.

**Band power, head yaw:**
- Removing the shifts (arm C) cuts 0.5-1 Hz power from 0.67 to 0.03 deg², with no change above 5 Hz.
- Removing the OU (arm B) barely changes 0.5-1 Hz power (0.67 to 0.62). It cuts 1-3 Hz power by about 21%, 3-5 Hz by 97% and >5 Hz by 99.7%.

**Eye (X):**
- Saccades dominate: 514 per 600 s (0.86/s).
- The eye's >5 Hz power (0.0169 deg²) is the same in every arm, so it comes from saccades and does not change with D or B.
- Quick reversals more than 0.15 s from any saccade are 0.155/s at baseline, 0.000/s with K=0 (D), and 0.040/s with the OU off (B).

**Face (mouthForm, lid multiplier), normalized units:**

| Arm | mouthForm reversals/s (≥0.004) | lid reversals/s (≥0.004) | mouthForm >5 Hz power | lid >5 Hz power |
|---|---|---|---|---|
| Baseline | 11.8 | 15.6 | 7.8e-6 | 1.55e-5 |
| H (0.3 s low-pass) | 0.94 | 1.54 | 3.3e-8 | 6.4e-7 |
| I (OU off) | 0 | 0.14 | 0 | 5.8e-7 |

- Baseline SD is 0.038 for mouthForm and 0.023 for the lid.
- At the 0.01 threshold, quick reversals fall from 2.72/s to 0.19/s for the mouth and from 3.19/s to 0.62/s for the lid.

## Calibration against the skeptic's numbers
Yaw only, 30 Hz, 0.25 deg hysteresis, `NaturalPostureLayers` driven directly (`calib.txt`).

| Case | My rate | Skeptic's rate | My change vs baseline | Skeptic's change vs baseline |
|---|---|---|---|---|
| Baseline | 1.88 | 2.38 | - | - |
| OU off | 0.22 | 0.33 | -88% | -86% |
| OU only, no shifts | 2.10 | 2.43 | - | - |
| Filters 0.07/0.08/0.10 | 1.76 | 2.26 | -6% | -5% |
| Filter 0.25 | 1.00 | 1.33 | -47% | -44% |
| OU tau ×3 | 1.07 | 1.46 | - | - |
| filterTau ×3 | 1.17 | - | - | - |

- My absolute rates are about 20-25% lower. The relative effects agree within about 3 points.
- The probable cause is the definition of a reversal. I did not reproduce their counting method, so that is a guess.
- At 60 Hz via the facade, baseline yaw is 1.88/s, matching the direct 1.94/s.

## Physics (T2 headless rig)
Cubism Core 5.0.0 loads in Node with the physics rig present. I ran 600 s at 60 Hz for arms A, B, G and J. The rig has 143 physics output parameters, 128 of them active. The OU patch took effect: ParamAngleX reversals fell from 1.62 to 0.20/s with the OU off.

| Measure | A baseline | B OU off |
|---|---|---|
| Median RMS ratio (B/A) | - | 0.997 |
| Median velocity-RMS ratio (B/A) | - | 0.948 |
| Reversals/s at ≥0.5% of range, summed over active params | 223.6 | 153.2 (G 190.9, J 192.1) |
| Reversals/s at ≥2% of range, summed over active params | 91.0 | 78.3 |

- **Head-driven params:** the OU contributes about 50-75% of their small-amplitude reversals, but the amplitude change is modest.
  - Param12: 3.08 to 0.75/s at ≥0.5% of range; RMS ratio 0.99.
  - x2: 2.99 to 1.37/s.
  - Param40: 2.73 to 1.10/s.
  - Param28: 2.72 to 1.39/s.
  - Param19: 2.69 to 1.08/s.
  - Param27: 2.52 to 0.91/s.
  - Param_Angle_Rotation7: 2.50 to 1.04/s.
  - RMS ratios across these run from 0.72 to 0.99.
- **Everything else:** the largest-RMS and highest-reversal outputs (eyelash, pupil, eyeball highlight, lip) are unchanged at ratio 1.0, because blinks and saccades drive them.
- **Hair/accessory mapping:** I did not map the Param## and x## ids to hair versus accessory. The head-driven ones above are inferred from their B/A ratio, not from names.
- **Large-amplitude reversals:** the OU wobble adds small-ripple reversals to physics outputs, but the ≥2%-range reversals drop only about 14%. This run does not support a large "hair shimmer" effect. The physics RMS barely changes.
- **Body note:** on this rig the controller drives the body (adapter `bodyWrites` 107,997), so arm E applies. Removing the body lag raises body quick reversals from 0.06 to 0.37/s, so the lag is acting as a smoother.

## Verdicts
- **H1, continuous OU drives visible jitter: PARTIAL.**
  - Confirmed as the cause of quick head reversals: head yaw quick reversals fall from 1.52 to 0.05/s with the OU off, pitch from 1.20 to 0.06/s, and roll from 0.26 to 0.03/s.
  - Even at ≥1 deg, yaw falls from 0.208 to 0.023/s.
  - The OU is also the entire >5 Hz power (99.7%) and sets the gate jitter value.
  - Not established: that this is visible. Its yaw SD is 0.36 deg and I did not measure pixel size.
- **H1b, posture shifts drive visible reversals: REFUTED.** Turning shifts off leaves quick reversals unchanged or higher (yaw 1.52 to 1.75/s). Shifts carry the large SD and the 0.5-1 Hz power, not the quick reversals.
- **H1c, eye counter-rotation mirrors head wobble into visible eye darting: PARTIAL.**
  - The mechanism is confirmed: K=0 halves eye quick reversals (0.32 to 0.17/s) and removes all non-saccade ones (0.155 to 0.000/s).
  - Visible darting is not supported. The mirrored amplitude is about 0.1 deg-eq (0.31 × 0.36 deg ÷ 30 × 20, my arithmetic), and the eye's >5 Hz power is unchanged because saccades dominate it.
- **H1d, unfiltered face OU produces visible mouth/lid flicker: PARTIAL.**
  - Confirmed as measurable high-frequency roughness. The 0.3 s low-pass removes about 99.6% of mouthForm's >5 Hz power and cuts reversals from 11.8 to 0.94/s.
  - Its amplitude is small: about 0.28% of range RMS above 5 Hz for the mouth and 0.4% for the lid. Visibility is unproven.
  - The lid is `1 - 0.04|q|`, so the absolute value adds a kink at each zero crossing of `q`.
  - No gate covers face metrics.

Gate: A passes on all three seeds. B, G, J and K fail low, C fails high, and F is marginal (seed 2 fails low). D, E, H and I leave the head unchanged and pass. Any change that reduces head wobble enough to cut reversals also fails the jitter gate, so the gate and the smoothing goal conflict.

## EXPAND
- LEAD: Re-tune the gate or add a reversal-rate metric - WHY: every smoothing arm that lowers quick reversals (G, J, K) drops jitter to 5e-6 to 7e-6, below the band floor of 1.47e-5. - ANGLE: add a second gate metric (quick-reversal rate at ≥0.25 deg, or ≥1 deg), or separate the 5-15 Hz wobble from the 0.5-4 Hz one.
- LEAD: Map the head-driven physics parameters to rig parts - WHY: the 50-75% cut in small reversals on Param12, x2 and Param40 may be hair shimmer. - ANGLE: read the physics3.json inputs and outputs for those ids, then check the pixel displacement of the matching meshes with deformation on.
- LEAD: Compare against the human recording's reversal rate - WHY: no arm tells us what rate looks natural. - ANGLE: compute the same hysteresis quick-reversal metric on the recordings in `reference-stats`.
- DEAD END: Face OU, the body follower and eye K=0 do not move the head metrics or the gate, so none of them can fix head jitter. Removing posture shifts raises jitter to 1.7e-4, so shifts are not a source of it.
