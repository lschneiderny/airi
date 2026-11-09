import type { StageHostMode } from '../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { presenceLimitations, presenceNoticeKey } from '@proj-airi/stage-shared/host-capabilities'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useHostNoticeSettings } from '@proj-airi/stage-ui/features/host-capabilities/notice-settings'
import { storeToRefs } from 'pinia'
import { onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { electronOpenSettings, electronStageGetState } from '../../shared/eventa'

/** The stage page owns the notice when the desktop stage runs; the main window owns it otherwise. */
export const presenceNoticeOwner: Record<StageHostMode, 'index' | 'stage'> = {
  window: 'index',
  desktop: 'stage',
}

export const presenceNoticeRoute = '/settings/system/presence-sensing'

/**
 * Tells the user once which presence signals this host cannot provide.
 *
 * Both stage pages call it, but only the page that owns the character in the running host mode shows the toast,
 * so one launch shows one notice. A dismissed key never shows again until Delete all data clears it.
 */
export function usePresenceNotice(page: 'index' | 'stage') {
  const { t } = useI18n()
  const { snapshot } = storeToRefs(useHostCapabilitiesStore())
  const notice = useHostNoticeSettings()
  const { document } = storeToRefs(notice)
  const getStageState = useElectronEventaInvoke(electronStageGetState)
  const openSettings = useElectronEventaInvoke(electronOpenSettings)
  const owns = shallowRef(false)
  let disposed = false
  let shownKey: string | null = null
  let toastId: ReturnType<typeof toast> | undefined
  let withdrawToast: (() => void) | undefined

  void getStageState().then((state) => {
    if (!disposed)
      owns.value = presenceNoticeOwner[state.running] === page
  }).catch(error => console.warn('[PresenceNotice] Failed to read the stage state:', errorMessageFrom(error)))

  function show(key: string) {
    const signals = presenceLimitations(snapshot.value!).map(limitation => t(`tamagotchi.settings.pages.system.presence-sensing.signals.${limitation.signal}`))
    const names = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(signals)
    shownKey = key
    const dismiss = async () => {
      try {
        // The callback owns the key shown to the user, even if capabilities change before it completes.
        await notice.dismiss(key)
      }
      catch (error) {
        console.warn('[PresenceNotice] Failed to save dismissal:', errorMessageFrom(error))
      }
    }
    let withdrawn = false
    const id = toast(t('tamagotchi.settings.pages.system.presence-sensing.notice.title'), {
      // Replace a stale notice in place without recording a user dismissal or stacking another toast.
      ...(toastId === undefined ? {} : { id: toastId }),
      description: t('tamagotchi.settings.pages.system.presence-sensing.notice.body', { signals: names }),
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      onDismiss: async () => {
        if (!withdrawn)
          await dismiss()
      },
      action: {
        label: t('tamagotchi.settings.pages.system.presence-sensing.notice.details'),
        onClick: async () => {
          await dismiss()
          await openSettings({ route: presenceNoticeRoute }).catch(error => console.warn('[PresenceNotice] Failed to open Settings:', errorMessageFrom(error)))
        },
      },
    })
    toastId = id
    withdrawToast = () => {
      withdrawn = true
      toast.dismiss(id)
    }
  }

  watch([owns, snapshot, document], ([owner, capabilities, settings]) => {
    const key = owner && capabilities ? presenceNoticeKey(capabilities) : null
    if (key === null || settings.dismissedKeys.includes(key)) {
      withdrawToast?.()
      withdrawToast = undefined
      toastId = undefined
      shownKey = null
      return
    }
    if (key !== shownKey)
      show(key)
  }, { immediate: true })

  onScopeDispose(() => {
    disposed = true
    withdrawToast?.()
  })
}
