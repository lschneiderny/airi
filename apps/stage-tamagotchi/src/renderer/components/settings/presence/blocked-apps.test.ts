import { describe, expect, it } from 'vitest'

import { addableApps, blockedAppRows, withEntry } from './blocked-apps'

const installed = [
  { name: 'Firefox', appKey: 'org.mozilla.firefox' },
  { name: 'KeePassXC', appKey: 'org.keepassxc.KeePassXC' },
]

describe('blocked apps', () => {
  it('names entries that match an installed app and keeps patterns as written', () => {
    expect(blockedAppRows(['org.keepassxc.keepassxc', '*bitwarden*'], installed)).toEqual([
      { entry: 'org.keepassxc.keepassxc', name: 'KeePassXC' },
      { entry: '*bitwarden*', name: null },
    ])
  })

  it('offers only the installed apps the list does not name yet', () => {
    expect(addableApps(installed, ['ORG.KEEPASSXC.KEEPASSXC'])).toEqual([installed[0]])
  })

  it('adds a trimmed entry once', () => {
    expect(withEntry(['a'], '  *keepass*  ')).toEqual(['a', '*keepass*'])
    expect(withEntry(['*KeePass*'], '*keepass*')).toBeNull()
    expect(withEntry(['a'], '   ')).toBeNull()
  })
})
