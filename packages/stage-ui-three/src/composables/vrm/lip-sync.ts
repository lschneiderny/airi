import type { VRMCore } from '@pixiv/three-vrm-core'
import type { WLipSyncAnalysis } from '@proj-airi/model-driver-lipsync/runtime/wlipsync'
import type { Profile, WLipSyncVowel } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type { Ref } from 'vue'

import { createWLipSyncAnalysis } from '@proj-airi/model-driver-lipsync/runtime/wlipsync'
import {
  createWLipSyncVowelDriver,
  WLIP_SYNC_VOWELS,
  wlipsyncProfile,
} from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import { ref, shallowRef, watch } from 'vue'

const VRM_EXPRESSION_BY_VOWEL: Record<WLipSyncVowel, string> = {
  A: 'aa',
  E: 'ee',
  I: 'ih',
  O: 'oh',
  U: 'ou',
}

/**
 * Applies shared wLipSync vowel weights to a VRM expression manager.
 *
 * The caller owns the AudioContext and audio source lifecycle. This composable
 * owns only the connection between that source and its wLipSync node.
 */
export function useVRMLipSync(
  audioContext: Readonly<Ref<AudioContext | undefined>>,
  audioSource: Readonly<Ref<AudioBufferSourceNode | undefined>>,
) {
  const isLipSyncActive = ref(false)
  const lipSyncAnalysis = shallowRef<WLipSyncAnalysis>()
  const vowelDriver = createWLipSyncVowelDriver()

  watch(audioContext, (context, _, onCleanup) => {
    lipSyncAnalysis.value = undefined
    vowelDriver.reset()
    isLipSyncActive.value = false
    if (!context)
      return

    let active = true
    let createdAnalysis: undefined | WLipSyncAnalysis
    onCleanup(() => {
      active = false
      createdAnalysis?.dispose()
    })

    void createWLipSyncAnalysis(context, wlipsyncProfile as Profile)
      .then((analysis) => {
        createdAnalysis = analysis
        if (!active) {
          analysis.dispose()
          return
        }
        lipSyncAnalysis.value = analysis
      })
      .catch((error) => {
        if (active)
          console.error('[stage-ui-three] Failed to create the VRM lip-sync node.', error)
      })
  }, { immediate: true })

  watch([lipSyncAnalysis, audioSource], ([analysis, source], _, onCleanup) => {
    if (!analysis || !source)
      return

    try {
      source.connect(analysis.input)
    }
    catch (error) {
      console.error('[stage-ui-three] Failed to connect the VRM lip-sync node.', error)
      return
    }

    onCleanup(() => {
      try {
        source.disconnect(analysis.input)
      }
      catch {
        // The source can end before Vue runs this watcher cleanup.
      }
    })
  }, { immediate: true })

  function update(vrm?: VRMCore, delta = 0.016) {
    const node = lipSyncAnalysis.value?.node
    if (!vrm?.expressionManager || !node) {
      isLipSyncActive.value = false
      return
    }

    const weights = vowelDriver.update(node, delta)
    let hasActiveVisemes = false
    for (const vowel of WLIP_SYNC_VOWELS) {
      const weight = weights[vowel]
      if (weight > 0.01)
        hasActiveVisemes = true
      vrm.expressionManager.setValue(VRM_EXPRESSION_BY_VOWEL[vowel], weight)
    }

    isLipSyncActive.value = hasActiveVisemes
  }

  return {
    isLipSyncActive,
    update,
  }
}
