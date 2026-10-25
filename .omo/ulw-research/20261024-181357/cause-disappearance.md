# Cause disappearance

| cause | expected truth | previous observation | last_seen | disconfirming | replacement | status | gone |
|---|---|---|---|---|---|---|---|
| K1 | I1 no visible quick reversals | head yaw quick reversals 1.52/s >=0.25 deg (baseline) | 2026-10-24T20:48:04.036Z | OU off -> 0.05/s; filter 0.25 s -> 0.68/s; tau x3 -> 0.78/s | none (continuous OU is the cause) | violation present at HEAD; disappears in arms B/G/J/K, all of which fail the gate jitter floor | no (not fixed in code) |
| K1b | I1 vs human reference | Natural yaw quick 1.52/s vs recordings 0.44/s | 2026-10-24T23:04:52.398Z | closest existing arm: filter .25 s (0.68/s) but it fails jitter | human target measured | violation present; wave-2 tests slow-wander arms | no |
