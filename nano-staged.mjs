import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// NOTICE:
// nano-staged imports this file with native Node ESM, which needs the extension to load TypeScript.
// Source: node_modules/nano-staged/lib/config.js.
// Removal condition: nano-staged resolves extensionless imports, or the helper becomes plain JavaScript.
// eslint-disable-next-line no-restricted-syntax
import { chunkByLength, shimCommandChunkLimits } from './scripts/dev-tools/lib/exec.ts'

const root = dirname(fileURLToPath(import.meta.url))

// NOTICE:
// nano-staged splits the command string with a tokenizer that keeps a quoted token twice, quotes included.
// A path with whitespace or quotes cannot be quoted, so each such character becomes the `?` glob.
// Source: node_modules/nano-staged/lib/utils.js, stringArgvToArray.
// Removal condition: nano-staged accepts an argument array from a function config.
const commandPath = file => relative(root, file).replaceAll('\\', '/').replaceAll(/[\s'"]/g, '?')

// NOTICE:
// One `moeru-lint --fix` over every staged file overflows the Windows command-line limit on large commits.
// nano-staged appends all matching files to one command. `moeru-lint` starts cmd.exe shims, which cap lines at 8191 characters.
// Source: node_modules/nano-staged/lib/cmd-runner.js.
// Removal condition: nano-staged splits long argument lists itself.
export default {
  '*': ({ filenames }) => chunkByLength(filenames.map(commandPath), shimCommandChunkLimits)
    .map(files => `node node_modules/@moeru/eslint-config/src/moeru-lint.js --fix ${files.join(' ')}`),
}
