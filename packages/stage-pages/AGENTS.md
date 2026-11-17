# Stage Pages

## CONVENTIONS
- The root `src/index.ts` only emits a warning. Import route files through wildcard subpaths, such as `@proj-airi/stage-pages/pages/devtools/polaroid.vue`.

## ANTI-PATTERNS
- Provider previews must not commit runtime provider selections.
