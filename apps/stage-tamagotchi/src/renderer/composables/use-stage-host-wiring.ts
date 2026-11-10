import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { Ref } from 'vue'

import type { ChatAttentionTarget } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import {
  useElectronAllDisplays,
  useElectronEventaContext,
  useElectronEventaInvoke,
  useElectronRelativeMouse,
  useElectronWindowBounds,
} from '@proj-airi/electron-vueuse'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useVoiceListening } from '@proj-airi/stage-ui/composables/voice-input-mode'
import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { computed, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'

import { electronChatAttentionTargetChanged, electronGetChatAttentionTarget, electronOpenInlay, electronOpenOnboarding } from '../../shared/eventa'
import { useDesktopActivityProducerStore } from '../stores/desktop-activity'
import { useForegroundWindowProducerStore } from '../stores/foreground-window'
import { useToolSelectionStore } from '../stores/tools'
import { usePresenceNotice } from './use-presence-notice'
import { usePushToTalkShortcut } from './use-push-to-talk-shortcut'
import { useStageActiveRenderer } from './use-stage-active-renderer'

/** The Natural inputs that the character host page passes to `WidgetStage`. */
export interface StageHostWiring {
  /** The cursor relative to this window, in DIP. Read it only while `canUseCursor` is true. */
  relativeMouseX: Readonly<Ref<number>>
  relativeMouseY: Readonly<Ref<number>>
  /**
   * True while the host reports a live cursor position and the first cursor and bounds readings have arrived.
   * Every native-coordinate consumer shares this boundary. DOM hover remains available without it.
   */
  canUseCursor: Readonly<Ref<boolean>>
  /** The relative cursor while `canUseCursor` is true, otherwise `undefined`. */
  cursorPosition: Readonly<Ref<{ x: number, y: number } | undefined>>
  /**
   * Where this window sits among the displays. Natural turns the character toward the screen interior from it.
   * `undefined` until the host trusts the window origin, because raw bounds may hide the origin on Wayland.
   */
  screenPlacement: Readonly<Ref<{ displays: PlacementRect[], windowBounds: PlacementRect } | undefined>>
  /** The chat window that Natural looks at. Hidden until the main process answers or sends the first change. */
  chatTarget: Readonly<Ref<ChatAttentionTarget>>
  /** Settles when the first chat target snapshot has been answered or has failed. It never rejects. */
  chatTargetRead: Promise<void>
}

/**
 * Wires the services and Natural inputs that the page hosting the character owns.
 *
 * The classic window page and the desktop stage page each call it once. One launch runs only one of them, so every
 * service starts once. Follower windows must not call it: they would poll the main process a second time and register
 * a second voice host.
 *
 * It starts the active-renderer record, the desktop activity producer, the foreground window producer (only while
 * the user shares the foreground app), the voice host with its tools, inlay, Push to Talk shortcut and error toasts,
 * the presence notice, and the onboarding window. Scope disposal stops every one of them.
 *
 * @param page The calling page. The presence notice shows only on the page that owns the character in the running host mode.
 */
export function useStageHostWiring(page: 'index' | 'stage'): StageHostWiring {
  useStageActiveRenderer()

  // The character host owns the desktop activity samples that drive the Natural motion performance state.
  const desktopActivityProducer = useDesktopActivityProducerStore()
  desktopActivityProducer.start()
  onScopeDispose(() => desktopActivityProducer.stop())
  // Only the character host samples the foreground app, so follower windows never poll the main process. It samples
  // only while the user shares the foreground app; stopping also clears the last sample.
  const foregroundWindowProducer = useForegroundWindowProducerStore()
  const situationSettings = useSituationSettings()
  watch(() => situationSettings.document.shareForegroundWindow, (sharing) => {
    if (sharing)
      foregroundWindowProducer.start()
    else
      foregroundWindowProducer.stop()
  }, { immediate: true })
  onScopeDispose(() => foregroundWindowProducer.stop())

  const voice = useVoiceStore()
  const toolSelection = useToolSelectionStore()
  // Spoken turns start in this window. They use the tools that the chat window composer grants.
  onScopeDispose(voice.connectTools(() => toolSelection.requestTools))
  const openInlay = useElectronEventaInvoke(electronOpenInlay)
  useVoiceListening()
  usePushToTalkShortcut()
  usePresenceNotice(page)
  // The inlay stays shown from startup and draws a capsule when any capture starts.
  // This call shows it again after the user hid it. A failed begin never reaches `capturing`.
  watch(
    () => voice.state?.phase === 'capturing',
    (capturing) => {
      if (capturing)
        void openInlay()
    },
  )
  watch(() => voice.error, (error) => {
    if (error)
      toast.error(error)
  })
  // A draft that the host is sending needs no inlay. A failed send clears `sending`, so the draft opens the inlay again.
  watch(
    () => voice.drafts.filter(draft => !draft.sending).map(draft => `${draft.id}:${draft.rawText}`).join('\0'),
    (speechDrafts) => {
      if (speechDrafts)
        void openInlay()
    },
  )

  const onboardingStore = useOnboardingStore()
  const openOnboarding = useElectronEventaInvoke(electronOpenOnboarding)
  onMounted(() => {
    if (onboardingStore.needsOnboarding)
      openOnboarding()
  })

  const { x: relativeMouseX, y: relativeMouseY, available: cursorAvailable } = useElectronRelativeMouse()
  const hostCapabilities = useHostCapabilitiesStore()
  const canUseCursor = computed(() => hostCapabilities.status('cursorScreenPoint')?.kind === 'live' && cursorAvailable.value)
  const cursorPosition = computed(() => canUseCursor.value
    ? { x: relativeMouseX.value, y: relativeMouseY.value }
    : undefined)

  const allDisplays = useElectronAllDisplays()
  const { x: windowX, y: windowY, width: windowWidth, height: windowHeight, available: boundsAvailable } = useElectronWindowBounds()
  const screenPlacement = computed(() => boundsAvailable.value && hostCapabilities.status('windowOrigin')?.kind === 'live'
    ? {
        displays: allDisplays.value.map(display => display.bounds),
        windowBounds: { x: windowX.value, y: windowY.value, width: windowWidth.value, height: windowHeight.value },
      }
    : undefined)

  // The main process sends only the rectangle and visibility, never chat content.
  // `null` until the first answer, which Natural reads as a hidden chat rather than a missing host feature.
  const latestChatTarget = shallowRef<ChatAttentionTarget | null>(null)
  // The main process can emit before the snapshot answers, so subscribe first and let a later event win over it.
  let chatTargetChanged = false
  onScopeDispose(useElectronEventaContext().value.on(electronChatAttentionTargetChanged, (event) => {
    if (!event?.body)
      return
    chatTargetChanged = true
    latestChatTarget.value = event.body
  }))
  const chatTargetRead = useElectronEventaInvoke(electronGetChatAttentionTarget)()
    .then((target) => {
      if (!chatTargetChanged)
        latestChatTarget.value = target
    })
    .catch(error => console.warn('[Stage Host] Failed to read the chat attention target; Natural treats the chat as hidden:', errorMessageFrom(error)))
  const chatTarget = computed(() => latestChatTarget.value ?? { visible: false, bounds: null })

  return { relativeMouseX, relativeMouseY, canUseCursor, cursorPosition, screenPlacement, chatTarget, chatTargetRead }
}
