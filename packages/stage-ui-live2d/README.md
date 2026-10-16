# stage-ui-live2d

## Purpose

This package provides AIRI's shared Live2D renderer, model controls, expressions, and persisted settings.

## Usage

Use the shared model settings to select a motion driver.
Universal remains the default and uses model motions, idle eyes, and mouse tracking.
MAGIC retains its dataset-based motion controls.
Select Natural to enable quiet resting poses and coordinated head, body, and eye adjustments.

Natural has its own Cursor attention setting, enabled by default.
It does not change Universal's mouse tracking preference or saved idle animation.
Eye offsets apply when cursor attention is enabled.
Blink, expressions, and speech retain their existing controls.
Resetting Live2D settings restores Universal and enables both cursor preferences.

## When to use

Use this package to render Live2D models in AIRI hosts.
Use Natural for restrained autonomous movement with optional cursor attention.
Natural controls head XYZ, body XYZ, and eye XY before the model's existing physics pass.
Model physics remains authoritative and can replace body commands, so torso movement depends on the rig.

## When not to use

Do not use Natural for recorded motion playback, speech choreography, or independent control of physics outputs.
Use model motions or MAGIC when their existing movement behavior fits the task.
Use a different renderer package for VRM, MMD, or other model formats.
