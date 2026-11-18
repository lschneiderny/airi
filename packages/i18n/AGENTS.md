# i18n

Scope: `packages/i18n/**`, and every string that a user sees.

## Keys

- After you add, rename, or delete a key, run `pnpm i18n:check` in the repository root. Fix each error that it reports.
- Do not edit `.x18n/check-baseline.json` or run `x18n check --update-baseline`. The file is upstream's, and each upstream sync brings its version.
- Before you delete a key that the check reports as unused, search the code for its parent key. The check cannot follow keys built at runtime.

## Glossary

`packages/i18n/glossary/schema.ts` documents each field of `packages/i18n/glossary/terms.yaml`.

- Read `terms.yaml` before you write or change a string that a user sees. Use the term it gives.
- Take terms from the interface. Search the documentation to confirm a term, not to find one.

**Add a term when it prevents one of two failures:**

- A translator who reads only the source string chooses the wrong word.
- Two translators choose different words, and both words are correct.

## ANTI-PATTERNS

**Do not add a term when:**

- It is code. A translated control token, JSON key, file name, or package name breaks the
  application, and the application shows no error.
- It is a common English word with its usual meaning, such as "Speed" or "Volume".
- Its parts each have an entry and it says no more than its parts, such as "VRM model".
- One feature uses it, and only two translators can disagree about it. But keep a rare term if a
  translator can get it wrong: `Tachie` occurs two times and is the strongest entry in the file.

`terms.yaml` holds no rationale, because each field must map to a TBX element. Give the reason in
the pull request.

**Write a definition in one sentence.** Describe the thing, not the word, and put a negative rule in
the `note`. Keep each sentence short and active: translators read them, and most do not read English
as a first language.

