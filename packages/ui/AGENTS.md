# UI Primitives

## OVERVIEW
Reusable Vue primitives with minimal business logic. Score: 10, including measured public component exports.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Package exports | `src/index.ts` |
| Form inputs and field wrappers | `src/components/form/` |
| Drawers, scrolling, settings cards | `src/components/layouts/` |
| Buttons, errors, avatars | `src/components/misc/` |
| Transition components | `src/components/animations/` |
| Swipe interaction ownership | `src/components/swipe-actions/` |
| Theme state | `src/composables/use-theme.ts` |
| Source CSS alias workaround | `src/style.css` |

## CONVENTIONS
- Consumers require UnoCSS Attributify Mode and a style reset.
- Component previews live in stage-ui Histoire.
- Keep business state in stage-ui or the owning application.
- Select and combobox components preserve generic Reka acceptable values.
- Swipe lists map logical start/end sides through RTL direction.
- `AnimatedContent` requires `data-state="open"` or `"closed"` and a retained element during the closing animation.
- Use `TransitionBidirectional`, not deprecated `BidirectionalTransition`.
- Follow root design, TypeScript, UnoCSS, and test routing.

## ANTI-PATTERNS
- Swipe components must not own conversation storage, undo, or swipe-to-reply behavior.
- Each swipe item requires a unique stable value within its list.
- A missing or disabled explicit default action must not select another action.
- Commit swipe actions only after committed motion completes.
- Use actual travel, not projected velocity, to arm actions.
- Keep `src/style.css` while documentation aliases this package to source.

## CHECKS
- `pnpm -F @proj-airi/ui typecheck`
- This package exposes source and has no package build or test script.
- Verify interaction changes through the owning application or stage-ui Histoire.
