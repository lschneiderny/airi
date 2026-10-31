<script setup lang="ts">
import type { ToolCallRerunRequest } from '../../../../stores/tool-call-rerun'
import type { ChatAssistantMessage, ChatHistoryItem, ChatSlices, ChatSlicesText, ChatSlicesToolCallResult } from '../../../../types/chat'
import type { ChatHistoryReplyPayload } from '../reply'
import type { ChatToolCallRendererRegistry } from './tool-call-renderer'

import { isStageCapacitor, isStageWeb } from '@proj-airi/stage-shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import ChatReplyQuote from './reply-quote.vue'
import ResponseCitations from './response-citations.vue'
import ChatResponsePart from './response-part.vue'
import ChatSticker from './sticker.vue'
import ChatToolCallBlock from './tool-call-block.vue'

import { MarkdownRenderer } from '../../../markdown'
import { getChatHistoryItemCopyText, splitSlicesIntoBubbles } from '../utils'
import { ChatActionMenu } from './action-menu'
import { createToolCallResultLookup, resolveToolCallBlockState } from './tool-call-results'

const props = withDefaults(defineProps<{
  message: ChatAssistantMessage
  label: string
  replyTarget?: ChatHistoryReplyPayload
  canReply?: boolean
  scrollContainer?: HTMLElement | null
  showPlaceholder?: boolean
  /**
   * `true` while this message is the live stream of the history. A bubble after a break then appears `seconds` after
   * the break slice arrived, on a schedule that keeps running after generation ends, as long as this item stays
   * mounted. A message mounted complete shows every bubble at once.
   */
  streaming?: boolean
  variant?: 'desktop' | 'mobile'
  /** How the bubble paints its background; see `ChatHistory`'s `surface`. */
  surface?: 'translucent' | 'opaque'
  toolCallRenderers?: ChatToolCallRendererRegistry
}>(), {
  canReply: false,
  showPlaceholder: false,
  streaming: false,
  scrollContainer: null,
  variant: 'desktop',
  surface: 'translucent',
  toolCallRenderers: () => ({}),
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'delete'): void
  (e: 'reply'): void
  /** A bubble after a break appeared on the reveal schedule; the item grew without any change to its message. */
  (e: 'reveal'): void
  (e: 'toolCallRerun', payload: ToolCallRerunRequest): void
}>()

const resolvedSlices = computed<ChatSlices[]>(() => {
  if (props.message.slices?.length) {
    return props.message.slices
  }

  if (typeof props.message.content === 'string' && props.message.content.trim()) {
    return [{ type: 'text', text: props.message.content } satisfies ChatSlicesText]
  }

  if (Array.isArray(props.message.content)) {
    const textPart = props.message.content.find(part => 'type' in part && part.type === 'text') as { text?: string } | undefined
    if (textPart?.text)
      return [{ type: 'text', text: textPart.text } satisfies ChatSlicesText]
  }

  return []
})

const toolResultBySlice = computed(() => {
  return createToolCallResultLookup(resolvedSlices.value, props.message.tool_results)
})

function getToolCallResult(sliceIndex: number): ChatSlicesToolCallResult | undefined {
  return toolResultBySlice.value.get(sliceIndex)
}

const invocationBySlice = computed(() => {
  const invocations = props.message.generationTranscript?.rounds.flatMap(round => round.toolInvocations)
  const occurrences = new Map<string, number>()
  const ids = new Map<number, string>()
  for (const [index, slice] of resolvedSlices.value.entries()) {
    if (slice.type !== 'tool-call')
      continue
    const callId = slice.toolCall.toolCallId
    const occurrence = occurrences.get(callId) ?? 0
    occurrences.set(callId, occurrence + 1)
    const invocation = invocations?.filter(call => call.callId === callId)[occurrence]
    if (invocation)
      ids.set(index, invocation.id)
  }
  return ids
})

/**
 * Triggering workflow: ChatToolCallBlock `toolCallRerun` -> emitToolCallRerun
 * -> ChatHistory `toolCallRerun` -> executeToolCallRerun in the owning runtime.
 */
function emitToolCallRerun(sliceIndex: number, payload: ToolCallRerunRequest) {
  const invocationId = invocationBySlice.value.get(sliceIndex)
  emit('toolCallRerun', invocationId === undefined ? payload : { ...payload, invocationId })
}

function getToolCallRenderer(slice: ChatSlices) {
  if (slice.type !== 'tool-call') {
    return ChatToolCallBlock
  }

  return props.toolCallRenderers[slice.toolCall.toolName] ?? ChatToolCallBlock
}

const bubbles = computed(() => splitSlicesIntoBubbles(resolvedSlices.value))
const breakSlices = computed(() => resolvedSlices.value.filter(slice => slice.type === 'break'))

/**
 * Reveal schedule of the bubbles after a break, in epoch milliseconds: entry `i` is when the bubble after break `i`
 * may appear. It never decreases, so bubbles appear in order even when a later break asks for a shorter pause.
 * The item owns the one pending timer and clears it on unmount.
 */
const revealDeadlines: number[] = []
/** Breaks whose next bubble is visible. Infinity for a message mounted complete, which hides nothing. */
const revealedBreaks = ref(props.streaming ? 0 : Number.POSITIVE_INFINITY)
let revealTimer: ReturnType<typeof setTimeout> | undefined

function scheduleNextReveal() {
  clearTimeout(revealTimer)
  revealTimer = undefined
  const deadline = revealDeadlines[revealedBreaks.value]
  if (deadline === undefined)
    return
  revealTimer = setTimeout(() => {
    revealedBreaks.value += 1
    emit('reveal')
    scheduleNextReveal()
  }, Math.max(0, deadline - Date.now()))
}

watch(breakSlices, (breaks) => {
  if (!Number.isFinite(revealedBreaks.value))
    return
  for (let index = revealDeadlines.length; index < breaks.length; index++) {
    const slice = breaks[index]
    const pauseMs = slice.type === 'break' ? slice.seconds * 1000 : 0
    revealDeadlines.push(Math.max(revealDeadlines[index - 1] ?? 0, Date.now() + pauseMs))
  }
  scheduleNextReveal()
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(revealTimer))

const visibleBubbles = computed(() => bubbles.value.slice(0, revealedBreaks.value + 1))

const showLoader = computed(() => props.showPlaceholder && resolvedSlices.value.length === 0)
/** The bubble shells to draw: the visible bubbles, or one empty shell that holds the loader. */
const shells = computed(() => visibleBubbles.value.length ? visibleBubbles.value : showLoader.value ? [[]] : [])
const containerClass = computed(() => props.variant === 'mobile' ? 'mr-0' : 'mr-12')
const boxClasses = computed(() => {
  const spacing = props.variant === 'mobile' ? 'px-2 py-2 text-sm' : 'px-3 py-3'
  if (props.surface === 'opaque')
    return [spacing, 'bg-primary-50 shadow-md dark:bg-primary-950']

  return [
    spacing,
    props.variant === 'mobile'
      ? 'bg-primary-50/60 backdrop-blur-xl dark:bg-primary-950/60'
      : 'bg-primary-50/80 dark:bg-primary-950/75',
  ]
})
const copyText = computed(() => getChatHistoryItemCopyText(props.message as ChatHistoryItem))
</script>

<template>
  <div flex :class="['font-cute', containerClass]" class="ph-no-capture">
    <ChatActionMenu
      :copy-text="copyText"
      :can-reply="canReply"
      :can-delete="!showPlaceholder"
      :press-feedback-enabled="variant === 'mobile'"
      :scroll-container="scrollContainer"
      @copy="emit('copy')"
      @delete="emit('delete')"
      @reply="emit('reply')"
    >
      <template #default="{ setMeasuredElement }">
        <!-- One shell per bubble; the quote, reasoning, and label stay on the first, the citations on the last. -->
        <div v-if="shells.length" :ref="setMeasuredElement" :class="['flex min-w-0 flex-col items-start gap-1.5']">
          <div
            v-for="(bubble, bubbleIndex) in shells"
            :key="bubbleIndex"
            data-chat-bubble
            :class="[
              'chat-message-item-container',
              'flex flex-col gap-2',
              'min-w-20 max-w-full rounded-xl',
              'h-unset <sm:h-fit',
              'shadow-sm shadow-primary-200/50 dark:shadow-none',
              boxClasses,
              (isStageWeb() || isStageCapacitor()) && props.variant === 'mobile' ? 'select-none sm:select-auto' : '',
            ]"
          >
            <template v-if="bubbleIndex === 0">
              <ChatReplyQuote v-if="replyTarget" :target="replyTarget" />
              <ChatResponsePart
                v-if="message.categorization"
                :message="message"
                :variant="variant"
              />
              <div class="<sm:hidden">
                <span :class="['text-sm font-normal', 'text-black/60 dark:text-white/65']">{{ label }}</span>
              </div>
            </template>
            <div v-if="bubble.length > 0" :class="['flex flex-col gap-2 break-words', 'text-primary-700 dark:text-primary-100']">
              <template v-for="{ slice, index: sliceIndex } in bubble" :key="sliceIndex">
                <component
                  :is="getToolCallRenderer(slice)"
                  v-if="slice.type === 'tool-call'"
                  :tool-call-id="slice.toolCall.toolCallId"
                  :tool-name="slice.toolCall.toolName"
                  :args="slice.toolCall.args"
                  :state="resolveToolCallBlockState(getToolCallResult(sliceIndex))"
                  :result="getToolCallResult(sliceIndex)?.result"
                  @tool-call-rerun="emitToolCallRerun(sliceIndex, $event)"
                />
                <template v-else-if="slice.type === 'tool-call-result'" />
                <ChatSticker v-else-if="slice.type === 'sticker'" :sticker-id="slice.stickerId" />
                <template v-else-if="slice.type === 'text'">
                  <MarkdownRenderer :content="slice.text" />
                </template>
              </template>
            </div>
            <ResponseCitations v-if="bubbleIndex === shells.length - 1 && message.citations?.length" :citations="message.citations" />
            <div v-if="bubble.length === 0 && showLoader" i-eos-icons:three-dots-loading />
          </div>
        </div>
      </template>
    </ChatActionMenu>
  </div>
</template>
