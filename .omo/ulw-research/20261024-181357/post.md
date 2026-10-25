# Corner VTuber motion research: summary

- The idle jitter is Natural's continuous head-noise layer: it causes nearly all small quick reversals (yaw 1.52/s; 0.05/s with it off). It is not inherited from MAGIC.
- Against Luke's own recordings, Natural reverses 3.5-3.85x as often; the human head moves in short steps with brief holds and changes activity level every 20-60 s.
- The liveliness gate enforces the wiggle. The best verified reshaping (slower continuous layer, human-measured holds, slow activity spells at a 120 s time constant) cuts reversals to 1.46x the recordings, passes stillness at the median, and lifts minute-to-minute variety from 0.10-0.17 to 0.45 (human 0.78). It fails only two heuristic gate bands (jitter, speed-peak asymmetry), which should be re-derived together with the motion change.
- More randomness does not add variety. Emotion clips need wind-up, arcs, settle, one side per episode, and 2-3 variants; idle should duck while they play. Exaggeration is a targeted tool, applied after the jitter fix and tested at widget size.
- Decisions for Luke: approve the gate re-baseline, confirm hold stillness by eye within the measured bands, and watch a widget-size A/B of current motion vs the retune.

Full report: report.md (approved by two independent gate reviews). Simulation evidence: .temp/ulw-ablation/.
