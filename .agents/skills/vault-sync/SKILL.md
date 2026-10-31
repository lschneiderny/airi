---
name: vault-sync
description: Bring the dTuber Obsidian vault at Z:/Obsidian/dTuber up to date with this repository after new commits. Proposes new bugs and follow-ups, marks tracked items whose fix landed, and lists reference notes the changes touched, then applies what the user approves. Use when the user runs /vault-sync, or asks to sync, refresh, or catch the vault up after a pull or merge.
---

# Sync the vault with the repository

The dTuber planning vault is a separate git repository at `Z:/Obsidian/dTuber` (`/z/Obsidian/dTuber` in Bash). Its `Home.md` documents the folders, statuses and properties. Never open `Engineering/ips and keys.md`; it holds personal credentials.

The vault is on a slow network drive. Do not run recursive `grep` or `find` over it from Bash, because `.git` makes that take minutes. Use the Grep tool with a `*.md` glob, or read specific files.

## What the vault tracks

- **Reference notes** in `05 Reference/Existing Implementation` describe what the code does. Their frontmatter records `inspected`, `evidence`, `source_revision` and `source_state`.
- **Bugs** (`type: bug`) in `04 Testing/Bugs`: something wrong, including an active workaround.
- **Follow-ups** (`type: follow-up`) in `03 Development/Follow-ups`: a documented next step. `kind` is `decision`, `tuning`, `code`, or `upstream`.
- **`Known Limits.md`**: limitations by design or not built, one table row each, with a "Tracked as" link when a follow-up exists.
- **`Source Evidence.md`**: its frontmatter `source_revision` is the last synced revision.

Tracked notes carry `status` (`inbox`, `open`, `next`, `doing`, `fixed`, `done`, `dropped`), `area`, `source` (`capture` or `repo`), `found_in` and `fixed_in`. Templates are `Templates/Bug.md` and `Templates/Follow-up.md`.

## 1. Find what changed

1. Read `source_revision` from `05 Reference/Existing Implementation/Engineering/Source Evidence.md`. That is the baseline. Compare it with `git rev-parse HEAD` and `git status --short`.
2. If the baseline equals HEAD, skip to step 2 and only re-check open items.
3. Otherwise collect, for `<baseline>..HEAD`:
   - `git log --oneline` and `git diff --stat`.
   - New or changed files in `docs/ai/adr/`, `docs/ai/audits/`, and `docs/ai/upstream-watch.md`. Read their open items, consequences and follow-up sections.
   - `.omo/plans/` and `.omo/boulder.json`, including untracked plans. A plan is work, not behavior: confirm in code before treating anything as built.
   - Workaround and debt markers added or removed: `git diff -U0 <baseline>..HEAD -- . ':!**/node_modules/**' | grep -E '^[+-].*(NOTICE:|TODO|FIXME)'`.
   - Branches that landed: `git cherry HEAD <branch>` for branches named in follow-ups.

## 2. Check open tracked items

List bug and follow-up notes whose `status` is not `done` or `dropped`, with the Grep tool over the two folders. For each, read its evidence paths and run `git log --oneline <baseline>..HEAD -- <paths>`.

- If a commit plausibly fixes it, read the change. Propose `status: fixed` with `fixed_in: <short hash>` only when the code shows the fix. Never propose `done`: that needs an app check or test run.
- If the evidence path no longer exists, find where the code moved and propose an evidence update.
- If an item looks obsolete, propose `dropped` with a reason.

## 3. Map changes to reference notes

For each changed source path, use the Grep tool over `05 Reference/**/*.md` to find notes that cite it or its directory. Also consider notes that own the area even if they do not cite the exact file; `Repository Map.md` and `System Map.md` route areas to notes.

## 4. Propose

Show everything before writing anything. Use these tables:

| New item | Type | Area | Kind or severity | Evidence |
| --- | --- | --- | --- | --- |

| Tracked item | Proposed change | Evidence |
| --- | --- | --- |

| Reference note | Why it needs refreshing |
| --- | --- |

Also list Known Limits rows to add, change or remove, and new ADRs for the table in `03 Development/Decision Log.md`. When a change moves an avatar system onto another model type, list the cells to update in `02 Design/Avatar/Natural Coverage by Model Type.md`.

Rules for proposals:

- Code is the authority. ADRs, audits and plans are leads. Before proposing an audit finding as open, check the commits after the audit date.
- Search existing bug and follow-up titles and evidence first. Extend an existing note rather than creating a duplicate.
- Group findings that share one fix into one note. Do not create a note per TODO; keep only markers that affect this fork's companion experience or document a real defect.
- Say whether each item was verified in code or only stated in a document.
- Do not invent severity, priority or acceptance criteria. Use `annoying` and `not sure` when the source says nothing.

## 5. Apply what the user approves

- **New items:** write them with the matching template's sections, `status: inbox`, `source: repo`, `found_in: <short HEAD>`, `fixed_in: ""`, and today's `created`. An `area: avatar` item also gets `system` and `renderer`, using the values in the vault's `Home.md` (Areas section). Bugs go in `04 Testing/Bugs`, follow-ups in `03 Development/Follow-ups`. `/triage` reviews them next.
- **Status changes:** set `status` and `fixed_in`, and add one dated line under the note's fix or evidence section saying what changed.
- **Reference notes:** inspect the source before changing a claim. Update the affected text, then set `inspected` to today, `source_revision` to the full HEAD hash, `source_state` to `working-tree` (or `clean`), and keep `evidence: source-inspection` unless something was run. Leave notes the changes did not touch at their old revision.
- **Known Limits and Decision Log:** apply the approved rows.
- **Source Evidence:** set its `source_revision` to the full HEAD hash and add a short dated entry naming the revision range, the notes re-inspected, and the items created or closed.
- Keep code paths in backticks, relative to the repository root. Use basename wiki links to notes that exist.
- Do not commit. The vault's obsidian-git plugin commits and pushes every 10 minutes while Obsidian is open.

Finish with a short list: items created, items marked fixed or dropped, reference notes refreshed, and the new synced revision.
