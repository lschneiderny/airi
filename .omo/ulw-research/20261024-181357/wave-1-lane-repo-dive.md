# wave-1-lane-repo-dive.md (journaled 2026-10-24T19:07:12.040Z)

st_01a16f21 [completed] transcript via event-log:
assistant: I read this as a read-only, source-backed deep dive into procedural character motion; I’ll inspect 3–5 relevant upstream implementations and stop when each has SHA-pinned evidence for idle generation, smoothing, variety, and reactions.
tool[error]: bash
tool[error]: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool[error]: bash
tool: bash
tool: bash
tool[error]: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool[error]: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool: bash
tool[error]: bash
tool[error]: bash
tool[error]: bash
tool[error]: bash
tool: bash
tool: bash
assistant: The strongest matches are **Live2D Cubism’s sample integration**, **Shimeji-ee**, **VPet**, and **three-vrm**. They cover layered Live2D motion, activity-state selection, desktop-pet reactions, and gaze targeting. All links below pin the retrieved repository HEAD SHA; line ranges are GitHub permalinks.

## Live2D Cubism Web Samples

[SHA-pinned sample model](https://github.com/Live2D/CubismWebSamples/blob/b1de66b0b1f1cb881d95fb6158622aeb6a2827bd/Samples/TypeScript/Demo/src/lappmodel.ts#L200-L330) initializes eye-blink and breath updaters as separate effects, alongside gaze, physics, and pose. Breath uses five parameter waves: head angles X/Y/Z use amplitudes `15.0`, `8.0`, `10.0` and cycle values `6.5345`, `3.5345`, `5.5345`; body angle X uses `4.0` and `15.5345`; the breath parameter uses offset and amplitude `0.5`, cycle `3.2345`. This is layered procedural movement, not a single idle loop.

[The update and idle-selection path](https://github.com/Live2D/CubismWebSamples/blob/b1de66b0b1f1cb881d95fb6158622aeb6a2827bd/Samples/TypeScript/Demo/src/lappmodel.ts#L430-L458) applies effects every model update using `deltaTimeSeconds`. When the motion manager finishes, the sample selects a random motion from the idle group; the selected idle therefore comes from authored motion files, while breath/blink/gaze are separate layers. Gaze parameters include head/eye and body response mappings in [look setup](https://github.com/Live2D/CubismWebSamples/blob/b1de66b0b1f1cb881d95fb6158622aeb6a2827bd/Samples/TypeScript/Demo/src/lappmodel.ts#L295-L332).

**Smoothing and reactions:** the sample schedules these effects but the retrieved file does not expose their filter constants or `CubismTargetPoint` implementation. Its gaze setup connects `CubismLook` to `_dragManager`, so this file supports a drag-driven look layer, but does not establish cursor-follow smoothing details. The idle selection shown here has no visible cooldown or weighting beyond uniform random choice.

## Shimeji-ee

[Manager](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8f77df23bfb56914834a3e/src/com/group_finity/mascot/Manager.java#L27-L100) advances the mascot on a `40 ms` tick. It uses `System.nanoTime()` for elapsed time, sleeps in `1 ms` increments while waiting, and resets its time baseline if more than two tick intervals late. That gives a roughly 25 Hz behavior update, not a frame-rate-independent smoothing filter.

[Behavior configuration](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8f77df23bfb56914834a3e/conf/CalmBehavior.xml#L8-L22) expresses variety as a state graph with `Frequency` weights and `NextBehavior` transitions: `SitAndFaceMouse` repeats at weight `100`, while `SitAndSpinHead` and `SitWhileDanglingLegs` each have weight `1`. Floor behavior similarly weights `StandUp` at `200`, `SitDown` at `100`, and walking at `200` in [the floor-state section](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8f77df23bfb56914834a3e/conf/CalmBehavior.xml#L41-L60).

[The runtime model](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8b8b8b8b8b8b8b8b8b8b8b8b8b8) is not used; the verified source permalink is [Mascot.java](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8f77df23bfb56914834a3e/src/com/group_finity/mascot/Mascot.java#L225-L270): each tick calls `behavior.next()` and increments a tick counter; mouse press/release are forwarded to the behavior. The sample config includes `ChaseMouse`, with a transition to `SitAndFaceMouse` ([lines 8–14](https://github.com/TigerHix/shimeji-ee/blob/22158a96e338424b7b8f77df23bfb56914834a3e/conf/CalmBehavior.xml#L8-L14)). **Inference:** this is a useful model for authored activity selection and interaction transitions, but its screen-edge, floor, and window-surface behaviors are not directly transferable to a fixed desktop-corner Live2D window. No cooldown is apparent in these inspected config excerpts.

## VPet-Simulator

[Idle scheduling](https://github.com/LorisYounger/VPet/blob/0c2e795b8e81485e448675316ba088d5226d908d/VPet-Simulator.Core/Display/MainLogic.cs#L300-L345) runs from a `15,000 ms` event timer by default. When the pet is idle, it draws from `Math.Max(20, InteractionCycle - CountNomal)`; work state increases that bound to twice the base plus `20`. Outcomes `0–2` try movement, `3–5` idle, `6` a second idle mode, `7` sleep, and `8–10` registered random interactions. This is a coarse, state-aware activity picker rather than continuous procedural motion.

[Idle animation playback](https://github.com/LorisYounger/VPet/blob/0c2e795b8e81485e448675316ba088d5226d908d/VPet-Simulator.Core/Display/MainDisplay.cs#L165-L225) chooses among available idle assets, plays start/loop/end segments, and randomizes the loop count against a configured duration. The two-stage idle mode also varies between continuing and ending through `Function.Rnd.Next(2 + CountNomal)` ([lines 100–145](https://github.com/LorisYounger/VPet/blob/0c2e795b8e81485e448675316ba088d5226d908d/VPet-Simulator.Core/Display/MainDisplay.cs#L100-L145)). Variety is therefore a mix of weighted event opportunities, random asset choice, and randomized loop duration.

[Touch responses](https://github.com/LorisYounger/VPet/blob/0c2e795b8e81485e448675316ba088d5226d908d/VPet-Simulator.Core/Display/MainDisplay.cs#L54-L99) explicitly layer head/body-touch behavior over the current animation, restarting or continuing the touch loop as appropriate. [Window movement and edge handling](https://github.com/LorisYounger/VPet/blob/0c2e795b8e81485e448675316ba088d5226d908d/VPet-Simulator.Core/Display/MainLogic.cs#L346-L390) checks screen bounds and can reposition the window or switch to a side-hide animation. The inspected code uses animation assets and event-driven transitions; it does not reveal a continuous jitter filter or a cooldown for idle activities.

## pixiv/three-vrm

[VRMLookAt](https://github.com/pixiv/three-vrm/blob/3caf7a21ee68f0d5dfa363ab3d577450bbf60136/packages/three-vrm-core/src/lookAt/VRMLookAt.ts#L35-L76) exposes an optional target and `autoUpdate`, enabled by default. Each update computes yaw/pitch toward the target and applies them when dirty ([update](https://github.com/pixiv/three-vrm/blob/3caf7a21ee68f0d5dfa363ab3d577450bbf60136/packages/three-vrm-core/src/lookAt/VRMLookAt.ts#L250-L270)). Angles are derived from target direction and sanitized, then converted to degrees ([lookAt](https://github.com/pixiv/three-vrm/blob/3caf7a21ee68f0d5dfa363ab3d577450bbf60136/packages/three-vrm-core/src/lookAt/VRMLookAt.ts#L208-L248)).

[The bone applier](https://github.com/pixiv/three-vrm/blob/3caf7a21ee68f0d5dfa363ab3d577450bbf60136/packages/three-vrm-core/src/lookAt/VRMLookAtBoneApplier.ts#L91-L124) maps yaw/pitch through separate horizontal-inner, horizontal-outer, vertical-up, and vertical-down range maps before applying eye rotations. This constrains gaze by model-specific ranges; it does **not** smooth target motion itself. The `delta` passed to `update` is explicitly unused, and the inspected look-at files do not provide idle generation or auto-blink, so three-vrm is best treated as a gaze-constraint reference, not a complete idle system.

## EXPAND
- LEAD: Live2D Cubism Web Samples - WHY: demonstrates separate breath/blink/gaze effect layers composited with authored idle motions - ANGLE: inspect the exact framework effect and target-point implementations for their update equations and constants; those files were not located in the retrieved sample tree.
- DEAD END: three-vrm as a standalone procedural-idle reference - WHY: the inspected modules implement target gaze and range mapping, but no idle generator, blink scheduler, or smoothing filter.
