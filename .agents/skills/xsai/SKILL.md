---
name: xsai
description: Use when editing existing xsai or @xsai integrations in AIRI providers, chat, speech, or transcription.
---

# AIRI xsAI Integrations

- Inspect the installed dependency version, existing imports, and provider wiring before changing an integration.
- Preserve granular @xsai packages versus the umbrella xsai package unless the task requires a change.
- Use the project's existing schema library and configuration ownership.
- Obtain endpoints, models, and credentials through the existing provider configuration or main-process transport.
- Do not prescribe a new credential storage mechanism or hardcode secrets in examples.
- Check installed types and official documentation before relying on version-sensitive API examples.
- Keep OpenAI-compatible integrations distinct from provider-specific APIs. Do not replace the provider layer as part of a local edit.

## Task References

Read only the reference needed for the changed behavior:

- [Recipes](references/recipes.md): minimal examples to adapt to existing provider wiring.
- [Package selection](references/package-selection.md): existing granular and umbrella dependencies.
- [Text and tools](references/text-stream-tools.md): text streaming and tool calls.
- [Structured output](references/structured-output.md): schema-backed output and tools.
- [Media and embeddings](references/media-and-embeddings.md): speech, transcription, images, and embeddings.
- [Extensions](references/extensions.md): only when the task uses an extension.
