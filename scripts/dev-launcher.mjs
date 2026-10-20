// Pure logic of `scripts/dev.mjs`: what pnpm would run for a package script, and with which environment.

import { existsSync, readFileSync } from 'node:fs'
import { constants } from 'node:os'
import { delimiter, join } from 'node:path'

/** An expected launcher failure. The entry point prints its message without a stack trace. */
export class LauncherError extends Error {}

/**
 * Splits a package script into commands and words.
 * Only `&&` chains of plain words are supported, because the launcher runs commands without a shell.
 */
export function parseScript(script) {
  const withoutAnd = script.replaceAll('&&', '')
  const commands = script.split('&&').map(command => command.trim().split(/\s+/).filter(Boolean))
  if (/["'`$|;<>()%^*?&]/.test(withoutAnd) || commands.some(words => words.length === 0 || words[0].includes('=')))
    throw new LauncherError(`Script "${script}" uses shell syntax that this launcher does not run. Use pnpm for it.`)
  return commands
}

/**
 * Reads the Node.js entry point and NODE_PATH from the text of a pnpm-generated `.cmd` shim.
 * The shim would run `node "%~dp0\<target>" %*` after setting NODE_PATH.
 */
export function parseCmdShim(text) {
  const target = /node\s+"%~dp0\\([^"]+)"\s+%\*/.exec(text)?.[1]
  if (!target)
    return undefined
  return { target, nodePath: /@SET "NODE_PATH=([^"]*)"/.exec(text)?.[1] }
}

/**
 * Resolves a command name with pnpm's lookup order: the package `.bin`, then the workspace root `.bin`.
 * On Windows, it returns the Node.js entry point behind the `.cmd` shim instead of the shim.
 */
export function resolveCommand(name, { packageDir, rootDir, platform, execPath }) {
  for (const binDir of [join(packageDir, 'node_modules', '.bin'), join(rootDir, 'node_modules', '.bin')]) {
    if (platform !== 'win32') {
      const shim = join(binDir, name)
      if (existsSync(shim))
        return { file: shim, args: [] }
      continue
    }

    const shim = join(binDir, `${name}.cmd`)
    if (!existsSync(shim))
      continue
    const parsed = parseCmdShim(readFileSync(shim, 'utf8'))
    if (!parsed)
      throw new LauncherError(`${shim} does not start a Node.js script. Use pnpm for this command.`)
    const localNode = join(binDir, 'node.exe')
    return {
      file: existsSync(localNode) ? localNode : execPath,
      args: [join(binDir, parsed.target)],
      nodePath: parsed.nodePath,
    }
  }

  return { file: name === 'node' ? execPath : name, args: [] }
}

/** Adds package fields as `npm_package_*` variables, flattening objects like pnpm's `makeEnv`. */
function addPackageFields(env, fields, prefix) {
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('_'))
      continue
    const envKey = `${prefix}${key}`.replace(/\W/g, '_')
    if (value && typeof value === 'object')
      addPackageFields(env, value, `${envKey}_`)
    else
      env[envKey] = String(value)
  }
}

/** Builds the environment that pnpm gives a package script, starting from `baseEnv`. */
export function createScriptEnv({ baseEnv, cwd, rootDir, packageDir, packageFile, manifest, scriptName, script, forwardedArgs }) {
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([key]) =>
    !key.startsWith('npm_package_') && !/^(?:npm|pnpm)_config_(?:[/@_]|.*:_)/.test(key)))
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const inheritedPath = env[pathKey] ?? ''
  const nodeGypBin = inheritedPath.split(delimiter).find(entry => entry.endsWith('node-gyp-bin'))

  env[pathKey] = [
    join(packageDir, 'node_modules', '.bin'),
    nodeGypBin,
    join(rootDir, 'node_modules', '.bin'),
    inheritedPath,
  ].filter(Boolean).join(delimiter)

  env.INIT_CWD ??= cwd
  env.PWD = packageDir
  env.PNPM_SCRIPT_SRC_DIR = packageDir
  env.npm_lifecycle_event = scriptName
  env.npm_lifecycle_script = [script, ...forwardedArgs.map(arg => JSON.stringify(arg))].join(' ')
  env.npm_package_json = packageFile
  for (const field of ['name', 'version', 'config', 'engines', 'bin']) {
    if (manifest[field] !== undefined)
      addPackageFields(env, { [field]: manifest[field] }, 'npm_package_')
  }

  return env
}

/** Adds a command's shim NODE_PATH in front of the script NODE_PATH, as the `.cmd` shim does. */
export function createCommandEnv(scriptEnv, command) {
  if (!command.nodePath)
    return scriptEnv
  const nodePath = scriptEnv.NODE_PATH ? `${command.nodePath};${scriptEnv.NODE_PATH}` : command.nodePath
  return { ...scriptEnv, NODE_PATH: nodePath }
}

/**
 * Returns the launcher's exit code after a command exits.
 * A stop that the user requested with Ctrl+C (SIGINT) is a normal end, not a failure.
 */
export function sessionExitCode({ code, signal, stopSignal }) {
  if (stopSignal === 'SIGINT')
    return 0
  return code ?? 128 + (constants.signals[signal] ?? 0)
}
