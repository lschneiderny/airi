import process from 'node:process'

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDocPaths } from '../src/docs/doc-paths'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const args = process.argv.slice(2)
let adrPath = resolve(repoRoot, 'docs/ai/adr/2026-10-20-motion-qa-levels.md')
if (args.length === 2 && args[0] === '--adr') {
  adrPath = resolve(args[1])
}
else if (args.length > 0) {
  console.error('Usage: check-doc-paths.ts [--adr <copy of ADR>]')
  process.exit(2)
}

const report = checkDocPaths({
  repoRoot,
  docs: [
    { file: adrPath, source: 'ADR' },
    { file: resolve(repoRoot, '.agents/skills/motion-qa/SKILL.md'), source: 'skill' },
  ],
})

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

if (report.missing.length > 0)
  process.exitCode = 1
