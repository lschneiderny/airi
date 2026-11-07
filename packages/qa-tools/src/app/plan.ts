import type { AppOptions } from './args'

import { join } from 'node:path'

import { consciousnessStorageKeys, providerStorageKeys, speechStorageKeys } from '@proj-airi/stage-ui/constants/settings-storage'

import { replayModel, speechModel } from '../llm/protocol'
import { t3LaunchEnv } from '../t3/launch'

/** Strings use VueUse's raw string serializer; objects and booleans use JSON. Only a disposable profile receives this. */
export function buildSeedEntries(baseURL: string, redact = false): Record<string, string> {
  const providers = Object.fromEntries([
    ['openai-compatible', replayModel],
    ['openai-compatible-audio-speech', speechModel],
  ].map(([id, model]) => [id, {
    id,
    definitionId: id,
    configuredBy: 'user',
    status: 'configured',
    config: { api: 'chat-completions', apiKey: redact ? '[REDACTED]' : 'replay', baseUrl: baseURL, model, voice: 'alloy', responseFormat: 'wav' },
  }]))
  return {
    [providerStorageKeys.configured]: JSON.stringify(providers),
    [providerStorageKeys.added]: JSON.stringify({ 'openai-compatible': true, 'openai-compatible-audio-speech': true }),
    [consciousnessStorageKeys.provider]: 'openai-compatible',
    [consciousnessStorageKeys.model]: replayModel,
    [consciousnessStorageKeys.customModel]: replayModel,
    [speechStorageKeys.provider]: 'openai-compatible-audio-speech',
    [speechStorageKeys.model]: speechModel,
    [speechStorageKeys.voice]: 'alloy',
    [speechStorageKeys.enabled]: 'true',
    [speechStorageKeys.ssml]: 'false',
  }
}

/** Pure, inspectable launch plan. Port and replay URL placeholders are resolved only during a live run. */
export function buildPlan(options: AppOptions, runDir: string) {
  const env: Record<string, string> = { ...t3LaunchEnv(join(runDir, 'profile'), 0), APP_REMOTE_DEBUG_PORT: '<allocated at launch>', AIRI_STAGE_HOST: 'window' }
  return {
    dryRun: options.dryRun,
    runDir,
    model: { path: options.model, kind: options.kind },
    replay: { script: options.script ?? null, set: options.set ?? null, defaultScript: !options.script && !options.set },
    env,
    seed: { onboarding: { completed: true, skipped: false }, entries: buildSeedEntries('<in-process replay baseURL>', true), mechanism: 'localStorage then reload leader before bridge import' },
    sendPath: 'chat-floating composer when open, otherwise stage chatSend',
    messages: options.say,
    expect: options.expect,
    timeoutMs: options.timeoutMs,
    keepOpen: options.keepOpen,
    steps: [
      'acquire exclusive CPU lease',
      'start replay server on loopback port 0',
      'launch T3 with temporary profile and window stage',
      'connect CDP and seed settings then reload leader',
      'import model through bridge file input and await mounted renderer',
      'send each message and poll events with a fresh sequence cursor',
      'save screenshot diagnostics replay requests and timings',
      ...(options.keepOpen ? ['wait for interrupt while retaining CPU lease and replay server'] : []),
      'teardown owned processes and remove temporary profile',
    ],
  }
}
