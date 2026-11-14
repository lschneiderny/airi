# i18n

Scope: `packages/i18n/**`, and every string that a user sees. The root guide gives locale-edit rules.

## Glossary

`packages/i18n/glossary/terms.yaml` gives the approved English term for each product concept.
`pnpm -F @proj-airi/i18n glossary:build` writes the glossary as a TBX file in the shape Crowdin imports.
`packages/i18n/glossary/schema.ts` documents each field.

- Read `terms.yaml` before you write or change a string that a user sees. Use the term it gives.
- Do not edit `packages/i18n/glossary/translations/`. It holds the last upstream Crowdin export, which this fork does not sync.
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

## CHECKS

- Vitest includes only `glossary/**/*.test.ts`, so locale catalogs have no unit tests here.
- The `dev` script only runs the build.
