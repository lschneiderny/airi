"""Real-pointer input for rendered QA inside a `pnpm qa:display` KWin session.

Run with `python3 -I kwin-pointer.py <command>`. Every command prints one JSON object on stdout.

  probe  Reports whether PyGObject, libei, KWin scripting, and the KWin EIS interface are available.
  query  Reports the output geometry, the cursor position, the active window, and every normal window.
  play   Reads a `<startAtMs> <pressDwellMs>` line and a `tMs,x,y,phase;...` table (phase 0 move, 1 down, 2 up, 3 leave) from stdin,
         plays it as absolute pointer input through KWin's EIS, and prints a receipt with the cursor read back.

The helper talks only to the session bus in DBUS_SESSION_BUS_ADDRESS. The TypeScript caller refuses to start it
outside a QA display, so it never drives the user's desktop.
"""

import ctypes
import json
import os
import select
import sys
import tempfile
import time

BTN_LEFT = 0x110
CAP_POINTER = 1 << 0
CAP_POINTER_ABSOLUTE = 1 << 1
CAP_BUTTON = 1 << 5
EVENT_SEAT_ADDED = 3
EVENT_DEVICE_RESUMED = 8
EIS_PATH = '/org/kde/KWin/EIS/RemoteDesktop'
EIS_INTERFACE = 'org.kde.KWin.EIS.RemoteDesktop'


def emit(value):
    print(json.dumps(value, separators=(',', ':')))


def fail(message):
    sys.stderr.write(f'{message}\n')
    sys.exit(1)


def import_gio():
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
    return Gio, GLib


def load_libei():
    ei = ctypes.CDLL('libei.so.1')
    vp, c_int, c_bool, c_double, c_uint32, c_uint64 = ctypes.c_void_p, ctypes.c_int, ctypes.c_bool, ctypes.c_double, ctypes.c_uint32, ctypes.c_uint64
    for name, res, args in [
        ('ei_new_sender', vp, [vp]), ('ei_configure_name', None, [vp, ctypes.c_char_p]), ('ei_setup_backend_fd', c_int, [vp, c_int]),
        ('ei_get_fd', c_int, [vp]), ('ei_dispatch', None, [vp]), ('ei_get_event', vp, [vp]), ('ei_event_get_type', c_int, [vp]),
        ('ei_event_get_seat', vp, [vp]), ('ei_event_get_device', vp, [vp]), ('ei_event_unref', vp, [vp]), ('ei_unref', vp, [vp]),
        ('ei_device_has_capability', c_bool, [vp, c_int]), ('ei_device_start_emulating', None, [vp, c_uint32]),
        ('ei_device_stop_emulating', None, [vp]),
        ('ei_device_pointer_motion_absolute', None, [vp, c_double, c_double]), ('ei_device_button_button', None, [vp, c_uint32, c_bool]),
        ('ei_device_frame', None, [vp, c_uint64]), ('ei_now', c_uint64, [vp]),
    ]:
        function = getattr(ei, name)
        function.restype = res
        function.argtypes = args
    # NOTICE:
    # ei_seat_bind_capabilities is variadic, so ctypes cannot declare its argtypes.
    # Undeclared pointer arguments are passed as C ints and truncated to 32 bits, which crashes libei.
    # Source: libei.h `ei_seat_bind_capabilities(struct ei_seat *seat, ...)`; the caller wraps every argument in c_void_p/c_int.
    # Removal condition: libei gains a non-variadic bind call that ctypes can declare.
    ei.ei_seat_bind_capabilities.restype = None
    return ei


def session_bus():
    Gio, GLib = import_gio()
    return Gio, GLib, Gio.bus_get_sync(Gio.BusType.SESSION, None)


def eis_available(Gio, GLib, bus):
    xml = bus.call_sync('org.kde.KWin', EIS_PATH, 'org.freedesktop.DBus.Introspectable', 'Introspect', None,
                        GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    return f'"{EIS_INTERFACE}"' in xml


KWIN_SCRIPT = '''
const windows = []
for (const w of workspace.windowList()) {
  if (w.desktopWindow || w.dock) continue
  const f = w.frameGeometry, c = w.clientGeometry
  windows.push({ pid: w.pid, caption: w.caption, resourceClass: w.resourceClass, active: w.active, minimized: w.minimized, stack: w.stackingOrder,
    frame: { x: f.x, y: f.y, width: f.width, height: f.height }, client: { x: c.x, y: c.y, width: c.width, height: c.height } })
}
const s = workspace.virtualScreenGeometry, p = workspace.cursorPos, a = workspace.activeWindow
callDBus(%(name)s, "/", %(name)s, "Report", JSON.stringify({
  screen: { x: s.x, y: s.y, width: s.width, height: s.height },
  cursor: { x: p.x, y: p.y },
  activePid: a ? a.pid : 0,
  activeName: a ? (a.resourceClass || a.caption || null) : null,
  windows,
}))
'''


def query_kwin(Gio, GLib, bus):
    """Loads a one-shot KWin script that calls back to a bus name this process owns; `print()` never reaches us."""
    name = f'org.airi.QaPointer.p{os.getpid()}'
    xml = f'<node><interface name="{name}"><method name="Report"><arg type="s" direction="in"/></method></interface></node>'
    loop, result = GLib.MainLoop(), {}

    def on_call(conn, sender, path, iface, method, params, invocation):
        result['report'] = json.loads(params.unpack()[0])
        invocation.return_value(None)
        loop.quit()

    registration = bus.register_object('/', Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0], on_call, None, None)
    owner = Gio.bus_own_name_on_connection(bus, name, Gio.BusNameOwnerFlags.NONE, None, None)
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as script:
        script.write(KWIN_SCRIPT % {'name': json.dumps(name)})
    plugin = f'airi-qa-pointer-{os.getpid()}'

    def kwin(path, iface, method, args=None, reply=None):
        return bus.call_sync('org.kde.KWin', path, iface, method, args, reply, Gio.DBusCallFlags.NONE, 5000, None)

    try:
        script_id = kwin('/Scripting', 'org.kde.kwin.Scripting', 'loadScript', GLib.Variant('(ss)', (script.name, plugin)), GLib.VariantType('(i)')).unpack()[0]
        if script_id < 0:
            fail(f'kwin-script-load-failed: loadScript returned {script_id}')
        kwin(f'/Scripting/Script{script_id}', 'org.kde.kwin.Script', 'run')
        GLib.timeout_add(5000, loop.quit)
        loop.run()
    finally:
        kwin('/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', GLib.Variant('(s)', (plugin,)))
        os.unlink(script.name)
        Gio.bus_unown_name(owner)
        bus.unregister_object(registration)
    if 'report' not in result:
        fail('kwin-script-no-report: the KWin script did not call back within 5 s')
    return result['report']


class EisPointer:
    """An absolute pointer and button device that KWin's EIS grants to this process, released on close."""

    def __init__(self, Gio, GLib, bus, ei):
        self.ei = ei
        reply, fds = bus.call_with_unix_fd_list_sync('org.kde.KWin', EIS_PATH, EIS_INTERFACE, 'connectToEIS',
                                                      GLib.Variant('(i)', (CAP_POINTER | CAP_POINTER_ABSOLUTE,)), GLib.VariantType('(hi)'),
                                                      Gio.DBusCallFlags.NONE, 5000, None, None)
        self.ctx = ei.ei_new_sender(None)
        ei.ei_configure_name(self.ctx, b'airi-qa-pointer')
        if ei.ei_setup_backend_fd(self.ctx, fds.get(reply.unpack()[0])) != 0:
            fail('eis-setup-failed: ei_setup_backend_fd rejected the KWin socket')
        self.device = None
        self.pressed = False
        deadline = time.monotonic() + 5
        while self.device is None and time.monotonic() < deadline:
            select.select([ei.ei_get_fd(self.ctx)], [], [], 0.2)
            ei.ei_dispatch(self.ctx)
            while event := ei.ei_get_event(self.ctx):
                kind = ei.ei_event_get_type(event)
                if kind == EVENT_SEAT_ADDED:
                    ei.ei_seat_bind_capabilities(ctypes.c_void_p(ei.ei_event_get_seat(event)), ctypes.c_int(CAP_POINTER_ABSOLUTE),
                                                 ctypes.c_int(CAP_BUTTON), ctypes.c_void_p(None))
                elif kind == EVENT_DEVICE_RESUMED:
                    device = ei.ei_event_get_device(event)
                    if ei.ei_device_has_capability(device, CAP_POINTER_ABSOLUTE) and ei.ei_device_has_capability(device, CAP_BUTTON):
                        ei.ei_device_start_emulating(device, 1)
                        self.device = device
                ei.ei_event_unref(event)
        if self.device is None:
            fail('eis-no-device: KWin resumed no absolute pointer device with buttons within 5 s')

    def frame(self):
        self.ei.ei_device_frame(self.device, self.ei.ei_now(self.ctx))
        self.ei.ei_dispatch(self.ctx)

    def move(self, x, y):
        self.ei.ei_device_pointer_motion_absolute(self.device, float(x), float(y))
        self.frame()

    def button(self, down):
        self.ei.ei_device_button_button(self.device, BTN_LEFT, down)
        self.frame()
        self.pressed = down

    def close(self, release):
        if release or self.pressed:
            self.button(False)
        self.ei.ei_device_stop_emulating(self.device)
        self.ei.ei_dispatch(self.ctx)
        # Let KWin read the last frame before the socket closes.
        time.sleep(0.1)
        self.ei.ei_dispatch(self.ctx)
        self.ei.ei_unref(self.ctx)


def parse_table(text):
    rows = []
    for row in filter(None, text.strip().split(';')):
        t_ms, x, y, phase = (int(part) for part in row.split(','))
        if t_ms < 0 or phase not in (0, 1, 2, 3) or (rows and t_ms < rows[-1][0]):
            fail(f'pointer-table-invalid: {row}')
        rows.append((t_ms, x, y, phase))
    return rows


def play():
    lines = sys.stdin.read().split('\n', 1)
    start_at_ms, press_dwell_ms = (int(part) for part in lines[0].split())
    rows = parse_table(lines[1] if len(lines) > 1 else '')
    Gio, GLib, bus = session_bus()
    before = query_kwin(Gio, GLib, bus)
    screen = before['screen']
    # Recheck the live output before any input, in case the session changed after the host planned the path.
    for _, x, y, _ in rows:
        if not (screen['x'] <= x < screen['x'] + screen['width'] and screen['y'] <= y < screen['y'] + screen['height']):
            fail(f'pointer-path-outside-virtual-screen: {x},{y}; bounds={json.dumps(screen)}')
    pointer = EisPointer(Gio, GLib, bus, load_libei())
    # Map the epoch origin onto the monotonic clock once, so a wall-clock step cannot shift the playback.
    origin = time.monotonic() * 1000 - (time.time() * 1000 - start_at_ms)

    def now():
        return time.monotonic() * 1000 - origin

    def wait(due):
        while (remaining := due - now()) > 0:
            time.sleep(min(remaining, 2) / 1000)

    played, max_error = 0, 0.0
    try:
        for t_ms, x, y, phase in rows:
            due = t_ms
            if phase == 1:
                # Mirrors the Windows backend: rest on the target before pressing, so hover state settles first.
                wait(due - press_dwell_ms)
                pointer.move(x, y)
                due = max(due, now() + press_dwell_ms)
            wait(due)
            pointer.move(x, y)
            if phase in (1, 2):
                pointer.button(phase == 1)
            max_error = max(max_error, abs(now() - t_ms))
            played += 1
    finally:
        # An empty table is the caller's release request after a killed playback; it always sends a release.
        pointer.close(release=not rows)
    after = query_kwin(Gio, GLib, bus)
    emit({
        'played': played,
        'maxTimingErrorMs': round(max_error, 3),
        'x': round(after['cursor']['x']),
        'y': round(after['cursor']['y']),
        'foregroundPid': after['activePid'],
        'foregroundName': after['activeName'],
        'foregroundElevated': False,
        'desktop': screen,
    })


def probe():
    missing = []
    try:
        Gio, GLib, bus = session_bus()
    except Exception as error:  # noqa: BLE001 - the probe reports every failure as data
        emit({'ok': False, 'missing': [f'PyGObject Gio or the session bus: {error}']})
        return
    try:
        load_libei()
    except OSError as error:
        missing.append(f'libei.so.1: {error}')
    try:
        if not eis_available(Gio, GLib, bus):
            missing.append(f'KWin does not export {EIS_INTERFACE} on {EIS_PATH}')
    except Exception as error:  # noqa: BLE001
        missing.append(f'KWin EIS interface: {error}')
    if not missing:
        try:
            screen = query_kwin(Gio, GLib, bus)['screen']
        except SystemExit:
            missing.append('KWin scripting did not report the output geometry')
            screen = None
    emit({'ok': not missing, 'missing': missing, **({'screen': screen} if not missing else {})})


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'probe':
        probe()
    elif command == 'query':
        Gio, GLib, bus = session_bus()
        emit(query_kwin(Gio, GLib, bus))
    elif command == 'play':
        play()
    else:
        fail('usage: kwin-pointer.py probe | query | play  (play reads "<startAtMs> <pressDwellMs>\\n<table>" from stdin)')


if __name__ == '__main__':
    main()
