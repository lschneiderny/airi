import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { MismatchField } from '../diff'
import type { DecodedMotionTrace } from '../read-trace'

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { diffTraces, formatDiffBlock, MISMATCH_FIELDS, pairMismatches } from '../diff'
import { MotionTraceRefusal, readTrace } from '../read-trace'

const usage = `Usage: qa:motion3d diff <base run> <tip run> [<base run> <tip run>...] [--allow-mismatch <${MISMATCH_FIELDS.join('|')}>[,...]]
       qa:motion3d diff <base folder of runs> <tip folder of runs> [--allow-mismatch ...]`

const isRun = (dir: string) => existsSync(join(dir, 'trace.json'))

async function runsIn(folder: string): Promise<Map<string, string>> {
  const entries = await readdir(folder, { withFileTypes: true })
  return new Map(entries.filter(e => e.isDirectory() && isRun(join(folder, e.name))).map(e => [e.name, join(folder, e.name)]))
}

/**
 * `qa:motion3d diff`: is the motion of two runs identical? Prints every pair block by block. Exit 0 when every pair is
 * IDENTICAL, 1 when one is DIFFERENT, 2 on a usage error, an unreadable trace or a refused pair (another scenario, seed,
 * model or scored length that `--allow-mismatch` does not name), 130 on interrupt.
 */
export async function diffMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const dirs: string[] = []
  const allowed = new Set<MismatchField>()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-mismatch' && args[i + 1]) {
      for (const field of args[++i].split(',').map(f => f.trim())) {
        const known = MISMATCH_FIELDS.find(f => f === field)
        if (!known) {
          console.error(`qa:motion3d diff: unknown --allow-mismatch field ${field}\n${usage}`)
          return 2
        }
        allowed.add(known)
      }
    }
    else if (args[i].startsWith('-')) {
      console.error(usage)
      return 2
    }
    else {
      dirs.push(resolve(context.cwd, args[i]))
    }
  }
  if (!dirs.length || dirs.length % 2) {
    console.error(usage)
    return 2
  }

  const pairs: { base: string, tip: string }[] = []
  let refused = false
  for (let i = 0; i < dirs.length; i += 2) {
    const [base, tip] = [dirs[i], dirs[i + 1]]
    if (isRun(base) && isRun(tip)) {
      pairs.push({ base, tip })
      continue
    }
    if (isRun(base) || isRun(tip) || !existsSync(base) || !existsSync(tip)) {
      console.error(`qa:motion3d diff: ${base} and ${tip} must both be run directories (with trace.json) or both folders of runs\n${usage}`)
      return 2
    }
    const [a, b] = [await runsIn(base), await runsIn(tip)]
    for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const pa = a.get(name)
      const pb = b.get(name)
      if (pa && pb) {
        pairs.push({ base: pa, tip: pb })
      }
      else {
        console.info(`diff ${name}: REFUSED: run only in ${pa ? base : tip}`)
        refused = true
      }
    }
    if (!a.size && !b.size) {
      console.error(`qa:motion3d diff: neither ${base} nor ${tip} holds a run directory`)
      return 2
    }
  }

  let different = false
  let identical = 0
  for (const pair of pairs) {
    if (context.signal.aborted)
      return 130
    let base: DecodedMotionTrace
    let tip: DecodedMotionTrace
    try {
      base = await readTrace(join(pair.base, 'trace.json'))
      tip = await readTrace(join(pair.tip, 'trace.json'))
    }
    catch (error) {
      if (!(error instanceof MotionTraceRefusal))
        throw error
      console.info(`diff ${pair.base} -> ${pair.tip}: REFUSED: ${error.message}`)
      refused = true
      continue
    }
    const blocking = pairMismatches(base, tip).filter(m => !allowed.has(m.field))
    if (blocking.length) {
      refused = true
      console.info(`diff ${pair.base} -> ${pair.tip}: REFUSED: not the same experiment`)
      for (const m of blocking)
        console.info(`  ${m.field}: ${m.base} -> ${m.tip} (--allow-mismatch ${m.field} compares anyway)`)
      continue
    }
    const blocks = diffTraces(base, tip)
    const same = blocks.every(block => block.identical)
    different ||= !same
    identical += same ? 1 : 0
    console.info(`diff ${pair.base} -> ${pair.tip}: ${same ? 'IDENTICAL' : 'DIFFERENT'}`)
    for (const line of blocks.flatMap(formatDiffBlock))
      console.info(line)
  }
  console.info(`pairs: ${pairs.length}; identical ${identical}; ${refused ? 'refused pairs present (exit 2)' : different ? 'different (exit 1)' : 'all identical (exit 0)'}`)
  return refused ? 2 : different ? 1 : 0
}
