import { join } from 'node:path'

/**
 * A QA display is a headless desktop session with a private D-Bus session bus, in one of three compositors:
 * - `kwin` (default): `kwin_wayland --virtual` with rootless Xwayland. `--portals` adds the desktop portal and KDE
 *   global shortcuts on the private bus.
 * - `x11`: Xvfb with openbox as the window manager.
 * - `sway`: headless sway, with Xwayland when sway starts it.
 * It runs as a transient systemd user unit, so `down` stops the compositor, its services, and the bus together.
 * Each session has a private `XDG_RUNTIME_DIR`, `XDG_DATA_HOME`, and `XDG_CONFIG_HOME` under its session directory, set
 * before the bus starts, so nothing it or its D-Bus-activated helpers create (sockets, FUSE mounts, config) lands in
 * the user's runtime directory or home.
 * Clients render on the host GPU, and their windows, focus, and cursor never reach the user's desktop.
 */

export type QaDisplayCommand = 'up' | 'down' | 'status' | 'env' | 'run' | 'shot' | 'pointer'

export const qaCompositors = ['kwin', 'x11', 'sway'] as const
export type QaCompositor = (typeof qaCompositors)[number]

const sessionIdentity: Record<QaCompositor, { XDG_CURRENT_DESKTOP: string, XDG_SESSION_TYPE: string }> = {
  kwin: { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' },
  x11: { XDG_CURRENT_DESKTOP: 'Openbox', XDG_SESSION_TYPE: 'x11' },
  sway: { XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland' },
}

export interface QaDisplayArgs {
  command: QaDisplayCommand
  name: string
  width: number
  height: number
  /** Opens the session as a window on the user's desktop instead of a virtual framebuffer. */
  windowed: boolean
  /** Set only when `--compositor` was given; a new session defaults to `kwin`, and a running one keeps its own. */
  compositor?: QaCompositor
  /** Starts the desktop portal and KDE global shortcuts on the private bus (kwin only). */
  portals: boolean
  /** The command after `--` for `run`. */
  argv: string[]
  /** The output file for `shot`. */
  file?: string
  /** The target position for `pointer`, in session pixels. */
  point?: { x: number, y: number }
}

const commands: readonly QaDisplayCommand[] = ['up', 'down', 'status', 'env', 'run', 'shot', 'pointer']

export const qaDisplayUsage = `Usage: pnpm qa:display <command> [--name <name>]

Commands:
  up [--size 1920x1080] [--windowed] [--compositor kwin|x11|sway] [--portals]
                                       Start the headless session (no-op when it is running)
  down                                 Stop the session and everything that renders in it
  status                               Print whether the session runs and its environment
  env                                  Print shell exports: eval "$(pnpm --silent qa:display env)"
  run [up flags] -- <command...>       Start the session if needed, then run a command inside it
  shot <file.png>                      Capture the whole session display (kwin only)
  pointer <x> <y>                      Move the session pointer (EIS on kwin, xdotool on x11, swaymsg on sway)

--name defaults to "qa". Use one name per parallel agent.
--compositor defaults to kwin. --portals adds xdg-desktop-portal and KDE global shortcuts (kwin only).`

/** Unit, socket, and directory names accept only characters that are safe in all three. */
export const namePattern = /^[a-z0-9][a-z0-9-]{0,31}$/

export function parseQaDisplayArgs(argv: readonly string[]): QaDisplayArgs | { error: string } {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1)
  const [command, ...rest] = own
  if (!commands.includes(command as QaDisplayCommand))
    return { error: command ? `unknown command "${command}"` : 'missing command' }

  const args: QaDisplayArgs = { command: command as QaDisplayCommand, name: 'qa', width: 1920, height: 1080, windowed: false, portals: false, argv: passthrough }
  const positional: string[] = []
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === '--windowed') {
      args.windowed = true
    }
    else if (flag === '--portals') {
      args.portals = true
    }
    else if (flag === '--name' || flag === '--size' || flag === '--compositor') {
      const value = rest[++index]
      if (value === undefined)
        return { error: `${flag} needs a value` }
      if (flag === '--name') {
        if (!namePattern.test(value))
          return { error: `--name must match ${namePattern}` }
        args.name = value
      }
      else if (flag === '--compositor') {
        if (!qaCompositors.includes(value as QaCompositor))
          return { error: `--compositor must be one of ${qaCompositors.join(', ')}` }
        args.compositor = value as QaCompositor
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

  if (args.portals && args.compositor !== undefined && args.compositor !== 'kwin')
    return { error: '--portals needs the kwin compositor' }
  if (args.windowed && args.compositor !== undefined && args.compositor !== 'kwin')
    return { error: '--windowed needs the kwin compositor' }

  if (args.command === 'shot') {
    if (positional.length !== 1 || !positional[0].endsWith('.png'))
      return { error: 'shot needs exactly one output path ending in .png' }
    args.file = positional[0]
  }
  else if (args.command === 'pointer') {
    if (positional.length !== 2 || !positional.every(value => /^\d{1,5}$/.test(value)))
      return { error: 'pointer needs two non-negative integer coordinates: pointer <x> <y>' }
    args.point = { x: Number(positional[0]), y: Number(positional[1]) }
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
  /** A startup step that gives up writes its reason here, so `up` can fail with it instead of waiting. */
  errorFile: string
  /** The session's private `XDG_RUNTIME_DIR` (mode 0700), `XDG_DATA_HOME`, and `XDG_CONFIG_HOME`. */
  runtime: string
  data: string
  config: string
  swayConfig: string
  /** Run through `swaymsg exec`; a file, because sway's command parser would split an inline probe at `;`. */
  swayProbe: string
}

export function qaDisplayPaths(name: string, runtimeDir: string): QaDisplayPaths {
  const dir = join(runtimeDir, 'airi-qa-display', name)
  return {
    unit: `airi-qa-display-${name}.service`,
    socket: `wayland-airi-qa-${name}`,
    dir,
    bus: join(dir, 'bus'),
    envFile: join(dir, 'env'),
    errorFile: join(dir, 'error'),
    runtime: join(dir, 'runtime'),
    data: join(dir, 'data'),
    config: join(dir, 'config'),
    swayConfig: join(dir, 'sway.conf'),
    swayProbe: join(dir, 'sway-probe.sh'),
  }
}

/** Binaries each session starts, with the Fedora package that ships them. Absolute paths are checked as files. */
export function requiredBinaries(compositor: QaCompositor, portals: boolean): Array<{ binary: string, pkg: string }> {
  const bus = { binary: 'dbus-daemon', pkg: 'dbus-daemon' }
  switch (compositor) {
    case 'kwin':
      return [
        { binary: 'kwin_wayland', pkg: 'kwin' },
        { binary: 'Xwayland', pkg: 'xorg-x11-server-Xwayland' },
        bus,
        ...(portals
          ? [
              { binary: '/usr/libexec/xdg-desktop-portal', pkg: 'xdg-desktop-portal' },
              { binary: '/usr/libexec/xdg-desktop-portal-kde', pkg: 'xdg-desktop-portal-kde' },
              { binary: 'busctl', pkg: 'systemd' },
            ]
          : []),
      ]
    case 'x11':
      return [{ binary: 'Xvfb', pkg: 'xorg-x11-server-Xvfb' }, { binary: 'openbox', pkg: 'openbox' }, bus]
    case 'sway':
      return [{ binary: 'sway', pkg: 'sway' }, { binary: 'swaymsg', pkg: 'sway' }, bus]
  }
}

/** The first binary `has` cannot find, as the message `up` fails with; `null` when all are installed. */
export function missingBinaryMessage(binaries: ReadonlyArray<{ binary: string, pkg: string }>, has: (binary: string) => boolean): string | null {
  const missing = binaries.find(entry => !has(entry.binary))
  return missing ? `qa-display: ${missing.binary} not installed (run: sudo dnf install ${missing.pkg})` : null
}

/**
 * Where KDE's global accelerator daemon lives, from `rpm -ql kglobalacceld kf6-kglobalaccel`. Plasma 6 ships it as
 * `libKGlobalAccelD`, which KWin loads in-process when it runs without `--no-global-shortcuts`; only a package that
 * still ships a `kglobalacceld` executable needs a separate process.
 */
export function locateGlobalAccelDaemon(rpmFiles: string): { kind: 'executable' | 'kwin-plugin', path: string } | null {
  const files = rpmFiles.split('\n').map(line => line.trim())
  const executable = files.find(file => /^\/usr\/(?:bin|libexec|lib64\/libexec)\/kglobalacceld\d*$/.test(file))
  if (executable)
    return { kind: 'executable', path: executable }
  const library = files.find(file => /^\/usr\/lib(?:64)?\/libKGlobalAccelD\.so\.\d+$/.test(file))
  return library ? { kind: 'kwin-plugin', path: library } : null
}

/** The push-to-talk binding QA binds over the GlobalShortcuts portal: id and default from `use-push-to-talk-shortcut.ts`. */
export const qaPushToTalkShortcut = { appId: 'ai.moeru.airi', id: 'voice-push-to-talk', trigger: 'Ctrl+Shift+Space', description: 'Push to Talk' } as const

/** `kglobalshortcutsrc` with the app's group pre-filled, so a portal bind may skip KDE's confirmation dialog. */
export function kglobalShortcutsSeed(): string {
  const { appId, id, trigger, description } = qaPushToTalkShortcut
  return `[${appId}]\n_k_friendly_name=AIRI\n${id}=${trigger},${trigger},${description}\n`
}

/** `output size` and nothing else: no bar, no key bindings, no idle or lock. */
export function swayConfig(width: number, height: number): string {
  return `output * resolution ${width}x${height}\n`
}

/** Writes the client environment through a temporary file, so a reader never sees a partial file. */
const writeEnvFile = 'env > "$AIRI_QA_DIR/env.tmp" && mv "$AIRI_QA_DIR/env.tmp" "$AIRI_QA_DIR/env"'

/** The probe sway runs once it accepts clients: hand its sockets to the private bus, then publish the env file. */
export function swayProbeScript(): string {
  return `${updateActivationEnv(['WAYLAND_DISPLAY', 'SWAYSOCK', 'DISPLAY'])}\n${writeEnvFile}\n`
}

/** The lowest X display number from 90 up that has neither a socket nor a lock file. */
export function freeX11Display(taken: ReadonlySet<number>): number {
  let display = 90
  while (taken.has(display))
    display++
  return display
}

/** A bounded wait in tenths of a second; on timeout it records the reason for `up` and exits 1. */
function waitFor(condition: string, tenths: number, reason: string): string {
  return `i=0; until ${condition}; do i=$((i+1)); if [ "$i" -ge ${tenths} ]; then echo "${reason}" > "$AIRI_QA_DIR/error"; exit 1; fi; sleep 0.1; done`
}

const portalProbe = 'busctl --user --timeout=2 get-property org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop org.freedesktop.portal.GlobalShortcuts version >/dev/null 2>&1'

/** Gives D-Bus-activated services the session's display sockets, which exist only once the compositor runs. */
function updateActivationEnv(keys: readonly string[]): string {
  const pairs = keys.map(key => `${key} "\${${key}:-}"`).join(' ')
  return `{ busctl --user --timeout=2 call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus UpdateActivationEnvironment a{ss} ${keys.length} ${pairs} >/dev/null || { echo "the private bus refused the activation environment" > "$AIRI_QA_DIR/error"; exit 1; }; }`
}

/** Host display, session, and desktop keys that the systemd user manager hands every unit; none may reach the session's bus. */
const hostSessionKeys = 'WAYLAND_DISPLAY DISPLAY XAUTHORITY SWAYSOCK HYPRLAND_INSTANCE_SIGNATURE KDE_FULL_SESSION KDE_SESSION_VERSION'

/** Host audio sockets linked into the private runtime directory one by one, so clients keep sound without the rest of the host runtime. */
const hostAudioSockets = ['pipewire-0', 'pipewire-0-manager', 'pulse/native']

/**
 * The unit's first steps for every compositor: drop host display keys, point the runtime, data, and config homes at
 * the session directory, then link the audio sockets. They run before `dbus-daemon`, so every activated service
 * inherits them.
 */
function privateSessionSetup(identity: { XDG_CURRENT_DESKTOP: string, XDG_SESSION_TYPE: string }): string[] {
  return [
    `unset ${hostSessionKeys}`,
    `export XDG_RUNTIME_DIR="$AIRI_QA_DIR/runtime" XDG_DATA_HOME="$AIRI_QA_DIR/data" XDG_CONFIG_HOME="$AIRI_QA_DIR/config" XDG_CURRENT_DESKTOP=${identity.XDG_CURRENT_DESKTOP} XDG_SESSION_TYPE=${identity.XDG_SESSION_TYPE}`,
    `for s in ${hostAudioSockets.join(' ')}; do if [ -S "$AIRI_QA_HOST_RUNTIME_DIR/$s" ]; then mkdir -p "$(dirname "$XDG_RUNTIME_DIR/$s")"; ln -sf "$AIRI_QA_HOST_RUNTIME_DIR/$s" "$XDG_RUNTIME_DIR/$s"; fi; done`,
  ]
}

export interface QaDisplayUnitOptions {
  width: number
  height: number
  windowed: boolean
  compositor: QaCompositor
  portals: boolean
  x11Display?: number
  /** A standalone `kglobalacceld` executable to start with the portals; `undefined` when KWin hosts it. */
  globalAccelExecutable?: string
}

/**
 * The `systemd-run` arguments that start the session.
 * Each compositor runs a probe once it accepts clients (KWin's and openbox's startup command, `swaymsg exec` for sway),
 * and the probe writes the env file, so the env file appearing means the session is ready.
 */
export function qaDisplayUnitArgs(options: QaDisplayUnitOptions, paths: QaDisplayPaths, host: { runtimeDir: string, waylandDisplay?: string }): string[] {
  const busStart = [
    ...privateSessionSetup(sessionIdentity[options.compositor]),
    'dbus-daemon --session --fork --address="unix:path=$AIRI_QA_DIR/bus" >/dev/null',
    'export DBUS_SESSION_BUS_ADDRESS="unix:path=$AIRI_QA_DIR/bus"',
  ]
  let script: string[]
  if (options.compositor === 'kwin') {
    // The private runtime directory does not hold the host compositor's socket, so the windowed backend gets an absolute path.
    const hostDisplay = host.waylandDisplay ?? 'wayland-0'
    const backend = options.windowed
      ? ['--wayland-display', hostDisplay.startsWith('/') ? hostDisplay : join(host.runtimeDir, hostDisplay)]
      : ['--virtual']
    const probe = [
      updateActivationEnv(['WAYLAND_DISPLAY', 'DISPLAY']),
      ...(options.portals
        ? [
            ...(options.globalAccelExecutable ? [`{ ${shellQuote(options.globalAccelExecutable)} & }`] : []),
            '{ /usr/libexec/xdg-desktop-portal-kde & }',
            '{ /usr/libexec/xdg-desktop-portal & }',
            waitFor(`${portalProbe} && busctl --user --timeout=2 status org.kde.kglobalaccel >/dev/null 2>&1`, 150, 'the GlobalShortcuts portal or org.kde.kglobalaccel did not answer on the private bus within 15 seconds'),
          ]
        : []),
      writeEnvFile,
    ].join('; ')
    const kwin = [
      'kwin_wayland',
      ...backend,
      '--xwayland',
      '--socket',
      paths.socket,
      '--width',
      String(options.width),
      '--height',
      String(options.height),
      '--no-lockscreen',
      ...(options.portals ? [] : ['--no-global-shortcuts']),
      '--no-kactivities',
      `sh -c ${shellQuote(probe)}`,
    ]
    script = [...busStart, `exec ${kwin.map(shellQuote).join(' ')}`]
  }
  else if (options.compositor === 'x11') {
    const display = options.x11Display ?? 90
    script = [
      ...busStart,
      `export DISPLAY=:${display}`,
      updateActivationEnv(['DISPLAY']),
      `{ Xvfb :${display} -screen 0 ${options.width}x${options.height}x24 -nolisten tcp & }`,
      waitFor(`[ -S /tmp/.X11-unix/X${display} ]`, 100, `Xvfb did not open display :${display} within 10 seconds`),
      `exec openbox --startup ${shellQuote(`sh -c ${shellQuote(writeEnvFile)}`)}`,
    ]
  }
  else {
    script = [
      ...busStart,
      'export WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1',
      '{ sway -c "$AIRI_QA_DIR/sway.conf" & }',
      'pid=$!',
      'sock="$XDG_RUNTIME_DIR/sway-ipc.$(id -u).$pid.sock"',
      waitFor('[ -S "$sock" ]', 100, 'sway did not open its IPC socket within 10 seconds'),
      `SWAYSOCK="$sock" swaymsg exec ${shellQuote('sh "$AIRI_QA_DIR/sway-probe.sh"')} >/dev/null`,
      'wait "$pid"',
    ]
  }
  return [
    '--user',
    `--unit=${paths.unit}`,
    '--collect',
    '--quiet',
    '--property=KillMode=control-group',
    `--setenv=AIRI_QA_DIR=${paths.dir}`,
    `--setenv=AIRI_QA_COMPOSITOR=${options.compositor}`,
    `--setenv=AIRI_QA_PORTALS=${options.portals ? '1' : '0'}`,
    `--setenv=AIRI_QA_HOST_RUNTIME_DIR=${host.runtimeDir}`,
    '/bin/sh',
    '-c',
    script.join(' && '),
  ]
}

function shellQuote(word: string): string {
  return /^[\w./=:-]+$/.test(word) ? word : `'${word.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * What a client inside each compositor gets: `sets` are taken from the env file (or fixed), `deletes` are removed
 * from the inherited host environment so a KDE, sway, or Hyprland host cannot leak into the session.
 * `XAUTHORITY` is deleted everywhere because the session X servers accept local clients without a cookie.
 * Sway sets `DISPLAY` only when it started Xwayland and deletes it otherwise.
 * Every compositor also sets the session's private `XDG_RUNTIME_DIR`, where its Wayland socket lives, and
 * `AIRI_QA_HOST_RUNTIME_DIR`, so `pnpm qa:display` still finds the user's systemd and sessions from inside a session.
 */
export const sessionKeys: Record<QaCompositor, { sets: readonly string[], deletes: readonly string[] }> = {
  kwin: {
    sets: ['XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR'],
    deletes: ['SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE', 'XAUTHORITY'],
  },
  x11: {
    sets: ['XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR'],
    deletes: ['WAYLAND_DISPLAY', 'SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE', 'KDE_FULL_SESSION', 'KDE_SESSION_VERSION', 'XAUTHORITY'],
  },
  sway: {
    sets: ['XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'SWAYSOCK', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR', 'DISPLAY'],
    deletes: ['HYPRLAND_INSTANCE_SIGNATURE', 'KDE_FULL_SESSION', 'KDE_SESSION_VERSION', 'XAUTHORITY'],
  },
}

/** Keys each compositor's env file must hold before the session counts as ready. */
const requiredKeys: Record<QaCompositor, readonly string[]> = {
  kwin: ['WAYLAND_DISPLAY', 'DISPLAY', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR'],
  x11: ['DISPLAY', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR'],
  sway: ['WAYLAND_DISPLAY', 'SWAYSOCK', 'XDG_RUNTIME_DIR', 'AIRI_QA_HOST_RUNTIME_DIR'],
}

export interface QaSession {
  compositor: QaCompositor
  portals: boolean
  /** Key to value; an empty value removes the key from the client environment. */
  env: Record<string, string>
}

export function parseSessionEnv(text: string): QaSession | null {
  const values = new Map<string, string>()
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0)
      values.set(line.slice(0, at), line.slice(at + 1))
  }
  const compositor = values.get('AIRI_QA_COMPOSITOR') as QaCompositor | undefined
  const bus = values.get('DBUS_SESSION_BUS_ADDRESS')
  if (!compositor || !qaCompositors.includes(compositor) || !bus || requiredKeys[compositor].some(key => !values.get(key)))
    return null
  const env: Record<string, string> = { ...sessionIdentity[compositor] }
  for (const key of sessionKeys[compositor].sets) {
    if (!(key in env))
      env[key] = values.get(key) ?? ''
  }
  for (const key of sessionKeys[compositor].deletes)
    env[key] = ''
  return { compositor, portals: values.get('AIRI_QA_PORTALS') === '1', env }
}

/** The host environment with the session keys replaced. An empty value removes the key, so host display keys cannot leak in. */
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

/**
 * Mount points under the session directory, deepest first, from `/proc/self/mountinfo`. A FUSE helper the unit stop
 * killed (the document portal, gvfsd-fuse) can leave its mount behind; `down` lazily unmounts exactly these.
 */
export function sessionMountTargets(mountinfo: string, sessionDir: string): string[] {
  const prefix = `${sessionDir}/`
  return mountinfo.split('\n')
    .map(line => line.split(' ')[4])
    .filter((target): target is string => Boolean(target))
    .map(target => target.replace(/\\(\d{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))))
    .filter(target => target.startsWith(prefix))
    .sort((a, b) => b.length - a.length)
}

export function shellExports(session: Record<string, string>, name: string): string {
  const lines = [`export AIRI_QA_DISPLAY=${shellQuote(name)}`]
  for (const [key, value] of Object.entries(session))
    lines.push(value ? `export ${key}=${shellQuote(value)}` : `unset ${key}`)
  return lines.join('\n')
}

/**
 * The command that moves the session pointer to an absolute position. On kwin it plays a one-row table through the
 * qa-tools EIS helper (`packages/qa-tools/scripts/linux/kwin-pointer.py play`), which prints the cursor read back from KWin.
 */
export function pointerCommand(compositor: QaCompositor, point: { x: number, y: number }, kwinHelper: string, nowMs: number): { command: string, args: string[], input?: string } {
  switch (compositor) {
    case 'kwin':
      return { command: 'python3', args: ['-I', kwinHelper, 'play'], input: `${nowMs} 0\n0,${point.x},${point.y},0` }
    case 'x11':
      return { command: 'xdotool', args: ['mousemove', String(point.x), String(point.y)] }
    case 'sway':
      return { command: 'swaymsg', args: ['seat', '-', 'cursor', 'set', String(point.x), String(point.y)] }
  }
}
