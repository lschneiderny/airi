import type { Reporter, Vitest } from 'vitest/node'

import process from 'node:process'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureClosure } from './closure'

/** Vitest reporters are root-scoped; this reporter reads only the gate project's graphs. */
export default class ClosureReporter implements Reporter {
  private ctx?: Vitest

  constructor(private repoRoot: string, private runDir: string) {}

  onInit(ctx: Vitest): void {
    this.ctx = ctx
  }

  onTestRunEnd(): void {
    const project = this.ctx?.projects.find(project => project.name === 'gate')
    if (!project)
      return

    const ids = Object.values(project.vite.environments).flatMap(environment => [...environment.moduleGraph.idToModuleMap.keys()])
    if (!ids.length)
      throw new Error('Cannot capture the gate module closure: Vite module graphs are empty.')
    ids.push(join(this.repoRoot, 'packages/qa-tools/vitest.config.ts'))
    const closure = captureClosure(ids, this.repoRoot)
    writeFileSync(join(this.runDir, `closure-vite-${process.pid}.json`), `${JSON.stringify(closure, null, 2)}\n`)
  }
}
