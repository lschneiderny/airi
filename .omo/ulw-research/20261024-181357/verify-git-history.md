# Git history of jitter tuning (lead, 2026-10-24T19:07:12.040Z)

```
== filter retune
4672ec409 2026-10-17 fix(stage-ui-live2d): tune natural motion constants on rendered rigs
cf87462ba 2026-10-17 feat(stage-ui-live2d): layer continuous posture motion for natural mode
== jitter band
== shift median
cc25dae6e 2026-10-17 fix(stage-ui-live2d): heavier posture shift tail
```

Interpretation: cf87462ba (2026-10-17) introduced continuous posture (filters 0.07/0.08/0.10); 4672ec409 (2026-10-17) "tune natural motion constants on rendered rigs" changed them to 0.06/0.07/0.09 (lighter filters to restore HF content per task-14 tuning log); cc25dae6e (2026-10-17) "heavier posture shift tail" (median 0.22->0.18, logSD 0.7->1).

Corroborated independently by member idle-code (second observation group): same SHAs and rationale; breath .001 from 338a38982.
