import process from 'node:process'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll } from 'vitest'

/**
 * Vitest setup file for test projects that exercise desktop sensors and QA tooling. It removes every way a test could
 * reach the user's desktop session: the display, compositor, and bus variables are gone, both bus addresses name a
 * socket that does not exist, and `XDG_RUNTIME_DIR` is a fresh empty directory. A test that needs a display or bus
 * starts a private one and passes its address explicitly; an accidental default connection fails instead.
 */
const runtimeDir = mkdtempSync(join(tmpdir(), 'airi-test-runtime-'))
const missingBus = `unix:path=${join(runtimeDir, 'no-bus')}`

for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE', 'XAUTHORITY'])
  delete process.env[key]
process.env.DBUS_SESSION_BUS_ADDRESS = missingBus
process.env.DBUS_SYSTEM_BUS_ADDRESS = missingBus
process.env.XDG_RUNTIME_DIR = runtimeDir

afterAll(() => {
  rmSync(runtimeDir, { recursive: true, force: true })
})
