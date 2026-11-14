# UI Primitives

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
- This package exposes source and has no package build or test script.
- Verify interaction changes through the owning application or stage-ui Histoire.
