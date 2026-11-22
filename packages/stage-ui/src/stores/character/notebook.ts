import type { TaskPriority } from '@proj-airi/stage-shared/situation'

import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type NotebookEntryKind = 'note' | 'diary' | 'focus'

export interface NotebookEntry {
  id: string
  kind: NotebookEntryKind
  text: string
  createdAt: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export type { TaskPriority } from '@proj-airi/stage-shared/situation'
export type TaskStatus = 'queued' | 'scheduled' | 'done' | 'dropped'

export interface ScheduledTask {
  id: string
  title: string
  details?: string
  priority: TaskPriority
  status: TaskStatus
  dueAt?: number
  createdAt: number
  updatedAt: number
  lastNotifiedAt?: number
  nextNotifyAt?: number
  /** Explicit rescheduling creates a new occurrence; delivery bookkeeping never does. */
  revision: number
  addressedRevision?: number
  firstNotifiedAt?: number
  metadata?: Record<string, unknown>
}

export const useCharacterNotebookStore = defineStore('character-notebook', () => {
  const entries = ref<NotebookEntry[]>([])
  const tasks = ref<ScheduledTask[]>([])

  const partitionDiary = computed(() => entries.value.filter(entry => entry.kind === 'diary'))
  const partitionFocus = computed(() => entries.value.filter(entry => entry.kind === 'focus'))

  function addEntry(kind: NotebookEntryKind, text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    const entry: NotebookEntry = {
      id: nanoid(),
      kind,
      text,
      createdAt: Date.now(),
      tags: options?.tags,
      metadata: options?.metadata,
    }

    entries.value.push(entry)
    return entry
  }

  function addNote(text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('note', text, options)
  }

  function addDiaryEntry(text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('diary', text, options)
  }

  function addFocusEntry(text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('focus', text, options)
  }

  function scheduleTask(payload: {
    title: string
    details?: string
    priority?: TaskPriority
    dueAt?: number
    metadata?: Record<string, unknown>
  }) {
    const now = Date.now()
    const task: ScheduledTask = {
      id: nanoid(),
      title: payload.title,
      details: payload.details,
      priority: payload.priority ?? 'normal',
      status: payload.dueAt ? 'scheduled' : 'queued',
      dueAt: payload.dueAt,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      metadata: payload.metadata,
    }

    tasks.value.push(task)
    return task
  }

  function markTaskDone(taskId: string) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.status = 'done'
    task.updatedAt = Date.now()
  }

  function requeueTask(taskId: string, options?: { dueAt?: number, reason?: string }) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.status = 'queued'
    task.dueAt = options?.dueAt
    task.updatedAt = Date.now()
    task.revision += 1
    task.firstNotifiedAt = undefined
    task.nextNotifyAt = undefined
    task.metadata = {
      ...task.metadata,
      requeueReason: options?.reason,
    }
  }

  function markTaskNotified(taskId: string, nextNotifyAt?: number) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.lastNotifiedAt = Date.now()
    task.firstNotifiedAt ??= task.lastNotifiedAt
    task.nextNotifyAt = nextNotifyAt
    task.updatedAt = Date.now()
  }

  /** Every settled attempt consumes its occurrence, including a decline or failed generation. */
  function addressTask(taskId: string, revision: number) {
    const task = tasks.value.find(item => item.id === taskId)
    if (task?.revision === revision)
      task.addressedRevision = revision
  }

  function getDueTasks(now: number, windowMs: number) {
    return tasks.value.filter((task) => {
      if (task.status === 'done' || task.status === 'dropped')
        return false
      if (task.addressedRevision === task.revision)
        return false
      const dueAt = task.dueAt ?? task.createdAt
      if (dueAt > now + windowMs)
        return false
      if (typeof task.nextNotifyAt === 'number' && task.nextNotifyAt > now)
        return false
      return true
    })
  }

  return {
    entries,
    tasks,
    partitionDiary,
    partitionFocus,
    addNote,
    addDiaryEntry,
    addFocusEntry,
    scheduleTask,
    markTaskDone,
    requeueTask,
    markTaskNotified,
    addressTask,
    getDueTasks,
  }
})
