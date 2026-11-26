# Live2D rig animations: a rig's own loops are catalog entries

Date: 2026-11-26
Status: accepted. The owner asked on 2026-11-25 for a rig's own loops to play in idle and delegated the design; an agent made it. How the loops look in play is not reviewed.

## Context

The owner reported that Live2D idle motion is uninteresting, most of all on the Bear Pajama rig. That rig ships two loops its author drew, eating and sleeping, as motion files that its `.vtube.json` binds to `TriggerAnimation` hotkeys. Nothing in the app could play them unasked: under Natural no idle motion group plays, and the catalog was built from expression files only.

The [idle agency ADR](2026-11-12-idle-agency.md) rejected "imported motion files for Live2D" because motion groups differ per rig and most rigs ship none for idle. That holds for a rig's motion groups. It does not hold for a motion file that the rig's author named with a hotkey: the hotkey says what the loop is and that it is meant to be switched on and off.

The first plan was a new idle errand, `idle-clip` for Live2D, as MMD has. The expression catalog already carries everything such an errand needs: the user's permission (`idleUse`), the timing (`pastime` errands, sleep entries, occasions, moments), a switch in the panel, pick-one groups, and tag suggestions.

## Decision

1. **A hotkey-named motion file is a catalog entry.** Each motion file that the `.vtube.json` binds to a `TriggerAnimation` hotkey, and that the loaded model can play, gets an entry with the id `animation:<motion file>`, the hotkey's name as its label, kind `prop`, and the props area. A motion file without such a hotkey gets none.
2. **The scene loops the file while the entry shows.** The entry has no parameters, so the composer ignores it, as it ignores a stage item. The expression store names the animation that shows (`animationTarget`), and the scene loops that motion file under every driver, whichever motion group the file is in. A motion that replaces the loop, such as an ACT motion, plays, and the loop resumes when it ends.
3. **Ending it returns her.** Switching the entry off fades the motion out over the file's own fade-out time. The scene writes the pre-loop values of the motion's parameters back before each motion update until the fade has ended, so she ends where she was and not on the loop's last pose. When the catalog switches from one animation to another, the first fades out before the second starts, because starting a motion drops every other motion on the frame.
4. **One animation at a time.** A rig's animation entries share one pick-one group.
5. **Nothing is allowed by default.** A new entry is not exposed to the LLM, has no `idleUse`, and has no moments. The user's edits are ordinary overrides, so the entry becomes a pastime or a sleep entry, takes occasions and moments, joins the resting look, and appears in "Suggest tags" exactly as an expression entry does.
6. **No new errand and no new setting.** The `pastime` errand and the sleep entries of the idle agency ADR time the loops.

## Consequences

- On Bear Pajama the panel shows two new entries, `eat ct` and `sleep`. Checked in the running app: the eat loop plays for as long as its switch is on, across more than one loop length; after each loop ends, the probed parameters are back at their values from before it; and a tag stored with `update-entry` is kept.
- She uses a loop on her own only after the user allows it, by hand or by applying a tag suggestion. No tag is written at import: the idle agency ADR rejected tagging at setup, because a wrong pastime stays on for minutes with nobody asking.
- A loop is a clip to Natural: posture keeps the clip residual and face writes skip the parameters the motion animates ([Body ownership](../context/body-ownership.md)).
- A rig without a `.vtube.json`, or without `TriggerAnimation` hotkeys, gets no entries and behaves as before.
- This reverses the idle agency ADR's rejected alternative for hotkey-named motion files only.

Not covered:

- Part opacities that a motion file animates are not returned when the loop ends.
- A motion that plays once, such as an ACT motion, still leaves its last pose on her when it ends, as before this decision. Checked in the running app: a one-shot motion that interrupted the eat loop left its closed eyes and its bubble on her while the loop resumed. Only a rig animation returns its parameters.
- A hotkey's other fields (`StopsOnLastFrame`, fade times, `IsActive`) are not read; every animation loops.
- Two animations cannot show together.
- The tag suggestion request sends an animation's label and kind, not its motion file name.

## Alternatives

- **A Live2D `idle-clip` errand.** It needs its own pacing, its own permission list, its own panel, and its own answer path, for a loop that behaves like a prop she picks up. It also gives the loop no switch for the user and no place in the sleep entries.
- **Every motion file as an entry.** Motion groups hold touch reactions, one-shots, and idle variants with machine names. Without a hotkey nothing says which are loops or what they show.
- **Play the loop through the idle motion group.** Natural handles idle frames itself and the SDK motion update does not run on them, so the idle group does not play under Natural.
- **Tag `eat` and `sleep` from their labels at import.** Rejected with the idle agency ADR's reasoning above.
- **Stop the loop with `stopAllMotions`.** It ends the motion on the frame, so she snaps out of the pose.
