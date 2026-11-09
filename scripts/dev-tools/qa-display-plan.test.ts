import { describe, expect, it } from 'vitest'

import { clientEnv, parseQaDisplayArgs, parseSessionEnv, qaDisplayPaths, qaDisplayUnitArgs, shellExports } from './qa-display-plan'

describe('qa display arguments', () => {
  it('defaults to a 1920x1080 headless session named qa', () => {
    expect(parseQaDisplayArgs(['up'])).toEqual({ command: 'up', name: 'qa', width: 1920, height: 1080, windowed: false, argv: [] })
  })

  it('reads name, size, windowed, and the command after --', () => {
    expect(parseQaDisplayArgs(['run', '--name', 'agent-2', '--size', '2560x1440', '--windowed', '--', 'pnpm', 'qa:stage', '--', '--x'])).toEqual({
      command: 'run',
      name: 'agent-2',
      width: 2560,
      height: 1440,
      windowed: true,
      argv: ['pnpm', 'qa:stage', '--', '--x'],
    })
  })

  it('takes one png path for shot', () => {
    expect(parseQaDisplayArgs(['shot', 'out/a.png'])).toMatchObject({ command: 'shot', file: 'out/a.png' })
    expect(parseQaDisplayArgs(['shot'])).toEqual({ error: 'shot needs exactly one output path ending in .png' })
    expect(parseQaDisplayArgs(['shot', 'a.jpg'])).toEqual({ error: 'shot needs exactly one output path ending in .png' })
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

  it('names the unit, socket, and runtime files after the session', () => {
    expect(paths).toEqual({
      unit: 'airi-qa-display-qa.service',
      socket: 'wayland-airi-qa-qa',
      dir: '/run/user/1000/airi-qa-display/qa',
      bus: '/run/user/1000/airi-qa-display/qa/bus',
      envFile: '/run/user/1000/airi-qa-display/qa/env',
    })
  })

  it('starts a private bus and a virtual KWin that writes the env file once ready', () => {
    const args = qaDisplayUnitArgs({ width: 1920, height: 1080, windowed: false }, paths, 'wayland-1')
    expect(args.slice(0, 6)).toEqual(['--user', '--unit=airi-qa-display-qa.service', '--collect', '--quiet', '--property=KillMode=control-group', '--setenv=AIRI_QA_DIR=/run/user/1000/airi-qa-display/qa'])
    expect(args.slice(6, 8)).toEqual(['/bin/sh', '-c'])
    const script = args[8]
    expect(script).toMatch(/^dbus-daemon --session --fork --address="unix:path=\$AIRI_QA_DIR\/bus"/)
    expect(script).toContain('exec kwin_wayland --virtual --xwayland --socket wayland-airi-qa-qa --width 1920 --height 1080 --no-lockscreen')
    expect(script).toContain('mv "$AIRI_QA_DIR/env.tmp" "$AIRI_QA_DIR/env"')
  })

  it('opens a window on the host compositor in windowed mode', () => {
    const args = qaDisplayUnitArgs({ width: 1280, height: 720, windowed: true }, paths, 'wayland-1')
    expect(args).toContain('--setenv=WAYLAND_DISPLAY=wayland-1')
    expect(args.at(-1)).toContain('kwin_wayland --wayland-display wayland-1 --xwayland')
    expect(args.at(-1)).not.toContain('--virtual')
  })
})

describe('qa display session environment', () => {
  const envText = 'HOME=/home/u\nWAYLAND_DISPLAY=wayland-airi-qa-qa\nDISPLAY=:2\nXAUTHORITY=\nDBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/airi-qa-display/qa/bus\nXDG_SESSION_TYPE=wayland\n'

  it('reads the client keys from the env file', () => {
    expect(parseSessionEnv(envText)).toEqual({
      WAYLAND_DISPLAY: 'wayland-airi-qa-qa',
      DISPLAY: ':2',
      XAUTHORITY: '',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/airi-qa-display/qa/bus',
      XDG_SESSION_TYPE: 'wayland',
    })
  })

  it('treats a file without the Wayland, X, or bus address as not ready', () => {
    expect(parseSessionEnv('WAYLAND_DISPLAY=wayland-airi-qa-qa\nDISPLAY=:2\n')).toBeNull()
  })

  it('replaces host display keys and drops the host XAUTHORITY', () => {
    const session = parseSessionEnv(envText)!
    const env = clientEnv({ PATH: '/bin', WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0', XAUTHORITY: '/run/user/1000/xauth_x' }, session, 'qa')
    expect(env).toEqual({ PATH: '/bin', AIRI_QA_DISPLAY: 'qa', WAYLAND_DISPLAY: 'wayland-airi-qa-qa', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/airi-qa-display/qa/bus', XDG_SESSION_TYPE: 'wayland' })
  })

  it('prints shell exports that unset empty keys', () => {
    expect(shellExports(parseSessionEnv(envText)!, 'qa')).toBe([
      'export AIRI_QA_DISPLAY=qa',
      'export WAYLAND_DISPLAY=wayland-airi-qa-qa',
      'export DISPLAY=:2',
      'unset XAUTHORITY',
      'export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/airi-qa-display/qa/bus',
      'export XDG_SESSION_TYPE=wayland',
    ].join('\n'))
  })
})
