---
name: stage-tamagotchi-godot-csharp
description: >-
  Apply the Stage Tamagotchi Godot C# development method and code style when
  working in `engines/stage-tamagotchi-godot`. Use it for its `.cs` files, `.csproj`,
  local `.editorconfig`, and Godot-specific C# structure decisions. Do not use
  it for TypeScript, Electron, renderer code, shared workspace configuration,
  or repo-wide C# conventions.
---

# Stage Tamagotchi Godot C#

1. `engines/stage-tamagotchi-godot` is the only Godot project. It is the VRM
   stage sidecar that the Electron app launches.
2. Before editing C# files, read:
   - `engines/stage-tamagotchi-godot/docs/csharp-development-method.md`
   - `engines/stage-tamagotchi-godot/.editorconfig`
   - `engines/stage-tamagotchi-godot/docs/csharp-style.md`
   These files are the canonical C# guidance.
3. Treat the development-method document as the primary source of truth for
   structure and feature usage. Treat `.editorconfig` and `csharp-style.md` as
   secondary formatting and naming guidance.
4. Classify the change before coding:
   - scene script
   - runtime core
   - contract and transport
   - registry and discovery
   - tooling and editor support
5. Apply the local design method:
   - keep scene scripts thin
   - push durable logic into plain C# runtime objects
   - make subsystem boundaries explicit through types
   - use reflection for discovery, not steady-state execution
   - use LINQ for cold-path querying and shaping, not hot-path loops
   - use async at I/O and process boundaries, not as a default runtime model
6. Apply the local low-level style baseline:
   - `engines/stage-tamagotchi-godot/.editorconfig`
   - 4 spaces, LF, UTF-8, 100 columns
   - Allman braces
   - `System.*` usings first
   - keyword types such as `string` and `int`
   - `var` only when the type is obvious
   - `PascalCase` for types and members
   - `camelCase` for locals and parameters
   - `_camelCase` for private fields
7. Keep changes local to the Stage Tamagotchi Godot migration line. Do not
   push these C# rules into repo root configuration or other workspaces.
8. After changing C# files or a local `.editorconfig`, run the verification
   command from the project directory that owns the changed file:

```powershell
dotnet format --verify-no-changes
```

If verification fails because of pre-existing files outside the intended change
scope, report that clearly instead of broadening the edit set silently.
