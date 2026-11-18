---
name: enforce-rules-for-typescript
description: Apply AIRI-specific TypeScript and Vue rules when changing imports, contracts, state ownership, lifecycle, module boundaries, date and time code, or unit conversion and formatting helpers.
---

# AIRI TypeScript and Vue

Follow the root and nested AGENTS.md files. Apply these rules only to the code being changed.
Use Composition API with `script setup lang="ts"` for Vue components.

## Contracts and Imports

- Import types from the package or module that owns the contract. Do not recreate public types locally.
- Keep type sources free of runtime side effects. Separate browser and Node runtime dependencies.
- For import failures, inspect package exports, declarations, and import-time side effects before changing consumers.
- Fix the owning boundary rather than adding leaf-level import workarounds.
- Keep provider JSON Schemas explicit about object types and required fields.

## Names and Documentation

- Use domain names. Let module boundaries provide context instead of repeating transport or product names.
- Comment on non-obvious intent, invariants, units, precedence, ownership, or external constraints.
- Keep implementation comments next to the decision they explain. Do not restate visible code.
- For public contracts, document assumptions, side effects, lifecycle, and guarantees that types cannot express.
- Add examples or diagrams only when they clarify a non-obvious contract. Do not require fixed documentation templates.
- Keep accurate comments when moving code. Remove comments that no longer describe the behavior.
- Use TODO for follow-up work, REVIEW for unresolved concerns, and NOTICE for workarounds under the root rules.

## Reactive State and Fallbacks

- Use a stable empty reference when identity affects a watcher, computed value, or synchronized state projection.
- A fresh empty object or array is valid when the operation intentionally creates an independent value.
- Use nullish defaults when only null and undefined mean missing. Preserve valid false, zero, and empty-string values.
- Make non-obvious fallback precedence explicit. Explain why stale, cached, or compatibility values are valid at their use sites.
- Follow the root policy for compatibility fallbacks.

## Lifecycle and Protocols

- Make the owner of mutable state, listeners, timers, and background work clear.
- Define startup, shutdown, duplicate-start, cancellation, and in-flight request behavior where those concerns apply.
- Keep correlation keys and isolation rules visible at event and response boundaries.
- Make ignored stale or unrelated events understandable through code, names, or a nearby explanation.
- Keep cleanup ordering explicit when it spans owners. Distinguish persisted configuration from transient and cached state.
- For synced Pinia stores, also read the enforce-rules-for-pinia-synced skill.

## Module Boundaries

- Split modules by stable responsibility, not file length or execution order.
- Keep cohesive flows together. Do not create pass-through services, forwarding dependency bags, or test-only exports.
- Put reusable domain contracts in the package that owns them. Runtime entry points compose those boundaries.
- Keep special cases near the affected branch. Prefer early returns when they improve readability.
- Follow the root rules for classes and dependency injection.
- Keep constants near their use. Explain non-obvious limits without adding comments to self-explanatory values.
- Use path-safe arguments and platform-aware paths for process and filesystem work.

## Dates and Times

- Use `date-fns` for parsing, formatting, arithmetic, comparison, relative time, and durations. The root guide names the UTC and time-zone packages.
- Do not write date arithmetic with millisecond constants such as `24 * 60 * 60 * 1000`. Use a `date-fns` function, or import the constant from `date-fns/constants`.
- Do not format dates by hand with `padStart` on `getHours()` or by slicing `toISOString()`.
- Use `UTCDate` for a value defined in UTC, such as a server day bucket, and `TZDate` for a named time zone.
- For text that users see, pass the locale of `packages/i18n` to `date-fns`, or use its `intl*` functions with that locale.
- On the server, store and send instants as ISO 8601 strings in UTC.
- Frame clocks and `performance.now()` trace durations are not date code. The `enforce-rules-for-render-loops` skill covers them.

## Units

- Before writing a unit conversion or formatting helper (bytes, durations, clock time, percentages, pixels, audio samples), search for an existing one by its operation, for example `formatBytes`, `/ 1024`, or `style: 'percent'`.
- A local helper is valid when no shared one exists and one place needs it. When a change adds the second copy, move the helper to a shared module in that change: `packages/stage-shared/src` for logic without Vue that several packages use, otherwise the owning package's `utils` directory.
- Name the unit in each input and output name, for example `sizeBytes` or `durationMs`.
- For locale-aware numbers, use `Intl.NumberFormat` with the `unit`, `percent`, or `compact` options and the locale of `packages/i18n`.
- When two copies format the same value differently, pick one format and report the change.

A readability-only change preserves behavior. For a behavior change, run the relevant checks and regression tests.
