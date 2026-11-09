import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'

import { errorMessageFrom } from '@moeru/std'

import { formatKwinProbeLine, kwinProbeUsage, parseKwinProbeArgs, qaSessionMarker, selectKwinProbeBus } from './kwin-probe-plan'
import { parseSessionEnv, qaDisplayPaths } from './qa-display-plan'

// NOTICE:
// The KWin backend imports its compositor scripts with Vite's `?raw` suffix, which tsx cannot load.
// This loader hook resolves `<file>?raw` to the file and exports its text as the default export.
// Source: apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/index.ts; Node module.registerHooks.
// Remove it when the backend stops importing `?raw` modules or tsx supports them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith('?raw'))
      return nextResolve(specifier, context)
    return { url: `${nextResolve(specifier.slice(0, -4), context).url}?raw`, shortCircuit: true }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('?raw'))
      return nextLoad(url, context)
    const source = readFileSync(new URL(url.slice(0, -4)), 'utf8')
    return { format: 'module', source: `export default ${JSON.stringify(source)}`, shortCircuit: true }
  },
})

/** Asks the user's systemd manager whether the session unit runs, then reads the bus the session recorded. */
function runningSessionBus(name: string): string | null {
  const hostRuntimeDir = process.env.AIRI_QA_HOST_RUNTIME_DIR || `/run/user/${process.getuid?.()}`
  const paths = qaDisplayPaths(name, hostRuntimeDir)
  const env = { ...process.env, XDG_RUNTIME_DIR: hostRuntimeDir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${hostRuntimeDir}/bus` }
  if (spawnSync('systemctl', ['--user', 'is-active', '--quiet', paths.unit], { env, stdio: 'ignore' }).status !== 0)
    return null
  if (!existsSync(paths.envFile))
    return null
  return parseSessionEnv(readFileSync(paths.envFile, 'utf8'))?.env.DBUS_SESSION_BUS_ADDRESS || null
}

async function main(): Promise<number> {
  const args = parseKwinProbeArgs(process.argv.slice(2))
  if ('error' in args) {
    console.error(`kwin-probe: ${args.error}\n\n${kwinProbeUsage}`)
    return 2
  }
  // Decide the bus before loading the backend or opening any connection.
  const bus = selectKwinProbeBus({
    explicitBus: args.bus,
    marker: process.env[qaSessionMarker],
    inheritedBus: process.env.DBUS_SESSION_BUS_ADDRESS,
    sessionBus: runningSessionBus,
  })
  if ('error' in bus) {
    console.error(`kwin-probe: ${bus.error}`)
    return 2
  }

  // The backend modules load only after the hook is registered.
  const { DbusTransport } = await import('../../apps/stage-tamagotchi/src/main/services/linux-desktop/dbus/transport')
  const { KwinBackend } = await import('../../apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/index')
  type Transport = Awaited<ReturnType<typeof DbusTransport.session>>

  /** Asks KWin itself, so the receipt never trusts the backend's own bookkeeping. */
  async function cleanupReceipt(transport: Transport, names: readonly string[]): Promise<'true' | 'false' | 'unverified'> {
    try {
      const owner = await transport.getNameOwner('org.kde.KWin')
      if (!owner)
        return 'unverified'
      for (const name of names) {
        if (await transport.call<boolean>({ destination: owner, path: '/Scripting', interface: 'org.kde.kwin.Scripting', member: 'isScriptLoaded', signature: 's', body: [name] }))
          return 'false'
      }
      return 'true'
    }
    catch (error) {
      console.error(`kwin-probe: isScriptLoaded failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
      return 'unverified'
    }
  }

  let transport: Transport
  try {
    transport = await DbusTransport.session(bus.address)
  }
  catch (error) {
    console.error(`bridge failed: ${errorMessageFrom(error) ?? 'session bus unavailable'}`)
    return 1
  }

  let code = 0
  const finished = Promise.withResolvers<string | undefined>()
  const backend = new KwinBackend({
    transport,
    // qa:display gives each session a private runtime directory, so stale-script cleanup stays per session.
    tempDir: process.env.XDG_RUNTIME_DIR || tmpdir(),
    ownPids: () => [process.pid],
    onMessage: message => console.info(formatKwinProbeLine(message)),
    onFailure: reason => finished.resolve(reason),
  })
  const interrupt = () => finished.resolve(undefined)
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  const timer = setTimeout(interrupt, args.seconds * 1000)
  try {
    await backend.start()
    if (args.cursor)
      await backend.setCursorStreaming(true)
    const failure = await finished.promise
    if (failure) {
      console.error(`bridge failed: ${failure}`)
      code = 1
    }
  }
  catch (error) {
    console.error(`bridge failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
    code = 1
  }
  finally {
    clearTimeout(timer)
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    try {
      await backend.stop()
    }
    catch (error) {
      console.error(`kwin-probe: stop failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
      code = 1
    }
    const receipt = await cleanupReceipt(transport, [backend.bridgeName, backend.cursorName])
    console.info(`scripts-unloaded: ${receipt}`)
    if (receipt !== 'true')
      code = 1
    await transport.close()
  }
  return code
}

process.exitCode = await main()
