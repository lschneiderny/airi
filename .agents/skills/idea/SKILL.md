---
name: idea
description: Save an idea, bug, or question to the dTuber Obsidian vault inbox at Z:/Obsidian/dTuber/00 Inbox. Use when the user runs /idea, or asks to note, capture, or remember an idea or issue for later in the vault.
---

# Capture to the vault inbox

The dTuber planning vault is a separate git repository at `Z:/Obsidian/dTuber` (`/z/Obsidian/dTuber` in Bash). Captures go in its `00 Inbox` folder. The vault's `Home.md` documents its layout and statuses.

## Steps

1. Take the capture from the arguments. If there are none, use the idea or problem the user just described in this conversation. Ask only if neither exists.
2. Choose the type:
   - `bug` when something behaves wrongly or feels wrong while using the app.
   - `idea` for everything else, including questions.
3. Choose a short, recognizable title in sentence case, such as `Petting rocks too fast`. Use it as the filename. If a note with that name exists, append ` 2`, ` 3`, and so on.
4. Write the note with the matching template's shape from `Z:/Obsidian/dTuber/Templates/Idea.md` or `Bug.md`. Replace the QuickAdd tokens: `{{TITLE}}` with the title, `{{DATE:YYYY-MM-DD}}` with today's date, and each free-text `{{VALUE:...}}` with the user's words. Keep `status: inbox`, and on bugs keep `source: capture` and `fixed_in: ""`. Replace each `js quickadd` block with its result: for bugs, the output of `git describe --always --dirty` in this repository; for the "Captured from" line, nothing.
5. Fill each dropdown token (`{{VALUE:a,b,c|label:...}}`) with one of its listed values:
   - `area`: the area from the table in the vault's `Home.md` that clearly owns the capture, or `unsure`.
   - `severity` and `frequency` on bugs: only what the user said. Otherwise use `annoying` and `not sure`.
6. Keep the user's wording. Do not add priorities, acceptance criteria, causes, or fixes the user did not state.
7. When this conversation already identified relevant code, add a `## Context` section listing repository-relative source paths in backticks. Label guesses as guesses.
8. Link related vault notes with basename wiki links only when they clearly exist. Check with `ls` or a search of the vault first.
9. Do not commit. The vault's obsidian-git plugin commits and pushes every 10 minutes while Obsidian is open.

Reply with the note's path and title in one line.
