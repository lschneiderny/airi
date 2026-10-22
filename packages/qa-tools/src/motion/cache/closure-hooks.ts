import type { ModuleHooks } from 'node:module'

import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'

import { captureClosure } from './closure'

/** Installed before the CLI's dynamic application imports; never modifies loader results. */
export class ClosureHooks {
  private readonly ids: Set<string>
  private readonly hooks: ModuleHooks

  constructor(private repoRoot: string, entryUrl: string) {
    // These bootstrap modules have already loaded when the hooks are installed.
    this.ids = new Set([entryUrl, import.meta.url, join(import.meta.dirname, 'closure.ts')])
    this.hooks = registerHooks({
      resolve: (specifier, context, nextResolve) => {
        const resolved = nextResolve(specifier, context)
        if (resolved.url.startsWith('file:'))
          this.ids.add(resolved.url)
        return resolved
      },
      load: (url, context, nextLoad) => {
        const loaded = nextLoad(url, context)
        if (url.startsWith('file:'))
          this.ids.add(url)
        return loaded
      },
    })
  }

  /** Writes the closure of this CLI process into the run directory of the run that is ending. */
  write(runDir: string): string {
    const path = join(runDir, `closure-cli-${process.pid}.json`)
    const closure = captureClosure(this.ids, this.repoRoot)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(path, `${JSON.stringify(closure, null, 2)}\n`)
    return path
  }

  stop(): void {
    this.hooks.deregister()
  }
}
