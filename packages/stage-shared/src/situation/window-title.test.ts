import { describe, expect, it } from 'vitest'

import { appIdFromExe, categorizeApp, isDenylisted, labelFromExe, normalizeWindowTitle, WINDOW_TITLE_MAX_CHARS, withoutAppExtension } from '.'

describe('normalizeWindowTitle', () => {
  it.each([
    ['Firefox suffix', 'Rust Book - Mozilla Firefox', 'Firefox', 'Rust Book'],
    ['Firefox em-dash suffix', 'Rust Book \u2014 Mozilla Firefox', 'Firefox', 'Rust Book'],
    ['VS Code em-dash suffix', 'index.ts \u2014 airi \u2014 Visual Studio Code', 'Code', 'index.ts \u2014 airi'],
    ['VS Code unsaved marker', '\u25CF file.ts - Visual Studio Code', 'Code', 'file.ts'],
    ['Chrome suffix keeps inner separators', 'Inbox - me@example.com - Google Chrome', 'Chrome', 'Inbox - me@example.com'],
    ['Edge zero-width space', 'News - Profile 1 - Microsoft\u200B Edge', 'Msedge', 'News - Profile 1'],
    ['generic app label suffix', 'notes.txt - Notepad++', 'Notepad++', 'notes.txt'],
    ['asterisk unsaved prefix', '*untitled - Notepad', 'Notepad', 'untitled'],
    ['asterisk unsaved suffix', 'report.docx* - Word', 'Word', 'report.docx'],
    ['bullet unsaved suffix', 'draft.md \u2022', 'Typora', 'draft.md'],
    ['collapses whitespace and newlines', '  a \t\n  b  ', 'App', 'a b'],
    ['no separator keeps app-like words', 'Be Brave', 'Notepad', 'Be Brave'],
    ['unicode stays intact', '\u30E1\u30E2 \u{1F600} - Mozilla Firefox', 'Firefox', '\u30E1\u30E2 \u{1F600}'],
  ])('%s', (_, title, appLabel, expected) => {
    expect(normalizeWindowTitle(title, appLabel)).toBe(expected)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   \t\n '],
    ['marker only', '\u25CF'],
    ['only the app name', 'Visual Studio Code'],
    ['only the app label', 'discord'],
  ])('returns null for %s', (_, title) => {
    expect(normalizeWindowTitle(title, 'Discord')).toBeNull()
  })

  it('returns null for a missing title', () => {
    expect(normalizeWindowTitle(null, 'Code')).toBeNull()
    expect(normalizeWindowTitle(undefined, 'Code')).toBeNull()
  })

  it('caps a 200-char title at the limit with an ellipsis', () => {
    const result = normalizeWindowTitle(`${'x'.repeat(200)} - Google Chrome`, 'Chrome')

    expect(result).toHaveLength(WINDOW_TITLE_MAX_CHARS)
    expect(result?.endsWith('\u2026')).toBe(true)
  })

  it('caps a 500-char astral title by code points without splitting surrogate pairs', () => {
    const result = normalizeWindowTitle('\u{1F600}'.repeat(500), 'App') ?? ''
    const codePoints = Array.from(result)

    expect(codePoints).toHaveLength(WINDOW_TITLE_MAX_CHARS)
    expect(codePoints.slice(0, -1).every(point => point === '\u{1F600}')).toBe(true)
  })

  it('keeps a title of exactly the limit unchanged', () => {
    const title = 'y'.repeat(WINDOW_TITLE_MAX_CHARS)

    expect(normalizeWindowTitle(title, 'App')).toBe(title)
  })
})

describe('appIdFromExe and labelFromExe', () => {
  it.each([
    ['C:\\Program Files\\Zoom\\bin\\Zoom.exe', 'zoom', 'Zoom'],
    ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'chrome', 'Chrome'],
    ['/usr/bin/firefox', 'firefox', 'Firefox'],
    ['ms-teams.EXE', 'ms-teams', 'Ms-Teams'],
    ['sublime_text.exe', 'sublime_text', 'Sublime_Text'],
    ['notepad++.exe', 'notepad++', 'Notepad++'],
    ['1Password.exe', '1password', '1Password'],
    ['', '', ''],
  ])('%s', (exePath, appId, label) => {
    expect(appIdFromExe(exePath)).toBe(appId)
    expect(labelFromExe(exePath)).toBe(label)
  })

  it.each([
    ['/Applications/zoom.us.app', 'zoom.us', 'Zoom.Us'],
    ['/Applications/Visual Studio Code.app', 'visual studio code', 'Visual Studio Code'],
    ['Google Chrome.app', 'google chrome', 'Google Chrome'],
    ['FaceTime.APP', 'facetime', 'FaceTime'],
  ])('%s on Darwin', (exePath, appId, label) => {
    expect(appIdFromExe(exePath, 'darwin')).toBe(appId)
    expect(labelFromExe(exePath, 'darwin')).toBe(label)
  })
})

describe('withoutAppExtension', () => {
  it.each([
    ['Zoom.EXE', 'Zoom'],
    ['zoom.us.app', 'zoom.us'],
    ['Webex*.APP', 'Webex*'],
    ['1password*.exe', '1password*'],
    ['notes.app.backup', 'notes.app.backup'],
    ['myapp', 'myapp'],
    ['', ''],
  ])('%s => %s', (fileName, expected) => {
    expect(withoutAppExtension(fileName, 'darwin')).toBe(expected)
  })

  it.each(['win32', undefined])('keeps .app patterns literal on host %s', (platform) => {
    expect(withoutAppExtension('zed.app', platform)).toBe('zed.app')
    expect(withoutAppExtension('z*.APP', platform)).toBe('z*.APP')
    expect(withoutAppExtension('zed.app.exe', platform)).toBe('zed.app')
  })
})

describe('isDenylisted', () => {
  it.each([
    ['1Password.exe', ['1password*.exe'], true],
    ['1Password-BrowserSupport.exe', ['1password*.exe'], true],
    ['C:\\Program Files\\1Password\\app\\8\\1Password.exe', ['1password*.exe'], true],
    ['KeePassXC.exe', ['keepassxc.exe'], true],
    ['chrome.exe', ['1password*.exe', 'keepass*'], false],
    ['password.exe', ['1password*.exe'], false],
    ['a.b.exe', ['a*b.exe'], true],
    ['axb.exe', ['a.b.exe'], false],
    ['anything.exe', ['', '   '], false],
    ['', ['*'], false],
  ])('%s against %j => %s', (exeName, denylist, expected) => {
    expect(isDenylisted(exeName, denylist)).toBe(expected)
  })
})

describe('categorizeApp', () => {
  it.each([
    ['zed.app', 'zed.app', 'Zed.App'],
    ['chrome.app', 'chrome.app', 'Chrome.App'],
    ['mystery.APP', 'mystery.app', 'Mystery.APP'],
    ['zed.app.app', 'zed.app.app', 'Zed.App.App'],
  ])('preserves literal Windows executable %s', (exeName, appId, label) => {
    const exePath = `C:\\Tools\\${exeName}`

    expect(appIdFromExe(exePath)).toBe(appId)
    expect(labelFromExe(exePath)).toBe(label)
    expect(categorizeApp(exePath, exeName)).toBe('other')
  })

  describe.each([
    ['safari', 'browser'],
    ['google chrome', 'browser'],
    ['arc', 'browser'],
    ['microsoft edge', 'browser'],
    ['visual studio code', 'editor'],
    ['xcode', 'editor'],
    ['zed', 'editor'],
    ['music', 'media'],
    ['quicktime player', 'media'],
    ['iina', 'media'],
    ['messages', 'chat'],
    ['zoom.us', 'call'],
    ['microsoft teams', 'call'],
    ['facetime', 'call'],
  ])('bundle-only category for %s', (name, category) => {
    it(`keeps Windows ${name}.exe in the pre-plan other category`, () => {
      const exeName = `${name}.exe`
      const exePath = `C:\\Program Files\\X\\${exeName}`

      expect(categorizeApp(exePath, exeName)).toBe('other')
      expect(categorizeApp(exePath, '')).toBe('other')
      expect(appIdFromExe(exePath)).toBe(name)
    })

    it(`keeps Windows ${name}.app.exe in the pre-plan other category`, () => {
      const exeName = `${name}.app.exe`
      const exePath = `C:\\X\\${exeName}`

      expect(categorizeApp(exePath, exeName)).toBe('other')
      expect(categorizeApp(exePath, '')).toBe('other')
      expect(appIdFromExe(exePath)).toBe(`${name}.app`)
    })

    it(`classifies the macOS ${name}.app bundle as ${category}`, () => {
      const exeName = `${name}.app`
      const exePath = `/Applications/${exeName}`

      expect(categorizeApp(exePath, exeName, 'darwin')).toBe(category)
      expect(categorizeApp(exePath, '', 'darwin')).toBe(category)
    })
  })

  it.each([
    ['chrome', 'browser'],
    ['msedge', 'browser'],
    ['firefox', 'browser'],
    ['brave', 'browser'],
    ['opera', 'browser'],
    ['vivaldi', 'browser'],
    ['code', 'editor'],
    ['cursor', 'editor'],
    ['idea64', 'editor'],
    ['devenv', 'editor'],
    ['sublime_text', 'editor'],
    ['notepad++', 'editor'],
    ['vlc', 'media'],
    ['mpc-hc64', 'media'],
    ['spotify', 'media'],
    ['discord', 'chat'],
    ['slack', 'chat'],
    ['telegram', 'chat'],
    ['whatsapp', 'chat'],
    ['zoom', 'call'],
    ['ms-teams', 'call'],
    ['teams', 'call'],
    ['webex', 'call'],
  ])('preserves the original Windows category for %s', (name, category) => {
    expect(categorizeApp(`C:\\Tools\\${name}.exe`, `${name}.exe`)).toBe(category)
    expect(categorizeApp(`C:\\Tools\\${name}`, name)).toBe(category)
  })

  it.each([
    ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe', 'Hades.exe', 'game'],
    ['D:/SteamLibrary/steamapps/common/Celeste/Celeste.exe', 'Celeste.exe', 'game'],
    ['C:\\Program Files\\Epic Games\\Fortnite\\FortniteClient.exe', 'FortniteClient.exe', 'game'],
    ['C:\\GOG Galaxy\\Games\\Witcher 3\\witcher3.exe', 'witcher3.exe', 'game'],
    ['C:\\Riot Games\\VALORANT\\VALORANT.exe', 'VALORANT.exe', 'game'],
    ['C:\\Program Files (x86)\\Battle.net\\Battle.net.exe', 'Battle.net.exe', 'game'],
    ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'chrome.exe', 'browser'],
    ['C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'firefox.exe', 'browser'],
    ['C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 'Code.exe', 'editor'],
    ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', 'vlc.exe', 'media'],
    ['C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0\\Discord.exe', 'Discord.exe', 'chat'],
    ['C:\\Program Files\\Zoom\\bin\\Zoom.exe', '', 'call'],
    ['C:\\Program Files\\WindowsApps\\MSTeams\\ms-teams.exe', 'ms-teams.exe', 'call'],
    ['C:\\Tools\\mystery.exe', 'mystery.exe', 'other'],
    ['', '', 'other'],
    ['C:\\Tools\\constructor', 'constructor', 'other'],
  ])('%s => %s', (exePath, exeName, expected) => {
    expect(categorizeApp(exePath, exeName)).toBe(expected)
  })

  it.each([
    ['/Users/x/Library/Application Support/Steam/steamapps/common/Hades/Hades.app', 'Hades.app', 'game'],
    ['/Applications/zoom.us.app', 'zoom.us.app', 'call'],
    ['/Applications/Microsoft Teams.app', 'Microsoft Teams.app', 'call'],
    ['/System/Applications/FaceTime.app', 'FaceTime.app', 'call'],
    ['/Applications/Webex.app', 'Webex.app', 'call'],
    ['/Applications/Safari.app', '', 'browser'],
    ['/Applications/Google Chrome.app', 'Google Chrome.app', 'browser'],
    ['/Applications/Arc.app', 'Arc.app', 'browser'],
    ['/Applications/Microsoft Edge.app', 'Microsoft Edge.app', 'browser'],
    ['/Applications/Visual Studio Code.app', 'Visual Studio Code.app', 'editor'],
    ['/Applications/Xcode.app', 'Xcode.app', 'editor'],
    ['/Applications/Zed.app', 'Zed.app', 'editor'],
    ['/System/Applications/Music.app', 'Music.app', 'media'],
    ['/System/Applications/QuickTime Player.app', 'QuickTime Player.app', 'media'],
    ['/Applications/IINA.app', 'IINA.app', 'media'],
    ['/System/Applications/Messages.app', 'Messages.app', 'chat'],
    ['/Applications/Discord.app', 'Discord.app', 'chat'],
    ['/Applications/Slack.app', 'Slack.app', 'chat'],
    ['/Applications/Telegram.app', 'Telegram.app', 'chat'],
    ['/Applications/WhatsApp.app', 'WhatsApp.app', 'chat'],
    ['/Applications/Spotify.app', 'Spotify.app', 'media'],
    ['/Applications/VLC.app', 'VLC.app', 'media'],
    ['/Applications/Firefox.app', 'Firefox.app', 'browser'],
    ['/Applications/Cursor.app', 'Cursor.app', 'editor'],
  ])('%s => %s', (exePath, exeName, expected) => {
    expect(categorizeApp(exePath, exeName, 'darwin')).toBe(expected)
  })
})
