# Usage performance recording: local recorder, pnpm perf, and qa:bench

Date: 2026-11-14
Status: accepted for the Electron desktop app. The recorder, the `pnpm perf` reader, and `qa:bench` are implemented. Linux numbers come from live sessions and the measurements listed under Validation. macOS and Windows CPU paths are checked by fixtures only. Superseded in part on 2026-11-17: `qa:stage measure --perf-ab` is gone, so `qa:bench` is the frame-time tool, and the stage-web lag sampler left with the web app. Current rules: [qa-tools perf reports](../../../packages/qa-tools/README.md#perf-reports).

## Context

Long desktop sessions left no record of how the app behaved. A stalled frame loop, a pegged core, or a memory climb had no evidence after the fact, and comparing two builds meant rerunning the app by hand.

Several sources already existed, but none answered these questions alone. The IO traces Tamagotchi saves cover one chat or speech turn. The stage-web lag sampler and the MMDFrameMetrics report renderer timings during a session. `qa:stage` drives scripted QA launches. The recorder adds records that outlive a session and line up with the app's own process and window timings. The existing sources stay as they are.

Two measurement problems shaped the design. Host CPU on Linux came from `os.cpus()`, which leaves out `iowait`. That omission overstated the machine's external CPU share by 1.6 to 3 times. The recorder also needed an app CPU figure that it could date to a sample, so it derives CPU from deltas of `cumulativeCPUUsage`. It does not use `percentCPUUsage`, because other callers share that metric's interval.

## Decision

### Owner decisions, 2026-11-14

Luke made these decisions on 2026-11-14, and the implementation follows them:

- Build the recorder first, then the bench.
- Recording is on by default in development builds and has a toggle, **Record performance**, in settings.
- Raw segments are kept for 14 days. Rollup rows are kept forever.
- Incidents are written from a ring buffer. A manual Chromium trace is also available. Traces are gzipped, and the newest 5 are kept.
- The bench runs on demand, not in the verify chain. Its records live in the per-machine state directory.
- The recorder and the bench cover the Electron desktop app only.
- Pure parts are written test first.

### Recording

The recorder runs in the Electron main process and samples the renderer and the child processes. It is on by default in development builds and off in preview and packaged builds. The **Record performance** setting in the settings window turns it on or off. In development, `AIRI_PERF_RECORD=1|0` overrides the setting, and `AIRI_PERF_DIR` names another data directory. Packaged builds ignore both variables. QA launches set `AIRI_PERF_RECORD=0`, so QA sessions stay out of the recordings unless a run asks for them with `--perf-dir`.

The data directory is `perf` under the Electron user data directory. Development builds use `@proj-airi/stage-tamagotchi`, and packaged builds use `ai.moeru.airi`. Each session writes `raw/<sessionId>.<segment>.jsonl`, with segments capped at 64 MiB. `raw/<sessionId>.live` names the recorder's pid while the session runs. The file survives a hard kill. `sessions.jsonl` is append-only and holds one `segment-rollup` row per segment. The rollup runs 30 s after start. Each row's cells split their windows into wall-clock 5-minute buckets, each with its own counts, frame histogram, per-window quartiles, and covered time span. Rows are `v: 2` since buckets; the readers still accept the `v: 1` rows written before, as one bucket spanning the segment.

Raw segments are removed after 14 days, and the raw total is capped at 1 GiB. A segment is pruned only after its rollup, or a `rollup-failed` row, exists in `sessions.jsonl`. Segments also rotate at local midnight. Rollup rows are kept. Incidents are removed after 14 days.

### Stage windows and CPU

Each stage window reports frame and stage timings in fixed bins, `FRAME_BINS_V1` and `STAGE_BINS_V1`. The reducer joins each window to the latest sample within 7.5 s, and to its identity epoch. The first 60 s of a segment, and the 20 s after a model load, resume, renderer reload, or identity change, are excluded from analysis.

An identity epoch is the running code's identity: the git sha, a dirty flag, and a diffHash. The diffHash is a sha256 over the git diff plus the name and blob hash of each untracked file. File contents are hashed and never stored. The branch name is not part of the identity. Packaged builds read build info, which has no dirty flag or diff hash, so their epoch changes only with the sha. In a development build, the identity is read again 2 s after the last stage window reload. A changed reading is confirmed by a second read, so one failed git call cannot start an epoch.

CPU per process comes from `cumulativeCPUUsage` deltas, keyed by pid and creation time. A backwards delta or a missing reading gives `null`.

Machine external CPU on Linux comes from the aggregate `cpu` line of `/proc/stat`, with `iowait` counted as idle. On a live check, the recorder reported 13.72% external CPU against 13.74% from an independent reading. The old `os.cpus()` formula reported 22.84% on the same run, and `iowait` made up 30% of the host time. macOS and Windows keep `os.cpus()`, because the Linux file does not exist there.

Host contention comes from `decideHostContended`, which reads the host's pressure and load signals and treats external CPU at or above 25% as a contention trigger. The recorder does not derive lease contention. `pnpm perf` derives it when it reads the data, and it marks each 5-minute bucket as lease-contended when the cpu-slots lease history shows another worktree holding a lease over that bucket's span. `features` and `compare` drop only the contended buckets and compute each cell's metrics over the kept ones. Marking per segment dropped almost everything on a busy host: segments last a whole dev session, foreign leases were held 62.5% of a 59.8 h history window, and a replay of that history marked 95.7% of 4 h segments and 100% of 8 h segments contended. Buckets are wall-clock aligned, so the buckets of different cells line up. The broker writes a `reap` event when it reclaims a dead holder's lease, and the reader ends that lease there. A holder that died before reap events existed still has no end time, so every bucket after its grant reads `null` until the history rotates. If the app dies mid-session, the next start writes a crash rollup marked `recovered: true`.

### Incidents and traces

Three pure deciders run in the main process: `decideFrameStall`, `decideMemoryGrowth`, and `decidePegged`. `decidePegged` fires only when a process holds at least 90% of one core for 6 samples and sits at least 25 points above its settled baseline. With no baseline, it does not fire. `IncidentBudget` caps written incidents at 6 per rolling hour and 20 per rolling day. A live 400 s MMD session produced 0 incidents.

An incident file is written as soon as its decider fires, with `frameRing: null` and `ringMissing: true`. The main process then pulls the stage window's per-frame ring and rewrites the file once, with the ring attached and `ringMissing: false`. The pull waits up to 3 s. A window that does not answer in time leaves `ringMissing: true`, and the pull is aborted.

A manual trace uses the **Capture Chromium trace (10 s)** action. The trace buffer holds 64 MiB. Each capture is gzipped to `traces/<ISO start>.json.gz`, and the newest 5 are kept. A 10 s capture measured 87 to 192 MB before gzip. One 92 MB capture gzipped to 7.9 MB, a ratio of 11.6 times. That is a single measurement, so the size after gzip will vary.

Traces can contain URLs, so they stay local, and the privacy checks skip them.

### Privacy

Model names reach the recorder only through `sanitizeModelName` (`apps/stage-tamagotchi/src/renderer/libs/perf/window-tags.ts:77`), which reduces a model path to a short label. The record contract does not carry model paths. Readers reject any line that fails `PerfRecordSchema`. The live sentinel canary from the recorder's QA run found 0 hits outside `traces/`.

`containsForbiddenText` flags path-, URL-, and key-like text. The privacy tests use it on fixture lines. Production code does not call it, so it is a test heuristic, not a runtime filter.

### Reading with pnpm perf

`pnpm perf` lives in `packages/qa-tools` next to `qa:report`. That package already reads run output, and the decision keeps root dependencies unchanged. The reader never writes into the perf directories. Its statistics are observational and say so in their output. The reader reports `fps` as frames divided by counted windows times 5 s. `medianFpsLowerBound` takes the upper edge of the median frame bin, so it reports a lower bound. `refreshHz` 0 means unknown.

The comparison rules are explicit. Unpaired comparisons decide only when a side has at least 5 blocks, 3 sessions, and 120 windows. Paired comparisons decide from 8 sessions. Below 8 sessions, paired power is low. For up to 14 sessions, the noise floor is the exact sign-flip floor. Above 14, it uses 50 seeded random sign patterns. Bootstrap intervals under-cover at small sample sizes, and the output notes that.

### Bench

`pnpm qa:display run -- pnpm qa:bench` runs the bench-v1 matrix on Electron only. Each launch takes its own exclusive CPU lease and starts the window stage on a fresh profile. The run appends one `bench-run` record per launch to `bench.jsonl` in the per-machine state directory. `AIRI_PERF_BENCH_DIR` names another directory. The bench runs on demand, not in the verify chain.

`compareBench` refuses runs whose host, build mode, Electron version, scenario, or model differ. It reports a regression or an improvement only when the median difference exceeds 2 sigma, exceeds the metric's practical floor, and at least 4 of 5 new runs agree. Dirty runs are compared but never enter the noise history.

## Consequences

Development sessions leave records by default. Those records show frame stalls, memory growth, and pegged CPU with timestamps, and they cost a small amount of disk. The 14-day raw retention and the 1 GiB cap bound that cost.

Overhead is small, and this instrument cannot resolve it precisely. In the overhead measurement over 14 paired launches (`qa:stage measure --perf-ab`), the pooled median fps delta was -1.82 (95% interval -6.16 to +3.33, sign test p = 0.42). Most of that delta matched the second-launch bias, since the control arm showed -1.38. The renderer sampler costs about 0.03 ms per second. The main process spends about 1.6 ms per 5 s tick. Pooled added app CPU was -0.62% of one core. The baseline arm alone spread 9.8 fps across launches, so the test resolves only about 3 fps in either direction.

Paired statistics stay quiet until enough sessions exist. A reader who wants a verdict on a small set of sessions gets an unpaired result or an explicit `insufficient data` line.

## Alternatives

Always-on recording in packaged builds was not chosen. It would store data on every user's machine by default, and the traces in particular carry URLs. A separate profiler process was not chosen, because the plan needed the app's own stage-window timings. Using `percentCPUUsage` was not chosen, because other callers share that metric's interval.

## Validation

The overhead pairs, the incident and reader checks, and the bench runs are recorded under the perf-tracking evidence directory of the worktree, which is gitignored. The Linux host CPU fix has a live check against an independent reading, given above. The qa-tools perf tests run under `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/perf`.

macOS and Windows behavior is checked by fixtures only.

## Follow-ups

Verify macOS and Windows on live machines. Revisit the 1 GiB raw cap after a few weeks of real sessions. Renderer event timestamps trail model loads by up to about 15 s, which the reader does not correct.
