# live2d-presence-v3: stub carried over from v2 F4 (2026-10-18)

v2's F4 audit (.omo/evidence/live2d-presence-v2-F4-fidelity-final.md) proposed five follow-ups. Two are in v2 as todos 24 and 25. Luke did not answer the scope question within 30 minutes, so the orchestrator took the recommended option and moved the three research-sized items here. Each one repeats work that already hit v2's stop rule.

## Candidate todos
1. **Duration-comparable jitter scoring and controller acceptance (IS-9).** Allow controller HF smoothing alongside justified normalization, and re-extract both references through the same scorer. Keep the desk seeds green, and get at least 9/10 predeclared product 600 s seeds passing jitter. Prove resistance to low-frequency dilution without widening bands after the fact. Prior attempt: v2 todo 20 ([~]; patch at .omo/evidence/live2d-presence-v2/task-20-attempt1.patch).
2. **A dedicated tail gate (IS-9).** It must reject the two-point {0.15, 0.45} and uniform [0.05, 0.6] shift alternatives through a reference-justified tail measure, independent of jitter. Candidate: a peak-skewness floor around 1.3 (the controller measures 1.61-1.75, no-tail alternatives 1.05 or less). Prior: v2 todos 16 and 21.
3. **Quantitative Universal parity under controlled randomness (IS-11).** Log a procedure before collecting data that uses controlled or recorded legacy random inputs, including the adapter constructor's extra draw. Show rendered SD and stillness parity within 15%, or change the acceptance contract before gathering data. Prior: v2 todo 15 ([~]).
4. **Multi-capture statistical acceptance in general.** Single 600 s captures are noisy judges: Bear still2 was 0.31 and 0.47 on identical code, and jitter ranged from 6e-6 to 7.5e-5. Define capture-count and aggregation rules for every rendered gate.

## Accepted limitations from v2
See the F4 report's "accepted_limitations" and the [~] notes on v2 todos 14, 15 and 20.
