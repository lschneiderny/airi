import { watch } from 'vue'

import { useMinecraftStore } from '../../modules/gaming-minecraft'
import { useSituationStore } from '../index'
import { situationContextText } from './context-text'

/** Situation source key of the Minecraft integration status. */
export const MINECRAFT_CONTEXT_SOURCE_KEY = 'system:minecraft-integration'

/**
 * Describes the Minecraft integration in one short line, or returns an empty string when no Minecraft service has
 * been observed. The rendered bullet is capped at 120 characters, so the status prefix stays short and leaves the
 * room for the bot's own context. The bot's text is untrusted and goes through {@link situationContextText}.
 */
export function minecraftContextText(minecraft: { configured: boolean, serviceConnected: boolean, latestRuntimeContextText: string }): string {
  if (!minecraft.configured)
    return ''

  const status = minecraft.serviceConnected ? 'online' : 'offline'
  const latest = minecraft.latestRuntimeContextText.trim()
  return situationContextText(latest
    ? `Minecraft bot (${status}): ${latest}`
    : `Minecraft bot (${status}): no live context yet.`)
}

/**
 * Feeds the Minecraft integration status into the situation as the `system:minecraft-integration` context.
 *
 * Starts the Minecraft store, which listens on the server channel. The watch also tracks leadership, so a window
 * that becomes the leader (and starts from an empty situation) ingests the current status at once. An empty text
 * clears the source when the Minecraft service disappears.
 *
 * Returns the function that stops the watch. It leaves the Minecraft store running for its other readers.
 */
export function startMinecraftSensor(): () => void {
  const minecraft = useMinecraftStore()
  const situation = useSituationStore()
  minecraft.initialize()

  return watch(
    () => [situation.leading, minecraftContextText(minecraft)] as const,
    ([leading, text]) => {
      if (!leading)
        return
      situation.ingest({ kind: 'context', sourceKey: MINECRAFT_CONTEXT_SOURCE_KEY, text, atMs: Date.now() })
    },
    { immediate: true },
  )
}
