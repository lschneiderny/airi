"""Real-pointer input for rendered QA on macOS, through CoreGraphics.

Run with `python3 -I mac-pointer.py <command>`. Every command prints one JSON object on stdout.

  probe  Reports whether this process may post mouse events, the responsible app that holds that permission, and the
         main display size in points.
  play   Reads `{"steps": [{"atMs": 0, "action": "warp" | "move" | "down" | "up", "x": 10, "y": 20}, ...]}` from stdin,
         plays it in global display points (origin at the top-left of the main display), and prints a receipt with
         the cursor read back.

`warp` moves the cursor with CGWarpMouseCursorPosition and posts no event; it needs no permission, and apps that poll
the cursor (the Electron stage's `screen.getCursorScreenPoint`) see it. `move`, `down`, and `up` post HID events,
which macOS drops silently unless the responsible app (the terminal or agent host that started python3) has
Accessibility access. `play` therefore refuses a table with posted steps when that access is missing, instead of
reporting input that never arrived.
"""

import ctypes
import json
import os
import sys
import time

EVENT_LEFT_DOWN = 1
EVENT_LEFT_UP = 2
EVENT_MOUSE_MOVED = 5
EVENT_LEFT_DRAGGED = 6
FIELD_CLICK_STATE = 1
TAP_HID = 0
BUTTON_LEFT = 0
ACTIONS = ('warp', 'move', 'down', 'up')


class Point(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]


def emit(value):
    print(json.dumps(value, separators=(',', ':')))


def fail(message, code=1):
    sys.stderr.write(f'{message}\n')
    sys.exit(code)


def load():
    cg = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    vp, u32 = ctypes.c_void_p, ctypes.c_uint32
    for name, res, args in [
        ('CGEventCreate', vp, [vp]), ('CGEventGetLocation', Point, [vp]), ('CGWarpMouseCursorPosition', ctypes.c_int32, [Point]),
        ('CGEventCreateMouseEvent', vp, [vp, u32, Point, u32]), ('CGEventPost', None, [u32, vp]),
        ('CGEventSetIntegerValueField', None, [vp, u32, ctypes.c_int64]), ('CGPreflightPostEventAccess', ctypes.c_bool, []),
        ('CGMainDisplayID', u32, []), ('CGDisplayPixelsWide', ctypes.c_size_t, [u32]), ('CGDisplayPixelsHigh', ctypes.c_size_t, [u32]),
    ]:
        function = getattr(cg, name)
        function.restype = res
        function.argtypes = args
    cf.CFRelease.argtypes = [vp]
    cf.CFRelease.restype = None
    return cg, cf


def cursor(cg, cf):
    event = cg.CGEventCreate(None)
    point = cg.CGEventGetLocation(event)
    cf.CFRelease(event)
    return round(point.x), round(point.y)


def screen(cg):
    display = cg.CGMainDisplayID()
    return {'width': cg.CGDisplayPixelsWide(display), 'height': cg.CGDisplayPixelsHigh(display)}


def responsible_app():
    """The app macOS checks for Accessibility is the one that launched this process tree, not python3 itself."""
    return os.environ.get('__CFBundleIdentifier') or os.environ.get('TERM_PROGRAM') or None


def access_missing(app):
    holder = app or 'the app that started python3'
    return (f'post-event access: macOS drops posted mouse events because {holder} lacks Accessibility access '
            '(System Settings > Privacy & Security > Accessibility; restart it after granting)')


def parse_steps(text):
    try:
        steps = json.loads(text)['steps']
    except (ValueError, KeyError, TypeError) as error:
        fail(f'pointer-steps-invalid: {error}')
    last = 0
    for step in steps:
        if step.get('action') not in ACTIONS or not all(isinstance(step.get(key), int) for key in ('atMs', 'x', 'y')) or step['atMs'] < last:
            fail(f'pointer-steps-invalid: {json.dumps(step)}')
        last = step['atMs']
    return steps


def play():
    steps = parse_steps(sys.stdin.read())
    cg, cf = load()
    app = responsible_app()
    if any(step['action'] != 'warp' for step in steps) and not cg.CGPreflightPostEventAccess():
        fail(access_missing(app), 3)
    bounds = screen(cg)
    pressed = False

    def post(kind, x, y):
        event = cg.CGEventCreateMouseEvent(None, kind, Point(x, y), BUTTON_LEFT)
        if kind in (EVENT_LEFT_DOWN, EVENT_LEFT_UP):
            cg.CGEventSetIntegerValueField(event, FIELD_CLICK_STATE, 1)
        cg.CGEventPost(TAP_HID, event)
        cf.CFRelease(event)

    started = time.monotonic() * 1000
    played, max_error = 0, 0.0
    try:
        for step in steps:
            while (remaining := step['atMs'] - (time.monotonic() * 1000 - started)) > 0:
                time.sleep(min(remaining, 2) / 1000)
            x, y, action = step['x'], step['y'], step['action']
            if action == 'warp':
                cg.CGWarpMouseCursorPosition(Point(x, y))
            elif action == 'move':
                post(EVENT_LEFT_DRAGGED if pressed else EVENT_MOUSE_MOVED, x, y)
            else:
                pressed = action == 'down'
                post(EVENT_LEFT_DOWN if pressed else EVENT_LEFT_UP, x, y)
            max_error = max(max_error, abs(time.monotonic() * 1000 - started - step['atMs']))
            played += 1
    finally:
        # A table that ends with the button held would leave the desktop in a drag; always release it.
        if pressed:
            post(EVENT_LEFT_UP, *cursor(cg, cf))
    x, y = cursor(cg, cf)
    emit({'played': played, 'maxTimingErrorMs': round(max_error, 3), 'x': x, 'y': y, 'screen': bounds})


def probe():
    try:
        cg, _ = load()
    except OSError as error:
        emit({'ok': False, 'warp': False, 'postEvents': False, 'responsibleApp': None, 'missing': [f'CoreGraphics: {error}']})
        return
    app = responsible_app()
    post_events = bool(cg.CGPreflightPostEventAccess())
    emit({'ok': post_events, 'warp': True, 'postEvents': post_events, 'responsibleApp': app,
          'missing': [] if post_events else [access_missing(app)], 'screen': screen(cg)})


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'probe':
        probe()
    elif command == 'play':
        play()
    else:
        fail('usage: mac-pointer.py probe | play  (play reads {"steps": [...]} from stdin)', 2)


if __name__ == '__main__':
    main()
