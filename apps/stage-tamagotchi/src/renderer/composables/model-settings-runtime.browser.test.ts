import type { NamedExpressionDefinition } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createEmptyModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { computed, defineComponent, nextTick, shallowRef } from 'vue'

import { applyLive2DExpressionSettingsCommand, modelSettingsRuntimeChannelName, modelSettingsRuntimeSnapshotChanged } from '../../shared/model-settings-runtime'
import { useModelSettingsRuntimeOwner } from './model-settings-runtime-owner'
import { useModelSettingsRuntimeSnapshot } from './model-settings-runtime-snapshot'

const expressionDefinitions: NamedExpressionDefinition[] = [{
  id: 'happy.exp3.json',
  name: 'happy',
  parameters: [{ id: 'ParamHappy', blend: 'Add', value: 1 }],
}]

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

    let settingsRuntime: ReturnType<typeof useModelSettingsRuntimeSnapshot> | undefined
    const firstSnapshot = new Promise<void>((resolve, reject) => {
      const signal = AbortSignal.timeout(5000)
      const stop = settingsChannelContext.context.on(modelSettingsRuntimeSnapshotChanged, (event) => {
        if (event.body?.modelId !== 'model-a')
          return
        stop()
        signal.removeEventListener('abort', abort)
        resolve()
      })
      function abort() {
        stop()
        reject(new Error('Initial model snapshot did not arrive.'))
      }
      signal.addEventListener('abort', abort, { once: true })
    })
    const TestHost = defineComponent({
      setup() {
        useModelSettingsRuntimeOwner({
          ownerInstanceId,
          renderer: () => renderer.value,
          runtimeSnapshot: ownerSnapshot,
          applyLive2DExpressionCommand: command => ownerExpressionStore.applySettingsCommand(command),
          context: ownerChannelContext.context,
        })
        settingsRuntime = useModelSettingsRuntimeSnapshot({
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

    if (!settingsRuntime)
      throw new Error('The settings runtime did not mount.')
    const mountedSettingsRuntime = settingsRuntime

    await firstSnapshot
    expect(mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.groups).toMatchObject([{
      id: 'happy.exp3.json',
      name: 'happy',
      active: false,
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
    expect(ownerExpressionStore.settingsSnapshot.groups[0].active).toBe(false)

    const applied = await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'toggle', id: 'happy.exp3.json' })

    expect(ownerExpressionStore.settingsSnapshot.groups[0].active).toBe(true)
    expect(mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.groups[0].active).toBe(true)
    expect(applied).toBe(true)
    expect(useExpressionStore(settingsPinia).definitions).toEqual([])

    await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'set-active', id: 'happy.exp3.json', active: false })
    expect(ownerExpressionStore.settingsSnapshot.groups[0].active).toBe(false)
    const setActive = await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'set-active', id: 'happy.exp3.json', active: true })
    expect(setActive).toBe(true)
    expect(ownerExpressionStore.settingsSnapshot.groups[0].active).toBe(true)
    expect(mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.groups[0].active).toBe(true)

    const updated = await mountedSettingsRuntime.sendLive2DExpressionCommand({
      type: 'update-entry',
      id: 'happy.exp3.json',
      patch: { label: 'Joyful' },
    })
    expect(updated).toBe(true)
    expect(ownerExpressionStore.catalog[0].label).toBe('Joyful')
    expect(mountedSettingsRuntime.runtimeSnapshot.value.live2dExpressions?.groups[0].label).toBe('Joyful')

    ownerExpressionStore.registerDefinitions('model-b', expressionDefinitions)
    const rejected = await mountedSettingsRuntime.sendLive2DExpressionCommand({ type: 'update-entry', id: 'happy.exp3.json', patch: { label: 'Stale' } })

    expect(rejected).toBe(false)
    expect(ownerExpressionStore.settingsSnapshot.groups[0].active).toBe(false)
    expect(ownerExpressionStore.catalog[0].label).toBe('happy')
    await nextTick()
    expect(mountedSettingsRuntime.runtimeSnapshot.value.modelId).toBe('model-b')
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
