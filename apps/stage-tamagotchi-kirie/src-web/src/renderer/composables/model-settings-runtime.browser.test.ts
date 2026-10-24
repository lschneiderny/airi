import type { NamedExpressionDefinition } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createEmptyModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { until } from '@vueuse/core'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { computed, defineComponent, shallowRef } from 'vue'

import { applyLive2DExpressionSettingsCommand, modelSettingsRuntimeChannelName } from '../../shared/model-settings-runtime'
import { useModelSettingsRuntimeOwner } from './model-settings-runtime-owner'
import { useModelSettingsRuntimeSnapshot } from './model-settings-runtime-snapshot'

const expressionDefinitions: NamedExpressionDefinition[] = [{
  id: 'happy.exp3.json',
  name: 'happy',
  parameters: [{ id: 'ParamHappy', blend: 'Add', value: 1 }],
}]

const signalTimeout = { timeout: 5000, throwOnTimeout: true }

describe('model settings runtime channel', () => {
  const channelContexts: Array<ReturnType<typeof createBroadcastChannelContext>> = []

  afterEach(() => {
    cleanup()
    for (const channelContext of channelContexts)
      channelContext.dispose()
    channelContexts.length = 0
    localStorage.clear()
  })

  // https://github.com/moeru-ai/airi/issues/2450
  it('applies an expression command through Eventa and rejects stale runtime identities for Issue #2450', async () => {
    // ROOT CAUSE:
    //
    // The settings window and the stage window have separate Pinia stores.
    // A component-only test did not cover the channel, owner check, store update, or returned snapshot.
    //
    // We fixed this with an Eventa RPC that returns the current owner snapshot.
    const ownerInstanceId = 'stage-owner'
    const ownerPinia = createPinia()
    const settingsPinia = createPinia()
    const ownerExpressionStore = useExpressionStore(ownerPinia)
    ownerExpressionStore.registerDefinitions('model-a', expressionDefinitions)

    const ownerChannelContext = createBroadcastChannelContext(new BroadcastChannel(modelSettingsRuntimeChannelName), { closeOnDispose: true })
    const settingsChannelContext = createBroadcastChannelContext(new BroadcastChannel(modelSettingsRuntimeChannelName), { closeOnDispose: true })
    channelContexts.push(ownerChannelContext, settingsChannelContext)

    const renderer = shallowRef<ModelSettingsRuntimeSnapshot['renderer']>('live2d')
    const ownerSnapshot = computed(() => createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId,
      modelId: ownerExpressionStore.modelId,
      renderer: renderer.value,
      phase: 'mounted',
      controlsLocked: false,
      previewAvailable: true,
      canCapturePreview: false,
      live2dExpressions: ownerExpressionStore.settingsSnapshot,
      updatedAt: Date.now(),
    }))

    const settingsRuntime = shallowRef<ReturnType<typeof useModelSettingsRuntimeSnapshot>>()
    const initialSnapshot = until(() => settingsRuntime.value?.runtimeSnapshot.value.live2dExpressions?.entries.length).toMatch(length => length === 1, signalTimeout)
    const TestHost = defineComponent({
      setup() {
        useModelSettingsRuntimeOwner({
          ownerInstanceId,
          renderer: () => renderer.value,
          runtimeSnapshot: ownerSnapshot,
          applyLive2DExpressionCommand: command => ownerExpressionStore.applySettingsCommand(command),
          context: ownerChannelContext.context,
        })
        settingsRuntime.value = useModelSettingsRuntimeSnapshot({
          context: settingsChannelContext.context,
        })

        return () => null
      },
    })

    await render(TestHost, {
      global: {
        plugins: [settingsPinia],
      },
    })

    const mountedSettingsRuntime = settingsRuntime.value
    if (!mountedSettingsRuntime)
      throw new Error('The settings runtime did not mount.')

    await initialSnapshot
    expect(mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.entries).toMatchObject([{
      id: 'happy.exp3.json',
      name: 'happy',
      active: false,
      exposedToLlm: true,
    }])

    const invokeExpressionCommand = defineInvoke(settingsChannelContext.context, applyLive2DExpressionSettingsCommand)
    const staleOwnerResponse = await invokeExpressionCommand({
      ownerInstanceId: 'stale-owner',
      modelId: 'model-a',
      command: { type: 'toggle', id: 'happy.exp3.json' },
    }, {
      signal: AbortSignal.timeout(1000),
    })

    expect(staleOwnerResponse.applied).toBe(false)
    expect(staleOwnerResponse.rejectionReason).toBe('owner-changed')
    expect(ownerExpressionStore.settingsSnapshot.entries[0].active).toBe(false)

    const ownerActivated = until(() => ownerExpressionStore.settingsSnapshot.entries[0].active).toBe(true, signalTimeout)
    const settingsActivated = until(() => mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.entries[0].active).toBe(true, signalTimeout)
    const applied = await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'toggle', id: 'happy.exp3.json' })

    await ownerActivated
    await settingsActivated
    expect(applied).toBe(true)
    expect(useExpressionStore(settingsPinia).definitions).toEqual([])

    const created = await mountedSettingsRuntime.sendLive2DExpressionCommand({
      type: 'create-combo',
      combo: { label: 'Happy combo', members: [{ expressionId: 'happy.exp3.json', strength: 0.7 }], emotion: 'happy' },
    })
    expect(created).toBe(true)
    const remoteCombo = mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.entries.find(entry => entry.kind === 'combo')
    expect(remoteCombo).toMatchObject({
      id: expect.stringMatching(/^combo:/),
      label: 'Happy combo',
      members: [{ expressionId: 'happy.exp3.json', strength: 0.7 }],
      mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }],
      usesOverwrite: false,
    })
    expect(ownerExpressionStore.catalog.find(entry => entry.id === remoteCombo?.id)).toMatchObject({ label: 'Happy combo' })

    const modelChanged = until(() => mountedSettingsRuntime.runtimeSnapshot.value.modelId).toBe('model-b', signalTimeout)
    ownerExpressionStore.registerDefinitions('model-b', expressionDefinitions)
    const rejected = await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'toggle', id: 'happy.exp3.json' })

    expect(rejected).toBe(false)
    expect(ownerExpressionStore.settingsSnapshot.entries[0].active).toBe(false)
    await modelChanged
  })

  // https://github.com/moeru-ai/airi/issues/2450
  it('clears a stale snapshot when the stage owner does not answer', async () => {
    const settingsChannelContext = createBroadcastChannelContext(new BroadcastChannel(modelSettingsRuntimeChannelName), { closeOnDispose: true })
    channelContexts.push(settingsChannelContext)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let settingsRuntime: ReturnType<typeof useModelSettingsRuntimeSnapshot> | undefined
    const TestHost = defineComponent({
      setup() {
        settingsRuntime = useModelSettingsRuntimeSnapshot({
          context: settingsChannelContext.context,
          commandTimeoutMs: 20,
        })
        return () => null
      },
    })

    await render(TestHost)
    if (!settingsRuntime)
      throw new Error('The settings runtime did not mount.')

    settingsRuntime.runtimeSnapshot.value = createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: 'stale-owner',
      modelId: 'model-a',
      renderer: 'live2d',
      phase: 'mounted',
      controlsLocked: false,
    })

    const applied = await settingsRuntime.sendLive2DExpressionCommand({ type: 'toggle', id: 'happy.exp3.json' })

    expect(applied).toBe(false)
    expect(settingsRuntime.runtimeSnapshot.value.ownerInstanceId).toBe('')
    expect(warn).toHaveBeenCalledOnce()
  })
})
