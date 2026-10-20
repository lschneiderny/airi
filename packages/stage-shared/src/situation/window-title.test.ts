import { describe, expect, it } from 'vitest'

import { appIdFromExe, categorizeApp, isDenylisted, labelFromExe, normalizeWindowTitle, WINDOW_TITLE_MAX_CHARS } from '.'

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
})
