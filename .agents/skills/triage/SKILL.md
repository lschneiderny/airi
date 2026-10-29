---
name: triage
description: Review the dTuber Obsidian vault inbox at Z:/Obsidian/dTuber/00 Inbox, propose an outcome for each note, and apply the approved outcomes. Use when the user runs /triage, or asks to sort, review, file, or clean up vault inbox captures.
---

# Triage the vault inbox

The dTuber planning vault is a separate git repository at `Z:/Obsidian/dTuber` (`/z/Obsidian/dTuber` in Bash). Its `Home.md` documents the folders and the status lifecycle: `inbox`, `next`, `doing`, `done`, `dropped`.

## 1. Read

Read every note in `00 Inbox` with `status: inbox`. For each one, look for an owning note elsewhere in the vault: a design note in `02 Design`, a feature in `03 Development/Features`, a bug in `04 Testing/Bugs`, or a question in `01 Product/Open Questions.md`.

When a note asks how existing code behaves, or whether something already exists, check this repository and answer it with source paths. Read the relevant `AGENTS.md` first.

## 2. Propose

Show one table with every note before changing anything:

| Note | Proposed outcome | Destination | Reason |
| --- | --- | --- | --- |

Use one of these outcomes:

- **Keep:** leave it in the inbox. Optionally add a clarifying question.
- **Answer:** add the answer from the code under `## Answer`, then keep it, merge it, or drop it.
- **Merge:** append the useful content to the owning note as a short bullet or paragraph with a link back. Archive the capture.
- **Promote to bug:** move it to `04 Testing/Bugs` and keep `type: bug`.
- **Promote to feature:** move it to `03 Development/Features`, set `type: feature`, and restructure it with `Templates/Feature.md`. Keep the original wording under `## Original capture`.
- **Pick:** set `status: next`. Only propose this when the user has asked for work to pick.
- **Drop:** set `status: dropped` and add a one-line reason.

Group related captures when they describe the same behavior. Do not invent requirements, priorities, or acceptance criteria. Mark guesses as guesses.

## 3. Apply

Apply only the outcomes the user approves, including edits they make to the table.

- When moving a note, keep its filename so wiki links still resolve.
- Archive merged captures to `06 Archive/Captures` with `status: done` and a `Merged into [[Note]]` line.
- Never delete the only copy of a capture's content.
- Do not commit. The vault's obsidian-git plugin commits and pushes every 10 minutes while Obsidian is open.

Finish with a short list of what moved where.
