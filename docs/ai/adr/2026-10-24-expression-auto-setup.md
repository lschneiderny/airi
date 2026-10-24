# Automatic expression setup

Date: 2026-10-24
Status: accepted

## Context

Luke's QA found that setting up expressions required too much manual work before the model could react. Reviewing every entry, confirming it, selecting emotion mappings, and exposing entries to the LLM made a new model profile feel unfinished.

## Decision and scope

The expression catalog uses an English and Chinese label lexicon to suggest kinds and emotion mappings during setup. The lexicon maps face and effect entries only, skips negated labels, assigns mapping weight 1, and sets the minimum band to `clear` for faces and `strong` for effects.

There is no confirmation gate. A fresh profile starts with the Expression system on. Eligibility is determined by kind: face and effect entries may be selected automatically, while face, effect, and prop entries may be exposed to the LLM. The default LLM access follows kind.

The settings view presents a relevance view for reviewing entries, groups related expressions as picker rows, and allows manual inversion of how an expression is displayed. `set-active` is part of the settings command contract. Users can review and correct lexicon suggestions, including mappings that don't match a model.

## Overrides

- The fresh-profile default in `docs/ai/adr/2026-10-18-expression-performance.md` at line 194 is superseded.
- The confirmation and initial catalog state at line 204 are superseded.
- The eligibility rules at lines 220-221 are superseded.
- The settings command list at line 237 is superseded.

Each superseded location points back to this ADR.

## Consequences

New profiles can use automatic expression selection without first confirming every entry. The lexicon may assign wrong mappings, and those suggestions are accepted unless a user reviews and changes them. Effect mappings require the strong band, so effects appear less often than face expressions.

Kind-based eligibility keeps outfits and system expressions out of LLM access. Props may be exposed to the LLM but are not automatically selected.

## Non-goals

Group creation remains a separate UX pass.

## Limitations

The lexicon and group naming cover English and Chinese labels only. Japanese VTS labels are common.
