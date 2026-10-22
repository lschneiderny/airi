import process from 'node:process'

const disableNodeWebStorage = '--no-experimental-webstorage'

// NOTICE:
// Node 26 enables Web Storage by default. Without `--localstorage-file` its global
// `localStorage` is undefined and shadows the jsdom storage, so tests throw on it.
// Source: Node warning "localStorage is not available", seen on 26.11.1.
// Removal condition: jsdom storage wins over the Node global, or Node stops defining it.
/**
 * Vitest worker `execArgv` for projects whose tests use DOM storage in a jsdom or happy-dom environment.
 * Empty on a Node version that does not know the flag, because Node rejects unknown `execArgv` flags.
 */
export const domStorageExecArgv: string[] = process.allowedNodeEnvironmentFlags.has(disableNodeWebStorage)
  ? [disableNodeWebStorage]
  : []
