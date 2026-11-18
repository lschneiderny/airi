import type { ChatReasoningMode } from '@proj-airi/provider-inference'

import type { ProviderDeployment } from './attributes'

import { REASONING_REPLY_MAX_TOKENS, REPLY_MAX_TOKENS } from '@proj-airi/stage-shared/stage-contract'

/** What decides the output cap of one chat request. */
export interface ReplyMaxTokensInput {
  /** The reasoning mode AIRI sends with the request, or `undefined` when the provider applies its own default. */
  reasoning: ChatReasoningMode | undefined
  /** Where the provider runs, or `undefined` when the catalogue does not say (a generic OpenAI-compatible endpoint). */
  deployment: ProviderDeployment | undefined
}

/**
 * Picks the output cap of one chat request.
 *
 * A request that does not reason gets {@link REPLY_MAX_TOKENS}, which backs the contract's reply-shape rules. A
 * request that may reason gets {@link REASONING_REPLY_MAX_TOKENS}, because providers count reasoning tokens toward
 * the cap. When AIRI sends no reasoning mode, a cloud provider's default may reason (Claude 5 models always do through
 * Anthropic's OpenAI-compatible endpoint); a local or unknown provider keeps the short cap, which also stops a slow
 * local model that runs away.
 */
export function replyMaxTokensFor(input: ReplyMaxTokensInput): number {
  if (input.reasoning === 'disabled')
    return REPLY_MAX_TOKENS
  if (input.reasoning === 'enabled')
    return REASONING_REPLY_MAX_TOKENS
  return input.deployment === 'cloud' ? REASONING_REPLY_MAX_TOKENS : REPLY_MAX_TOKENS
}
