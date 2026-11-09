import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import type { ScreenAmbientLightDiagnosticsSnapshot } from '../../shared/screen-ambient-light-diagnostics'

import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useSettingsScreenAmbientLight } from '@proj-airi/stage-shared/stores/screen-ambient-light'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, nextTick, ref } from 'vue'

import { screenAmbientLightDiagnosticsChannelName } from '../../shared/screen-ambient-light-diagnostics'
import { useScreenAmbientLight } from './use-screen-ambient-light'

/**
 * Two displays side by side. The window starts on the left one and the cases
 * move it by writing these refs, which is what the Electron bounds loop does.
 */
const displays = [
  { id: 17, bounds: { x: 0, y: 0, width: 1600, height: 1000 } },
  { id: 18, bounds: { x: 1600, y: 0, width: 1600, height: 1000 } },
]
/** The display list as the Electron poll publishes it; a case replaces it to rescale a display. */
const displayList = ref(displays)
const windowBounds = vi.hoisted(() => ({ x: 100, y: 100, width: 400, height: 500 }))
const bounds = { x: ref(windowBounds.x), y: ref(windowBounds.y), width: ref(windowBounds.width), height: ref(windowBounds.height) }

/** Records which display each capture was opened for. */
const selectedDisplayIds = vi.hoisted(() => [] as string[])
const captureCanvases: HTMLCanvasElement[] = []
/** Sources the main process offers; each case sets what it needs. */
const offeredSources = vi.hoisted(() => ({ list: [] as { id: string, display_id: string }[] }))
const getPrimaryDisplay = vi.fn(async () => displays[1])

// The returned functions run at composable setup, after the consts above
// exist; the factory itself runs before them and must not touch them.
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronCursorAvailable: () => ref(true),
  getElectronEventaContext: () => ({}),
  useElectronAllDisplays: () => displayList,
  useElectronEventaInvoke: () => getPrimaryDisplay,
  useElectronWindowBounds: () => bounds,
}))

vi.mock('@proj-airi/electron-screen-capture/vue', () => ({
  useElectronScreenCapture: () => ({
    checkMacOSPermission: vi.fn(async () => 'granted'),
    requestMacOSPermission: vi.fn(async () => {}),
    // The composable picks a source from the list the main process would
    // return. The pick is recorded and a canvas stream plays in its place,
    // which is a real MediaStream that the video element can decode.
    selectWithSource: async (select: (sources: { id: string, display_id: string }[]) => string) => {
      const id = select(offeredSources.list)
      selectedDisplayIds.push(id)
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 40
      canvas.getContext('2d')!.fillRect(0, 0, 64, 40)
      captureCanvases.push(canvas)
      return canvas.captureStream(5)
    },
  }),
}))

const views: Awaited<ReturnType<typeof render>>[] = []

beforeEach(() => {
  vi.stubGlobal('electron', { ipcRenderer: {} })
  vi.stubGlobal('platform', 'linux')
  setActivePinia(createPinia())
  useHostCapabilitiesStore().set(capabilitiesForHost('windows'))
  selectedDisplayIds.length = 0
  getPrimaryDisplay.mockClear()
  captureCanvases.length = 0
  offeredSources.list = displays.map(display => ({ id: `screen:${display.id}:0`, display_id: String(display.id) }))
  bounds.x.value = windowBounds.x
  bounds.y.value = windowBounds.y
  bounds.width.value = windowBounds.width
  bounds.height.value = windowBounds.height
  displayList.value = displays
  const settings = useSettingsScreenAmbientLight()
  settings.screenAmbientLightEnabled = true
  settings.screenAmbientLightSource = 'screen-capture'
})

afterEach(async () => {
  for (const view of views.splice(0))
    await view.unmount()
  useSettingsScreenAmbientLight().screenAmbientLightEnabled = false
  vi.unstubAllGlobals()
})

async function mount() {
  views.push(await render(defineComponent({
    setup() {
      useScreenAmbientLight()
      return () => null
    },
  })))
}

describe('screen ambient light capture', () => {
  it.each(['windows', 'macos'] as const)('waits for the first %s bounds before choosing a capture display', async (host) => {
    useHostCapabilitiesStore().set(capabilitiesForHost(host))
    bounds.x.value = 0
    bounds.y.value = 0
    bounds.width.value = 0
    bounds.height.value = 0
    await mount()
    await nextTick()

    expect(selectedDisplayIds).toEqual([])
    expect(getPrimaryDisplay).not.toHaveBeenCalled()

    bounds.x.value = windowBounds.x
    bounds.y.value = windowBounds.y
    bounds.width.value = windowBounds.width
    bounds.height.value = windowBounds.height

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0']))
  })

  it.each<HostId>(['windows', 'macos', 'linux-wayland'])('waits for the %s snapshot before selecting a capture display', async (host) => {
    const capabilities = useHostCapabilitiesStore()
    capabilities.reset()
    await mount()
    await nextTick()

    expect(getPrimaryDisplay).not.toHaveBeenCalled()
    expect(selectedDisplayIds).toEqual([])

    capabilities.set(capabilitiesForHost(host))

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual([host === 'linux-wayland' ? 'screen:18:0' : 'screen:17:0']))
    expect(getPrimaryDisplay).toHaveBeenCalledTimes(host === 'linux-wayland' ? 1 : 0)
  })

  it('does not start a cancelled capture when the pending snapshot arrives', async () => {
    const capabilities = useHostCapabilitiesStore()
    capabilities.reset()
    await mount()
    useSettingsScreenAmbientLight().screenAmbientLightEnabled = false
    await nextTick()

    capabilities.set(capabilitiesForHost('windows'))
    await nextTick()

    expect(getPrimaryDisplay).not.toHaveBeenCalled()
    expect(selectedDisplayIds).toEqual([])
  })

  it('captures the primary display without position-derived regions when the window origin is unavailable', async () => {
    useHostCapabilitiesStore().set(capabilitiesForHost('linux-wayland'))
    // Fabricated zero origin points at display 17; the primary is display 18.
    bounds.x.value = 0
    bounds.y.value = 0
    displayList.value = []
    const channel = new BroadcastChannel(screenAmbientLightDiagnosticsChannelName)
    onTestFinished(() => channel.close())
    let snapshot: ScreenAmbientLightDiagnosticsSnapshot | undefined
    let requested = false
    channel.onmessage = (event) => {
      requested = true
      if (event.data.type === 'snapshot' && event.data.snapshot.status === 'capturing')
        snapshot = event.data.snapshot
    }
    let frameCallback: VideoFrameRequestCallback | undefined
    const scheduleFrame = vi.spyOn(HTMLVideoElement.prototype, 'requestVideoFrameCallback').mockImplementation((callback) => {
      frameCallback = callback
      return 1
    })
    onTestFinished(() => scheduleFrame.mockRestore())
    await mount()
    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:18:0']))
    await vi.waitFor(() => expect(scheduleFrame).toHaveBeenCalled())
    channel.postMessage({ type: 'request-current' })
    await vi.waitFor(() => expect(requested).toBe(true))
    const captureContext = captureCanvases[0].getContext('2d')
    if (!captureContext)
      throw new Error('Capture canvas context missing')
    captureContext.fillStyle = 'white'
    captureContext.fillRect(0, 0, 64, 40)
    const now = performance.now()
    frameCallback?.(now, { presentationTime: now, expectedDisplayTime: now, width: 64, height: 40, mediaTime: 0, presentedFrames: 1, processingDuration: 0 })

    await vi.waitFor(() => expect(snapshot?.status).toBe('capturing'))
    expect(snapshot?.excludedRegion).toBeUndefined()
    expect(snapshot?.subjectRegion).toBeUndefined()
    expect(snapshot?.windowBounds).toEqual({ x: null, y: null, width: 400, height: 500 })
    expect(snapshot?.sampling?.excludedPixelCount).toBe(0)
  })

  it('captures the display the window sits on', async () => {
    await mount()

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0']))
  })

  it('restarts the capture on the new display once the window has moved there', async () => {
    // ROOT CAUSE:
    //
    // The display was chosen once in start(), and only the switch or the
    // source restarted the capture. A window dragged onto another display kept
    // the old stream, and each sample normalized the new position against the
    // old bounds. The capture now restarts once the dominant display changes.
    await mount()
    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0']))

    bounds.x.value = 1600 + 100

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0', 'screen:18:0']), { timeout: 3000 })
  })

  it('restarts the capture when the display is rescaled under a still window', async () => {
    // ROOT CAUSE:
    //
    // The restart compared display ids only. Rotating or rescaling a display
    // keeps its id and changes its bounds, so the capture kept constraints
    // and normalization from the old geometry. The bounds are compared too.
    await mount()
    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0']))

    displayList.value = [{ id: 17, bounds: { x: 0, y: 0, width: 1280, height: 800 } }, displays[1]]

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0', 'screen:17:0']), { timeout: 3000 })
  })

  it('takes the only screen source when no display id matches', async () => {
    // A Wayland portal returns one source with no display id. With one screen
    // the choice is forced, so the capture starts on it.
    offeredSources.list = [{ id: 'screen:0:0', display_id: '' }]
    await mount()

    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:0:0']))
  })

  it('refuses an arbitrary screen when several are offered and none matches', async () => {
    // ROOT CAUSE:
    //
    // With no display id match the selection took the first screen source
    // and normalized against the window's display, so the light came from one
    // screen and was placed by another. Several unmatched screens now fail
    // the start, which switches the feature off with an error.
    offeredSources.list = [{ id: 'screen:0:0', display_id: '' }, { id: 'screen:1:0', display_id: '' }]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()

    await vi.waitFor(() => expect(useSettingsScreenAmbientLight().screenAmbientLightEnabled).toBe(false))
    expect(selectedDisplayIds).toEqual([])
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('No screen-capture source matches display 17'))
    errors.mockRestore()
  })

  it('does not restart while the window only crosses the boundary briefly', async () => {
    // A window dragged across the seam and back within the settle time has not
    // moved displays. Restarting a capture costs a new getDisplayMedia call and
    // a gap in the light, so a short excursion must not trigger it.
    await mount()
    await vi.waitFor(() => expect(selectedDisplayIds).toEqual(['screen:17:0']))

    bounds.x.value = 1600 + 100
    await new Promise(resolve => setTimeout(resolve, 100))
    bounds.x.value = windowBounds.x
    await new Promise(resolve => setTimeout(resolve, 1200))

    expect(selectedDisplayIds).toEqual(['screen:17:0'])
  })
})
