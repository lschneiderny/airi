import type { ShortcutAccelerator, ShortcutModifier } from '@proj-airi/stage-shared/global-shortcut'

import { KEY_NAMES } from '@proj-airi/stage-shared/global-shortcut'

const modifiers: Record<ShortcutModifier, string> = {
  'cmd-or-ctrl': 'CTRL',
  'ctrl': 'CTRL',
  'alt': 'ALT',
  'shift': 'SHIFT',
  'cmd': 'LOGO',
  'super': 'LOGO',
}

const keysyms: Readonly<Record<string, string>> = {
  Space: 'space',
  Enter: 'Return',
  Backspace: 'BackSpace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'Prior',
  PageDown: 'Next',
  Backquote: 'grave',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'apostrophe',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
}

/** XDG uses base-layer XKB keysyms; the portal resolves the user's layout. */
export function toXdgTrigger(accelerator: ShortcutAccelerator): string | null {
  if (!KEY_NAMES.has(accelerator.key))
    return null
  const mapped = new Set(accelerator.modifiers.map(modifier => modifiers[modifier]))
  const key = accelerator.key.startsWith('Key')
    ? accelerator.key.slice(3).toLowerCase()
    : accelerator.key.startsWith('Digit')
      ? accelerator.key.slice(5)
      : keysyms[accelerator.key] ?? accelerator.key
  return [...['CTRL', 'ALT', 'SHIFT', 'LOGO'].filter(modifier => mapped.has(modifier)), key].join('+')
}
