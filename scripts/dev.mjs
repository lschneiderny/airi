#!/usr/bin/env node
// Runs one workspace package script the way `pnpm --filter <package> run <script>` does,
// but starts each command's Node.js entry point directly instead of through a Windows `.cmd` shim.
// Every `.cmd` layer makes `cmd.exe` ask "Terminate batch job (Y/N)?" after Ctrl+C.
//
// Usage: node scripts/dev.mjs <package-dir> <script> [args...]
// Example: node scripts/dev.mjs apps/stage-web dev --port 3000

import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

// eslint-disable-next-line no-restricted-syntax -- Plain Node.js ESM resolves a relative import only with its extension.
import { createCommandEnv, createScriptEnv, LauncherError, parseScript, resolveCommand, sessionExitCode } from './dev-launcher.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const IS_WINDOWS = process.platform === 'win32'
const FORCE_STOP_AFTER_MS = 10_000

function prepare(argv) {
  const [packageArg, scriptName, ...forwardedArgs] = argv
  if (!packageArg || !scriptName)
    throw new LauncherError('Usage: node scripts/dev.mjs <package-dir> <script> [args...]')

  const packageDir = resolve(ROOT, packageArg)
  const fromRoot = relative(ROOT, packageDir)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
    throw new LauncherError(`${packageArg} is outside the workspace.`)

  const packageFile = join(packageDir, 'package.json')
  if (!existsSync(packageFile))
    throw new LauncherError(`${packageFile} does not exist.`)
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
  const script = manifest.scripts?.[scriptName]
  if (!script)
    throw new LauncherError(`${manifest.name} has no "${scriptName}" script. Available: ${Object.keys(manifest.scripts ?? {}).join(', ')}`)

  return {
    packageDir,
    manifest,
    scriptName,
    forwardedArgs,
    commands: parseScript(script),
    scriptEnv: createScriptEnv({ baseEnv: process.env, cwd: process.cwd(), rootDir: ROOT, packageDir, packageFile, manifest, scriptName, script, forwardedArgs }),
  }
}

let session
try {
  session = prepare(process.argv.slice(2))
}
catch (error) {
  if (!(error instanceof LauncherError))
    throw error
  console.error(`[dev] ${error.message}`)
  process.exit(1)
}

const { packageDir, manifest, scriptName, forwardedArgs, commands, scriptEnv } = session

let child
let stopSignal

function forceStop() {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return
  if (IS_WINDOWS)
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  else
    child.kill('SIGKILL')
}

function stop(signal) {
  if (stopSignal) {
    forceStop()
    return
  }
  stopSignal = signal

  // On Windows, the console already delivered Ctrl+C to every attached process.
  // A closed console window (SIGHUP) terminates this process within seconds, so stop the tree now.
  if (IS_WINDOWS && signal === 'SIGHUP')
    forceStop()
  else if (!IS_WINDOWS)
    child?.kill(signal)

  setTimeout(forceStop, FORCE_STOP_AFTER_MS).unref()
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => stop(signal))

function runCommand([name, ...args], extraArgs) {
  let command
  try {
    command = resolveCommand(name, { packageDir, rootDir: ROOT, platform: process.platform, execPath: process.execPath })
  }
  catch (error) {
    if (!(error instanceof LauncherError))
      throw error
    console.error(`[dev] ${error.message}`)
    return Promise.resolve({ code: 1 })
  }

  return new Promise((resolveExit) => {
    child = spawn(command.file, [...command.args, ...args, ...extraArgs], { cwd: packageDir, env: createCommandEnv(scriptEnv, command), stdio: 'inherit' })
    child.once('error', (error) => {
      console.error(`[dev] Could not start "${name}": ${error.message}`)
      resolveExit({ code: 1 })
    })
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

let exitCode = 0
for (const [index, words] of commands.entries()) {
  if (stopSignal)
    break
  const result = await runCommand(words, index === commands.length - 1 ? forwardedArgs : [])
  exitCode = sessionExitCode({ ...result, stopSignal })
  if (stopSignal || exitCode !== 0) {
    if (exitCode !== 0 && !stopSignal)
      console.error(`[dev] ${manifest.name} ${scriptName}: "${words.join(' ')}" exited with code ${exitCode}.`)
    break
  }
}

process.exit(exitCode)
