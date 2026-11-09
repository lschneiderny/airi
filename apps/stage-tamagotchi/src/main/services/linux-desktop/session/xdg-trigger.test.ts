import type { ShortcutAccelerator } from '@proj-airi/stage-shared/global-shortcut'

import { describe, expect, it } from 'vitest'

import { toXdgTrigger } from './xdg-trigger'

describe('xDG shortcut triggers', () => {
  it.each<{ accelerator: ShortcutAccelerator, expected: string | null }>([
    { accelerator: { modifiers: ['shift', 'ctrl'], key: 'KeyA' }, expected: 'CTRL+SHIFT+a' },
    { accelerator: { modifiers: ['cmd-or-ctrl', 'shift'], key: 'Space' }, expected: 'CTRL+SHIFT+space' },
    { accelerator: { modifiers: ['cmd', 'alt'], key: 'Enter' }, expected: 'ALT+LOGO+Return' },
    { accelerator: { modifiers: ['super'], key: 'ArrowUp' }, expected: 'LOGO+Up' },
    { accelerator: { modifiers: ['ctrl', 'cmd-or-ctrl'], key: 'Digit1' }, expected: 'CTRL+1' },
    { accelerator: { modifiers: ['cmd', 'super'], key: 'F24' }, expected: 'LOGO+F24' },
    { accelerator: { modifiers: [], key: 'PageDown' }, expected: 'Next' },
    { accelerator: { modifiers: [], key: 'Backquote' }, expected: 'grave' },
    { accelerator: { modifiers: [], key: 'Equal' }, expected: 'equal' },
    { accelerator: { modifiers: [], key: 'Quote' }, expected: 'apostrophe' },
    { accelerator: { modifiers: [], key: 'Backspace' }, expected: 'BackSpace' },
    { accelerator: { modifiers: [], key: 'Escape' }, expected: 'Escape' },
    { accelerator: { modifiers: [], key: 'F25' }, expected: null },
    { accelerator: { modifiers: [], key: 'KeyAA' }, expected: null },
    { accelerator: { modifiers: [], key: 'AudioVolumeUp' }, expected: null },
    { accelerator: { modifiers: [], key: 'a+CTRL' }, expected: null },
    { accelerator: { modifiers: [], key: '' }, expected: null },
  ])('converts $accelerator to $expected', ({ accelerator, expected }) => {
    expect(toXdgTrigger(accelerator)).toBe(expected)
  })
})
