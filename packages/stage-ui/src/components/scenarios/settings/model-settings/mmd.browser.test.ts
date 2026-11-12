import type { ClipKind, ClipLayer, ClipMetaNote, DerivedClipMeta } from '@proj-airi/stage-ui-mmd'

import type { DesktopStageHost, DesktopStageState } from './desktop-stage'
import type { ExpressionPanelEntry } from './expressions/source'
import type { ModelSettingsRuntimeSnapshot } from './runtime'

import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import { nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { desktopStageHostKey } from './desktop-stage'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  })
}

const { t } = createTestI18n().global

/** A face entry as the MMD store publishes it: the morph name is the id, the label, and the only parameter. */
function morphEntry(name: string, overrides: Partial<ExpressionPanelEntry> = {}): ExpressionPanelEntry {
  return {
    id: name,
    name,
    label: name,
    kind: 'face',
    group: null,
    confirmed: false,
    exposedToLlm: false,
    mappings: [],
    fileName: name,
    parameterIds: [name],
    active: false,
    effective: overrides.active ?? false,
    overriddenBy: null,
    via: [],
    isDefault: false,
    ...overrides,
  }
}

function remoteSnapshot(entries: ExpressionPanelEntry[]): ModelSettingsRuntimeSnapshot {
  return {
    ownerInstanceId: 'stage-owner',
    modelId: 'display-model-chisa',
    renderer: 'mmd',
    phase: 'mounted',
    controlsLocked: false,
    previewAvailable: true,
    canCapturePreview: false,
    updatedAt: 1,
    mmdExpressions: {
      entries,
      groups: [{ id: 'group:eyes', memberIds: entries.filter(entry => entry.group === 'group:eyes').map(entry => entry.id) }],
      activeIds: entries.filter(entry => entry.active).map(entry => entry.id),
      restIds: [],
    },
  }
}

const localSnapshot: ModelSettingsRuntimeSnapshot = {
  ownerInstanceId: '',
  modelId: '',
  renderer: 'mmd',
  phase: 'mounted',
  controlsLocked: false,
  previewAvailable: true,
  canCapturePreview: false,
  updatedAt: 1,
}

/** Chisa-like PMX morphs: 笑い and 怒り become faces; あ is lip-sync owned and まばたき is blink owned, so neither is an expression. */
const chisaMorphs = [
  { index: 0, name: 'あ', category: 3, type: 1 },
  { index: 1, name: 'まばたき', category: 2, type: 1 },
  { index: 2, name: '笑い', category: 2, type: 1 },
  { index: 3, name: '怒り', category: 2, type: 1 },
  { index: 4, name: '照れ', category: 4, type: 1 },
]

describe('mmd model settings expressions', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
      import('virtual:uno.css'),
    ])
  }, 60_000)

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a remote MMD snapshot with its groups and emits a curate command without touching the local store', async () => {
    const [{ useMMDExpressionStore }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const onMmdExpressionCommand = vi.fn()
    const entries = [
      morphEntry('笑い', { label: 'Smile', mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }] }),
      morphEntry('怒り', { label: 'Angry', mappings: [{ emotion: 'angry', weight: 1, minBand: 'clear' }], active: true }),
      morphEntry('じと目', { label: 'Eyes A', group: 'group:eyes' }),
      morphEntry('はぅ', { label: 'Eyes B', group: 'group:eyes' }),
    ]

    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: remoteSnapshot(entries), onMmdExpressionCommand },
      global: { plugins: [pinia, createTestI18n()] },
    })

    expect(t('settings.mmd.expressions.title')).not.toBe('settings.mmd.expressions.title')
    await screen.getByText(t('settings.mmd.expressions.title'), { exact: true }).click()

    // Emotion first: the Reactions block lists the mapped faces before the catalog rows.
    await expect.element(screen.getByText(t('settings.live2d.expressions.reactions.title'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Angry` })).toBeChecked()
    // The choose-one set renders as one group row with a select, not as two switches.
    await expect.element(screen.getByRole('combobox', { name: t('settings.live2d.expressions.group-select') })).toBeVisible()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.live2d.expressions.switch')}: Eyes A` })).not.toBeInTheDocument()
    // MMD publishes no free parameters, so the Live2D-only custom switch creator stays hidden.
    await expect.element(screen.getByRole('button', { name: t('settings.live2d.expressions.custom.add'), exact: true })).not.toBeInTheDocument()

    await screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: Smile` }).click()

    expect(onMmdExpressionCommand).toHaveBeenCalledTimes(1)
    expect(onMmdExpressionCommand).toHaveBeenCalledWith({ type: 'update-entry', id: '笑い', patch: { exposedToLlm: true } })
    expect(useMMDExpressionStore(pinia).catalog).toEqual([])
  })

  it('curates the local MMD store when no remote snapshot is present and persists the override', async () => {
    const [{ useMMDExpressionStore }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const store = useMMDExpressionStore(pinia)
    store.registerMorphs('display-model-chisa', chisaMorphs, null, 0)
    const onMmdExpressionCommand = vi.fn()

    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: localSnapshot, onMmdExpressionCommand },
      global: { plugins: [pinia, createTestI18n()] },
    })
    await screen.getByText(t('settings.mmd.expressions.title'), { exact: true }).click()
    // Derived faces start inactive and unmapped, so the in-use filter hides them until Show all.
    const hiddenRowCount = store.settingsSnapshot.entries.filter(entry => entry.group === null && !entry.active && entry.mappings.length === 0).length
    expect(hiddenRowCount).toBeGreaterThan(0)
    await screen.getByRole('button', { name: t('settings.live2d.expressions.show-all', { count: hiddenRowCount }), exact: true }).click()

    // Derived faces are exposed to the AI by default, so the curation here withdraws one.
    const exposed = screen.getByRole('switch', { name: `${t('settings.live2d.expressions.llm-exposed')}: 笑い` })
    await expect.element(exposed).toBeChecked()
    await exposed.click()

    expect(onMmdExpressionCommand).not.toHaveBeenCalled()
    expect(store.catalog.find(entry => entry.id === 'mmd:2:笑い')?.exposedToLlm).toBe(false)
    await expect.element(exposed).not.toBeChecked()
    const stored = JSON.parse(localStorage.getItem('expression-catalog:display-model-chisa') ?? 'null')
    expect(stored.overrides).toEqual([{ id: 'mmd:2:笑い', exposedToLlm: false }])
  })
})

const MODEL_ID = 'preset-live2d-1'

const builtInDisplay: DesktopStageState['displays'][number] = { id: '1', primary: true, workArea: { x: 0, y: 25, width: 1440, height: 801 }, scaleFactor: 2 }
const externalDisplay: DesktopStageState['displays'][number] = { id: '7', primary: false, workArea: { x: 1440, y: 0, width: 2560, height: 1415 }, scaleFactor: 1 }

/** A host whose writes land in its own state, as the Electron page does after each invoke resolves. */
function fakeDesktopStageHost(initial: Omit<DesktopStageState, 'next' | 'followMe'> & Partial<Pick<DesktopStageState, 'next' | 'followMe'>>) {
  const state = shallowRef<DesktopStageState | null>({ ...initial, followMe: initial.followMe ?? false, next: initial.next ?? (initial.experimental ? initial.mode : 'window') })
  const host: DesktopStageHost = {
    state,
    setExperimental: vi.fn(async (experimental) => {
      state.value = { ...state.value!, experimental, next: experimental ? state.value!.mode : 'window' }
    }),
    setMode: vi.fn(async (mode) => {
      state.value = { ...state.value!, mode, next: state.value!.experimental ? mode : 'window' }
    }),
    setHomeDisplay: vi.fn(async (homeDisplayId) => {
      state.value = { ...state.value!, homeDisplayId }
    }),
    setFollowMe: vi.fn(async (followMe) => {
      state.value = { ...state.value!, followMe }
    }),
    relaunch: vi.fn(async () => {}),
  }
  return host
}

describe('mmd model settings desktop stage', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
      import('virtual:uno.css'),
    ])
  }, 60_000)

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  async function renderWithHost(host: DesktopStageHost | undefined) {
    const [{ useMMD }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const store = useMMD(pinia)
    store.resetState()
    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: localSnapshot },
      global: {
        plugins: [pinia, createTestI18n()],
        provide: host ? { [desktopStageHostKey as symbol]: host } : {},
      },
    })
    return { screen, store }
  }

  it('hides the section and the classic-only note when no desktop host is provided', async () => {
    const { screen } = await renderWithHost(undefined)

    expect(t('settings.mmd.stage.title')).not.toBe('settings.mmd.stage.title')
    await expect.element(screen.getByText(t('settings.mmd.stage.title'), { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText(t('settings.mmd.stage.classic-only-note'), { exact: true })).not.toBeInTheDocument()
  })

  it('shows only the off Experimental 3D stage toggle until it is turned on, then the stage controls and a relaunch', async () => {
    const host = fakeDesktopStageHost({ experimental: false, mode: 'window', running: 'window', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    const toggle = screen.getByRole('switch', { name: t('settings.mmd.stage.experimental.title') })
    await expect.element(toggle).not.toBeChecked()
    await expect.element(screen.getByText(t('settings.mmd.stage.mode.title'), { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText(t('settings.mmd.stage.classic-only-note'), { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: t('settings.mmd.stage.relaunch.button'), exact: true })).not.toBeInTheDocument()

    await toggle.click()
    await vi.waitFor(() => expect(host.setExperimental).toHaveBeenCalledWith(true))
    await expect.element(screen.getByText(t('settings.mmd.stage.mode.title'), { exact: true })).toBeVisible()
    // The saved mode is still the classic window, so turning the setting on alone needs no relaunch.
    await expect.element(screen.getByRole('button', { name: t('settings.mmd.stage.relaunch.button'), exact: true })).not.toBeInTheDocument()
  })

  it('offers a relaunch when the setting is turned off while the desktop stage runs', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()
    const relaunch = screen.getByRole('button', { name: t('settings.mmd.stage.relaunch.button'), exact: true })
    await expect.element(relaunch).not.toBeInTheDocument()

    await screen.getByRole('switch', { name: t('settings.mmd.stage.experimental.title') }).click()
    await vi.waitFor(() => expect(host.setExperimental).toHaveBeenCalledWith(false))
    await expect.element(relaunch).toBeVisible()
    await expect.element(screen.getByText(t('settings.mmd.stage.mode.title'), { exact: true })).not.toBeInTheDocument()
  })

  it('renders the saved mode from the host state and shows the relaunch button only while the saved mode differs from the running one', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'window', running: 'window', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen } = await renderWithHost(host)
    await expect.element(screen.getByText(t('settings.mmd.stage.classic-only-note'), { exact: true })).toBeVisible()
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    const classic = screen.getByRole('radio', { name: t('settings.mmd.stage.mode.options.window.title'), exact: true })
    const desktop = screen.getByRole('radio', { name: t('settings.mmd.stage.mode.options.desktop.title'), exact: true })
    const relaunch = screen.getByRole('button', { name: t('settings.mmd.stage.relaunch.button'), exact: true })
    await expect.element(classic).toBeChecked()
    await expect.element(relaunch).not.toBeInTheDocument()
    // One display: the home display cannot change, so the control is disabled.
    await expect.element(screen.getByRole('combobox', { name: t('settings.mmd.stage.home-display.title') })).toBeDisabled()

    await desktop.click()
    await vi.waitFor(() => expect(host.setMode).toHaveBeenCalledWith('desktop'))
    await expect.element(desktop).toBeChecked()
    await expect.element(relaunch).toBeVisible()
    await expect.element(screen.getByText(t('settings.mmd.stage.relaunch.description'), { exact: true })).toBeVisible()

    await relaunch.click()
    expect(host.relaunch).toHaveBeenCalledOnce()

    // Saving the running mode again hides the button; the mode is never applied live.
    await classic.click()
    await vi.waitFor(() => expect(host.setMode).toHaveBeenLastCalledWith('window'))
    await expect.element(relaunch).not.toBeInTheDocument()
  })

  it('explains a restricted desktop host without offering a relaunch that cannot change it', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'window', next: 'window', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    await expect.element(screen.getByText(t('settings.mmd.stage.classic-host-notice'), { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: t('settings.mmd.stage.relaunch.button'), exact: true })).not.toBeInTheDocument()
  })

  it('switches the home display through the host and leaves the current one alone', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay, externalDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    const combobox = screen.getByRole('combobox', { name: t('settings.mmd.stage.home-display.title') })
    await expect.element(combobox).not.toBeDisabled()
    await combobox.click()
    await screen.getByRole('option', { name: /Display 7/ }).click()

    await vi.waitFor(() => expect(host.setHomeDisplay).toHaveBeenCalledWith('7'))
    expect(host.setHomeDisplay).toHaveBeenCalledOnce()
  })

  it('turns Follow me on through the host, off by default', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay, externalDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    const followMe = screen.getByRole('switch', { name: t('settings.mmd.stage.follow-me.title') })
    await expect.element(followMe).not.toBeChecked()
    await followMe.click()
    await vi.waitFor(() => expect(host.setFollowMe).toHaveBeenCalledWith(true))
    await expect.element(followMe).toBeChecked()
  })

  it('offers Follow me only with a second display', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    await expect.element(screen.getByRole('switch', { name: t('settings.mmd.stage.follow-me.title') })).toBeDisabled()
  })

  it('writes the character height and the roam mode to the store and persists them', async () => {
    const host = fakeDesktopStageHost({ experimental: true, mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay] })
    const { screen, store } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    await expect.element(screen.getByRole('radio', { name: t('settings.mmd.stage.roam.options.stay.title'), exact: true })).toBeChecked()
    await screen.getByRole('radio', { name: t('settings.mmd.stage.roam.options.roam.title'), exact: true }).click()
    await nextTick()
    expect(store.roamMode).toBe('roam')
    expect(localStorage.getItem('settings/mmd/roam-mode')).toBe('roam')

    // The Range input scales its value, so read the formatted readout next to the label.
    await expect.element(screen.getByRole('slider', { name: t('settings.mmd.stage.character-height.title') })).toBeVisible()
    await expect.element(screen.getByText('560 pt', { exact: true })).toBeVisible()
    store.stageCharacterHeight = 400
    await nextTick()
    await expect.element(screen.getByText('400 pt', { exact: true })).toBeVisible()
    expect(localStorage.getItem('settings/mmd/stage-character-height')).toBe('400')
  })
})

describe('mmd model settings motion', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
      import('virtual:uno.css'),
    ])
  }, 60_000)

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  async function renderMotionSection() {
    const [{ useMMD, useMMDNaturalSettings }, { useSettingsStageModel }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('../../../../stores/settings/stage-model'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const store = useMMD(pinia)
    store.resetState()
    const natural = useMMDNaturalSettings(pinia)
    // The stage-model store replaces an unknown id with the default preset, so use a known one.
    useSettingsStageModel(pinia).stageModelSelected = MODEL_ID
    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: localSnapshot },
      global: { plugins: [pinia, createTestI18n()] },
    })
    expect(t('settings.mmd.motion.title')).not.toBe('settings.mmd.motion.title')
    await screen.getByText(t('settings.mmd.motion.title'), { exact: true }).click()
    return { screen, store, natural }
  }

  it('switches the driver through the radio and writes the store, hiding Natural controls under Classic', async () => {
    const { screen, store, natural } = await renderMotionSection()
    const energy = screen.getByRole('slider', { name: t('settings.mmd.motion.natural-energy.title') })
    const touch = screen.getByRole('switch', { name: t('settings.mmd.motion.natural-touch.title') })
    await expect.element(screen.getByRole('radio', { name: t('settings.mmd.motion.driver.options.natural.title'), exact: true })).toBeChecked()
    await expect.element(energy).toBeVisible()
    await expect.element(touch).toBeChecked()

    await screen.getByRole('radio', { name: t('settings.mmd.motion.driver.options.classic.title'), exact: true }).click()
    await nextTick()
    expect(store.motionDriver).toBe('classic')
    expect(localStorage.getItem('settings/mmd/motion-driver')).toBe('classic')
    await expect.element(energy).not.toBeInTheDocument()
    await expect.element(touch).not.toBeInTheDocument()

    await screen.getByRole('radio', { name: t('settings.mmd.motion.driver.options.natural.title'), exact: true }).click()
    await nextTick()
    expect(store.motionDriver).toBe('natural')
    await expect.element(energy).toBeVisible()

    // Pet-requires-hold depends on the touch toggle, and both write the settings document.
    const hold = screen.getByRole('switch', { name: t('settings.mmd.motion.natural-touch-pet-requires-hold.title') })
    await hold.click()
    await nextTick()
    expect(natural.document.touchPetRequiresHold).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings/mmd/natural')!).touchPetRequiresHold).toBe(true)
    await touch.click()
    await nextTick()
    expect(natural.document.touch).toBe(false)
    expect(JSON.parse(localStorage.getItem('settings/mmd/natural')!).touch).toBe(false)
    await expect.element(hold).not.toBeInTheDocument()
  })

  it('writes the per-model emotion strength under Natural, in the shape Live2D uses', async () => {
    const { screen, natural } = await renderMotionSection()
    await screen.getByRole('button', { name: t('settings.natural.emotion-strength.title') }).click()
    const happy = screen.getByRole('slider', { name: t('settings.emotions.happy') })
    await expect.element(happy).toBeVisible()
    happy.element().focus()
    for (let step = 0; step < 10; step++)
      await userEvent.keyboard('{ArrowRight}')
    await vi.waitFor(() => expect(natural.document.emotionStrength).toEqual({ [MODEL_ID]: { happy: 1.5 } }))
    expect(JSON.parse(localStorage.getItem('settings/mmd/natural') ?? 'null').emotionStrength).toEqual({ [MODEL_ID]: { happy: 1.5 } })

    await screen.getByRole('button', { name: t('settings.natural.emotion-strength.reset'), exact: true }).click()
    await vi.waitFor(() => expect(natural.document.emotionStrength).toEqual({}))
  })

  it('writes the stance slot for the selected stage model and shows None for a removed motion', async () => {
    const { screen, store } = await renderMotionSection()
    store.availableMotions = [{ id: 'mmd-motion-sit', name: 'sit' }, { id: 'mmd-motion-wave', name: 'wave' }]
    // A slot naming a motion that no longer exists reads as the none state.
    store.stanceSlots = { [MODEL_ID]: { sleep: 'gone' } }
    await nextTick()

    const sit = screen.getByRole('combobox', { name: t('settings.mmd.motion.stance.sit') })
    const sleep = screen.getByRole('combobox', { name: t('settings.mmd.motion.stance.sleep') })
    // The combobox is a text input that shows the selected option's label as its value.
    await expect.element(sleep).toHaveValue(t('settings.mmd.motion.stance.none'))

    await sit.click()
    await screen.getByRole('option', { name: 'sit', exact: true }).click()
    // The combobox commits its selection after its own tick, so wait for the store rather than one render.
    await vi.waitFor(() => expect(store.stanceSlots[MODEL_ID]).toEqual({ sleep: 'gone', sit: 'sit' }))
    expect(JSON.parse(localStorage.getItem('settings/mmd/stance-slots') ?? 'null')).toEqual({ [MODEL_ID]: { sleep: 'gone', sit: 'sit' } })
    await expect.element(sit).toHaveValue('sit')

    // Choosing None removes only that slot.
    await sit.click()
    await screen.getByRole('option', { name: t('settings.mmd.motion.stance.none'), exact: true }).click()
    await vi.waitFor(() => expect(store.stanceSlots[MODEL_ID]).toEqual({ sleep: 'gone' }))
    await expect.element(sit).toHaveValue(t('settings.mmd.motion.stance.none'))
  })
})

/** Derived metadata as the scene publishes it after import. */
function clipMeta(name: string, kind: ClipKind, layer: ClipLayer, durationMs: number, notes: ClipMetaNote[] = []): DerivedClipMeta & { name: string } {
  return { name, kind, layer, loop: kind === 'stance', durationMs, label: name, notes }
}

describe('mmd model settings clips', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('./mmd.vue'),
      import('virtual:uno.css'),
    ])
  }, 60_000)

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  const aiMayUse = (name: string) => `${t('settings.mmd.animation.clips.headers.ai-may-use')}: ${name}`
  const label = (name: string) => `${t('settings.mmd.animation.clips.headers.label')}: ${name}`

  async function renderClipTable() {
    const [{ useMMD }, { useSettingsStageModel }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('../../../../stores/settings/stage-model'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const store = useMMD(pinia)
    store.resetState()
    // The reset's storage write settles on the next tick and would overwrite a seed made in the same tick.
    await nextTick()
    const stageModel = useSettingsStageModel(pinia)
    stageModel.stageModelSelected = MODEL_ID
    store.availableMotions = [
      { id: 'mmd-motion-1', name: 'arms-wave' },
      { id: 'mmd-motion-2', name: 'legs-step' },
      { id: 'mmd-motion-3', name: 'dance-long' },
      { id: 'mmd-motion-4', name: 'empty' },
    ]
    store.availableClipMeta = {
      'arms-wave': clipMeta('arms-wave', 'gesture', 'upper', 2_000),
      'legs-step': clipMeta('legs-step', 'action', 'full', 3_000),
      'dance-long': clipMeta('dance-long', 'dance', 'full', 50_000),
      'empty': clipMeta('empty', 'unusable', 'none', 1_000, ['no-animated-bones']),
    }
    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: localSnapshot },
      global: { plugins: [pinia, createTestI18n()] },
    })
    expect(t('settings.mmd.animation.clips.headers.ai-may-use')).not.toBe('settings.mmd.animation.clips.headers.ai-may-use')
    await screen.getByText(t('settings.mmd.animation.title'), { exact: true }).click()
    return { screen, store, stageModel }
  }

  it('renders one row per imported clip with the derived kind and layer badges and the unusable note', async () => {
    const { screen } = await renderClipTable()

    await expect.element(screen.getByRole('row', { name: /arms-wave/ })).toBeVisible()
    expect(screen.getByRole('row').elements()).toHaveLength(5) // header plus four clips
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.kinds.gesture'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.kinds.action'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.kinds.dance'), { exact: true })).toBeVisible()
    expect(screen.getByText(t('settings.mmd.animation.clips.layers.upper'), { exact: true }).elements()).toHaveLength(1)
    expect(screen.getByText(t('settings.mmd.animation.clips.layers.full'), { exact: true }).elements()).toHaveLength(2)
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.kinds.unusable'), { exact: true })).toBeVisible()
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.notes.no-animated-bones'), { exact: true })).toBeVisible()
    // The kind select is named per row and starts on Auto.
    await expect.element(screen.getByRole('combobox', { name: `${t('settings.mmd.animation.clips.headers.kind')}: legs-step` })).toHaveTextContent(t('settings.mmd.animation.clips.kinds.auto'))
  })

  it('refuses a duplicate or malformed label with an inline error and leaves the store unchanged', async () => {
    const { screen, store } = await renderClipTable()

    await screen.getByRole('textbox', { name: label('arms-wave') }).fill('wave')
    await vi.waitFor(() => expect(store.curationFor(MODEL_ID, 'arms-wave').label).toBe('wave'))

    const second = screen.getByRole('textbox', { name: label('legs-step') })
    await second.fill('wave')
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.errors.duplicate'), { exact: true })).toBeVisible()
    expect(store.curationFor(MODEL_ID, 'legs-step').label).toBeNull()
    expect(Object.values(store.clipCuration[MODEL_ID] ?? {}).filter(curation => curation.label === 'wave')).toHaveLength(1)

    for (const malformed of ['Wave', 'wave!', 'a'.repeat(33)]) {
      await second.fill(malformed)
      await expect.element(screen.getByText(t('settings.mmd.animation.clips.errors.invalid'), { exact: true })).toBeVisible()
      expect(store.curationFor(MODEL_ID, 'legs-step').label).toBeNull()
    }

    // A valid label clears the error and lands in the store.
    await second.fill('step')
    await vi.waitFor(() => expect(store.curationFor(MODEL_ID, 'legs-step').label).toBe('step'))
    await expect.element(screen.getByText(t('settings.mmd.animation.clips.errors.invalid'), { exact: true })).not.toBeInTheDocument()
  })

  it('shows an empty label input for a same-named clip after the loaded model changes', async () => {
    const { screen, store, stageModel } = await renderClipTable()
    const input = screen.getByRole('textbox', { name: label('arms-wave') })
    await input.fill('wave')
    await vi.waitFor(() => expect(store.curationFor(MODEL_ID, 'arms-wave').label).toBe('wave'))

    stageModel.stageModelSelected = 'mmd-other-model'
    await vi.waitFor(() => expect(store.curationFor('mmd-other-model', 'arms-wave').label).toBeNull())
    await expect.element(input).toHaveValue('')
    expect(store.curationFor(MODEL_ID, 'arms-wave').label).toBe('wave')

    // Switching back shows model A's stored label again.
    stageModel.stageModelSelected = MODEL_ID
    await expect.element(input).toHaveValue('wave')
  })

  it('exposes a labeled gesture to the AI through the switch and persists it', async () => {
    const { screen, store } = await renderClipTable()
    await screen.getByRole('textbox', { name: label('arms-wave') }).fill('wave')
    await vi.waitFor(() => expect(store.curationFor(MODEL_ID, 'arms-wave').label).toBe('wave'))

    const exposed = screen.getByRole('switch', { name: aiMayUse('arms-wave') })
    await expect.element(exposed).not.toBeDisabled()
    await exposed.click()
    await nextTick()
    expect(store.exposedActions(MODEL_ID)).toEqual([{ name: 'arms-wave', label: 'wave', kind: 'gesture', layer: 'upper', exposed: true, idle: false }])
    expect(JSON.parse(localStorage.getItem('settings/mmd/clip-curation') ?? 'null')[MODEL_ID]['arms-wave']).toEqual({ label: 'wave', kind: null, loop: null, aiMayUse: true, idleMayUse: false })
  })

  it('lets her play a labeled clip on her own through the idle switch, without exposing it to the AI', async () => {
    const { screen, store } = await renderClipTable()
    const idleMayUse = (name: string) => `${t('settings.mmd.animation.clips.headers.idle-may-use')}: ${name}`
    await expect.element(screen.getByRole('switch', { name: idleMayUse('arms-wave') })).toBeDisabled()
    await screen.getByRole('textbox', { name: label('arms-wave') }).fill('wave')
    await vi.waitFor(() => expect(store.curationFor(MODEL_ID, 'arms-wave').label).toBe('wave'))

    const idle = screen.getByRole('switch', { name: idleMayUse('arms-wave') })
    await expect.element(idle).not.toBeDisabled()
    await idle.click()
    await nextTick()
    expect(store.labeledClips(MODEL_ID).find(clip => clip.name === 'arms-wave')).toMatchObject({ exposed: false, idle: true })
    expect(store.exposedActions(MODEL_ID)).toEqual([])
  })

  it('disables the switch for an unlabeled or unusable clip and the loop toggle for a dance', async () => {
    const { screen } = await renderClipTable()

    await expect.element(screen.getByRole('switch', { name: aiMayUse('legs-step') })).toBeDisabled()
    await expect.element(screen.getByRole('switch', { name: aiMayUse('empty') })).toBeDisabled()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.mmd.animation.clips.headers.loop')}: dance-long` })).toBeDisabled()
    await expect.element(screen.getByRole('switch', { name: `${t('settings.mmd.animation.clips.headers.loop')}: legs-step` })).not.toBeDisabled()
  })
})
