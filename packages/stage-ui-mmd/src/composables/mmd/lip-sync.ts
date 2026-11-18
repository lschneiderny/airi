import type { WLipSyncAnalysis } from '@proj-airi/model-driver-lipsync/runtime/wlipsync'
import type { Profile, WLipSyncVowel } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type { Ref } from 'vue'

import type { VowelSlot } from '../../constants/morphs'
import type { MorphController } from './morph'

import { createWLipSyncAnalysis } from '@proj-airi/model-driver-lipsync/runtime/wlipsync'
import {
  createWLipSyncVowelDriver,
  WLIP_SYNC_VOWELS,
  wlipsyncProfile,
} from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import { shallowRef, watch } from 'vue'

const MMD_SLOT_BY_VOWEL: Record<WLipSyncVowel, VowelSlot> = {
  A: 'vowelA',
  E: 'vowelE',
  I: 'vowelI',
  O: 'vowelO',
  U: 'vowelU',
}

/**
 * Applies shared wLipSync vowel weights to MMD mouth morphs.
 *
 * The caller owns the AudioContext and the played speech. `connectSpeech`
 * connects the wLipSync node to that speech and returns the disconnection.
 * Call `update` after the MMD animation helper so lip-sync wins over VMD morphs.
 */
export function useMMDLipSync(
  audioContext: Readonly<Ref<AudioContext | undefined>>,
  connectSpeech: Readonly<Ref<((node: AudioNode) => () => void) | undefined>>,
) {
  const lipSyncAnalysis = shallowRef<WLipSyncAnalysis>()
  const level = shallowRef(0)
  const vowelDriver = createWLipSyncVowelDriver()

  watch(audioContext, (context, _, onCleanup) => {
    lipSyncAnalysis.value = undefined
    vowelDriver.reset()
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
          console.error('[stage-ui-mmd] Failed to create the MMD lip-sync node.', error)
      })
  }, { immediate: true })

  watch([lipSyncAnalysis, connectSpeech], ([analysis, connect], _, onCleanup) => {
    if (!analysis || !connect)
      return

    try {
      onCleanup(connect(analysis.input))
    }
    catch (error) {
      console.error('[stage-ui-mmd] Failed to connect the MMD lip-sync node.', error)
    }
  }, { immediate: true })

  function update(morphs: MorphController | undefined, delta = 0.016) {
    const node = lipSyncAnalysis.value?.node
    if (!morphs || !node) {
      level.value = 0
      return
    }

    const weights = vowelDriver.update(node, delta)
    level.value = Math.min(1, WLIP_SYNC_VOWELS.reduce((sum, vowel) => sum + weights[vowel], 0))
    for (const vowel of WLIP_SYNC_VOWELS)
      morphs.set(MMD_SLOT_BY_VOWEL[vowel], weights[vowel])
  }

  return { update, level }
}
