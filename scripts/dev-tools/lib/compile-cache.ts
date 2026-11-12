import { join } from 'node:path'

const variable = 'NODE_COMPILE_CACHE'

/**
 * The checkout's own Node compile cache directory. It lives inside `node_modules`, so `pnpm wt rm` deletes it with the
 * worktree, and it stays off the temporary directory, whose fixed inode table it filled on 2026-11-12.
 */
export function defaultCompileCacheDir(rootDir: string): string {
  return join(rootDir, 'node_modules', '.cache', 'node-compile-cache')
}

/**
 * The `NODE_COMPILE_CACHE` entry a repository entry point adds to the environment of the Node processes it starts:
 * the checkout's directory when the variable is unset, and nothing when it is set, even to an empty string, because a
 * set value is the user's choice. Windows environment names are case-insensitive, so any spelling counts as set.
 */
export function compileCacheEnv(env: Record<string, string | undefined>, rootDir: string): Record<string, string> {
  const set = Object.keys(env).some(key => key.toUpperCase() === variable && env[key] !== undefined)
  return set ? {} : { [variable]: defaultCompileCacheDir(rootDir) }
}
