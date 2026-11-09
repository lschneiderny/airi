import { join } from 'node:path'

/**
 * A QA display is a headless KWin Wayland session with rootless Xwayland and a private D-Bus session bus.
 * It runs as a transient systemd user unit, so `down` stops KWin, Xwayland, and the bus together.
 * Clients render on the host GPU, and their windows, focus, and cursor never reach the user's desktop.
 */

export type QaDisplayCommand = 'up' | 'down' | 'status' | 'env' | 'run' | 'shot'

export interface QaDisplayArgs {
  command: QaDisplayCommand
  name: string
  width: number
  height: number
  /** Opens the session as a window on the user's desktop instead of a virtual framebuffer. */
  windowed: boolean
  /** The command after `--` for `run`. */
  argv: string[]
  /** The output file for `shot`. */
  file?: string
}

const commands: readonly QaDisplayCommand[] = ['up', 'down', 'status', 'env', 'run', 'shot']

export const qaDisplayUsage = `Usage: pnpm qa:display <command> [--name <name>]

Commands:
  up [--size 1920x1080] [--windowed]   Start the headless session (no-op when it is running)
  down                                 Stop the session and everything that renders in it
  status                               Print whether the session runs and its environment
  env                                  Print shell exports: eval "$(pnpm --silent qa:display env)"
  run -- <command...>                  Start the session if needed, then run a command inside it
  shot <file.png>                      Capture the whole session display

--name defaults to "qa". Use one name per parallel agent.`

/** Unit, socket, and directory names accept only characters that are safe in all three. */
const namePattern = /^[a-z0-9][a-z0-9-]{0,31}$/

export function parseQaDisplayArgs(argv: readonly string[]): QaDisplayArgs | { error: string } {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1)
  const [command, ...rest] = own
  if (!commands.includes(command as QaDisplayCommand))
    return { error: command ? `unknown command "${command}"` : 'missing command' }

  const args: QaDisplayArgs = { command: command as QaDisplayCommand, name: 'qa', width: 1920, height: 1080, windowed: false, argv: passthrough }
  const positional: string[] = []
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === '--windowed') {
      args.windowed = true
    }
    else if (flag === '--name' || flag === '--size') {
      const value = rest[++index]
      if (value === undefined)
        return { error: `${flag} needs a value` }
      if (flag === '--name') {
        if (!namePattern.test(value))
          return { error: `--name must match ${namePattern}` }
        args.name = value
      }
      else {
        const size = /^(\d{3,5})x(\d{3,5})$/.exec(value)
        if (!size)
          return { error: '--size must look like 1920x1080' }
        args.width = Number(size[1])
        args.height = Number(size[2])
      }
    }
    else if (flag.startsWith('--')) {
      return { error: `unknown flag "${flag}"` }
    }
    else {
      positional.push(flag)
    }
  }

  if (args.command === 'shot') {
    if (positional.length !== 1 || !positional[0].endsWith('.png'))
      return { error: 'shot needs exactly one output path ending in .png' }
    args.file = positional[0]
  }
  else if (positional.length > 0) {
    return { error: `unexpected argument "${positional[0]}"` }
  }
  if (args.command === 'run' && passthrough.length === 0)
    return { error: 'run needs a command after --' }
  if (args.command !== 'run' && separator !== -1)
    return { error: '-- is only valid with run' }
  return args
}

export interface QaDisplayPaths {
  unit: string
  socket: string
  dir: string
  bus: string
  envFile: string
}

export function qaDisplayPaths(name: string, runtimeDir: string): QaDisplayPaths {
  const dir = join(runtimeDir, 'airi-qa-display', name)
  return {
    unit: `airi-qa-display-${name}.service`,
    socket: `wayland-airi-qa-${name}`,
    dir,
    bus: join(dir, 'bus'),
    envFile: join(dir, 'env'),
  }
}

/**
 * The `systemd-run` arguments that start the session.
 * KWin starts the probe after Wayland and Xwayland are ready, so the env file appearing means the session accepts clients.
 * The probe writes through a temporary file, so a reader never sees a partial file.
 */
export function qaDisplayUnitArgs(args: Pick<QaDisplayArgs, 'width' | 'height' | 'windowed'>, paths: QaDisplayPaths, hostWaylandDisplay: string | undefined): string[] {
  const backend = args.windowed
    ? ['--wayland-display', hostWaylandDisplay ?? 'wayland-0']
    : ['--virtual']
  const kwin = [
    'kwin_wayland',
    ...backend,
    '--xwayland',
    '--socket',
    paths.socket,
    '--width',
    String(args.width),
    '--height',
    String(args.height),
    '--no-lockscreen',
    '--no-global-shortcuts',
    '--no-kactivities',
    'sh -c \'env > "$AIRI_QA_DIR/env.tmp" && mv "$AIRI_QA_DIR/env.tmp" "$AIRI_QA_DIR/env"\'',
  ]
  const script = [
    'dbus-daemon --session --fork --address="unix:path=$AIRI_QA_DIR/bus" >/dev/null',
    'export DBUS_SESSION_BUS_ADDRESS="unix:path=$AIRI_QA_DIR/bus"',
    `exec ${kwin.map(shellQuote).join(' ')}`,
  ].join(' && ')
  return [
    '--user',
    `--unit=${paths.unit}`,
    '--collect',
    '--quiet',
    '--property=KillMode=control-group',
    `--setenv=AIRI_QA_DIR=${paths.dir}`,
    ...(args.windowed && hostWaylandDisplay ? [`--setenv=WAYLAND_DISPLAY=${hostWaylandDisplay}`] : []),
    '/bin/sh',
    '-c',
    script,
  ]
}

function shellQuote(word: string): string {
  return /^[\w./=:-]+$/.test(word) ? word : `'${word.replaceAll('\'', '\'\\\'\'')}'`
}

/** Keys a client needs to reach the session. `XAUTHORITY` is empty because KWin's Xwayland accepts local clients without a cookie. */
export const sessionKeys = ['WAYLAND_DISPLAY', 'DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_TYPE'] as const

export function parseSessionEnv(text: string): Record<(typeof sessionKeys)[number], string> | null {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0)
      values.set(line.slice(0, at), line.slice(at + 1))
  }
  const wayland = values.get('WAYLAND_DISPLAY')
  const display = values.get('DISPLAY')
  const bus = values.get('DBUS_SESSION_BUS_ADDRESS')
  if (!wayland || !display || !bus)
    return null
  return { WAYLAND_DISPLAY: wayland, DISPLAY: display, XAUTHORITY: values.get('XAUTHORITY') ?? '', DBUS_SESSION_BUS_ADDRESS: bus, XDG_SESSION_TYPE: 'wayland' }
}

/** The host environment with the session keys replaced. An empty value removes the key, so the host `XAUTHORITY` cannot leak in. */
export function clientEnv(host: NodeJS.ProcessEnv, session: Record<string, string>, name: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...host, AIRI_QA_DISPLAY: name }
  for (const [key, value] of Object.entries(session)) {
    if (value)
      env[key] = value
    else
      delete env[key]
  }
  return env
}

export function shellExports(session: Record<string, string>, name: string): string {
  const lines = [`export AIRI_QA_DISPLAY=${shellQuote(name)}`]
  for (const [key, value] of Object.entries(session))
    lines.push(value ? `export ${key}=${shellQuote(value)}` : `unset ${key}`)
  return lines.join('\n')
}
