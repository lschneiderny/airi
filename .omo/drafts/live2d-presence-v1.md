---
slug: live2d-presence-v1
status: complete
intent: clear
review_required: true
plan_path: .omo/plans/live2d-presence-v1.md
plan_sha256: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb
review_round_id: live2d-presence-v1-20261016-r2
review_round_limit: 5
round_status: approved
pending-action: deliver reviewed plan; execution requires a separate user request
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: C:/Users/Luke/.omo/binary-runtime/5.1.30
    target: .omo/plans/live2d-presence-v1.md
    round_id: live2d-presence-v1-20261016-r2
    plan_sha256: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb
    launch_id: live2d-presence-v1-review-launch-r2
    session: st_01a142ae
    result: OKAY - no blocking issues found
approach: Add an opt-in Natural mode with optional cursor attention and preserve existing selectable motion modes without automatic wiggle switching.
---

# Draft: live2d-presence-v1

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected user: Luke uses a Live2D companion in the desktop corner during ordinary work and gaming.
The shared renderer also serves web clients. Existing modes and settings must remain usable there.

| Row | Property | Reason |
| --- | --- | --- |
| IS-1 | The first iteration feels inhabited through restrained head/body and eye movement. | This is the user's primary outcome. |
| IS-2 | Existing wiggle and cursor-follow behavior remains useful and accessible. | The user explicitly retained both. |
| IS-3 | New motion respects both target rigs and existing parameter owners. | Competing writers can destroy the intended movement. |
| IS-4 | Motion pauses, resumes, switches, and unloads without jumps or stale work. | Lifecycle defects break the illusion of presence. |
| IS-5 | Acceptance includes actual moving models at corner size. | Statistics and unit tests cannot prove aliveness. |
| GAP-1 | Existing idle focus samples unrelated targets and uses one coupled SDK focus driver. | It does not establish persistent posture or independently timed gaze. |
| GAP-2 | Current settings expose Universal and MAGIC only. | A new first-iteration option needs an explicit coexistence policy. |
| GAP-3 | SDK focus and physics run after AIRI final plugins. | A naive new final plugin can be overwritten or doubled. |
| GAP-4 | Existing manual ownership writes a complete pose, including mouth and eyelids. | Reusing it for presence introduces unrelated facial writes. |
| GAP-5 | Neither supplied rig has received visual acceptance for a new presence driver. | The recordings are illustrative data only. |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

| Component | Outcome | Status | Evidence |
| --- | --- | --- | --- |
| Motion generation | Restrained temporal posture and gaze, with smooth continuity | active | `animation.ts`, `motion-control-spring.ts` |
| Renderer ownership | One effective owner per head/body/eye channel before physics | active | `Model.vue:454-480`, installed Cubism update loop |
| User controls | Clear coexistence with cursor, Universal, and MAGIC | active | shared `model-settings/live2d.vue:354-450` |
| Acceptance | Real rendered motion plus deterministic regression checks | active | both local model directories, existing package tests |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

- Desktop is the primary acceptance surface. Shared web behavior gets regression coverage.
- Existing TypeScript/Vue/Pixi stack stays. No new runtime dependency, service, model training, or paid API.
- One local avatar at a time is the performance target.
- Recordings inform qualitative timing. They do not become shipped assets or acceptance thresholds.
- Test strategy recommendation: tests-after within each implementation task, using existing Vitest boundaries and real rendered QA.
- Private model assets remain local and uncommitted.

## Findings (cited - path:lines)

- `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:4-12`: Universal/MAGIC selection, existing enabled defaults.
- `packages/stage-ui-live2d/src/components/scenes/Live2D.vue:112-120`: cursor source expires after 1000 ms.
- `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:454-480`: ordered AIRI motion plugins and hooked SDK update.
- Installed `packages/stage-ui-live2d/node_modules/pixi-live2d-display/dist/cubism4.es.js:5416-5444`: focus and physics run after AIRI plugins.
- `packages/stage-ui/src/components/scenes/Stage.vue:105-142`: MAGIC lifecycle already yields to pause and exclusive manual control.
- `packages/stage-ui/src/features/motions/live2d/view-target.ts:26-40`: existing head-compensated gaze formula.
- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:354-450`: shared settings and driver-gated controls.
- `packages/stage-ui-live2d/src/composables/live2d/live2d.test.ts:27-72`: existing default-selection and blink regressions.
- ForBOOTH has separate physics outputs. Bear physics owns standard body-angle outputs. Prior model inspection established this difference.
- Explorer completed as st_01a14287. Its final-plugin insertion suggestion is not sufficient by itself, because the installed SDK adds focus afterward.
- Architect lane unavailable. Lead owns architecture. Algorithm advisory st_01a14288 completed.
- Installed SDK declarations `types/index.d.ts:4685` expose `updateFocus()` publicly.
- Lead independently checked exact-follower partition invariance and convex bounds. Maximum discrepancy was 5.551115123125783e-17.
- Adviser reports broader numerical probes. Those are advisory evidence, not renderer acceptance.

## Decisions (with rationale)

- User selected "Natural mode + cursor": opt-in Natural, optional cursor attention, existing modes preserved, no automatic wiggle switching.
- Do not send a zero-filled complete manual pose for presence. Mouth and expression behavior are outside this first iteration.
- Do not add another physics evaluation pass or write physics outputs as if they were independent tracked inputs.
- Preserve existing MAGIC behavior rather than refactor its training, filter, or profile mechanism.
- Preserve unrelated dirty files. The settings translation file and Stage.vue sit in a dirty workspace and require scoped edits during execution.
- Use one renderer-local intermittent posture controller, not a generic behavior framework.
- Use persistent bounded posture targets with sparse clustered adjustments and exact non-bouncy followers.
- Use one shared posture destination for head and body, with faster head response and slower body response.
- Eyes retain a view-space fixation or shift to a new fixation. Compensate using commanded head orientation.
- Cursor attention changes targets without resetting posture or velocity.
- Compose at a scoped public SDK updateFocus wrapper, before existing physics. Do not add a physics pass.
- Do not route presence through the whole-pose manual store. Existing manual/MAGIC ownership and explicit motions take precedence.
- Pause active time when paused or hidden. Do not replay missed bursts on resume.
- Validate perception on both models at corner size. Numerical metrics are supporting evidence, not a naturalness pass.
- Keep current Universal default. Natural is explicitly opt-in, as the user selected.

## Scope IN

- Head/body posture continuity and eye direction.
- Existing blink behavior retained unless an integration regression requires a scoped fix.
- Cursor coexistence and useful existing movement choices.
- Both target rigs in real rendered acceptance.
- Lifecycle, parameter ownership, settings, and regression verification.

## Scope OUT (Must NOT have)

- Recording replay product features, training pipeline, statistical imitation, or dataset shipping.
- New speech gesture choreography, emotion planning, game-event integrations, or desktop perception.
- Arm/hand choreography, rig editing, model-specific authored clips, or public asset uploads.
- Generic behavior trees, broad plugin frameworks, independent random motion on every parameter, or per-frame LLM calls.
- Replacement of existing MAGIC, unrelated motion bugs, or unrelated workspace cleanup.

## Open questions

- Mode policy is resolved by the user's explicit selection.
- No unresolved product fork remains for the approach. Detailed contracts follow after approval.

## Approval gate
status: approved
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

Brief:
- Add opt-in Natural alongside Universal and MAGIC.
- Scope is head/body posture and eye direction. Preserve existing blink, expressions, speech, and model physics.
- Natural uses persistent rests, small clustered changes, separate response rates, and optional cursor attention.
- No automatic wiggle switching, recording replication, learned generator, game integration, or emotion choreography.
- Use tests-after within each implementation task, then real rendered motion acceptance on both local rigs.
- After approval, write one complete plan, run plan-consultant gap analysis, and run the native plan-reviewer.
- Approval authorizes the plan only. Implementation belongs to a separate ulw-execute request.

User answer: "Approve (Recommended)" through request_user_input on 2026-10-16.
Scope and tests-after strategy approved. Plan review remains required.

## Plan completion and review binding
- Complete plan: `.omo/plans/live2d-presence-v1.md`.
- Five implementation tasks and four final-verification tasks.
- Structural check passed for heading order, column-zero task grammar, task sections, required fields, and filled template fields.
- Full plan read before review. No runtime implementation was performed.
- Round 1 is bound to the SHA256 in frontmatter. Any plan edit invalidates that binding.

## Review receipt
- Reviewer: native plan-reviewer, session st_01a142a9.
- Round: live2d-presence-v1-20261016-r1.
- Verdict: OKAY. No blocking issues found.
- Parent re-read and hashed the live plan after completion. The digest matches the reviewed artifact.
- Reviewer verified source references, SDK order, settings, test paths, local rig paths, and ideal-state coverage.
- Round 1 required no design change.
- Staged whitespace validation subsequently caught a generated trailing blank line.
- The correction changes only trailing whitespace. Round 2 binds the corrected bytes before commit.
- Round 2 reviewer st_01a142ae returned OKAY with no blockers.
- Parent verified the matching round, receipt, and live SHA256 after completion.
- Final approved hash: 694b061bed61fd09db5a3464054d5acd6b41a186e20ca82d28bd25234f0cedeb.
- Planning is complete. Runtime implementation and runtime QA have not started.
