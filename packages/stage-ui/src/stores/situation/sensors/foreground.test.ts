import type { AppCategory, Observation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'

import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSituationSettings } from '../../../features/situation/settings'
import { FOREGROUND_SAMPLE_STALE_HIDDEN_MS, FOREGROUND_SAMPLE_STALE_VISIBLE_MS, startForegroundSensor } from './foreground'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)

const NOTEPAD = 'C:\\Windows\\System32\\notepad.exe'
const AIRI = 'C:\\Program Files\\AIRI\\AIRI.exe'

/** A fresh Notepad sample at the current fake time. */
function sample(overrides: Partial<ForegroundWindowSample> = {}): ForegroundWindowSample {
  return {
    exePath: NOTEPAD,
    exeName: 'notepad.exe',
    title: 'notes.txt - Notepad',
    pid: 4242,
    ownProcess: false,
    notificationState: 'accepts',
    sampledAtMs: Date.now(),
    ...overrides,
  }
}

/** Starts a sensor on the real foreground and settings stores and records what it ingests. */
function run(options: { visible?: boolean } = {}) {
  let visible = options.visible ?? true
  const observations: Observation[] = []
  const categories: Array<AppCategory | null> = []
  const sensor = startForegroundSensor(observation => observations.push(observation), {
    stageVisible: () => visible,
    onCategory: category => categories.push(category),
  })
  const foreground = useForegroundWindowStore()
  return {
    observations,
    categories,
    sensor,
    activities: () => observations.filter(observation => observation.kind === 'activity'),
    setVisible(next: boolean) {
      visible = next
    },
    /** Moves the fake clock to `atMs` and publishes a sample taken then. */
    publish(atMs: number, overrides: Partial<ForegroundWindowSample> = {}) {
      vi.setSystemTime(atMs)
      foreground.setSample(sample(overrides))
    },
  }
}

describe('foreground situation sensor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends nothing for a host without samples, now or on later checks', () => {
    const { observations, sensor } = run()

    sensor.check(T0 + 60_000)

    expect(observations).toEqual([])
  })

  it('reports the foreground app with its label, category and normalized title', () => {
    const { observations, publish } = run()

    publish(T0)

    expect(observations).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 },
    ])
  })

  it('reports an app again only when its app id or normalized title changes', () => {
    const { activities, publish } = run()

    publish(T0)
    publish(T0 + 1_000)
    // Only an unsaved marker differs, which normalization removes.
    publish(T0 + 2_000, { title: '*notes.txt - Notepad' })
    publish(T0 + 3_000, { title: 'todo.txt - Notepad', pid: 4343 })
    publish(T0 + 4_000, { exePath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', exeName: 'Code.exe', title: 'todo.txt' })

    expect(activities()).toEqual([
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'todo.txt', atMs: T0 + 3_000 },
      { kind: 'activity', appId: 'code', label: 'Code', category: 'editor', title: 'todo.txt', atMs: T0 + 4_000 },
    ])
  })

  it('skips AIRI\'s own windows and offers the first own app id as selfAppIds', () => {
    const { activities, publish, sensor } = run()

    expect(sensor.selfAppIds()).toEqual([])
    publish(T0, { exePath: AIRI, exeName: 'AIRI.exe', title: 'AIRI', ownProcess: true })
    // The Godot stage sidecar is also an own process; it never becomes activity and does not replace the first id.
    publish(T0 + 1_000, { exePath: 'C:\\AIRI\\godot-stage.exe', exeName: 'godot-stage.exe', title: 'Stage', ownProcess: true })
    publish(T0 + 2_000)
    publish(T0 + 3_000, { exePath: AIRI, exeName: 'AIRI.exe', title: 'Chat', ownProcess: true })

    expect(activities()).toEqual([
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 + 2_000 },
    ])
    expect(sensor.selfAppIds()).toEqual(['airi'])
  })

  it('keeps reading the session-wide busy state from AIRI\'s own windows', () => {
    const { observations, publish } = run()

    publish(T0, { exePath: AIRI, exeName: 'AIRI.exe', ownProcess: true, notificationState: 'accepts' })
    publish(T0 + 1_000, { exePath: AIRI, exeName: 'AIRI.exe', ownProcess: true, notificationState: 'presentation' })

    expect(observations).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'busy', state: 'presentation', atMs: T0 + 1_000 },
    ])
  })

  it('reports a denylisted exe with its app and category but a null title', async () => {
    const { activities, publish } = run()
    const settings = useSituationSettings()

    publish(T0, { exePath: 'C:\\Program Files\\1Password\\1Password.exe', exeName: '1Password.exe', title: 'Vault - secret-bank-login' })
    await settings.update({ titleDenylist: ['notepad.exe'] })
    publish(T0 + 1_000)
    publish(T0 + 2_000, { title: 'other secret - Notepad' })

    expect(activities()).toEqual([
      { kind: 'activity', appId: '1password', label: '1Password', category: 'other', title: null, atMs: T0 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: null, atMs: T0 + 1_000 },
    ])
    expect(JSON.stringify(activities())).not.toMatch(/secret/u)
  })

  it('drops the title of an app that is denylisted while it stays in front', async () => {
    const { activities, publish } = run()
    const settings = useSituationSettings()

    publish(T0)
    await settings.update({ titleDenylist: ['NOTEPAD.EXE'] })
    publish(T0 + 1_000)

    expect(activities().map(observation => observation.kind === 'activity' && observation.title)).toEqual(['notes.txt', null])
  })

  it('reports a default-denylisted macOS bundle with its app id and category but a null title', () => {
    const { activities, publish } = run()

    publish(T0, { exePath: '/Applications/1Password 7.app', exeName: '1Password 7.app', title: 'Vault - secret-bank-login' })

    expect(activities()).toEqual([
      { kind: 'activity', appId: '1password 7', label: '1Password 7', category: 'other', title: null, atMs: T0 },
    ])
    expect(JSON.stringify(activities())).not.toMatch(/secret/u)
  })

  it('drops the title of a macOS bundle whose denylist entry differs only in case', async () => {
    const { activities, publish } = run()
    const settings = useSituationSettings()
    const macSample = { exePath: '/Applications/Notes.app', exeName: 'Notes.app', title: 'Groceries' }

    publish(T0, macSample)
    await settings.update({ titleDenylist: ['NOTES.APP'] })
    publish(T0 + 1_000, macSample)

    expect(activities().map(observation => observation.kind === 'activity' && observation.title)).toEqual(['Groceries', null])
    expect(activities().map(observation => observation.kind === 'activity' && observation.appId)).toEqual(['notes', 'notes'])
  })

  it('maps every shell notification state to busy, reporting only changes', () => {
    const { observations, publish } = run()
    const states: Array<ForegroundWindowSample['notificationState']> = ['accepts', 'accepts', 'busy', 'd3d-fullscreen', 'presentation', 'quiet-time', 'app', 'not-present', null]

    states.forEach((notificationState, index) => publish(T0 + index * 1_000, { notificationState }))

    expect(observations.filter(observation => observation.kind === 'busy')).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'busy', state: 'busy', atMs: T0 + 2_000 },
      { kind: 'busy', state: 'fullscreen', atMs: T0 + 3_000 },
      { kind: 'busy', state: 'presentation', atMs: T0 + 4_000 },
      { kind: 'busy', state: 'quiet', atMs: T0 + 5_000 },
      { kind: 'busy', state: 'busy', atMs: T0 + 6_000 },
      { kind: 'busy', state: 'unknown', atMs: T0 + 7_000 },
    ])
  })

  it('reports busy unknown once a sample is older than 5 s while the stage is visible', () => {
    const { observations, publish, sensor } = run({ visible: true })
    publish(T0)

    sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS)
    expect(observations.filter(observation => observation.kind === 'busy')).toEqual([{ kind: 'busy', state: 'accepts', atMs: T0 }])

    sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1)
    sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 2)
    publish(T0 + 10_000)

    expect(observations.filter(observation => observation.kind === 'busy')).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'busy', state: 'unknown', atMs: T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1 },
      { kind: 'busy', state: 'accepts', atMs: T0 + 10_000 },
    ])
  })

  it('counts a sample as current for up to 20 s while the stage is hidden or minimized', () => {
    const { observations, publish, sensor, setVisible } = run({ visible: false })
    publish(T0)

    // Throttled timers deliver hidden-window samples about 12 s apart; that is not stale.
    sensor.check(T0 + 12_000)
    sensor.check(T0 + FOREGROUND_SAMPLE_STALE_HIDDEN_MS)
    expect(observations.filter(observation => observation.kind === 'busy')).toEqual([{ kind: 'busy', state: 'accepts', atMs: T0 }])

    sensor.check(T0 + FOREGROUND_SAMPLE_STALE_HIDDEN_MS + 1)
    expect(observations.filter(observation => observation.kind === 'busy')).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'busy', state: 'unknown', atMs: T0 + FOREGROUND_SAMPLE_STALE_HIDDEN_MS + 1 },
    ])

    // Showing the stage again brings back the 5 s limit.
    publish(T0 + 30_000)
    setVisible(true)
    sensor.check(T0 + 30_000 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1)
    expect(observations.filter(observation => observation.kind === 'busy').slice(2)).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 + 30_000 },
      { kind: 'busy', state: 'unknown', atMs: T0 + 30_000 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1 },
    ])
  })

  it('clears the category once the producer stops, after 5 s visible and 20 s hidden', () => {
    const visible = run({ visible: true })
    visible.publish(T0, { exePath: 'C:\\Games\\steamapps\\common\\Title\\title.exe', exeName: 'title.exe' })
    expect(visible.categories).toEqual(['game'])

    visible.sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS)
    expect(visible.categories).toEqual(['game'])
    visible.sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1)
    visible.sensor.check(T0 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 2)
    expect(visible.categories).toEqual(['game', null])

    // The same app coming back in front is reported again without a new activity change.
    visible.publish(T0 + 10_000, { exePath: 'C:\\Games\\steamapps\\common\\Title\\title.exe', exeName: 'title.exe' })
    expect(visible.categories).toEqual(['game', null, 'game'])

    const hidden = run({ visible: false })
    hidden.publish(T0 + 20_000, { exePath: 'C:\\Games\\steamapps\\common\\Title\\title.exe', exeName: 'title.exe' })
    hidden.sensor.check(T0 + 20_000 + FOREGROUND_SAMPLE_STALE_HIDDEN_MS)
    expect(hidden.categories).toEqual(['game'])
    hidden.sensor.check(T0 + 20_000 + FOREGROUND_SAMPLE_STALE_HIDDEN_MS + 1)
    expect(hidden.categories).toEqual(['game', null])
  })

  it('keeps the category while a fresh sample of AIRI\'s own window is in front', () => {
    const { categories, publish } = run()
    publish(T0, { exePath: 'C:\\Games\\steamapps\\common\\Title\\title.exe', exeName: 'title.exe' })

    publish(T0 + 1_000, { exePath: AIRI, exeName: 'AIRI.exe', ownProcess: true })

    expect(categories).toEqual(['game'])
  })

  it('reports no activity from a stale, future or untimed sample', () => {
    const { observations, publish } = run()

    publish(T0, { sampledAtMs: T0 - FOREGROUND_SAMPLE_STALE_VISIBLE_MS - 1 })
    publish(T0 + 1_000, { sampledAtMs: T0 + 1_000 + FOREGROUND_SAMPLE_STALE_VISIBLE_MS + 1 })
    publish(T0 + 2_000, { sampledAtMs: Number.NaN })

    expect(observations).toEqual([{ kind: 'busy', state: 'unknown', atMs: T0 }])
  })

  it('ignores malformed samples without throwing', () => {
    const { observations, publish } = run()
    // Parsed JSON stands in for an untyped producer, so the wrongly typed fields need no type assertion.
    const malformed: Array<Partial<ForegroundWindowSample>> = [
      { exePath: null, exeName: null },
      { exePath: '   ', exeName: '' },
      JSON.parse('{"title":42}'),
      JSON.parse('{"notificationState":"sideways"}'),
    ]

    malformed.forEach((overrides, index) => publish(T0 + index * 1_000, overrides))

    expect(observations).toEqual([
      { kind: 'busy', state: 'accepts', atMs: T0 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: null, atMs: T0 + 2_000 },
      { kind: 'busy', state: 'unknown', atMs: T0 + 3_000 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 + 3_000 },
    ])
  })

  it('takes the app from the exe name when the path is unknown', () => {
    const { activities, publish } = run()

    publish(T0, { exePath: null, exeName: 'Spotify.exe', title: 'Song - Artist' })

    expect(activities()).toEqual([
      { kind: 'activity', appId: 'spotify', label: 'Spotify', category: 'media', title: 'Song - Artist', atMs: T0 },
    ])
  })

  it('reports nothing while foreground sharing is off, and the current sample once it is on again', async () => {
    const settings = useSituationSettings()
    await settings.update({ shareForegroundWindow: false })
    const { observations, categories, publish, sensor } = run()

    publish(T0)
    publish(T0 + 1_000, { notificationState: 'presentation' })
    sensor.check(T0 + 2_000)

    expect(observations).toEqual([])
    expect(categories).toEqual([])

    await settings.update({ shareForegroundWindow: true })

    expect(observations).toEqual([
      { kind: 'busy', state: 'presentation', atMs: T0 + 1_000 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 + 1_000 },
    ])
    expect(categories).toEqual(['other'])
  })

  it('clears the category when foreground sharing turns off, and reports the same app again once it is on', async () => {
    const settings = useSituationSettings()
    const { activities, categories, observations, publish } = run()
    publish(T0)

    await settings.update({ shareForegroundWindow: false })
    publish(T0 + 1_000, { title: 'secret plans.txt - Notepad' })

    expect(categories).toEqual(['other', null])
    expect(JSON.stringify(observations)).not.toMatch(/secret/u)

    await settings.update({ shareForegroundWindow: true })

    expect(activities()).toEqual([
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'notes.txt', atMs: T0 },
      { kind: 'activity', appId: 'notepad', label: 'Notepad', category: 'other', title: 'secret plans.txt', atMs: T0 + 1_000 },
    ])
    expect(categories).toEqual(['other', null, 'other'])
  })

  it('reads nothing after it stops', () => {
    const { observations, publish, sensor } = run()
    publish(T0)

    sensor.stop()
    publish(T0 + 1_000, { title: 'later.txt - Notepad', notificationState: 'busy' })

    expect(observations).toHaveLength(2)
  })
})
