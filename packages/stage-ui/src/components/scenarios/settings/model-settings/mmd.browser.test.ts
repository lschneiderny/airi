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
function fakeDesktopStageHost(initial: DesktopStageState) {
  const state = shallowRef<DesktopStageState | null>(initial)
  const host: DesktopStageHost = {
    state,
    setMode: vi.fn(async (mode) => {
      state.value = { ...state.value!, mode }
    }),
    setHomeDisplay: vi.fn(async (homeDisplayId) => {
      state.value = { ...state.value!, homeDisplayId }
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

  it('renders the saved mode from the host state and shows the relaunch button only while the saved mode differs from the running one', async () => {
    const host = fakeDesktopStageHost({ mode: 'window', running: 'window', homeDisplayId: '1', displays: [builtInDisplay] })
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

  it('switches the home display through the host and leaves the current one alone', async () => {
    const host = fakeDesktopStageHost({ mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay, externalDisplay] })
    const { screen } = await renderWithHost(host)
    await screen.getByText(t('settings.mmd.stage.title'), { exact: true }).click()

    const combobox = screen.getByRole('combobox', { name: t('settings.mmd.stage.home-display.title') })
    await expect.element(combobox).not.toBeDisabled()
    await combobox.click()
    await screen.getByRole('option', { name: /Display 7/ }).click()

    await vi.waitFor(() => expect(host.setHomeDisplay).toHaveBeenCalledWith('7'))
    expect(host.setHomeDisplay).toHaveBeenCalledOnce()
  })

  it('writes the character height and the roam mode to the store and persists them', async () => {
    const host = fakeDesktopStageHost({ mode: 'desktop', running: 'desktop', homeDisplayId: '1', displays: [builtInDisplay] })
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
    const [{ useMMD }, { useSettingsStageModel }, { default: MMDSettings }] = await Promise.all([
      import('@proj-airi/stage-ui-mmd'),
      import('../../../../stores/settings/stage-model'),
      import('./mmd.vue'),
    ])
    const pinia = createPinia()
    const store = useMMD(pinia)
    store.resetState()
    // The stage-model store replaces an unknown id with the default preset, so use a known one.
    useSettingsStageModel(pinia).stageModelSelected = MODEL_ID
    const screen = await render(MMDSettings, {
      props: { palette: [], runtimeSnapshot: localSnapshot },
      global: { plugins: [pinia, createTestI18n()] },
    })
    expect(t('settings.mmd.motion.title')).not.toBe('settings.mmd.motion.title')
    await screen.getByText(t('settings.mmd.motion.title'), { exact: true }).click()
    return { screen, store }
  }

  it('switches the driver through the radio and writes the store, hiding Natural controls under Classic', async () => {
    const { screen, store } = await renderMotionSection()
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

    // Pet-requires-hold depends on the touch toggle, and both write their landed keys.
    const hold = screen.getByRole('switch', { name: t('settings.mmd.motion.natural-touch-pet-requires-hold.title') })
    await hold.click()
    await nextTick()
    expect(store.naturalTouchPetRequiresHold).toBe(true)
    expect(localStorage.getItem('settings/mmd/natural-touch-pet-requires-hold')).toBe('true')
    await touch.click()
    await nextTick()
    expect(store.naturalTouch).toBe(false)
    expect(localStorage.getItem('settings/mmd/natural-touch')).toBe('false')
    await expect.element(hold).not.toBeInTheDocument()
  })

  it('writes the per-model emotion strength under Natural, in the shape Live2D uses', async () => {
    const { screen, store } = await renderMotionSection()
    await screen.getByRole('button', { name: t('settings.natural.emotion-strength.title') }).click()
    const happy = screen.getByRole('slider', { name: t('settings.emotions.happy') })
    await expect.element(happy).toBeVisible()
    happy.element().focus()
    for (let step = 0; step < 10; step++)
      await userEvent.keyboard('{ArrowRight}')
    await vi.waitFor(() => expect(store.naturalEmotionStrength).toEqual({ [MODEL_ID]: { happy: 1.5 } }))
    expect(JSON.parse(localStorage.getItem('settings/mmd/natural-emotion-strength') ?? 'null')).toEqual({ [MODEL_ID]: { happy: 1.5 } })

    await screen.getByRole('button', { name: t('settings.natural.emotion-strength.reset'), exact: true }).click()
    await vi.waitFor(() => expect(store.naturalEmotionStrength).toEqual({}))
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
