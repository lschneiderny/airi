"""QA-only EIS keyboard input. Stdin contains evdev codes, down/up phases and dwell times."""

import ctypes
import json
import os
from pathlib import Path
import runpy
import select
import sys
import time


def main() -> None:
    """Keep the connection alive across presses/releases and release keys before disconnecting."""
    name = os.environ.get('AIRI_QA_DISPLAY', '')
    runtime = Path(os.environ.get('XDG_RUNTIME_DIR', ''))
    session = runtime.parent
    address = os.environ.get('DBUS_SESSION_BUS_ADDRESS', '')
    if (not name or session.name != name or session.parent.name != 'airi-qa-display'
            or runtime.name != 'runtime' or address != f'unix:path={session}/bus'):
        raise RuntimeError('Keyboard input requires a private pnpm qa:display run session')
    recorded = dict(line.split('=', 1) for line in (session / 'env').read_text().splitlines() if '=' in line)
    if recorded.get('DBUS_SESSION_BUS_ADDRESS') != address or recorded.get('XDG_RUNTIME_DIR') != str(runtime):
        raise RuntimeError('Keyboard input bus does not match the recorded QA session')
    rows = json.load(sys.stdin)
    for row in rows:
        if (type(row.get('keyCode')) is not int or not 1 <= row['keyCode'] <= 767
                or row.get('phase') not in ('down', 'up')
                or type(row.get('delayMs')) is not int or row['delayMs'] < 0):
            raise ValueError('Invalid keyboard step')
    helper = runpy.run_path(str(Path(__file__).with_name('kwin-pointer.py')))
    Gio, GLib, bus = helper['session_bus']()
    ei = helper['load_libei']()
    ei.ei_device_keyboard_key.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_bool]
    ei.ei_device_keyboard_key.restype = None
    # KWin's connectToEIS uses portal capability flags: keyboard=1.
    reply, fds = bus.call_with_unix_fd_list_sync(
        'org.kde.KWin', helper['EIS_PATH'], helper['EIS_INTERFACE'], 'connectToEIS',
        GLib.Variant('(i)', (1,)), GLib.VariantType('(hi)'), Gio.DBusCallFlags.NONE, 5000, None, None)
    context = ei.ei_new_sender(None)
    device = None
    pressed: set[int] = set()

    def key(code: int, down: bool) -> None:
        ei.ei_device_keyboard_key(device, code, down)
        ei.ei_device_frame(device, ei.ei_now(context))
        ei.ei_dispatch(context)

    try:
        ei.ei_configure_name(context, b'airi-qa-keyboard')
        if ei.ei_setup_backend_fd(context, fds.get(reply.unpack()[0])) != 0:
            raise RuntimeError('KWin rejected the EIS keyboard connection')
        deadline = time.monotonic() + 5
        # libei's own capability enum differs from the portal flags: keyboard=1<<2.
        capability = 1 << 2
        while device is None and time.monotonic() < deadline:
            select.select([ei.ei_get_fd(context)], [], [], max(0, deadline - time.monotonic()))
            ei.ei_dispatch(context)
            while event := ei.ei_get_event(context):
                kind = ei.ei_event_get_type(event)
                if kind == helper['EVENT_SEAT_ADDED']:
                    ei.ei_seat_bind_capabilities(ctypes.c_void_p(ei.ei_event_get_seat(event)), ctypes.c_int(capability), ctypes.c_void_p(None))
                elif kind == helper['EVENT_DEVICE_RESUMED']:
                    candidate = ei.ei_event_get_device(event)
                    if ei.ei_device_has_capability(candidate, capability):
                        device = candidate
                        ei.ei_device_start_emulating(device, 1)
                ei.ei_event_unref(event)
        if device is None:
            raise RuntimeError('KWin did not resume an EIS keyboard within five seconds')
        for row in rows:
            time.sleep(row['delayMs'] / 1000)
            down = row['phase'] == 'down'
            key(row['keyCode'], down)
            if down:
                pressed.add(row['keyCode'])
            else:
                pressed.discard(row['keyCode'])
        print(json.dumps({'sent': rows}))
    finally:
        if device is not None:
            for code in pressed:
                key(code, False)
            ei.ei_device_stop_emulating(device)
            ei.ei_dispatch(context)
            # Match the pointer helper's flush dwell before disconnecting its socket.
            time.sleep(0.1)
            ei.ei_dispatch(context)
        ei.ei_unref(context)
        bus.call_sync('org.kde.KWin', helper['EIS_PATH'], helper['EIS_INTERFACE'], 'disconnect',
                      GLib.Variant('(i)', (reply.unpack()[1],)), None, Gio.DBusCallFlags.NONE, 5000, None)


if __name__ == '__main__':
    main()
