import process from 'node:process'

import { runCharacterCli } from './cli'

process.exitCode = runCharacterCli(process.argv.slice(2))
