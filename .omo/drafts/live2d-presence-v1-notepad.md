# Ultrawork Notepad - Live2D presence first iteration
Started: 2026-10-16

## Scope and tier
Planning only. LIGHT: this session investigates and writes plan artifacts, not runtime code.
The implementation is likely HEAVY because it adds a motion mechanism.
The user's first-iteration boundary is explicit and overrides broader ideal-state expansion.

## Skills
- ulw-plan: requested explore-first, decision-complete planning workflow and plan review.
- bun-1-4: resident JavaScript discovery and short command execution.
- simple-english: plan prose and acceptance instructions.
- git-master: plan-artifact commit authorized by the user's ultrawork directive.
- Other runtime and visual-QA skills belong to the downstream executor unless this session runs their workflows.

## Plan (exhaustively detailed)
1. Preserve prior recording and rig evidence, inspect current motion ownership, settings, tests, and workspace changes.
2. Run independent read-only advisory lanes for renderer integration, architectural scope, and motion algorithm design.
3. Verify advisory claims against source and identify only owner decisions that affect the first iteration.
4. Record ideal state, gap list, component topology, defaults, test strategy, and exact downstream QA approach.
5. Present the approval brief and obtain explicit approval for plan creation, not execution.
6. Scaffold one plan, complete its contracts, tasks, dependency matrix, tests, QA scenarios, and exclusions.
7. Run structural verification and required plan review, resolving criterion-cited blockers.
8. Self-review the artifact scope, commit only this session's plan artifacts, record evidence, and deliver.

## Delegation topology
- Lead: source verification, owner decisions, scope control, final synthesis, structural verification, and artifact commit.
- explore lane: renderer and settings ownership plus existing tests; read-only, independent of design advisories.
- architect advisory: smallest boundaries and coexistence policy; read-only, no implementation.
- ultrabrain advisory: temporal behavior and channel composition contracts; read-only, no implementation.
- plan-consultant and plan-reviewer: only after the plan artifact opens the workflow gate.
All initial lanes run in parallel. No team is needed because none edits shared files.

## Success criteria + QA scenarios
SC1: Ground the plan in current files, LSP evidence, both rigs, and prior recording findings. Record approval before final plan generation.
SC2: `.omo/plans/live2d-presence-v1.md` is decision-complete and passes a Bun Markdown-structure check plus required native plan review.
The structural check accepts only column-zero numbered task rows in Todos and F-numbered rows in Final verification wave.
Every implementation task must include its executor category, references, acceptance, concrete QA invocation, evidence path, and commit grouping.
No runtime or model files change. No private model or recording assets are uploaded or committed.
Final QA is artifact inspection, not a claim that unimplemented motion has passed visual QA.

## Now
Ground current motion ownership and collect independent design advice.

## Todo
- Inspect renderer integration, driver settings, tests, and model-physics contracts.
- Collect architecture and algorithm advisory results.
- Verify claims and resolve owner decisions.
- Obtain approach approval.
- Write and structurally verify the complete plan.
- Run required review and resolve blockers.
- Commit only scoped plan artifacts and deliver.

## Findings
- User wants first-iteration aliveness, focused on body/head and eyes.
- Existing wiggle and cursor follow remain useful, not deprecated by assumption.
- Recordings are illustrative, not a training/replay requirement.
- Prior evidence is in memory `reference/projects/dtuber-motion-recordings.md` and `dtuber-live2d-rigs.md`.
- Current worktree has many unrelated edits. Preserve all of them, including untracked `.omo/` artifacts.
- Initial git history query for Live2D packages returned only f3e6a24. No broader history conclusion is justified.
- LSP confirms motion-manager.ts has pre/post/final plugin stages and separate manual, blink, expression, breath, and lipsync plugins.
- No product implementation is authorized by this planning request.

## Learnings
- Do not mistake physics outputs for independent performance inputs.
- Do not replace the user's modest first iteration with a learned animation platform.
- Parameter statistics alone cannot prove perceived aliveness.
- The prior recordings have no video and do not establish visual acceptance.

## Grounding update
- Registered goal: one reviewed first-iteration plan, no implementation.
- Intent CLEAR, review_required true. Cold-start question stance: one-by-one, with user veto.
- Canonical draft generated through `buildDraft` and apply_patch.
- Scaffold invocation: `bun <ulw-plan>/scripts/scaffold-plan.mjs live2d-presence-v1 --clear --draft-only --review-required`, exit 0, existing draft preserved.
- Read-only explore receipt: presence-surface / st_01a14287.
- Read-only algorithm receipt: presence-algorithm / st_01a14288.
- Architect dispatch failed: no available model for architect, attempted anthropic/claude-fable-5-1.
- User confirmed architect providers are disconnected. Lead takes architecture analysis. No provider changes.
- `file:///` dynamic import failed in this eval runtime. Absolute module path import succeeded.
- Host apply_patch adapter requires `input`, not `patchText`. The corrected call succeeded.
- `packages/model-driver-magic-live2d/AGENTS.md` does not exist. Root guidance applies there.
- `live2d.ts:4-12`: current driver choices are magic/universal, default universal, cursor/idle/idle-eye flags default true.
- `Live2D.vue:112-120`: cursor source clears after 1000 ms without new prop updates.
- `Live2D.vue:163-172`: cursor focus and idle settings are gated to universal mode.
- `Model.vue:454-476`: beat/idle pre plugins, idle focus post plugin, expressions/blink/light/manual/lipsync/breath final plugins.
- Installed `pixi-live2d-display/dist/cubism4.es.js:5416-5436`: SDK focus and physics execute after all AIRI motion-manager plugins.
- Installed SDK `:5438-5444`: focus adds eye X/Y, head X/Y/Z, and body X together.
- `Model.vue:386`: SDK breath is disabled.
- `motion-manager.ts:711-734`: manual controller owns a complete pose including mouth and eye closure, not a head/eye-only interface.
- `model-driver-magic-live2d/src/driver.ts:53-151`: MAGIC owns a separate generation lifecycle and applies through its target.
- Design implication: preserve MAGIC and manual ownership. Do not add presence by sending a zero-filled full manual pose.
- Design implication: a final motion plugin alone cannot prevent the later SDK focus from adding duplicate head/eye motion.

## Now
Verify narrow integration contracts and collect the two running advisory results.

## Todo
- Finish current renderer/settings/test grounding.
- Integrate completed advisory results and choose minimal implementation boundaries.
- Resolve the user-facing mode-selection decision and confirm test strategy.
- Obtain approach approval before the final plan.
- Write, verify, review, and commit the one scoped plan.

## Grounding completed
- Grounding task marked done after source verification and explorer completion.
- Explorer st_01a14287 completed. Its final-plugin suggestion was checked against the installed SDK and is incomplete without focus arbitration.
- `Stage.vue:105-142`: MAGIC stops for pause, another renderer, or exclusive manual ownership.
- `stage-ui/.../view-target.ts:26-40`: existing gaze compensation subtracts normalized head movement from the view target.
- Shared model settings are under `/settings/models` and expose Universal/MAGIC, cursor, idle eyes, blink, and idle-motion selection.
- `Model.vue:900-906`: scene focus calls the SDK only when eyeTracking is enabled.
- Installed SDK FocusController has normalized targetX/targetY and current x/y. Coordinate conversion must reuse existing scene geometry.
- Relevant regression files read: motion-manager.test.ts, live2d.test.ts. Existing defaults are Universal and enabled cursor/blink.
- No regression tests ran during planning. Existing tests establish downstream contracts, not new motion acceptance.
- Sent question `motion_mode_policy`, nonblocking. Recommended opt-in Natural mode plus optional cursor attention and preserved old modes.
- Algorithm adviser remains pending. No second discovery wave is needed for already-answered integration questions.

## Now
Await the mode-policy answer and algorithm advisory, then verify the recommendation and present the approval brief.

## Todo
- Integrate algorithm advisory and record the mode-policy decision.
- Confirm tests-after plus deterministic and rendered acceptance in the brief.
- Obtain explicit plan-creation approval.
- Complete, structurally verify, review, and commit the plan.

## Owner decision received
- User answered `motion_mode_policy`: Natural mode + cursor (Recommended).
- Resolved policy: opt-in Natural mode with optional cursor attention. Universal and MAGIC remain selectable.
- No automatic wiggle switching in this iteration.
- This answer resolves the mode fork. It is not the post-brief approval gate.
- Saved the decision in persistent project memory and the draft.

## Now
Integrate the pending algorithm advisory and present the bounded approach for approval.

## Acceptance-surface verification
- Verified existing shared settings browser test at `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.browser.test.ts`.
- That test covers remote expression settings, not live model movement. It is regression coverage, not aliveness evidence.
- `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.browser.test.ts:303` checks view-control UI, not rendered motion quality.
- Guessed `apps/stage-tamagotchi/test/setup/browser.ts` does not exist.
- Actual setup is declared by `apps/stage-tamagotchi/vitest.config.ts:69`: `src/test/setup-live2d.browser.ts`.
- Electron Vitest browser config loads the shipped Cubism SDK through DownloadLive2DSDK.
- Desktop computer tool discovery succeeded. Future real-surface QA must use OS screenshots/actions, not substitute UI unit tests.
- No application, browser, or desktop session was started during this planning work.
- One algorithm-adviser midpoint peek confirmed it is working on the mechanism and invariants. Do not poll it again.

## Advisory integration completed
- Algorithm adviser st_01a14288 completed. No edits or persistent QA resources reported.
- Proposed one intermittent posture controller, exact critically damped followers, shared posture targets, retained fixation, and optional cursor bias.
- Verified public SDK updateFocus declaration at installed types/index.d.ts:4685.
- Lead numerical probe: one 1-second step versus sixty 1/60-second steps differed by 5.551115123125783e-17.
- Lead bounds probe: targets and initial follower states in {-1,0,1}, time steps {0,0.001,0.1,1,20}, tau0.17 all remained bounded.
- PASS for those narrow mathematical checks. No claim that unimplemented motion looks natural.
- Scope remains opt-in Natural plus cursor, preserved Universal/MAGIC, head/body/eye only.
- Component topology: generator, renderer ownership, user controls, and actual moving-model acceptance.
- Test strategy proposed in approval brief: tests-after with deterministic time/randomness and real rendered QA.
- All advisory lanes are terminal: explore complete, algorithm complete, architect unavailable and handled by lead.
- Draft gate changed to awaiting-approval. Do not create final plan before the answer.

## Now
Present the approach brief and await explicit approval for final plan creation.

## Todo
- Obtain approval.
- Generate and complete the plan with exact contracts and QA scenarios.
- Run structural verification and plan review.
- Commit the scoped artifacts and deliver.

## Approval received
- User answered "Approve (Recommended)" to the bounded approach brief.
- Approval authorizes final plan creation, gap analysis, and plan review. It does not authorize implementation.
- Test strategy and scope from the brief are accepted.

## Now
Generate the canonical plan skeleton and complete its implementation contracts.

## Todo
- Write the complete plan and obtain mandatory plan-consultant gap analysis.
- Structurally verify the plan.
- Run native plan-reviewer and resolve eligible blockers.
- Commit only scoped planning artifacts and deliver.

## Plan writing and gap-analysis receipt
- Canonical plan skeleton created after approval through buildPlanSkeleton and apply_patch.
- Required scaffold command without --draft-only returned exit 0 and preserved both artifacts.
- Plan-consultant st_01a1429d completed. No owner question is required.
- Accepted: explicit wrapper semantics, reset-state coverage, shared web functionality, real rig physics comparison, and no Stage.vue edits by default.
- Accepted: preserve the existing idle-disable blink path unless Natural introduces a demonstrated regression.
- Rejected consultant beat-feedback claim: SDK saveParameters precedes updateFocus and loadParameters restores that snapshot after drawing.
- Natural must not write its pose into the saved snapshot. Added a two-frame test to prove no feedback/accumulation.
- Rejected automatic beat interruption: it conflicts with the approved no-automatic-wiggle policy. Natural masks beat head output while selected.
- Rejected blanket prohibition on visibility handling and elapsed-time invariance. The approved lifecycle contract needs an active clock and one disposed visibility listener.
- Rejected a required user perceptual test. The execution lead must inspect real moving evidence and report perceptual limits honestly.
- New source finding: SDK model.focus converts cursor position into a unit-circle direction, not distance-preserving normalized coordinates.
- Updated Natural cursor mapping to reuse toModelPosition and existing eye-offset geometry, then clamp local normalized XY directly.
- Universal keeps its old focus path unchanged. Natural now maps a centered cursor to zero.
- Existing stage-ui-live2d README does not exist. The plan creates the root-required structured README instead of claiming to update it.
- FFmpeg and ffprobe are available through WinGet links on this workstation.
- Verified APP_USER_DATA_PATH and APP_REMOTE_DEBUG_PORT for isolated desktop QA.
- Generated plan has five implementation tasks and four final-verification rows.
- One discovery cell failed because tool_schema is a prelude helper, not tool.tool_schema. Corrected call returned the computer tool contract.

## Now
Read and structurally check the completed plan before the native plan-reviewer.

## Todo
- Verify all task rows, categories, headings, references, and evidence contracts.
- Run native plan-reviewer against the complete plan and resolve eligible blockers.
- Commit only the reviewed plan and its planning records.
- Deliver the plan path, review result, scope summary, and commit receipt.

## Structural verification PASS
- Read all 584 initial plan lines, then checked the updated complete plan after resolving self-review gaps.
- Corrected output contract to return fixation metadata, so handoff compensation does not reconstruct a clamped value.
- Corrected desktop clip QA: supplied manifests register no clips. Explicit clip priority is tested in the SDK-order integration fixture.
- Final structure: five implementation tasks, four final checks, all expected headings in canonical order.
- PASS: column-zero task grammar, section placement, executor categories, references, evidence, commit fields, and no unfilled template fields.
- `git diff --check --` for the three planning paths returned exit 0. These files remain untracked until scoped staging.
- Plan SHA256 for review round 1: bc7f707d4d2e5f983775a8425ebe7764dd3d9c82f42f7f0ea6c25b3dd4d639b0.
- Review state initialized as launching, round live2d-presence-v1-20261016-r1.

## Now
Run the native plan-reviewer against the complete bound plan.

## Todo
- Integrate the review verdict and resolve eligible blockers.
- Stage and commit only the scoped planning artifacts.
- Deliver the reviewed plan and evidence.

## Review receipt
- Native plan-reviewer launched against `.omo/plans/live2d-presence-v1.md`.
- Receipt: st_01a142a9.
- Round: live2d-presence-v1-20261016-r1.
- Bound plan hash: bc7f707d4d2e5f983775a8425ebe7764dd3d9c82f42f7f0ea6c25b3dd4d639b0.
- Draft state is in_flight. Do not change the plan or launch another reviewer while this receipt is active.

## Commit preparation
- `git log --oneline -20` returned the available baseline commit f3e6a24 with Conventional Commit style.
- `git log -5 --` the three scoped planning paths returned no history.
- Current branch is main. No branch rewrite, push, or merge is planned.
- `git diff --cached --stat` is empty before staging. Preserve any later user-staged files.
- Proposed documentation commit: `docs(plan): define first-iteration Live2D natural motion`.
- Commit only the final plan, its draft/review receipt, and this notepad after review approval.
- No live application, browser, desktop, capture process, or temporary model asset was created during planning.
- Native plan-reviewer st_01a142a9 is the only pending child.

## Now
Await the native review verdict. The plan remains frozen at its bound hash.

## Review PASS
- Native plan-reviewer st_01a142a9 returned OKAY with no blocking issues.
- Verified receipt and round identity against the persisted draft.
- Re-read live plan after completion. SHA256 remains bc7f707d4d2e5f983775a8425ebe7764dd3d9c82f42f7f0ea6c25b3dd4d639b0.
- Reviewer verified all cited implementation/test paths, SDK claims, desktop setup, local rig paths, and IS-to-QA coverage.
- No plan modification or second review is required.

## Self-review and cleanup
- LIGHT tier held: this session changed planning Markdown only and executed read-only discovery plus mathematical probes.
- The final plan was read in full and passed structural checks before review.
- No runtime implementation, model edits, dependency changes, or private asset uploads occurred.
- All children are terminal: explorer and algorithm adviser completed, consultant completed, reviewer approved, architect unavailable and handled by lead.
- No QA application, browser, desktop session, capture, port, or temporary model path was created in this planning run.
- Existing user changes remain outside the scoped artifact commit.
- The plan's code tests and visual scenarios are future execution requirements, not claims of completed runtime QA.

## Now
Stage only the three planning artifacts, check the staged scope and whitespace, then create the authorized documentation commit.

## Todo
- Commit `.omo/plans/live2d-presence-v1.md`, `.omo/drafts/live2d-presence-v1.md`, and this notepad.
- Verify the commit receipt and deliver the plan.
- The commit hash is recorded in the final response and persistent memory, avoiding a self-referential commit in this notepad.

## Staged whitespace failure and correction
- Staged scope contained exactly the three intended Markdown files.
- `git diff --cached --check` returned exit 2: new blank line at EOF in draft line 158 and plan line 590.
- The earlier unstaged diff check did not inspect untracked file content. Do not treat it as equivalent to the staged check.
- Removed the two generated trailing blank lines through apply_patch.
- Confirmed correctedPlan.trimEnd() equals the approved plan's trimEnd(): no semantic change.
- Corrected plan SHA256: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb.
- Structural evidence remains valid because the only change is trailing whitespace.
- Added the fresh-review task and renewed the review binding instead of reusing the stale hash.

## Now
Obtain the review receipt for the whitespace-corrected plan, then rerun the staged whitespace check.

## Todo
- Complete review round 2.
- Restage the three artifacts and require staged diff check exit 0.
- Commit and deliver.

## Corrected-artifact review receipt
- Round 2 reviewer: st_01a142ae.
- Bound hash: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb.
- Plan is frozen. The first review's approved design is unchanged.

## Final approval and handoff
- Round 2 reviewer st_01a142ae returned OKAY with no blockers.
- Parent verified receipt, round, and unchanged final SHA256: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb.
- Corrected staged whitespace check returned exit 0.
- Both plan criteria pass: source-grounded approved approach, complete structurally valid plan, and native reviewer approval.
- All advisory/review children are terminal. No QA resource requires teardown.
- No code, models, recordings, or runtime dependencies changed.
- Scope remains five implementation tasks and four final checks for a separate execution session.
- Commit command is scoped to these three planning files and carries the plan footer.
- Final command receipts and commit hash are retained in the thread and persistent memory.

## Now
Final handoff only. Do not reopen planning or begin implementation.

## Todo
No design, verification, review, or cleanup work remains. Deliver the scoped commit receipt after the final commit command succeeds.
