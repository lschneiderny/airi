# UI Primitives

## CONVENTIONS
- Keep business state in stage-ui or the owning application.
- Select and combobox components preserve generic Reka acceptable values.
- `AnimatedContent` requires `data-state="open"` or `"closed"` and a retained element during the closing animation.

## ANTI-PATTERNS
- A missing or disabled explicit default action must not select another action.
- Commit swipe actions only after committed motion completes.
- Use actual travel, not projected velocity, to arm actions.

## CHECKS
- Verify interaction changes through the owning application or stage-ui Histoire.
