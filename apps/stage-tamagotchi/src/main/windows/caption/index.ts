import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { animate, utils } from 'animejs'
import { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { debounce, throttle } from 'es-toolkit'
import { isMacOS } from 'std-env'
import { boolean, number, object, optional, record, string } from 'valibot'

import icon from '../../../../resources/icon.png?asset'

import { captionGetIsFollowingWindow, captionIsFollowingWindowChanged } from '../../../shared/eventa'
import { clampBoundsWithinRect } from '../../../shared/utils/electron/display'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createWindowContext } from '../../libs/electron/window-context'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { displayMatching, onCompositorWindowRect, readDisplays, readPrimaryDisplay, readWindowRect, windowOriginTrusted } from '../../services/electron/coordinates'
import { showWindowOnAllWorkspaces } from '../shared/app-icon'
import { mapForBreakpoints, resolutionBreakpoints, widthFrom } from '../shared/display'
import { placeWindow } from '../shared/placement'
import { protectPrivilegedWindowNavigation, setupBaseWindowElectronInvokes, setWindowAlwaysOnTop, transparentWindowConfig } from '../shared/window'

const captionConfigSchema = object({
  isFollowing: boolean(),
  matrices: record(string(), object({
    bounds: object({
      x: optional(number()),
      y: optional(number()),
      width: number(),
      height: number(),
    }),
    relativeToMain: optional(object({
      dx: number(),
      dy: number(),
    })),
  })),
})
type CaptionConfig = InferOutput<typeof captionConfigSchema>

function computeDisplayMatrixHash(): string {
  const displays = readDisplays()
  const signature = displays
    .slice()
    .sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))
    .map(d => [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.scaleFactor ?? 1].join(','))
    .join('|')

  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}

function computeInitialCaptionBounds(params: { mainWindow: BrowserWindow, captionOptions?: Partial<Rectangle> }): Pick<Rectangle, 'width' | 'height'> & Partial<Rectangle> {
  const mainBounds = readWindowRect(params.mainWindow)
  const displayWorkArea = mainBounds ? displayMatching(mainBounds).workArea : readPrimaryDisplay().workArea

  // Base sizing from display width with sensible caps
  const width = mapForBreakpoints(
    displayWorkArea.width,
    {
      '720p': widthFrom(displayWorkArea, { percentage: 0.9, max: { actual: 560 }, min: { actual: 280 } }),
      '1080p': widthFrom(displayWorkArea, { percentage: 0.5, max: { actual: 640 }, min: { actual: 320 } }),
      '2k': widthFrom(displayWorkArea, { percentage: 0.4, max: { actual: 720 }, min: { actual: 360 } }),
      '4k': widthFrom(displayWorkArea, { percentage: 0.33, max: { actual: 768 }, min: { actual: 420 } }),
    },
    { breakpoints: resolutionBreakpoints },
  )
  const height = Math.max(Math.floor(width / 3.2), 120)

  if (!mainBounds)
    return { width, height }

  const margin = 16
  // Prefer to the right of main window, else to the left, else bottom centered
  let x = mainBounds.x + mainBounds.width + margin
  let y = mainBounds.y + mainBounds.height - height

  const rightEdge = x + width
  const displayRight = displayWorkArea.x + displayWorkArea.width

  if (rightEdge > displayRight) {
    // Place to the left
    x = mainBounds.x - width - margin
  }

  // If still out of bounds horizontally, fallback to bottom center
  if (x < displayWorkArea.x || (x + width) > displayRight) {
    x = displayWorkArea.x + Math.floor((displayWorkArea.width - width) / 2)
  }

  // Clamp vertically
  if (y < displayWorkArea.y) {
    y = displayWorkArea.y + margin
  }

  const initial = clampBoundsWithinRect({ x, y, width, height }, displayWorkArea)

  return { ...initial, ...params.captionOptions }
}

function createCaptionWindow(options?: BrowserWindowConstructorOptions) {
  const window = new ElectronBrowserWindow({
    title: 'Caption',
    width: 480,
    height: 180,
    show: false,
    icon,
    webPreferences: {
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: isMacOS ? 'panel' : undefined,
    ...transparentWindowConfig(),
    ...options,
  })

  // Click-through is controlled by caller via setIgnoreMouseEvents
  // Avoid window buttons on macOS frameless windows
  // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
  //
  // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
  // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
  showWindowOnAllWorkspaces(window)
  if (isMacOS) {
    window.setFullScreenable(false)
    window.setWindowButtonVisibility(false)
  }
  setWindowAlwaysOnTop(window, true, 2)

  window.on('ready-to-show', () => window.show())
  protectPrivilegedWindowNavigation(window)

  return window
}

export function setupCaptionWindowManager(params: {
  mainWindow: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}) {
  const matrixHash = computeDisplayMatrixHash()

  const {
    setup: setupConfig,
    get: getConfigRaw,
    update: updateConfig,
  } = createConfig('windows-caption', 'config.json', captionConfigSchema, {
    default: { isFollowing: true, matrices: {} },
    autoHeal: true,
  })
  const getConfig = (): CaptionConfig => getConfigRaw() ?? { isFollowing: true, matrices: {} }

  setupConfig()

  let isFollowing = getConfig().isFollowing ?? true
  let lastProgrammaticMoveAt = 0

  // Keep references to listeners so we can detach when toggling
  let detachMainMoveListener: (() => void) | undefined

  // Note: when following window, we compute and persist the current relative offset
  // and start following without docking, so no immediate reposition is needed here.

  function computeRelativeOffset(win: BrowserWindow): { dx: number, dy: number } | null {
    const caption = readWindowRect(win)
    const main = readWindowRect(params.mainWindow)
    return caption && main ? { dx: caption.x - main.x, dy: caption.y - main.y } : null
  }

  function followMainWindow(win: BrowserWindow) {
    const cfg = getConfig() ?? { isFollowing, matrices: {} }
    const initialOffset = cfg?.matrices?.[matrixHash]?.relativeToMain ?? computeRelativeOffset(win)
    if (!windowOriginTrusted() || !initialOffset)
      return

    // Store relative offset for this matrix
    const cfgToSave = getConfig() ?? { isFollowing, matrices: {} }
    cfgToSave.matrices[matrixHash] = { ...cfgToSave.matrices[matrixHash], relativeToMain: initialOffset }
    updateConfig(cfgToSave)

    let animation: ReturnType<typeof animate> | null = null
    const state = { x: 0, y: 0 }

    const settleTo = (toX: number, toY: number) => {
      if (win.isDestroyed() || !windowOriginTrusted())
        return
      if (!Number.isFinite(toX) || !Number.isFinite(toY))
        return

      const b = readWindowRect(win)
      if (!b)
        return
      state.x = Number.isFinite(b.x) ? b.x : 0
      state.y = Number.isFinite(b.y) ? b.y : 0
      animation?.pause()
      animation = animate(state, {
        x: toX,
        y: toY,
        duration: 160,
        ease: 'outCubic',
        modifier: utils.round(0),
        onRender: () => {
          if (win.isDestroyed() || !windowOriginTrusted())
            return
          if (!Number.isFinite(state.x) || !Number.isFinite(state.y))
            return

          const toX = Math.round(state.x)
          const toY = Math.round(state.y)
          lastProgrammaticMoveAt = Date.now()
          placeWindow(win, { x: toX, y: toY })
        },
      })
    }

    let lastTx = 0
    let lastTy = 0
    let lastAppliedTx = Number.NaN
    let lastAppliedTy = Number.NaN

    const moveThrottled = throttle(() => {
      if (win.isDestroyed() || !windowOriginTrusted())
        return

      const stored = getConfig()?.matrices[matrixHash]?.relativeToMain ?? initialOffset
      const main = readWindowRect(params.mainWindow)
      const b = readWindowRect(win)
      if (!main || !b)
        return
      let tx = main.x + stored.dx
      let ty = main.y + stored.dy
      const target = { x: tx, y: ty, width: b.width, height: b.height }
      const workArea = displayMatching(target).workArea
      const clamped = clampBoundsWithinRect(target, workArea)
      tx = clamped.x
      ty = clamped.y
      lastTx = tx
      lastTy = ty
      if (Math.abs(lastAppliedTx - tx) <= 0 && Math.abs(lastAppliedTy - ty) <= 0)
        return
      lastAppliedTx = tx
      lastAppliedTy = ty
      // Animate towards target at throttled cadence for visible easing
      settleTo(tx, ty)
    }, 1000 / 60)

    const settleDebounced = debounce(() => {
      settleTo(lastTx, lastTy)
    }, 200)

    const onMainChange = () => {
      moveThrottled()
      settleDebounced()
    }
    onMainChange()
    params.mainWindow.on('move', onMainChange)
    params.mainWindow.on('resize', onMainChange)
    detachMainMoveListener = () => {
      params.mainWindow.removeListener('move', onMainChange)
      params.mainWindow.removeListener('resize', onMainChange)
      animation?.pause()
      animation = null
    }
  }

  function detachFromMain() {
    detachMainMoveListener?.()
    detachMainMoveListener = undefined
  }

  let eventaContext: ReturnType<typeof createContext>['context'] | undefined
  let currentWindow: BrowserWindow | undefined
  const visibilityListeners = new Set<() => void>()

  const emitVisibilityChanged = () => {
    for (const listener of visibilityListeners) {
      try {
        listener()
      }
      catch {
      }
    }
  }

  function applyIgnoreMouseEvents(win: BrowserWindow, ignore: boolean) {
    try {
      if (ignore)
        win.setIgnoreMouseEvents(true, { forward: true })
      else
        win.setIgnoreMouseEvents(false)
    }
    catch {
      // ignore failures during early window lifecycle
    }
  }

  const reusable = createReusableWindow(async () => {
    const window = createCaptionWindow()
    currentWindow = window
    const { context } = createWindowContext(window)
    eventaContext = context

    await setupBaseWindowElectronInvokes({ context, window, serverChannel: params.serverChannel, i18n: params.i18n })

    applyIgnoreMouseEvents(window, isFollowing)

    const cfg = getConfig()
    const saved = cfg?.matrices?.[matrixHash]?.bounds

    // A saved position waits for a live origin and this window's proved rectangle before it is applied.
    let pendingRestore: Rectangle | undefined
    if (!windowOriginTrusted()) {
      const size = saved ?? computeInitialCaptionBounds({ mainWindow: params.mainWindow })
      window.setSize(size.width, size.height)
      if (saved?.x !== undefined && saved.y !== undefined)
        pendingRestore = { ...saved, x: saved.x, y: saved.y }
    }
    else if (saved && saved.x !== undefined && saved.y !== undefined) {
      const workArea = displayMatching({ ...saved, x: saved.x, y: saved.y }).workArea
      const clamped = clampBoundsWithinRect({ ...saved, x: saved.x, y: saved.y }, workArea)
      placeWindow(window, clamped)
    }
    else {
      const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
      placeWindow(window, { ...initialBounds, ...saved })
    }

    const persistBounds = () => {
      const origin = readWindowRect(window)
      // Before the restore, a readable origin is the compositor's choice, not the user's.
      if (pendingRestore && origin)
        return
      const config = getConfig() ?? { isFollowing, matrices: {} }
      const { width, height } = window.getBounds()
      const stored = config.matrices[matrixHash]
      const bounds = origin ?? { ...stored?.bounds, width, height }
      config.matrices[matrixHash] = { ...stored, bounds }
      config.isFollowing = isFollowing
      const rel = origin && isFollowing && Date.now() - lastProgrammaticMoveAt > 100 ? computeRelativeOffset(window) : null
      if (rel)
        config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds, relativeToMain: rel }
      updateConfig(config)
    }

    window.on('resize', persistBounds)
    window.on('move', persistBounds)
    onCompositorWindowRect(window, () => {
      if (!pendingRestore) {
        persistBounds()
        return
      }
      if (!readWindowRect(window))
        return
      const target = pendingRestore
      pendingRestore = undefined
      lastProgrammaticMoveAt = Date.now()
      placeWindow(window, clampBoundsWithinRect(target, displayMatching(target).workArea))
    })
    window.on('show', emitVisibilityChanged)
    window.on('hide', emitVisibilityChanged)

    const cleanupGetAttached = defineInvokeHandler(context, captionGetIsFollowingWindow, async () => isFollowing)

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/caption', {
      query: { 'synced-leader': 'false' },
    }))

    try {
      context.emit(captionIsFollowingWindowChanged, isFollowing)
    }
    catch {

    }

    if (isFollowing) {
      followMainWindow(window)
    }

    window.on('closed', () => {
      detachFromMain()
      try {
        cleanupGetAttached()
      }
      catch {
      }

      if (currentWindow === window) {
        currentWindow = undefined
      }
      eventaContext = undefined
      emitVisibilityChanged()
    })

    return window
  })

  async function getWindow(): Promise<BrowserWindow> {
    return reusable.getWindow()
  }

  async function setFollowWindow(isFollowingWindow: boolean) {
    isFollowing = isFollowingWindow
    const window = await reusable.getWindow()

    applyIgnoreMouseEvents(window, isFollowing)

    const rel = isFollowing ? computeRelativeOffset(window) : null
    if (rel) {
      const config = getConfig() ?? { isFollowing, matrices: {} }
      config.isFollowing = isFollowing
      config.matrices[matrixHash] = { ...config.matrices[matrixHash], relativeToMain: rel }
      updateConfig(config)

      // Start following main without re-docking; keep current position
      followMainWindow(window)
    }
    else {
      detachFromMain()

      const config = getConfig() ?? { isFollowing, matrices: {} }
      config.isFollowing = isFollowing
      updateConfig(config)
    }

    // Keep window visible after toggle
    window.show()

    // Notify renderer for UI state (handle visibility)
    try {
      eventaContext?.emit(captionIsFollowingWindowChanged, isFollowing)
    }
    catch {

    }
  }

  async function toggleFollowWindow() {
    await setFollowWindow(!isFollowing)
  }

  function getIsFollowingWindow(): boolean {
    return isFollowing
  }

  async function resetToSide() {
    const window = await reusable.getWindow()

    applyIgnoreMouseEvents(window, isFollowing)

    // Prevent user-move persistence from overwriting our programmatic move
    lastProgrammaticMoveAt = Date.now()
    const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
    if (windowOriginTrusted())
      placeWindow(window, initialBounds)
    else
      window.setSize(initialBounds.width, initialBounds.height)

    // Persist new bounds and a clean relative offset so follow uses it
    const config = getConfig() ?? { isFollowing, matrices: {} }
    const b = readWindowRect(window)
    const rel = computeRelativeOffset(window)
    if (!b || !rel) {
      const { width, height } = window.getBounds()
      config.matrices[matrixHash] = {
        ...config.matrices[matrixHash],
        bounds: { ...config.matrices[matrixHash]?.bounds, width, height },
      }
      config.isFollowing = isFollowing
      updateConfig(config)
      return
    }

    config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b, relativeToMain: rel }
    config.isFollowing = isFollowing

    updateConfig(config)
  }

  function isVisible(): boolean {
    return Boolean(currentWindow && !currentWindow.isDestroyed() && currentWindow.isVisible())
  }

  async function toggleVisibility() {
    if (isVisible()) {
      currentWindow?.hide()
      return
    }

    const window = await reusable.getWindow()
    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
  }

  function onVisibilityChanged(listener: () => void): () => void {
    visibilityListeners.add(listener)
    return () => {
      visibilityListeners.delete(listener)
    }
  }

  return {
    getWindow,
    setFollowWindow,
    toggleFollowWindow,
    getIsFollowingWindow,
    resetToSide,
    isVisible,
    toggleVisibility,
    onVisibilityChanged,
  }
}
