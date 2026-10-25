import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCommandEnv, createScriptEnv, LauncherError, parseCmdShim, parseScript, resolveCommand, sessionExitCode } from './dev-launcher'

// The shim text and the expected environment follow what pnpm 11.24 generated and set on Windows.
const viteCmdShim = [
  '@SETLOCAL',
  '@IF NOT DEFINED NODE_PATH (',
  '  @SET "NODE_PATH=C:\\repo\\node_modules\\.pnpm\\vite@8.2.2\\node_modules;C:\\repo\\node_modules\\.pnpm\\node_modules"',
  ') ELSE (',
  '  @SET "NODE_PATH=C:\\repo\\node_modules\\.pnpm\\vite@8.2.2\\node_modules;C:\\repo\\node_modules\\.pnpm\\node_modules;%NODE_PATH%"',
  ')',
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\vite\\bin\\vite.js" %*',
  ') ELSE (',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  '  node  "%~dp0\\..\\vite\\bin\\vite.js" %*',
  ')',
].join('\r\n')

const roots = []

async function workspace(files) {
  const root = await mkdtemp(join(tmpdir(), 'airi-dev-launcher-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('parseScript', () => {
  it('splits an && chain into commands and keeps every argument', () => {
    expect(parseScript('install-electron && electron-vite dev -- --ozone-platform=x11')).toEqual([
      ['install-electron'],
      ['electron-vite', 'dev', '--', '--ozone-platform=x11'],
    ])
  })

  it.each([
    'node --version | more',
    'vite "--host"',
    'vite --port $PORT',
    'NODE_ENV=production vite',
    'vite & tsc',
    'vite > out.log',
    'vite && && tsc',
  ])('rejects shell syntax in %j', (script) => {
    expect(() => parseScript(script)).toThrow(LauncherError)
  })
})

describe('parseCmdShim', () => {
  it('reads the Node.js entry point and the NODE_PATH that the shim sets', () => {
    expect(parseCmdShim(viteCmdShim)).toEqual({
      target: '..\\vite\\bin\\vite.js',
      nodePath: 'C:\\repo\\node_modules\\.pnpm\\vite@8.2.2\\node_modules;C:\\repo\\node_modules\\.pnpm\\node_modules',
    })
  })

  it('returns undefined for a shim that does not start Node.js', () => {
    expect(parseCmdShim('@"%~dp0\\..\\tool\\bin\\tool.exe" %*')).toBeUndefined()
  })
})

describe('resolveCommand', () => {
  const execPath = join('runtime', 'node')

  it('prefers the package .bin over the root .bin on Windows and starts the shim target with Node.js', async () => {
    const root = await workspace({
      'node_modules/.bin/vite.cmd': viteCmdShim.replace('vite\\bin', 'root-vite\\bin'),
      'apps/web/node_modules/.bin/vite.cmd': viteCmdShim,
    })
    const packageDir = join(root, 'apps', 'web')
    const binDir = join(packageDir, 'node_modules', '.bin')

    const command = resolveCommand('vite', { packageDir, rootDir: root, platform: 'win32', execPath })

    expect(command.file).toBe(execPath)
    // The shim target keeps its Windows separators, and the host `join` resolves them only on Windows.
    expect(command.args).toEqual([join(binDir, '..\\vite\\bin\\vite.js')])
    expect(command.nodePath).toContain('vite@8.2.2')
  })

  it('uses node.exe next to the Windows shim when it exists', async () => {
    const root = await workspace({ 'node_modules/.bin/vite.cmd': viteCmdShim, 'node_modules/.bin/node.exe': '' })

    const command = resolveCommand('vite', { packageDir: join(root, 'apps', 'web'), rootDir: root, platform: 'win32', execPath })

    expect(command.file).toBe(join(root, 'node_modules', '.bin', 'node.exe'))
  })

  it('falls back to the root .bin and runs the shim itself outside Windows', async () => {
    const root = await workspace({ 'node_modules/.bin/tsx': '#!/bin/sh' })

    const command = resolveCommand('tsx', { packageDir: join(root, 'packages', 'server'), rootDir: root, platform: 'linux', execPath })

    expect(command).toEqual({ file: join(root, 'node_modules', '.bin', 'tsx'), args: [] })
  })

  it('rejects a Windows shim that does not start Node.js', async () => {
    const root = await workspace({ 'node_modules/.bin/tool.cmd': '@"%~dp0\\tool.exe" %*' })

    expect(() => resolveCommand('tool', { packageDir: root, rootDir: root, platform: 'win32', execPath })).toThrow(LauncherError)
  })

  it('runs node with the current Node.js binary and leaves other names to PATH', async () => {
    const root = await workspace({})

    expect(resolveCommand('node', { packageDir: root, rootDir: root, platform: 'win32', execPath }).file).toBe(execPath)
    expect(resolveCommand('git', { packageDir: root, rootDir: root, platform: 'win32', execPath }).file).toBe('git')
  })
})

describe('createScriptEnv', () => {
  const rootDir = join('repo')
  const packageDir = join('repo', 'packages', 'server-runtime')
  const packageFile = join(packageDir, 'package.json')
  const nodeGypBin = join('pnpm', 'dist', 'node-gyp-bin')
  const rootScriptEnv = {
    'Path': [join(rootDir, 'node_modules', '.bin'), nodeGypBin, join('system')].join(delimiter),
    'INIT_CWD': rootDir,
    'npm_package_name': '@proj-airi/root',
    'npm_package_version': '0.12.0',
    'npm_lifecycle_event': 'dev:server',
    'npm_config_//registry.npmjs.org/:_authToken': 'secret',
    'pnpm_config_verify_deps_before_run': 'false',
  }

  function create(overrides = {}) {
    return createScriptEnv({
      baseEnv: rootScriptEnv,
      cwd: 'elsewhere',
      rootDir,
      packageDir,
      packageFile,
      manifest: { name: '@proj-airi/server-runtime', bin: './dist/bin/run.mjs', engines: { node: '>=20' }, config: { port: 6121 } },
      scriptName: 'dev',
      script: 'tsx ./src/bin/run.js',
      forwardedArgs: [],
      ...overrides,
    })
  }

  it('replaces the root package variables with the target package fields', () => {
    const env = create()

    expect(env.npm_package_name).toBe('@proj-airi/server-runtime')
    expect(env.npm_package_version).toBeUndefined()
    expect(env.npm_package_bin).toBe('./dist/bin/run.mjs')
    expect(env.npm_package_engines_node).toBe('>=20')
    expect(env.npm_package_config_port).toBe('6121')
    expect(env.npm_package_json).toBe(packageFile)
  })

  it('sets the lifecycle and directory variables of the package script', () => {
    const env = create({ forwardedArgs: ['--port', '5199'] })

    expect(env.npm_lifecycle_event).toBe('dev')
    expect(env.npm_lifecycle_script).toBe('tsx ./src/bin/run.js "--port" "5199"')
    expect(env.PNPM_SCRIPT_SRC_DIR).toBe(packageDir)
    expect(env.PWD).toBe(packageDir)
    expect(env.INIT_CWD).toBe(rootDir)
  })

  it('defaults INIT_CWD to the current directory when pnpm did not set it', () => {
    const env = create({ baseEnv: {} })

    expect(env.INIT_CWD).toBe('elsewhere')
  })

  it('puts the package .bin, node-gyp-bin, and root .bin in front of the inherited PATH under its original key', () => {
    const env = create()

    expect(env.PATH).toBeUndefined()
    expect(env.Path).toBe([
      join(packageDir, 'node_modules', '.bin'),
      nodeGypBin,
      join(rootDir, 'node_modules', '.bin'),
      rootScriptEnv.Path,
    ].join(delimiter))
  })

  it('drops scoped registry settings and keeps other pnpm settings, as pnpm does', () => {
    const env = create()

    expect(env['npm_config_//registry.npmjs.org/:_authToken']).toBeUndefined()
    expect(env.pnpm_config_verify_deps_before_run).toBe('false')
  })
})

describe('createCommandEnv', () => {
  it('puts the shim NODE_PATH in front of an inherited NODE_PATH', () => {
    expect(createCommandEnv({ NODE_PATH: 'inherited' }, { nodePath: 'shim' }).NODE_PATH).toBe('shim;inherited')
  })

  it('uses the shim NODE_PATH alone when none is inherited', () => {
    expect(createCommandEnv({}, { nodePath: 'shim' }).NODE_PATH).toBe('shim')
  })

  it('keeps the script environment for a command without a shim NODE_PATH', () => {
    const scriptEnv = { NODE_PATH: 'inherited' }

    expect(createCommandEnv(scriptEnv, {})).toBe(scriptEnv)
  })
})

describe('sessionExitCode', () => {
  it('ends with 0 when the user stopped the session with Ctrl+C', () => {
    expect(sessionExitCode({ code: 1, stopSignal: 'SIGINT' })).toBe(0)
    expect(sessionExitCode({ code: null, signal: 'SIGKILL', stopSignal: 'SIGINT' })).toBe(0)
  })

  it('keeps the command exit code without a Ctrl+C stop', () => {
    expect(sessionExitCode({ code: 1 })).toBe(1)
    expect(sessionExitCode({ code: 1, stopSignal: 'SIGTERM' })).toBe(1)
  })

  it('maps a signal exit to 128 plus the signal number', () => {
    expect(sessionExitCode({ code: null, signal: 'SIGTERM' })).toBe(143)
  })
})
