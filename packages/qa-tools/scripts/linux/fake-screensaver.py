"""Fake `org.freedesktop.ScreenSaver` for lock QA inside a `pnpm qa:display` session.

Run with `pnpm qa:display run --name <name> -- python3 -I fake-screensaver.py --lock-after <s> --unlock-after <s>`.

It exports `/org/freedesktop/ScreenSaver` and only then owns the name on the session bus in DBUS_SESSION_BUS_ADDRESS,
so a client that reads `GetActive` when the name appears reads `false`. `--lock-after` seconds after the start it emits
`ActiveChanged(true)`, `--unlock-after` seconds after the start `ActiveChanged(false)`, and exits 5 s later. Each step prints
one JSON line on stdout.

It refuses to start outside a QA display (exit 2): `pnpm qa:display run` sets AIRI_QA_DISPLAY_SESSION and a private
DBUS_SYSTEM_BUS_ADDRESS, and the private session bus has no ScreenSaver of its own. On the user's desktop the real
screen locker owns the name, so the helper also refuses when the name already has an owner.
"""

import argparse
import json
import os
import sys
import time

NAME = 'org.freedesktop.ScreenSaver'
PATH = '/org/freedesktop/ScreenSaver'
UNLOCK_LINGER_MS = 5000
XML = f'''<node>
  <interface name="{NAME}">
    <method name="GetActive"><arg type="b" direction="out"/></method>
    <signal name="ActiveChanged"><arg type="b"/></signal>
  </interface>
</node>'''


def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def refuse(message):
    sys.stderr.write(f'fake-screensaver: {message}\n')
    sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description='Owns org.freedesktop.ScreenSaver on a QA display bus and plays a lock.')
    parser.add_argument('--lock-after', type=float, required=True, help='seconds from start until ActiveChanged(true)')
    parser.add_argument('--unlock-after', type=float, required=True, help='seconds from start until ActiveChanged(false)')
    args = parser.parse_args()
    if not 0 <= args.lock_after < args.unlock_after:
        refuse('--lock-after must be at least 0 and less than --unlock-after')
    if not os.environ.get('AIRI_QA_DISPLAY_SESSION') or not os.environ.get('DBUS_SYSTEM_BUS_ADDRESS'):
        refuse('not inside a QA display; run it through `pnpm qa:display run --`')

    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    owner = bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner',
                          GLib.Variant('(s)', (NAME,)), GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 5000, None)
    if owner.unpack()[0]:
        refuse(f'{NAME} already has an owner on this bus')

    loop = GLib.MainLoop()
    state = {'active': False, 'code': 0}

    def on_call(_connection, _sender, _path, _interface, method, _parameters, invocation):
        if method == 'GetActive':
            invocation.return_value(GLib.Variant('(b)', (state['active'],)))
        else:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownMethod', method)

    interface = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
    bus.register_object(PATH, interface, on_call, None, None)

    def set_active(active):
        state['active'] = active
        bus.emit_signal(None, PATH, NAME, 'ActiveChanged', GLib.Variant('(b)', (active,)))
        emit({'event': 'lock' if active else 'unlock', 'atMs': round(time.monotonic() * 1000)})
        if not active:
            # The app resolves the owner of the name when a signal arrives and drops the signal when the name has
            # no owner, so keep the name for a while after the unlock.
            bus.flush_sync(None)
            GLib.timeout_add(UNLOCK_LINGER_MS, lambda: (loop.quit(), GLib.SOURCE_REMOVE)[1])
        return GLib.SOURCE_REMOVE

    def on_acquired(_connection, _name):
        emit({'event': 'owned', 'name': NAME, 'atMs': round(time.monotonic() * 1000)})
        GLib.timeout_add(round(args.lock_after * 1000), set_active, True)
        GLib.timeout_add(round(args.unlock_after * 1000), set_active, False)

    def on_lost(_connection, _name):
        sys.stderr.write(f'fake-screensaver: could not own {NAME}\n')
        state['code'] = 1
        loop.quit()

    # DO_NOT_QUEUE: losing a race to a real locker must fail, not wait for it.
    owner_id = Gio.bus_own_name_on_connection(bus, NAME, Gio.BusNameOwnerFlags.DO_NOT_QUEUE, on_acquired, on_lost)
    loop.run()
    Gio.bus_unown_name(owner_id)
    return state['code']


if __name__ == '__main__':
    sys.exit(main())
