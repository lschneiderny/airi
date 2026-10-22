import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkDocPaths } from './doc-paths'

const roots: string[] = []

function fixture(doc: string) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'doc-paths-'))
  roots.push(repoRoot)
  mkdirSync(join(repoRoot, 'docs'))
  writeFileSync(join(repoRoot, 'docs', 'present.md'), '# present')
  const file = join(repoRoot, 'doc.md')
  writeFileSync(file, doc)
  return { repoRoot, docs: [{ file, source: 'doc' }] }
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('checkDocPaths', () => {
  it('reports .temp references as runtime outputs, not as missing, when the directory is absent', () => {
    const report = checkDocPaths(fixture('Run `.temp/qa/20260101-motion-t1/run.json` and `.temp/qa`, see `docs/present.md`.'))

    expect(report.runtimeOutputs).toEqual(['.temp/qa', '.temp/qa/20260101-motion-t1/run.json'])
    expect(report.missing).toEqual([])
    expect(report.resolved).toEqual(['docs/present.md'])
    expect(report.count).toBe(1)
  })

  it('still reports a missing repository path next to .temp references', () => {
    const report = checkDocPaths(fixture('See `.temp/qa/run.json` and `docs/not-there.md`.'))

    expect(report.missing.map(entry => entry.resolvedPath)).toEqual(['docs/not-there.md'])
    expect(report.runtimeOutputs).toEqual(['.temp/qa/run.json'])
  })
})
