import process from 'node:process'

import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { archiveEvidence, EvidenceConflictError, resolveMainCheckout } from '../src/evidence/archive'

const USAGE = 'Usage: evidence archive --plan <slug> --from <worktree-path>'

/** Exit codes: 0 archived, 1 refused or failed, 2 usage error. */
function main(argv: string[]): number {
  const [command, ...rest] = argv
  if (command !== 'archive') {
    console.error(USAGE)
    return 2
  }

  let values: { plan?: string, from?: string }
  try {
    ({ values } = parseArgs({ args: rest, options: { plan: { type: 'string' }, from: { type: 'string' } }, strict: true }))
  }
  catch (error) {
    console.error(`${errorMessageFrom(error) ?? 'unknown error'}\n${USAGE}`)
    return 2
  }
  if (!values.plan || !values.from) {
    console.error(USAGE)
    return 2
  }

  try {
    const main = resolveMainCheckout(values.from)
    const result = archiveEvidence({ plan: values.plan, from: values.from, main })
    console.info(`archived plan=${values.plan} main=${main} copied=${result.copied.length} unchanged=${result.unchanged.length}`)
    for (const file of result.manifest.files)
      console.info(`${file.sha256}  ${file.path}`)
    return 0
  }
  catch (error) {
    if (error instanceof EvidenceConflictError) {
      console.error(error.message)
      for (const c of error.conflicts)
        console.error(`conflict ${c.path} source=${c.sourceSha256} destination=${c.destinationSha256}`)
    }
    else {
      console.error(errorMessageFrom(error) ?? 'unknown error')
    }
    return 1
  }
}

process.exitCode = main(process.argv.slice(2))
