import { describe, expect, it } from 'vitest'

import { clientEnv, freeX11Display, kglobalShortcutsSeed, locateGlobalAccelDaemon, missingBinaryMessage, parseQaDisplayArgs, parseSessionEnv, pointerCommand, qaDisplayGuard, qaDisplayPaths, qaDisplayUnitArgs, requiredBinaries, sessionMountTargets, shellExports, swayConfig, swayProbeScript, takeAllowHostSession } from './qa-display-plan'

describe('qa display arguments', () => {
  it('defaults to a 1920x1080 headless session named qa without portals', () => {
    expect(parseQaDisplayArgs(['up'])).toEqual({ command: 'up', name: 'qa', width: 1920, height: 1080, windowed: false, portals: false, argv: [] })
  })

  it('reads name, size, windowed, and the command after --', () => {
    expect(parseQaDisplayArgs(['run', '--name', 'agent-2', '--size', '2560x1440', '--windowed', '--', 'pnpm', 'qa:stage', '--', '--x'])).toEqual({
      command: 'run',
      name: 'agent-2',
      width: 2560,
      height: 1440,
      windowed: true,
      portals: false,
      argv: ['pnpm', 'qa:stage', '--', '--x'],
    })
  })

  it('reads the compositor and portals', () => {
    expect(parseQaDisplayArgs(['up', '--compositor', 'x11'])).toMatchObject({ compositor: 'x11', portals: false })
    expect(parseQaDisplayArgs(['up', '--compositor', 'sway'])).toMatchObject({ compositor: 'sway' })
    expect(parseQaDisplayArgs(['up', '--portals'])).toMatchObject({ portals: true })
    expect(parseQaDisplayArgs(['up', '--portals'])).not.toHaveProperty('compositor')
    expect(parseQaDisplayArgs(['up', '--compositor', 'kwin', '--portals'])).toMatchObject({ compositor: 'kwin', portals: true })
  })

  it('rejects an unknown compositor and portals or windowed outside kwin', () => {
    expect(parseQaDisplayArgs(['up', '--compositor', 'gnome'])).toEqual({ error: '--compositor must be one of kwin, x11, sway' })
    expect(parseQaDisplayArgs(['up', '--compositor'])).toEqual({ error: '--compositor needs a value' })
    expect(parseQaDisplayArgs(['up', '--compositor', 'x11', '--portals'])).toEqual({ error: '--portals needs the kwin compositor' })
    expect(parseQaDisplayArgs(['up', '--portals', '--compositor', 'sway'])).toEqual({ error: '--portals needs the kwin compositor' })
    expect(parseQaDisplayArgs(['up', '--compositor', 'sway', '--windowed'])).toEqual({ error: '--windowed needs the kwin compositor' })
  })

  it('takes one png path for shot', () => {
    expect(parseQaDisplayArgs(['shot', 'out/a.png'])).toMatchObject({ command: 'shot', file: 'out/a.png' })
    expect(parseQaDisplayArgs(['shot'])).toEqual({ error: 'shot needs exactly one output path ending in .png' })
    expect(parseQaDisplayArgs(['shot', 'a.jpg'])).toEqual({ error: 'shot needs exactly one output path ending in .png' })
  })

  it('takes two integer coordinates for pointer', () => {
    expect(parseQaDisplayArgs(['pointer', '100', '200', '--name', 'p'])).toMatchObject({ command: 'pointer', name: 'p', point: { x: 100, y: 200 } })
    const error = { error: 'pointer needs two non-negative integer coordinates: pointer <x> <y>' }
    expect(parseQaDisplayArgs(['pointer', '100'])).toEqual(error)
    expect(parseQaDisplayArgs(['pointer', '1.5', '2'])).toEqual(error)
    expect(parseQaDisplayArgs(['pointer', '-1', '2'])).toEqual(error)
  })

  it('rejects unsafe names, bad sizes, unknown input, and misplaced --', () => {
    expect(parseQaDisplayArgs([])).toEqual({ error: 'missing command' })
    expect(parseQaDisplayArgs(['start'])).toEqual({ error: 'unknown command "start"' })
    expect(parseQaDisplayArgs(['up', '--name', '../x'])).toHaveProperty('error')
    expect(parseQaDisplayArgs(['up', '--name'])).toEqual({ error: '--name needs a value' })
    expect(parseQaDisplayArgs(['up', '--size', '1920'])).toEqual({ error: '--size must look like 1920x1080' })
    expect(parseQaDisplayArgs(['up', '--fast'])).toEqual({ error: 'unknown flag "--fast"' })
    expect(parseQaDisplayArgs(['up', 'extra'])).toEqual({ error: 'unexpected argument "extra"' })
    expect(parseQaDisplayArgs(['run'])).toEqual({ error: 'run needs a command after --' })
    expect(parseQaDisplayArgs(['up', '--', 'x'])).toEqual({ error: '-- is only valid with run' })
  })
})

describe('qa display unit', () => {
  const paths = qaDisplayPaths('qa', '/run/user/1000')
  const kwin = { width: 1920, height: 1080, windowed: false, compositor: 'kwin', portals: false } as const
  const host = { runtimeDir: '/run/user/1000', waylandDisplay: 'wayland-1' }

  it('names the unit, socket, and runtime files after the session', () => {
    expect(paths).toEqual({
      unit: 'airi-qa-display-qa.service',
      socket: 'wayland-airi-qa-qa',
      dir: '/run/user/1000/airi-qa-display/qa',
      bus: '/run/user/1000/airi-qa-display/qa/bus',
      envFile: '/run/user/1000/airi-qa-display/qa/env',
      errorFile: '/run/user/1000/airi-qa-display/qa/error',
      runtime: '/run/user/1000/airi-qa-display/qa/runtime',
      data: '/run/user/1000/airi-qa-display/qa/data',
      config: '/run/user/1000/airi-qa-display/qa/config',
      swayConfig: '/run/user/1000/airi-qa-display/qa/sway.conf',
      swayProbe: '/run/user/1000/airi-qa-display/qa/sway-probe.sh',
    })
  })

  it('starts a private bus and a virtual KWin that writes the env file once ready', () => {
    const args = qaDisplayUnitArgs(kwin, paths, host)
    expect(args.slice(0, 9)).toEqual(['--user', '--unit=airi-qa-display-qa.service', '--collect', '--quiet', '--property=KillMode=control-group', '--setenv=AIRI_QA_DIR=/run/user/1000/airi-qa-display/qa', '--setenv=AIRI_QA_COMPOSITOR=kwin', '--setenv=AIRI_QA_PORTALS=0', '--setenv=AIRI_QA_HOST_RUNTIME_DIR=/run/user/1000'])
    expect(args.slice(9, 11)).toEqual(['/bin/sh', '-c'])
    const script = args[11]
    expect(script).toContain('dbus-daemon --session --fork --address="unix:path=$AIRI_QA_DIR/bus"')
    expect(script).toContain('exec kwin_wayland --virtual --xwayland --socket wayland-airi-qa-qa --width 1920 --height 1080 --no-lockscreen --no-global-shortcuts --no-kactivities')
    expect(script).toContain('mv "$AIRI_QA_DIR/env.tmp" "$AIRI_QA_DIR/env"')
    expect(script).not.toContain('portal')
  })

  it.each([
    ['kwin', kwin, 'KDE', 'wayland'],
    ['kwin with portals', { ...kwin, portals: true }, 'KDE', 'wayland'],
    ['x11', { ...kwin, compositor: 'x11', x11Display: 90 }, 'Openbox', 'x11'],
    ['sway', { ...kwin, compositor: 'sway' }, 'sway', 'wayland'],
  ] as const)('%s drops host display keys and exports the private XDG homes before the bus starts', (_, options, desktop, type) => {
    const script = qaDisplayUnitArgs(options, paths, host).at(-1)!
    const steps = script.split(' && ')
    const bus = steps.findIndex(step => step.startsWith('dbus-daemon '))
    expect(steps[0]).toBe('unset WAYLAND_DISPLAY DISPLAY XAUTHORITY SWAYSOCK HYPRLAND_INSTANCE_SIGNATURE KDE_FULL_SESSION KDE_SESSION_VERSION')
    expect(steps[1]).toBe(`export XDG_RUNTIME_DIR="$AIRI_QA_DIR/runtime" XDG_DATA_HOME="$AIRI_QA_DIR/data" XDG_CONFIG_HOME="$AIRI_QA_DIR/config" XDG_CURRENT_DESKTOP=${desktop} XDG_SESSION_TYPE=${type}`)
    expect(steps[2]).toBe('for s in pipewire-0 pipewire-0-manager pulse/native; do if [ -S "$AIRI_QA_HOST_RUNTIME_DIR/$s" ]; then mkdir -p "$(dirname "$XDG_RUNTIME_DIR/$s")"; ln -sf "$AIRI_QA_HOST_RUNTIME_DIR/$s" "$XDG_RUNTIME_DIR/$s"; fi; done')
    expect(bus).toBe(3)
    expect(steps.slice(bus).some(step => /XDG_(?:RUNTIME_DIR|DATA_HOME|CONFIG_HOME)=/.test(step))).toBe(false)
  })

  it('hands the compositor sockets to the private bus activation environment before publishing the env file', () => {
    const kwinScript = qaDisplayUnitArgs(kwin, paths, host).at(-1)!
    expect(kwinScript).toContain('UpdateActivationEnvironment a{ss} 2 WAYLAND_DISPLAY')
    expect(kwinScript.indexOf('UpdateActivationEnvironment')).toBeLessThan(kwinScript.indexOf('env.tmp'))
    expect(qaDisplayUnitArgs({ ...kwin, compositor: 'x11', x11Display: 90 }, paths, host).at(-1)).toContain('UpdateActivationEnvironment a{ss} 1 DISPLAY')
    const probe = swayProbeScript()
    expect(probe).toContain('UpdateActivationEnvironment a{ss} 3 WAYLAND_DISPLAY')
    expect(probe.indexOf('UpdateActivationEnvironment')).toBeLessThan(probe.indexOf('env.tmp'))
  })

  it('opens a window on the host compositor in windowed mode', () => {
    const args = qaDisplayUnitArgs({ ...kwin, width: 1280, height: 720, windowed: true }, paths, host)
    expect(args.at(-1)).toContain('kwin_wayland --wayland-display /run/user/1000/wayland-1 --xwayland')
    expect(args.at(-1)).not.toContain('--virtual')
  })

  it('starts the portals and global shortcuts after KWin, with a private config home and a bounded wait', () => {
    const args = qaDisplayUnitArgs({ ...kwin, portals: true }, paths, host)
    const script = args.at(-1)!
    expect(args).toContain('--setenv=AIRI_QA_PORTALS=1')
    expect(script).toContain('--no-lockscreen --no-kactivities')
    expect(script).not.toContain('--no-global-shortcuts')
    expect(script).toContain('/usr/libexec/xdg-desktop-portal-kde &')
    expect(script).toContain('/usr/libexec/xdg-desktop-portal &')
    expect(script).toContain('org.freedesktop.portal.GlobalShortcuts version')
    expect(script).toContain('busctl --user --timeout=2 status org.kde.kglobalaccel')
    expect(script).toContain('-ge 150')
    expect(script).not.toContain('kglobalacceld')
    expect(qaDisplayUnitArgs({ ...kwin, portals: true, globalAccelExecutable: '/usr/libexec/kglobalacceld' }, paths, host).at(-1)).toContain('/usr/libexec/kglobalacceld &')
  })

  it('runs Xvfb and openbox on a free display for x11', () => {
    const args = qaDisplayUnitArgs({ width: 1280, height: 720, windowed: false, compositor: 'x11', portals: false, x11Display: 91 }, paths, host)
    const script = args.at(-1)!
    expect(args).toContain('--setenv=AIRI_QA_COMPOSITOR=x11')
    expect(script).toContain('export DISPLAY=:91')
    expect(script).toContain('Xvfb :91 -screen 0 1280x720x24 -nolisten tcp &')
    expect(script).toContain('[ -S /tmp/.X11-unix/X91 ]')
    expect(script).toContain('exec openbox --startup')
    expect(script).not.toContain('kwin')
  })

  it('runs headless sway with a generated config and probes through swaymsg', () => {
    const script = qaDisplayUnitArgs({ width: 1280, height: 720, windowed: false, compositor: 'sway', portals: false }, paths, host).at(-1)!
    expect(script).toContain('export WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1')
    expect(script).toContain('sway -c "$AIRI_QA_DIR/sway.conf" &')
    expect(script).toContain('sock="$XDG_RUNTIME_DIR/sway-ipc.$(id -u).$pid.sock"')
    expect(script).toContain('SWAYSOCK="$sock" swaymsg exec \'sh "$AIRI_QA_DIR/sway-probe.sh"\'')
    expect(swayConfig(1280, 720)).toBe('output * resolution 1280x720\n')
  })

  it('picks the first X display from 90 without a socket or lock', () => {
    expect(freeX11Display(new Set([0, 1]))).toBe(90)
    expect(freeX11Display(new Set([90, 91, 93]))).toBe(92)
  })

  it('finds only the mounts under the session directory, deepest first', () => {
    const mountinfo = [
      '891 946 0:91 / /run/user/1000/doc rw,nosuid,nodev,relatime shared:693 - fuse.portal portal rw,user_id=1000,group_id=1000',
      '1151 946 0:107 / /run/user/1000/gvfs rw,nosuid,nodev - fuse.gvfsd-fuse gvfsd-fuse rw',
      '1200 946 0:120 / /run/user/1000/airi-qa-display/qa/runtime/doc rw - fuse.portal portal rw',
      '1201 946 0:121 / /run/user/1000/airi-qa-display/qa/runtime/gvfs rw - fuse.gvfsd-fuse gvfsd-fuse rw',
      '1202 946 0:122 / /run/user/1000/airi-qa-display/qa/runtime/doc/by-app rw - fuse.portal portal rw',
      '1203 946 0:123 / /run/user/1000/airi-qa-display/qa-2/runtime/doc rw - fuse.portal portal rw',
      '1204 946 0:124 / /run/user/1000/airi-qa-display/qa/runtime/a\\040b rw - fuse x rw',
    ].join('\n')
    expect(sessionMountTargets(mountinfo, '/run/user/1000/airi-qa-display/qa')).toEqual([
      '/run/user/1000/airi-qa-display/qa/runtime/doc/by-app',
      '/run/user/1000/airi-qa-display/qa/runtime/gvfs',
      '/run/user/1000/airi-qa-display/qa/runtime/doc',
      '/run/user/1000/airi-qa-display/qa/runtime/a b',
    ])
  })
})

describe('qa display binaries', () => {
  it.each([
    ['kwin', false, ['kwin_wayland', 'Xwayland', 'dbus-daemon']],
    ['kwin', true, ['kwin_wayland', 'Xwayland', 'dbus-daemon', '/usr/libexec/xdg-desktop-portal', '/usr/libexec/xdg-desktop-portal-kde', 'busctl']],
    ['x11', false, ['Xvfb', 'openbox', 'dbus-daemon']],
    ['sway', false, ['sway', 'swaymsg', 'dbus-daemon']],
  ] as const)('%s (portals %s) needs %j', (compositor, portals, binaries) => {
    expect(requiredBinaries(compositor, portals).map(entry => entry.binary)).toEqual(binaries)
  })

  it('names the first missing binary and its package', () => {
    expect(missingBinaryMessage(requiredBinaries('x11', false), binary => binary !== 'Xvfb')).toBe('qa-display: Xvfb not installed (run: sudo dnf install xorg-x11-server-Xvfb)')
    expect(missingBinaryMessage(requiredBinaries('sway', false), binary => binary !== 'swaymsg')).toBe('qa-display: swaymsg not installed (run: sudo dnf install sway)')
    expect(missingBinaryMessage(requiredBinaries('kwin', true), binary => !binary.endsWith('-kde'))).toBe('qa-display: /usr/libexec/xdg-desktop-portal-kde not installed (run: sudo dnf install xdg-desktop-portal-kde)')
    expect(missingBinaryMessage(requiredBinaries('kwin', false), () => true)).toBeNull()
  })

  it('finds the global accelerator as a KWin plugin or a standalone executable', () => {
    expect(locateGlobalAccelDaemon('/usr/lib/.build-id/4c\n/usr/lib64/libKGlobalAccelD.so.0\n/usr/lib64/libKGlobalAccelD.so.6.8.2\n/usr/lib64/libKF6GlobalAccel.so.6\n')).toEqual({ kind: 'kwin-plugin', path: '/usr/lib64/libKGlobalAccelD.so.0' })
    expect(locateGlobalAccelDaemon('/usr/bin/kglobalacceld\n/usr/lib64/libKGlobalAccelD.so.0\n')).toEqual({ kind: 'executable', path: '/usr/bin/kglobalacceld' })
    expect(locateGlobalAccelDaemon('package kglobalacceld is not installed\n')).toBeNull()
  })

  it('seeds the push-to-talk trigger in the app group', () => {
    expect(kglobalShortcutsSeed()).toBe('[ai.moeru.airi]\n_k_friendly_name=AIRI\nvoice-push-to-talk=Ctrl+Shift+Space,Ctrl+Shift+Space,Push to Talk\n')
  })
})

describe('qa display session environment', () => {
  const bus = 'unix:path=/run/user/1000/airi-qa-display/qa/bus'
  const rt = '/run/user/1000/airi-qa-display/qa/runtime'
  const own = `XDG_RUNTIME_DIR=${rt}\nAIRI_QA_HOST_RUNTIME_DIR=/run/user/1000\n`
  const ownEnv = { XDG_RUNTIME_DIR: rt, AIRI_QA_HOST_RUNTIME_DIR: '/run/user/1000' }
  const kwinText = `HOME=/home/u\n${own}AIRI_QA_COMPOSITOR=kwin\nAIRI_QA_PORTALS=0\nWAYLAND_DISPLAY=wayland-airi-qa-qa\nDISPLAY=:2\nXAUTHORITY=\nDBUS_SESSION_BUS_ADDRESS=${bus}\nXDG_SESSION_TYPE=wayland\n`
  const kdeHost = { PATH: '/bin', XDG_CURRENT_DESKTOP: 'KDE', KDE_FULL_SESSION: 'true', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }

  it('reads the kwin client keys from the env file', () => {
    expect(parseSessionEnv(kwinText)).toEqual({
      compositor: 'kwin',
      portals: false,
      env: {
        XDG_CURRENT_DESKTOP: 'KDE',
        XDG_SESSION_TYPE: 'wayland',
        WAYLAND_DISPLAY: 'wayland-airi-qa-qa',
        DISPLAY: ':2',
        DBUS_SESSION_BUS_ADDRESS: bus,
        ...ownEnv,
        SWAYSOCK: '',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        XAUTHORITY: '',
      },
    })
    expect(parseSessionEnv(kwinText.replace('AIRI_QA_PORTALS=0', 'AIRI_QA_PORTALS=1'))?.portals).toBe(true)
  })

  it.each([
    ['kwin without the private runtime dir', `AIRI_QA_COMPOSITOR=kwin\nWAYLAND_DISPLAY=w\nDISPLAY=:2\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
    ['kwin without DISPLAY', `${own}AIRI_QA_COMPOSITOR=kwin\nWAYLAND_DISPLAY=w\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
    ['kwin without the bus', `${own}AIRI_QA_COMPOSITOR=kwin\nWAYLAND_DISPLAY=w\nDISPLAY=:2\n`],
    ['x11 without DISPLAY', `${own}AIRI_QA_COMPOSITOR=x11\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
    ['sway without SWAYSOCK', `${own}AIRI_QA_COMPOSITOR=sway\nWAYLAND_DISPLAY=wayland-1\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
    ['no compositor', `${own}WAYLAND_DISPLAY=w\nDISPLAY=:2\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
    ['an unknown compositor', `${own}AIRI_QA_COMPOSITOR=gnome\nWAYLAND_DISPLAY=w\nDISPLAY=:2\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`],
  ])('treats a file with %s as not ready', (_, text) => {
    expect(parseSessionEnv(text)).toBeNull()
  })

  it.each([
    ['kwin', kwinText, { PATH: '/bin', AIRI_QA_DISPLAY: 'qa', AIRI_QA_DISPLAY_SESSION: 'qa', KDE_FULL_SESSION: 'true', KDE_SESSION_VERSION: '6', XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-airi-qa-qa', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: bus, ...ownEnv }],
    ['x11', `${own}AIRI_QA_COMPOSITOR=x11\nDISPLAY=:90\nDBUS_SESSION_BUS_ADDRESS=${bus}\nXDG_SESSION_TYPE=x11\n`, { PATH: '/bin', AIRI_QA_DISPLAY: 'qa', AIRI_QA_DISPLAY_SESSION: 'qa', XDG_CURRENT_DESKTOP: 'Openbox', XDG_SESSION_TYPE: 'x11', DISPLAY: ':90', DBUS_SESSION_BUS_ADDRESS: bus, ...ownEnv }],
    ['sway with Xwayland', `${own}AIRI_QA_COMPOSITOR=sway\nWAYLAND_DISPLAY=wayland-1\nSWAYSOCK=/run/user/1000/sway-ipc.1000.7.sock\nDISPLAY=:3\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`, { PATH: '/bin', AIRI_QA_DISPLAY: 'qa', AIRI_QA_DISPLAY_SESSION: 'qa', XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1', SWAYSOCK: '/run/user/1000/sway-ipc.1000.7.sock', DISPLAY: ':3', DBUS_SESSION_BUS_ADDRESS: bus, ...ownEnv }],
    ['sway without Xwayland', `${own}AIRI_QA_COMPOSITOR=sway\nWAYLAND_DISPLAY=wayland-1\nSWAYSOCK=/run/user/1000/sway-ipc.1000.7.sock\nDBUS_SESSION_BUS_ADDRESS=${bus}\n`, { PATH: '/bin', AIRI_QA_DISPLAY: 'qa', AIRI_QA_DISPLAY_SESSION: 'qa', XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1', SWAYSOCK: '/run/user/1000/sway-ipc.1000.7.sock', DBUS_SESSION_BUS_ADDRESS: bus, ...ownEnv }],
  ])('turns an inherited KDE host environment into the exact %s client environment', (_, text, expected) => {
    expect(clientEnv({ ...kdeHost, XDG_RUNTIME_DIR: '/run/user/1000', XAUTHORITY: '/run/user/1000/xauth_x', SWAYSOCK: '/x', HYPRLAND_INSTANCE_SIGNATURE: 'h', KDE_SESSION_VERSION: '6' }, parseSessionEnv(text)!.env, 'qa')).toEqual(expected)
  })

  it('prints shell exports that unset deleted keys', () => {
    expect(shellExports(parseSessionEnv(kwinText)!.env, 'qa')).toBe([
      'export AIRI_QA_DISPLAY=qa',
      'export AIRI_QA_DISPLAY_SESSION=qa',
      'export XDG_CURRENT_DESKTOP=KDE',
      'export XDG_SESSION_TYPE=wayland',
      'export WAYLAND_DISPLAY=wayland-airi-qa-qa',
      'export DISPLAY=:2',
      `export DBUS_SESSION_BUS_ADDRESS=${bus}`,
      `export XDG_RUNTIME_DIR=${rt}`,
      'export AIRI_QA_HOST_RUNTIME_DIR=/run/user/1000',
      'unset SWAYSOCK',
      'unset HYPRLAND_INSTANCE_SIGNATURE',
      'unset XAUTHORITY',
    ].join('\n'))
  })
})

describe('qa display host session guard', () => {
  const bus = 'unix:path=/run/user/1000/airi-qa-display/lsp/bus'
  const kwinText = `XDG_RUNTIME_DIR=/run/user/1000/airi-qa-display/lsp/runtime\nAIRI_QA_HOST_RUNTIME_DIR=/run/user/1000\nAIRI_QA_COMPOSITOR=kwin\nAIRI_QA_PORTALS=0\nWAYLAND_DISPLAY=wayland-airi-qa-lsp\nDISPLAY=:2\nDBUS_SESSION_BUS_ADDRESS=${bus}\nXDG_SESSION_TYPE=wayland\n`
  const session = parseSessionEnv(kwinText)!
  const kdeHost = { PATH: '/bin', XDG_CURRENT_DESKTOP: 'KDE', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland', XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }
  const inside = clientEnv(kdeHost, session.env, 'lsp')
  const guard = (overrides: Partial<Parameters<typeof qaDisplayGuard>[0]>) => qaDisplayGuard({ command: 'qa:smoke', platform: 'linux', env: inside, allowHostSession: false, session, unitActive: true, ...overrides })

  it('lets a command run inside the live session it names', () => {
    expect(guard({})).toEqual({ ok: true })
  })

  it('refuses the older AIRI_QA_DISPLAY name alone as a session marker', () => {
    expect(guard({ env: { ...inside, AIRI_QA_DISPLAY_SESSION: undefined } }).ok).toBe(false)
  })

  it.each([
    ['no session marker', { env: kdeHost }, 'AIRI_QA_DISPLAY_SESSION is not set'],
    ['a marker that is not a session name', { env: { ...inside, AIRI_QA_DISPLAY_SESSION: '../x' } }, 'is not a qa:display session name'],
    ['a stale marker whose unit stopped', { unitActive: false }, 'the qa:display session "lsp" is not running'],
    ['a stale marker whose env file is gone', { session: null }, 'the qa:display session "lsp" is not running'],
    ['a marker set by hand on the host display', { env: { ...kdeHost, AIRI_QA_DISPLAY_SESSION: 'lsp' } }, 'does not match the qa:display session "lsp"'],
    ['the host bus inside the session', { env: { ...inside, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' } }, 'DBUS_SESSION_BUS_ADDRESS does not match'],
    ['no bus inherited inside the session', { env: { ...inside, DBUS_SESSION_BUS_ADDRESS: undefined } }, 'DBUS_SESSION_BUS_ADDRESS does not match'],
    ['a host sway socket leaking into a kwin session', { env: { ...inside, SWAYSOCK: '/run/user/1000/sway.sock' } }, 'SWAYSOCK does not match'],
  ])('refuses on Linux with %s and names qa:display run', (_, overrides, reason) => {
    const verdict = guard(overrides)
    expect(verdict.ok).toBe(false)
    expect(verdict).toHaveProperty('message', expect.stringContaining(reason))
    expect(verdict).toHaveProperty('message', expect.stringContaining('pnpm qa:display run -- pnpm qa:smoke'))
  })

  it('lets the explicit escape hatch and other platforms through without a session', () => {
    expect(guard({ env: kdeHost, session: null, unitActive: false, allowHostSession: true })).toEqual({ ok: true })
    expect(guard({ env: kdeHost, session: null, unitActive: false, platform: 'win32' })).toEqual({ ok: true })
    expect(guard({ env: kdeHost, session: null, unitActive: false, platform: 'darwin' })).toEqual({ ok: true })
  })

  it('strips the escape hatch from the arguments the command parses', () => {
    expect(takeAllowHostSession(['--model', 'a.vrm', '--allow-host-session'])).toEqual({ argv: ['--model', 'a.vrm'], allowHostSession: true })
    expect(takeAllowHostSession(['run', '--say', 'hi'])).toEqual({ argv: ['run', '--say', 'hi'], allowHostSession: false })
  })
})

describe('qa display pointer', () => {
  it.each([
    ['kwin', { command: 'python3', args: ['-I', '/h/kwin-pointer.py', 'play'], input: '1000 0\n0,10,20,0' }],
    ['x11', { command: 'xdotool', args: ['mousemove', '10', '20'] }],
    ['sway', { command: 'swaymsg', args: ['seat', '-', 'cursor', 'set', '10', '20'] }],
  ] as const)('routes %s to its pointer tool', (compositor, expected) => {
    expect(pointerCommand(compositor, { x: 10, y: 20 }, '/h/kwin-pointer.py', 1000)).toEqual(expected)
  })
})
