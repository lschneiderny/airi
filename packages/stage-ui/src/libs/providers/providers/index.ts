import { portableProviderDefinitions } from '@proj-airi/provider-inference'

import { registerProviders } from './registry'

import './aliyun-nls'
import './apple-speech'
import './apple-vision'
import './sherpaw'
import './local-audio'
import './kokoro-local'
import './official'
import './prompt-api'

// Keep shared runtime adapters while limiting this fork's app catalog.
const removedProviderIds = new Set([
  '302-ai',
  'aihubmix',
  'amazon-bedrock',
  'atlascloud',
  'azure-ai-foundry',
  'azure-openai',
  'byteplus',
  'byteplus-coding-plan',
  'cerebras-ai',
  'cloudflare-workers-ai',
  'comet-api',
  'comet-api-speech',
  'comet-api-transcription',
  'featherless-ai',
  'fireworks-ai',
  'google-generative-ai',
  'google-gemini-audio-speech',
  'groq',
  'mimo',
  'mimo-audio-speech',
  'mimo-audio-transcription',
  'minimax',
  'minimax-global',
  'minimax-speech',
  'mistral-ai',
  'modelscope',
  'moonshot-ai',
  'n1n',
  'novita-ai',
  'perplexity-ai',
  'together-ai',
  'volcengine-coding-plan',
  'xai',
])

registerProviders(portableProviderDefinitions.filter(definition => !removedProviderIds.has(definition.id)))

export {
  OFFICIAL_TRANSCRIPTION_PROVIDER_ID,
} from './official'

export {
  getDefinedProvider,
  isProviderId,
  listProviders,
} from './registry'

export type { StageProviderId } from './registry'
